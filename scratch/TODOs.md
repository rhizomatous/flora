# Chat composers

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

- [x] Share the input and toolbar between New Chat and existing chats, preserving interrupt, stop, resume, follow-up drafts, and blocked-state behavior.
- [ ] Existing-chat PR summary and menu: connect branch/PR details, checks, diff counts, and actions.
- [ ] Existing-chat context meter: connect token usage, breakdown, and compaction controls.

## Chat page controls

### Connected

- [x] Title summary opens on hover, keyboard focus, or tap; shows saved chat ID, title, status, and last update.
- [x] Scroll to end keeps the composer fixed while returning to the latest message.
- [x] Cloud menu stops the container through the existing API.
- [x] Open in new tab and Copy link use the current chat route.
- [x] PR/terminal summary expands and collapses without inventing backend data.

### Disconnected placeholders

- [ ] PR summary: fetch associated PRs, titles, status, additions/deletions, checks, and review/open actions. The strip shows “PRs”, not a fabricated count.
- [ ] Terminals: list active shells, open a terminal, and reflect their count in the summary strip.
- [ ] Runtime: report actual machine size, CPU, memory, disk, awake/asleep state, and wake controls. The neutral dot does not report machine health.
- [ ] Context: report usage, limits, system prompt, native tools, rules, codemode catalog, environment, and conversation breakdown; implement compaction thresholds. Unknown values are shown as dashes.
- [ ] Title summary: connect actual model details and associated PR count. Both are currently shown as unavailable.
- [ ] Cost: report actual spend instead of the unavailable dash.
- [ ] Plus menu: search views; add diffs, machine files, setup, browser, side threads, new shell, desktop, and keep-awake controls. Overview is the current chat view.
- [ ] Split review: open a resizable review pane next to the conversation.
- [ ] Chat actions: share, pin, move to folder, tags, promote to Captain, rename, regenerate title, fork, device access, Slack, automation, mark unread, archive, and delete.
- [ ] Rich PR references: render linked PR cards and CI status in the transcript when structured metadata is available.

Attachment/context, model, reasoning, slash-command, and voice placeholders listed above apply to both composers.


## Sidebar refinement

### Connected

- [x] Search chats by title, project, or ID; clear search to restore the full list.
- [x] Collapse individual projects or all projects and sort chats by update time or title for this session.
- [x] Show saved status, relative update time, project counts, and a hover summary for each chat.
- [x] Keep project settings, chat navigation, mobile dismissal, notification sound, and logout connected.

### Disconnected placeholders

- [ ] Add Issues, Pull requests, Automations, Explore, and More destinations.
- [ ] Implement pinned chats and a pinned section, archive actions, and custom folders.
- [ ] Add grouping preferences, display controls, filters, and read/unread tracking. Persist sidebar preferences.
- [ ] Populate hover summaries with model, PR/check details, and diff counts when backend metadata is available.
- [ ] Add workspace identity/avatar data, usage, desktop app integration, appearance settings, and workspace switching.

Sidebar actions that are not connected are disabled; timestamps and statuses come from the saved chat feed.
