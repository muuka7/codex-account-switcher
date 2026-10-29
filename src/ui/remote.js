/* SSH server view. Only public metadata crosses the preload bridge. */
let remoteHost = '', remoteSnapshot = null, remoteBusy = false, remoteLoadId = 0;
let serverInventory = { hosts: [], warnings: [] }, remoteNameAction = 'import', deviceHost = null;
let copyCodeTimer;
const remoteApi = api.remote;

function remoteNode(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text; return node;
}
function remoteButton(label, action, disabled = false) {
  const button = remoteNode('button', 'btn btn-sm', label); button.type = 'button'; button.disabled = disabled;
  button.addEventListener('click', action); return button;
}
function remoteWindowLabel(window) {
  const minutes = window.windowDurationMins;
  if (minutes === 10080) return 'Weekly';
  return minutes % 60 === 0 ? `${minutes / 60}h window` : `${minutes}m window`;
}
function renderRemoteUsage(target, usage, name, ring = false) {
  target.replaceChildren();
  for (const bucket of usage?.buckets || []) {
    for (const window of [bucket.primary, bucket.secondary].filter(Boolean)) {
      target.append(quotaRail(`${bucket.name || bucket.id} · ${remoteWindowLabel(window)}`, window, name, { ring }));
    }
  }
  if (!target.childNodes.length) target.append(remoteNode('p', 'remote-copy', 'Usage has not been read for this account.'));
  if (usage) {
    const checked = usage.checkedAt ? new Date(usage.checkedAt).toLocaleString() : 'unknown';
    target.append(remoteNode('p', 'remote-copy', `${usage.stale || usage.error ? 'Last reading (may be stale)' : 'Read'}: ${checked}${usage.error ? ` · ${usage.error}` : ''}`));
  }
}
function renderRemote() {
  const snapshot = remoteSnapshot, doctor = snapshot?.doctor;
  el('remote-title').textContent = remoteHost;
  el('account-location').disabled = remoteBusy;
  el('manage-servers').disabled = remoteBusy;
  for (const id of ['remote-reconnect', 'remote-setup', 'remote-import', 'remote-login', 'remote-recover', 'remote-refresh-saved', 'remote-terminal']) el(id).disabled = remoteBusy;
  if (!doctor) {
    el('remote-status').textContent = remoteBusy ? 'Connecting over SSH…' : 'Connect or set up the Linux helper to read server accounts.';
    el('remote-live').hidden = true; el('remote-maintenance').hidden = true;
    el('remote-import').disabled = true; el('remote-login').disabled = true;
    el('remote-refresh-saved').disabled = true; el('remote-recover').hidden = true;
    el('remote-terminal').hidden = true;
    el('remote-accounts').replaceChildren(); el('remote-empty').hidden = true;
    return;
  }
  el('remote-status').textContent = `${doctor.host} · ${doctor.codexVersion || 'Codex unavailable'} · helper ${doctor.helperVersion || 'unknown'}${remoteBusy ? ' · Operation in progress…' : ''}`;
  el('remote-setup').hidden = false; el('remote-setup').textContent = 'Update helper';
  el('remote-live').hidden = !snapshot.live;
  if (snapshot.live) {
    el('remote-live-account').textContent = `${snapshot.live.account?.email || 'Account unavailable'}${snapshot.live.account?.planType ? ` · ${snapshot.live.account.planType}` : ''}`;
    renderRemoteUsage(el('remote-live-usage'), snapshot.live, 'connected daemon');
    el('remote-live-note').textContent = 'Read from the existing daemon. Its workspace identity is not available, so this reading is kept separate from saved accounts. Other terminal sessions may use another account.';
  }
  const blockers = [];
  if (doctor.running.length) blockers.push(`${doctor.running.length} Codex processes are running. Finish work and disconnect affected clients before refreshing saved accounts or switching. Live usage and adding a new account remain available.`);
  if (!doctor.fileStoreReady) blockers.push('Before switching, set cli_auth_credentials_store = "file" at the top level of the server’s ~/.codex/config.toml.');
  if (doctor.vaultExists && !snapshot.keyAvailable) blockers.push('Unlock this vault with its existing terminal passphrase or the key from the computer that created it. Update the helper if it predates desktop vault unlocking.');
  if (snapshot.state?.recoveryRequired) blockers.push('A previous transaction needs recovery before adding or switching accounts.');
  el('remote-maintenance').textContent = blockers.join(' '); el('remote-maintenance').hidden = !blockers.length;
  const canMutate = !remoteBusy && (!doctor.vaultExists || snapshot.keyAvailable) && !snapshot.state?.recoveryRequired;
  el('remote-import').disabled = !canMutate; el('remote-login').disabled = !canMutate;
  el('remote-refresh-saved').disabled = !canMutate || doctor.running.length > 0 || !doctor.vaultExists;
  el('remote-recover').hidden = !snapshot.state?.recoveryRequired; el('remote-recover').disabled = remoteBusy || !snapshot.keyAvailable || doctor.running.length > 0;
  el('remote-terminal').hidden = !doctor.vaultExists;
  el('remote-terminal').textContent = snapshot.keyAvailable ? 'Terminal access…' : 'Unlock vault…';
  const accounts = snapshot.state?.accounts || []; el('remote-empty').hidden = accounts.length > 0;
  el('remote-accounts').replaceChildren(...accounts.map((account, position) => ({ account, position }))
    .sort((a, b) => Number(Boolean(b.account.isSelected)) - Number(Boolean(a.account.isSelected)))
    .map(({ account, position }) => remoteAccountCard(account, position, canMutate, doctor)));
}
/* Server accounts share the local card grammar: the login the server is using
   leads as the hero, the rest sit in the grid. */
function remoteAccountCard(account, position, canMutate, doctor) {
  const selected = Boolean(account.isSelected);
  const card = remoteNode('div', `acct${selected ? ' is-active' : ''}`);
  const top = remoteNode('div', 'acct-top');
  const avatar = remoteNode('span', `avatar tone-${position % 4}`, initials(account.label));
  avatar.setAttribute('aria-hidden', 'true');
  const copy = remoteNode('span', 'acct-copy'), nameRow = remoteNode('span', 'acct-name');
  nameRow.append(remoteNode('strong', '', account.label));
  if (selected) {
    const chip = remoteNode('span', 'chip chip-ok');
    chip.append(remoteNode('span', 'dot'), document.createTextNode('Selected'));
    chip.title = 'Selected in the server auth file';
    nameRow.append(chip);
  }
  copy.append(nameRow, remoteNode('span', 'acct-meta', account.identity.email || 'Unknown email'));
  top.append(avatar, copy);

  // Workspace identifiers are shown so two logins with the same email can
  // be distinguished without treating email alone as proof of identity.
  const tags = remoteNode('div', 'acct-tags');
  tags.append(remoteNode('span', 'chip chip-accent', account.identity.planType || 'Plan unknown'));
  const workspace = remoteNode('span', 'chip mono', `Workspace ${account.identity.accountId || 'unknown'}`);
  workspace.title = 'Workspace identifier';
  tags.append(workspace);

  const usage = remoteNode('div', 'acct-usage');
  renderRemoteUsage(usage, account.usage, account.label, selected);

  const foot = remoteNode('div', 'acct-foot');
  foot.append(remoteButton('Re-authenticate', () => beginRemoteName('reauth', account.label), !canMutate || doctor.running.length > 0));
  if (!selected) {
    const switchBtn = remoteButton('Switch to this account', () => switchRemoteAccount(account), !canMutate || doctor.running.length > 0 || !doctor.fileStoreReady);
    switchBtn.classList.add('btn-switch');
    foot.append(switchBtn);
  }
  card.append(top, tags, usage, foot);
  return card;
}
function remoteError(error) {
  el('remote-error').textContent = error?.message || 'The server operation failed.'; el('remote-error').hidden = false;
}
async function loadRemote(host = remoteHost) {
  const id = ++remoteLoadId; remoteSnapshot = null; el('remote-error').hidden = true; el('remote-setup').hidden = true;
  remoteBusy = true; renderRemote();
  try { const snapshot = await remoteApi.snapshot(host); if (id === remoteLoadId && host === remoteHost) remoteSnapshot = snapshot; }
  catch (error) { if (id === remoteLoadId) { remoteError(error); el('remote-setup').hidden = false; } }
  finally {
    if (id === remoteLoadId) {
      remoteBusy = false; renderRemote();
      if (remoteSnapshot?.stateError || remoteSnapshot?.liveError) remoteError({ message: [remoteSnapshot.stateError, remoteSnapshot.liveError].filter(Boolean).join(' ') });
    }
  }
}
async function selectRemote(host) {
  if (remoteBusy) return;
  remoteHost = host; el('account-location').value = host;
  el('location-icon').innerHTML = codexIcon(host ? 'server' : 'monitor');
  el('local-view').hidden = Boolean(host); el('remote-view').hidden = !host;
  // Local shortcuts/settings continue to refer to this computer only.
  el('open-codex').hidden = Boolean(host);
  if (host) await loadRemote(host);
}
async function refreshServerInventory() {
  serverInventory = await remoteApi.servers();
  const select = el('account-location'); select.replaceChildren(new Option('This computer', ''));
  for (const host of serverInventory.hosts) select.add(new Option(`${host.alias}${host.user ? ` (${host.user})` : ''}`, host.alias));
  select.value = remoteHost;
  el('servers-warning').textContent = serverInventory.warnings.join(' ');
  el('servers-list').replaceChildren(...serverInventory.hosts.map(host => {
    const row = remoteNode('div', 'server-row'), copy = remoteNode('p', 'remote-copy');
    copy.append(remoteNode('strong', '', host.alias), document.createTextNode(`${host.user ? `${host.user}@` : ''}${host.hostname}${host.port ? `:${host.port}` : ''} · ${host.manual ? 'Added manually' : 'SSH config'}`));
    row.append(copy, remoteButton('Connect', async () => { closeLayer(el('servers-dialog')); await selectRemote(host.alias); }));
    row.append(remoteButton(host.saved ? 'Remove' : 'Save', async () => {
      try { host.saved ? await remoteApi.remove(host.alias) : await remoteApi.add({ alias: host.alias }); await refreshServerInventory(); }
      catch (error) { serverFormError(error); }
    })); return row;
  }));
}
function serverFormError(error) { el('servers-form-error').textContent = error.message; el('servers-form-error').hidden = false; }
async function performRemote(method, label) {
  if (remoteBusy) return; remoteBusy = true; el('remote-error').hidden = true; renderRemote();
  const host = remoteHost;
  try {
    remoteSnapshot = method === 'install' ? await remoteApi.install(host) : await remoteApi.mutate(host, method, label);
    if (['login', 'reauth'].includes(method)) showAlert('ok', 'Account saved on the server. The active login was not switched.');
    else if (method === 'switch') showAlert('ok', 'Server login switched. Reconnect Codex before starting work.');
  } catch (error) {
    remoteError(error);
    // A dropped connection can hide a completed commit; reconcile before
    // presenting another credential action rather than replaying the request.
    try { remoteSnapshot = await remoteApi.snapshot(host); } catch { remoteSnapshot = null; }
  } finally {
    if (deviceHost === host) { closeLayer(el('remote-device-dialog')); deviceHost = null; el('remote-device-code').textContent = ''; clearTimeout(copyCodeTimer); el('remote-copy-status').textContent = ''; }
    remoteBusy = false; renderRemote();
  }
}
function beginRemoteName(method, label = '') {
  if (remoteBusy) return; remoteNameAction = method; el('remote-label').value = label; el('remote-label').disabled = method === 'reauth';
  el('remote-name-title').textContent = method === 'import' ? 'Save the current server login' : method === 'reauth' ? 'Re-authenticate server account' : 'Add a server account';
  el('remote-name-note').textContent = method === 'import' ? 'A snapshot of the current file login will be encrypted on this server. Existing sessions keep running.' : 'Complete official OpenAI device login in your browser. The new credentials are saved privately on the server; enrollment does not switch its current login.';
  el('remote-name-error').hidden = true; openLayer(el('remote-name-dialog'), el('remote-label'));
}
async function switchRemoteAccount(account) {
  if (await askConfirm({ title: `Switch ${remoteHost} to ${account.label}?`, message: 'The server auth file will be replaced after validating and preserving both saved accounts. All affected Codex clients must be stopped. Reconnect them after switching to use this account.', confirmLabel: 'Switch server account' })) await performRemote('switch', account.label);
}
function cancelRemoteLogin() {
  if (deviceHost) {
    el('remote-device-status').textContent = 'Cancelling and preserving login state…'; el('remote-device-cancel').disabled = true;
    el('remote-device-copy').disabled = true;
    remoteApi.cancel(deviceHost).catch(remoteError);
  }
}

el('account-location').addEventListener('change', event => selectRemote(event.target.value));
el('manage-servers').addEventListener('click', async () => {
  el('servers-form-error').hidden = true;
  try { await refreshServerInventory(); openLayer(el('servers-dialog')); } catch (error) { reportError(error); }
});
el('servers-done').addEventListener('click', () => closeLayer(el('servers-dialog')));
el('server-add').addEventListener('click', async () => {
  try {
    await remoteApi.add({ alias: el('server-alias').value.trim(), address: el('server-address').value.trim(), user: el('server-user').value.trim(), port: el('server-port').value.trim() });
    await refreshServerInventory(); for (const id of ['server-alias', 'server-address', 'server-user', 'server-port']) el(id).value = '';
    el('servers-form-error').hidden = true;
  } catch (error) { serverFormError(error); }
});
el('remote-reconnect').addEventListener('click', () => loadRemote());
el('remote-setup').addEventListener('click', async () => {
  if (await askConfirm({ title: `Set up ${remoteHost}?`, message: 'Install the source-only helper and two pinned dependencies over SSH as your user. Requires Linux with Node.js 20+ and npm. Existing logins, vaults and Codex processes are preserved.', confirmLabel: 'Install helper' })) await performRemote('install');
});
el('remote-import').addEventListener('click', () => beginRemoteName('import'));
el('remote-login').addEventListener('click', () => beginRemoteName('login'));
el('remote-name-cancel').addEventListener('click', () => closeLayer(el('remote-name-dialog')));
el('remote-name-confirm').addEventListener('click', async () => {
  const label = el('remote-label').value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(label)) {
    el('remote-name-error').textContent = 'Use 1–64 letters, digits, dots, underscores or hyphens.'; el('remote-name-error').hidden = false; return;
  }
  closeLayer(el('remote-name-dialog')); await performRemote(remoteNameAction, label);
});
el('remote-refresh-saved').addEventListener('click', () => performRemote('refresh'));
el('remote-recover').addEventListener('click', () => performRemote('recover'));
el('remote-terminal').addEventListener('click', () => {
  const available = remoteSnapshot?.keyAvailable === true;
  el('remote-vault-title').textContent = available ? 'Terminal access' : 'Unlock server vault';
  el('remote-vault-export').hidden = !available; el('remote-vault-unlock').hidden = available;
  el('remote-vault-status').textContent = ''; el('remote-vault-passphrase').value = '';
  el('remote-vault-copy').textContent = 'Copy vault key for terminal';
  openLayer(el('remote-vault-dialog'), el(available ? 'remote-vault-copy' : 'remote-vault-passphrase'));
});
el('remote-vault-done').addEventListener('click', () => { el('remote-vault-passphrase').value = ''; closeLayer(el('remote-vault-dialog')); });
el('remote-vault-copy').addEventListener('click', async () => {
  el('remote-vault-copy').disabled = true;
  try { await remoteApi.copyVaultKey(remoteHost); el('remote-vault-copy').textContent = 'Copied'; el('remote-vault-status').textContent = 'Vault key copied. Paste only into the helper’s hidden passphrase prompt or your password manager.'; }
  catch (error) { el('remote-vault-status').textContent = error.message; }
  finally { el('remote-vault-copy').disabled = false; }
});
el('remote-vault-verify').addEventListener('click', async () => {
  const passphrase = el('remote-vault-passphrase').value; el('remote-vault-passphrase').value = '';
  el('remote-vault-verify').disabled = true; remoteBusy = true; renderRemote();
  try { remoteSnapshot = await remoteApi.unlock(remoteHost, passphrase); closeLayer(el('remote-vault-dialog')); renderRemote(); }
  catch (error) { el('remote-vault-status').textContent = error.message; }
  finally { el('remote-vault-verify').disabled = false; remoteBusy = false; renderRemote(); }
});
el('remote-device-open').addEventListener('click', () => remoteApi.openLogin().catch(remoteError));
el('remote-device-cancel').addEventListener('click', cancelRemoteLogin);
el('remote-device-copy').addEventListener('click', async () => {
  if (!deviceHost) return;
  try {
    await remoteApi.copyCode(deviceHost);
    clearTimeout(copyCodeTimer); el('remote-device-copy').textContent = 'Copied';
    el('remote-copy-status').textContent = 'Sign-in code copied to clipboard.';
    copyCodeTimer = setTimeout(() => { el('remote-device-copy').textContent = 'Copy code'; }, 2000);
  } catch { el('remote-copy-status').textContent = 'Could not copy. Select the code and use your keyboard’s Copy command.'; }
});
remoteApi.onEvent(event => {
  if (event.host !== remoteHost || !remoteBusy || event.kind !== 'device-code') return;
  deviceHost = event.host; el('remote-device-code').textContent = event.userCode;
  clearTimeout(copyCodeTimer); el('remote-device-copy').textContent = 'Copy code'; el('remote-device-copy').disabled = false; el('remote-copy-status').textContent = '';
  el('remote-device-status').textContent = 'Waiting for browser sign-in…'; el('remote-device-cancel').disabled = false;
  if (el('remote-device-dialog').hidden) openLayer(el('remote-device-dialog'), el('remote-device-open'));
});
refreshServerInventory().catch(reportError);
