# UI TODOs

## Shared chat composers

### Connected

- [x] Project picker uses saved projects, supports search, and selects the project used when sending.
- [x] New project and Manage projects open the existing project screens.
- [x] Text submission starts a chat through the existing API, including retry identity, byte-limit validation, and error handling.
- [x] Enter sends, Shift+Enter adds a newline, and composing text with an IME does not send.
- [x] The microphone changes to a send button when a message is entered.

### Disconnected placeholders

The menus open, but their unfinished actions are disabled. Default model, reasoning, and branch labels do not claim a particular backend configuration.

- [ ] Setup: implement setup assistance and snapshots. The plain button is currently disabled.
- [ ] Branch: load the project's actual branches and allow a per-chat base branch override. Currently the server uses the saved project configuration.
- [ ] Attachments: upload, store, preview, remove, and send attachments with messages.
- [ ] Context: add people, threads, pull requests, skills, and files to a message.
- [ ] Chat settings: implement access, setup/snapshots, environment variables, and MCP servers.
- [ ] Model: load supported models and pass the selected model to the backend. Currently uses the server default.
- [ ] Reasoning effort: load supported options and pass the selection to the backend. Currently uses the server default.
- [ ] Voice input: record and transcribe audio. The microphone button is currently disabled.
- [ ] Slash commands and @ context: implement suggestions, keyboard selection, and structured message payloads. The reference placeholder is present, but text is sent literally.

## Chat screen

### Connected

- [x] Share the composer between New Chat and existing chats, preserving interrupt, stop, resume, drafts, and blocked-state behavior.
- [x] Turn navigator previews and jumps to exchanges; visible exchanges are highlighted.
- [x] Title summary opens on hover, keyboard focus, or tap; shows saved chat ID, title, status, and last update.
- [x] Scroll to end keeps the composer fixed while returning to the latest message.
- [x] Cloud menu stops the container through the existing API.
- [x] Open in new tab and Copy link use the current chat route.
- [x] Linked PR summary shows saved PR counts, titles, status, additions/deletions, and links to GitHub.
- [x] Title summary shows associated PR counts and details.
- [x] Transcript PR links show saved PR status and include repository/title metadata.
- [x] Cost: show estimated model cost and token counts from persisted usage, including captured subagent work; identify missing history, token counts, and pricing.

### Disconnected placeholders

- [ ] PR review: expose in-app changes review and CI checks from the linked PR UI.
- [ ] Terminals: list active shells, open a terminal, and reflect their count in the summary strip.
- [ ] Runtime: report actual machine size, CPU, memory, disk, awake/asleep state, and wake controls. The neutral dot does not report machine health.
- [ ] Context: report usage, limits, system prompt, native tools, rules, codemode catalog, environment, and conversation breakdown; implement compaction thresholds. Unknown values are shown as dashes.
- [ ] Title summary: connect actual model details. Model information is still unavailable.
- [ ] Subagent capture: discover child sessions, persist their messages and activity, recover after reconnects and restarts, and attribute their usage to the parent chat without double-counting.
- [ ] Subagent UI: show spawned agents inline with their task and live status; open their conversation and tool activity in a side pane; expose completion, failures, and requests for input while keeping the parent conversation accessible.
- [ ] Plus menu: search views; add diffs, machine files, setup, browser, side threads, new shell, desktop, and keep-awake controls. Overview is the current chat view.
- [ ] Split review: open a resizable review pane next to the conversation.
- [ ] Chat actions: implement pin, move to folder, rename, archive, and delete.
- [ ] Rich PR references: add expanded PR cards and CI/check status. Inline PR links already show saved open/draft/merged/closed status.

Attachment/context, model, reasoning, slash-command, and voice placeholders listed above apply to both composers.

## Chats and Pull requests pages

### Connected

- [x] Chats supports title/project/ID search, status filters and counts, project filtering, and collapsible project groups.
- [x] Pull requests supports search, state filters and counts, repository filtering, collapsible state groups, GitHub links, and linked-chat navigation.
- [x] Both pages share their page frame, search focus behavior, filter bar, empty-state layout, and compact Florets list components.
- [x] Chat list, sidebar, and title summary share status labels; setup and automatic provider retries appear as Working.

## Sidebar

### Connected

- [x] Search chats by title, project, or ID; clear search to restore the full list.
- [x] Collapse individual projects or all projects and sort chats by update time or title for this session.
- [x] Show saved status, relative update time, project counts, and a hover summary for each chat.
- [x] Keep project settings, chat navigation, mobile dismissal, notification sound, and logout connected.
- [x] Show linked PR counts in chat rows and saved PR titles, statuses, additions/deletions, and GitHub links in hover summaries.
- [x] Mark a viewed chat revision as seen for this tab, surviving reloads through session storage; later updates become unread again.

### Disconnected placeholders

- [ ] Navigation: implement the disabled Automations destination.
- [ ] Chat row actions: implement Pin and Archive in both the hover toolbar and action menu; add the pinned section.
- [ ] Folders: connect New folder and Move to folder, including folder creation and saved chat membership.
- [ ] Sidebar list options: connect Display and filters and add grouping preferences. The separate Chats page already has working status and project filters.
- [ ] Read state: implement Mark all as read and durable read/unread persistence across tabs and browser sessions. Per-tab viewed revisions already use session storage.
- [ ] Persist sorting and collapsed project preferences; currently these work only for the current sidebar session.
- [ ] Populate hover summaries with model and CI/check details when backend metadata is available. Saved PR details and additions/deletions are already connected.
- [ ] Workspace menu: connect Usage.
- [ ] Workspace identity: replace the generic Flora/Workspace footer with saved identity and avatar data when available.

Sidebar actions that are not connected are disabled; timestamps and statuses come from the saved chat feed.
