const accountsEl = document.getElementById('accounts');
const emptyEl = document.getElementById('empty');
const activeNameEl = document.getElementById('active-name');
const activeEmailEl = document.getElementById('active-email');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('display-name');
const importBtn = document.getElementById('import-btn');

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

function accountRow(account, position) {
  const row = document.createElement('div');
  row.className = `account${account.isActive ? ' active' : ''}`;

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

  if (account.isActive) {
    const badge = document.createElement('button');
    badge.disabled = true;
    badge.textContent = 'Active';
    actions.append(badge);
  } else {
    const useBtn = document.createElement('button');
    useBtn.textContent = 'Switch';
    useBtn.addEventListener('click', async () => {
      try {
        setBusy(`Switching to ${account.displayName}…`);
        const state = await window.codexSwitcher.switchAccount(account.id);
        render(state);
        if (state.warning) setWarning(state.warning);
        else setReady();
      } catch (error) { setError(error); }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      try {
        const state = await window.codexSwitcher.removeAccount(account.id);
        render(state);
        setReady();
      } catch (error) { setError(error); }
    });
    actions.append(useBtn, removeBtn);
  }

  row.append(main, actions);
  return row;
}

function render(state) {
  accountsEl.replaceChildren();
  state.accounts.forEach((account, i) => accountsEl.append(accountRow(account, i)));
  emptyEl.hidden = state.accounts.length > 0;
  const active = state.accounts.find((a) => a.isActive);
  activeNameEl.textContent = active?.displayName || 'None saved';
  activeEmailEl.textContent = active?.email || '';
}

async function refresh() {
  try {
    render(await window.codexSwitcher.getState());
    setReady();
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
    setReady();
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
