const messages = Object.freeze({
  ARGUMENTS: 'The request is invalid.', PROTOCOL_MISMATCH: 'The helper protocol is incompatible. Update the server helper.',
  VAULT_LOCKED: 'The server vault key is missing, incorrect, or the vault is damaged.',
  PASSPHRASE_REQUIRED: 'A server vault key is required.', INVALID_AUTH: 'A valid ChatGPT file login is required on this server.',
  ACCOUNT_EXISTS: 'That label or account/workspace is already saved.', ACCOUNT_NOT_FOUND: 'That account is not saved.',
  INVALID_LABEL: 'Use 1–64 letters, digits, dots, underscores or hyphens for the account label.',
  NO_LOGIN: 'No current file login was found. Add an account through device login.',
  CODEX_RUNNING: 'Codex is running on the server. Finish work and disconnect affected clients before refreshing saved accounts or switching.',
  PROCESS_CHECK_FAILED: 'The helper could not verify running Codex processes. No login was changed.',
  FILE_STORE_REQUIRED: 'Server switching requires explicit file credential storage in the Codex config.',
  UNSUPPORTED_CONFIG: 'This server configuration is not supported for shared-home switching.',
  UNSUPPORTED_AUTH: 'External or managed authentication is active. Use the owning Codex daemon for usage.',
  WORKSPACE_RESTRICTED: 'The account does not match the server workspace restriction.',
  UNSAVED_LOGIN: 'Save the current server account before switching.',
  BUSY: 'Another credential operation is active, or its lock needs recovery after a crash.',
  RECOVERY_REQUIRED: 'A previous credential transaction needs recovery before making more changes.',
  LIVE_AUTH_CHANGED: 'The server login changed during the operation. No unfamiliar login was overwritten.',
  PERSIST_FAILED: 'Refreshed credentials could not be encrypted. A private recovery copy remains on the server; resolve storage before continuing.',
  UNSAFE_PATH: 'The helper found unsafe file ownership, permissions, or a symlink.',
  INVALID_DATA: 'The saved data is invalid or unsupported.', IDENTITY_MISMATCH: 'The authenticated account/workspace did not match the expected account.',
  UNSAFE_SOCKET: 'The Codex daemon socket is not private or has unexpected ownership.',
  LIVE_USAGE_TIMEOUT: 'The existing Codex daemon did not answer in time.', LIVE_USAGE_UNAVAILABLE: 'Live daemon usage is unavailable. No new daemon was started.',
  CANCELLED: 'The operation was cancelled after preserving any in-flight credential changes.',
  LOGIN_FAILED: 'Codex device login did not complete. Use a current Codex CLI and enable device-code login for this account or workspace. The active account was not switched.',
  USAGE_UNAVAILABLE: 'Codex did not return quota information.', APP_SERVER_STOP_FAILED: 'A helper-owned Codex process could not be stopped. A private recovery copy was retained.',
});
function publicError(error) {
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'OPERATION_FAILED';
  return { code, message: messages[code] || 'The server operation failed. Raw configuration, credentials and server output were withheld.' };
}
module.exports = { publicError };
