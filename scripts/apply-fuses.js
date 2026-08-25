const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');

exports.default = async function afterPack(context) {
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
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
