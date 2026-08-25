const accountsEl = document.getElementById('accounts');
const emptyEl = document.getElementById('empty');
const activeNameEl = document.getElementById('active-name');
const activeEmailEl = document.getElementById('active-email');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('display-name');
const importBtn = document.getElementById('import-btn');
const prepareNewBtn = document.getElementById('prepare-new');
const pendingCard = document.getElementById('pending-card');
const pendingTitle = document.getElementById('pending-title');
const pendingMessage = document.getElementById('pending-message');
const pendingHelp = document.getElementById('pending-help');
const completeReauthBtn = document.getElementById('complete-reauth');
const cancelPendingBtn = document.getElementById('cancel-pending');

function clearStatusClasses() {
  statusEl.classList.remove('error', 'warning');
}

function setBusy(message = 'Working…') {
  statusEl.textContent = message;
  clearStatusClasses();
}

function setError(error) {
  statusEl.textContent = error?.message || String(error);
  clearStatusClasses();
  statusEl.classList.add('error');
}

function setWarning(message) {
  statusEl.textContent = message;
  clearStatusClasses();
  statusEl.classList.add('warning');
}

function setReady() {
  statusEl.textContent = 'Local only';
  clearStatusClasses();
}

function applyStateMessage(state) {
  if (state.warning) setWarning(state.warning);
  else setReady();
}

function accountRow(account, position, state) {
  const row = document.createElement('div');
  row.className = `account${account.isActive ? ' active' : ''}${account.isPendingReauth ? ' pending' : ''}`;

  const main = document.createElement('div');
  main.className = 'account-main';
  const name = document.createElement('div');
  name.className = 'account-name';
  name.textContent = `${position + 1}. ${account.displayName}`;
  const email = document.createElement('div');
  email.className = 'account-email muted';
  email.textContent = account.email || account.planType || 'Saved account';
  main.append(name, email);

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (!account.isActive || state.pendingLogin) {
    const useBtn = document.createElement('button');
    useBtn.textContent = account.isActive ? 'Restore' : 'Switch';
    useBtn.addEventListener('click', async () => {
      try {
        setBusy(`Switching to ${account.displayName}…`);
        const next = await window.codexSwitcher.switchAccount(account.id);
        render(next);
        applyStateMessage(next);
      } catch (error) { setError(error); }
    });
    actions.append(useBtn);
  } else {
    const badge = document.createElement('button');
    badge.disabled = true;
    badge.textContent = 'Active';
    actions.append(badge);
  }

  const reauthBtn = document.createElement('button');
  reauthBtn.textContent = 'Re-auth';
  reauthBtn.disabled = Boolean(state.pendingLogin);
  reauthBtn.addEventListener('click', async () => {
    try {
      setBusy(`Preparing re-auth for ${account.displayName}…`);
      const next = await window.codexSwitcher.prepareReauth(account.id);
      render(next);
      applyStateMessage(next);
    } catch (error) { setError(error); }
  });
  actions.append(reauthBtn);

  if (!account.isActive) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.disabled = Boolean(state.pendingLogin);
    removeBtn.addEventListener('click', async () => {
      try {
        const next = await window.codexSwitcher.removeAccount(account.id);
        render(next);
        setReady();
      } catch (error) { setError(error); }
    });
    actions.append(removeBtn);
  }

  row.append(main, actions);
  return row;
}

function renderPending(state) {
  const pending = state.pendingLogin;
  pendingCard.hidden = !pending;
  completeReauthBtn.hidden = !pending || pending.mode !== 'reauth';
  cancelPendingBtn.hidden = !pending;
  prepareNewBtn.disabled = Boolean(pending);

  if (!pending) {
    pendingMessage.textContent = '';
    pendingHelp.textContent = '';
    importBtn.disabled = false;
    nameInput.disabled = false;
    return;
  }

  if (pending.mode === 'reauth') {
    pendingTitle.textContent = 'RE-AUTHENTICATION IN PROGRESS';
    pendingMessage.textContent = `Sign into ${pending.accountName || 'the selected account'} in the official Codex app.`;
    pendingHelp.textContent = 'Do not use Logout. Complete the normal sign-in, then return here and click Complete re-auth.';
    importBtn.disabled = true;
    nameInput.disabled = true;
  } else {
    pendingTitle.textContent = 'NEW ACCOUNT SIGN-IN IN PROGRESS';
    pendingMessage.textContent = 'Sign into the additional account in the official Codex app.';
    pendingHelp.textContent = 'After Codex finishes signing in, return here, enter a display name below, and click Import.';
    importBtn.disabled = false;
    nameInput.disabled = false;
  }
}

function render(state) {
  accountsEl.replaceChildren();
  state.accounts.forEach((account, i) => accountsEl.append(accountRow(account, i, state)));
  emptyEl.hidden = state.accounts.length > 0;
  const active = state.accounts.find((a) => a.isActive);
  activeNameEl.textContent = active?.displayName || 'None saved';
  activeEmailEl.textContent = active?.email || '';
  renderPending(state);
}

async function refresh() {
  try {
    const state = await window.codexSwitcher.getState();
    render(state);
    applyStateMessage(state);
  } catch (error) { setError(error); }
}

importBtn.addEventListener('click', async () => {
  try {
    const displayName = nameInput.value.trim();
    if (!displayName) throw new Error('Give this account a display name first.');
    setBusy('Encrypting current Codex account…');
    const state = await window.codexSwitcher.importCurrent(displayName);
    nameInput.value = '';
    render(state);
    applyStateMessage(state);
  } catch (error) { setError(error); }
});

prepareNewBtn.addEventListener('click', async () => {
  try {
    setBusy('Preparing a safe additional-account sign-in…');
    const state = await window.codexSwitcher.prepareNewAccount();
    render(state);
    applyStateMessage(state);
  } catch (error) { setError(error); }
});

completeReauthBtn.addEventListener('click', async () => {
  try {
    setBusy('Capturing refreshed Codex credentials…');
    const state = await window.codexSwitcher.completeReauth();
    render(state);
    applyStateMessage(state);
  } catch (error) { setError(error); }
});

cancelPendingBtn.addEventListener('click', async () => {
  try {
    setBusy('Restoring saved account…');
    const state = await window.codexSwitcher.cancelPendingLogin();
    render(state);
    applyStateMessage(state);
  } catch (error) { setError(error); }
});

document.getElementById('open-codex').addEventListener('click', async () => {
  try {
    setBusy('Opening Codex…');
    await window.codexSwitcher.openCodex();
    setReady();
  } catch (error) { setError(error); }
});

document.getElementById('open-store').addEventListener('click', () => window.codexSwitcher.openStoreFolder().catch(setError));

refresh();
