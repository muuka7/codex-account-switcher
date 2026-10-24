const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');
const { bundleRuntime } = require('./bundle-runtime');
const { bundleServer } = require('./bundle-server');

exports.default = async function afterPack(context) {
  await bundleRuntime(context);
  await bundleServer(context);
  const appName = context.packager.appInfo.productFilename;
  let executable;

  if (context.electronPlatformName === 'darwin') {
    executable = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName);
  } else if (context.electronPlatformName === 'win32') {
    executable = path.join(context.appOutDir, `${appName}.exe`);
  } else {
    return;
  }

  await flipFuses(executable, {
    version: FuseVersion.V1,
    // On Apple Silicon, flipping fuses invalidates Electron's embedded
    // ad-hoc signature. Clear it so electron-builder can apply the real
    // Developer ID signature afterward (or produce a launchable local build).
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin' && context.arch === 3,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
