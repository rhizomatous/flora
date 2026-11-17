# UI checklist

Remaining UI work is tracked in [GitHub issues](https://github.com/rhizomatous/flora/issues), including separate decision issues for features that still need a defined scope. Voice transcription has been dropped from the backlog.

Subagent conversation capture and browsing are covered by [PR #108](https://github.com/rhizomatous/flora/pull/108), which is still open.

## Shared chat composers

### Connected

- [x] Project picker uses saved projects, supports search, and selects the project used when sending.
- [x] New project and Manage projects open the existing project screens.
- [x] Text submission starts a chat through the existing API, including retry identity, byte-limit validation, and error handling.
- [x] Enter sends, Shift+Enter adds a newline, and composing text with an IME does not send.
- [x] The microphone changes to a send button when a message is entered.

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
- [x] Cost: show estimated model cost and token counts from persisted usage, including captured subagent work; show reported totals and collection failures.
- [x] Context: show latest main-session model-call usage against its runtime model limit.
- [x] Subagent accounting: discover descendant sessions, persist their usage, reconcile after reconnects and restarts, and include it in parent-chat totals without double-counting.
- [x] Plus menu: open saved workspace changes in the Diffs view.
- [x] Split review: show Overview and Diffs in a resizable side panel, preserving the conversation and draft.

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
- [x] Workspace menu: connect Usage with date ranges, cost and token charts, project/model breakdowns, and linked chat history.
- [x] Navigation: open Automations to create and edit schedules and view linked run history.
