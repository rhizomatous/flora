# Main screen chatbox

## Connected

- [x] Project picker uses saved projects, supports search, and selects the project used when sending.
- [x] New project and Manage projects open the existing project screens.
- [x] Text submission starts a chat through the existing API, including retry identity, byte-limit validation, and error handling.
- [x] Enter sends, Shift+Enter adds a newline, and composing text with an IME does not send.
- [x] The microphone changes to a send button when a message is entered.

## Disconnected placeholders

The menus open, but their unfinished actions are disabled. Default model, reasoning, and branch labels do not claim a particular backend configuration.

- [ ] Cloud: show actual runtime status and machine details; implement machine selection and wake controls.
- [ ] Setup: implement setup assistance and snapshots. The plain button is currently disabled.
- [ ] Branch: load the project's actual branches and allow a per-chat base branch override. Currently the server uses the saved project configuration.
- [ ] Attachments: upload, store, preview, remove, and send attachments with messages.
- [ ] Context: add environment variables, people, threads, pull requests, skills, and files to a message.
- [ ] Chat settings: implement access, machine size, setup/snapshots, environment variables, MCP servers, pinning, folders, and tags.
- [ ] Model: load supported models and pass the selected model to the backend. Currently uses the server default.
- [ ] Reasoning effort: load supported options and pass the selection to the backend. Currently uses the server default.
- [ ] Voice input: record and transcribe audio. The microphone button is currently disabled.
- [ ] Slash commands and @ context: implement suggestions, keyboard selection, and structured message payloads. The reference placeholder is present, but text is sent literally.

## Other reference views

- [ ] Apply the chatbox styling to the existing-chat composer, preserving interrupt, stop, follow-up drafts, and blocked-state behavior.
- [ ] Existing-chat PR summary and menu: connect branch/PR details, checks, diff counts, and actions.
- [ ] Existing-chat context meter: connect token usage, breakdown, and compaction controls.
