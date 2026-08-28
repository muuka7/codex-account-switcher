## What changed

<!-- Describe the user-visible or security-relevant change and why it is needed. -->

## Validation

- [ ] `npm ci` completed successfully
- [ ] `npm run lint` passed
- [ ] Packaging was tested on each affected native platform
- [ ] Documentation and `CHANGELOG.md` are updated when needed

## Review checklist

- [ ] No credentials, tokens, private account data, or signing material are included
- [ ] I considered renderer/IPC, filesystem, process, and navigation boundaries
- [ ] I considered privacy and network behavior; no new collection is implicit
- [ ] Destructive actions remain confirmed and reversible paths preserve state
- [ ] I tested keyboard access, reduced window sizes, and relevant light/dark states

For security-sensitive changes, explain the threat model and test evidence in
the PR description. Report vulnerabilities privately as described in
`SECURITY.md`; do not put exploit details in a public PR.
