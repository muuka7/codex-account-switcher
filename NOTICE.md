# Upstream attribution

This project is derived from ideas and implementation patterns reviewed in:

- GboyCode/CodexAuth (MIT License), including its local-first account switching model, encrypted credential profile concept, atomic credential replacement, and macOS/Windows platform support.
- ZOONGG/codex-swap-account (MIT License), used as UX inspiration for compact account switching and clear active-account presentation.

No claim is made that this repository is an official OpenAI project. Codex, ChatGPT, OpenAI, and related marks belong to their respective owners.

The upstream MIT license text for CodexAuth is retained in `LICENSE`.

The packaged usage-refresh feature includes `@openai/codex`, distributed under
the Apache License 2.0. This dependency provides the Codex App Server runtime;
its inclusion does not make this switcher an official OpenAI application.
