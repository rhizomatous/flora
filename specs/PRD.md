# Flora: Product Requirements Document

## Context

Flora is a free and open-source, self-hostable autonomous coding agent. The target user is a developer maintaining GitHub repositories who wants persistent, remotely accessible chats with a coding agent, but prefers to self-host rather than give up control to a SaaS. With Flora a user can describe a task, let an agent work async, review the result, and turn it into a pull request.

Flora also emphasizes simplicity and ease of maintenance. Flora is packaged as a single binary for easy installation. Flora uses OpenCode as its coding harness.

Flora is inspired by autonomous coding agents like [Google Jules](https://jules.google/), [Devin](https://devin.ai/), and [Capy](https://capy.ai/).

## Objectives

1. **Delegate coding work from a browser.** Connect a GitHub repository, describe a task, and follow the agent’s progress.
2. **Refine work through persistent conversations.** Send follow-ups against the same workspace and context, including after disconnects or restarts.
3. **Review changes and open pull requests.** Inspect diffs and command results, request refinements, and ask the agent to push changes and open a draft PR.
4. **Work in multiple projects and chats independently.** Give each project several chats, and each chat an isolated workspace.
5. **Self-host with minimal setup.** Install and operate Flora on one Linux host using your own GitHub credentials and model provider and minimal hassle.

## Use Cases

**Viv, repository maintainer: take a bug fix from prompt to pull request.** Viv connects a private GitHub repository, chooses its base branch, configures a setup command, and asks Flora to fix a bug. She leaves the web app while the agent works, then returns to its chat response and diff. A follow-up refines the same workspace. Once satisfied, she asks the agent to open a draft PR and receives its link in the conversation.

**Sam, self-hosting developer: continue a chat after stepping away.** Sam gets pulled away while an agent is working and closes the web app. An hour later, Sam returns. The web app reconnects and refreshes the chat state. Sam inspects the state and sends another message to continue.

**Alex, maintainer of several projects: work in multiple chats.** Alex starts work in three chats. The Flora agents work in parallel

## Requirements

**Priorities:** P10: ship-blocking; P7–P9: important; P4–P6: valuable but deferrable; P1–P3: optional.

### 1. Installation and access

1.1 Flora shall support installation on a Linux host using a minimal setup environment: one application binary, Docker, persistent local storage, and an HTTPS reverse proxy.

1.2 Flora shall provide a first-time setup screen to create the administrator account. Users shall be able to log in and log out.

1.3 Flora shall report actionable configuration and dependency failures, including unavailable Docker, invalid credentials, and unwritable storage, without exposing credential values.

1.4 Flora shall require authenticated access to project data, conversations, logs, diffs, live events, and mutations. Unauthenticated requests and cross-site mutation attempts shall be rejected.

1.5 Users shall be able to configure GitHub and model-provider credentials, container concurrency, resource limits, timeouts, notification sound, and Git commit author name and email through Flora's settings.

### 2. Agent environment

2.1 Flora shall provide a Linux container with OpenCode, Git, and the GitHub CLI installed.

2.2 Setup and agent commands shall be able to install system packages, tools, and dependencies inside the container using passwordless sudo. This makes it possible for users to develop using any language, framework, or dev tool of their choice.

2.3 Setup shall run once per container before OpenCode starts, with a configurable timeout and visible output and exit status. Failure or timeout shall block agent startup; diagnostic output shall be retained and setup may be retried.

2.4 The agent shall execute commands and edit files within the agent container without requiring per-action approval.

2.5 The agent shall have a system prompt instructing it of its identity as Flora and any behavioral guidelines and tool pointers necessary for proper function.

2.6 Flora shall enforce a configurable limit on running agent containers. When capacity is full, requests to start another container shall be rejected with an explanation.

### 2. Projects

2.1 A user shall be able to configure a project with one or more public or authorized private GitHub repositories, a base branch, and optional setup command. Flora shall validate the repository connection and base branch and report configuration errors.

2.2 Flora shall support several independent projects at the same time.

2.3 Each of a project's repositories shall be designated "core" or "extra". Core repositories are automatically downloaded on container start. Extra repositories are fetched at will.

2.4 Each chat shall record its starting commit, environment image identity, and agent harness version.

2.5 Users shall be able to edit project settings. Changes shall apply only to new chats in the project. Existing chats shall keep their original settings. (P9)

### 3. Chats, messages, and agent activity

3.1 A user shall be able to start a persistent chat in a project, which shall spin up a container and begin agent work.

3.2 A user shall be able to send follow-up messages within a chat. The agent shall continue using that chat’s existing workspace and conversation history.

3.4 Flora shall display one of five chat statuses:

- **Working:** Preparing the environment, delivering a message, executing agent work, or stopping.
- **Waiting:** In-progress work is blocked on user input or an external operation.
- **Failed:** An error or unexpected interruption prevents progress, with an explanation of what is known.
- **Idle:** No work is in progress, the chat is running and ready for a new message.
- **Stopped:** The chat's container is stopped.

3.5 Flora shall display a Chat List view, sectioned by project, exposing status, project, title, and last activity.

3.6 Flora shall display a Chat Detail view for each chat which shall expose the full contents of the OpenCode chat as a web interface: chat messages, tool activity, command output, changed files, follow-up, a control to interrupt the agent, and any linked pull requests with links, PR numbers, and statuses.

3.7 Flora shall use one hosted provider/model, fixed at installation setup, for all chats through OpenCode. A user shall be able to see which provider and model produced each agent response. An unavailable model or provider failure shall produce a visible failure.

3.8 Flora shall notify the user with a toast and audio notification when an agent finishes work. The notification shall identify the chat and link to its conversation.

### 4. Isolation and execution control

4.1 Each chat shall have its own container and an independent repository workspace within that container. Concurrently running chats shall not share writable repository metadata, agent state, or workspace files.

4.2 Containers shall run without privileged mode, the host Docker socket, host namespaces, host devices, or access to other chats' storage. Docker shall enforce configurable CPU, memory, and process-count limits.

4.3 Flora shall provide `git` and `gh` in agent containers, allowing authenticated access to the chat's repositories without interactive login. Authentication shall use an administrator-supplied fine-grained GitHub token restricted to selected repositories. Flora shall keep its GitHub token outside agent-accessible containers and persisted repository configuration.

4.4 Endpoints shall be private to the execution/application boundary and authenticated.

4.5 A user shall be able to explicitly stop an agent's container to free capacity while preserving its workspace and conversation.

4.6 A user shall be able to interrupt the agent's current execution without stopping its container. After interruption is confirmed, sending another message shall start new work using the existing context.

4.7 Flora shall stop an agent's container if the agent remains active beyond a configurable time limit.

4.8 Agent containers shall have unrestricted outbound network access, subject to the host’s network configuration.


### 5. Progress, persistence, and recovery

5.1 Flora shall save chat messages, status changes, and agent activity. Reloading the web app shall restore the saved chat history.

5.2 Losing the web app's connection to the backend shall not stop agent work. When the web app reconnects, Flora shall show activity missed during the disconnection, then continue showing live updates.

5.3 After application restart or loss of connection to OpenCode, Flora shall restore saved activity and reconnect to ongoing execution.

5.4 Status changes should reach connected users within one second of being saved under normal load.

### 6. Review and pull requests

6.1 Flora shall provide a Changes view comparing the chat's current working files against its recorded starting commit, including committed and uncommitted changes. Flora shall refresh the view while the container runs and retain only the latest successful changed-file list and diff, so review remains available after the container stops or is removed. Files whose contents cannot be displayed, such as binaries, shall still be listed.

6.2 A user shall be able to ask the agent to commit and push the chat's changes and open a draft GitHub pull request against the project's repository. This shall be handled through the normal OpenCode mechanisms.

6.3 Flora shall discover pull requests from branches used in each chat and PR links in its conversation and command output, verify them against GitHub, and retain their links and statuses. A chat may be linked to multiple pull requests.

6.4 The Flora agent shall commit its code changes locally after making changes and when explicitly requested. A system prompt is a sufficient mechanism.

## Defaults and Limits

All defaults are editable.

| Setting | Default or limit |
| --- | --- |
| Maximum running chat containers | 10 |
| Setup timeout | 10 minutes |
| Continuous-activity timeout | 1 hour |
| Chat CPU / memory / process limits | 2 CPUs / 8 GiB / 512 processes |
| Inline file diff | 1 MiB; larger files listed with a full-diff download link |
| Maximum user-message text | 128 KiB UTF-8; larger messages rejected before saving |
| Browser session lifetime | 7 days; absolute expiry; logout revokes immediately |
| Git commit author | `Flora <flora@rhizomato.us>` |

## Approach

### Components

1. `Flora Web`: user-facing UI for projects and chats, conversation, live progress, code review, and notifications.
2. `Florets`: design system component library for web UI
3. `Flora Backend`: API supporting authentication, HTTP actions, static asset serving, SSE, and request validation.
4. `Agent Container`: container packaging OpenCode and the other Flora essentials into an isolated sandbox environment.

### Tech Stack
- Backend: Go, with a SQLite driver distributable inside the application binary.
- Frontend: TypeScript and React. ShadCN and Tailwind for component library. Compiled at release time and embedded using Go's asset embedding.
- Persistence: SQLite plus application-owned directories on a local Linux filesystem.
- Containers: Docker Engine API or equivalent container runtime. No dependency on the Docker CLI.
- Container image: a Flora-provided Linux image, pinned by digest for each release. It contains a headless OpenCode HTTP server and Git utilities.
- Git operations: Git inside the chat container, invoked through Docker.
- Deployment: one Flora process, normally managed by systemd, behind an HTTPS reverse proxy.
- Build tools & repo setup: Nix for dependency management, monorepo with dedicated folders for separate components, polyglot monorepo build tools as needed

## Scope Boundaries

The initial release supports one trusted administrator running selected repositories on one Linux host, using Docker, GitHub, and hosted model APIs.

Out of scope for the initial release:

- Multiple users, shared team accounts, organizations, and role-based access.
- Usage accounting or application-enforced budgets.
- Message queueing, including submitting follow-ups during active work, editing/cancelling/reordering queued messages, and selectable steer or interrupt-and-send modes.
- Inline review annotations
- Chat search, labels, archiving, and chat or project deletion.
- GitHub App onboarding, CI/review feedback ingestion, and automatic merging.
- Schedules, webhooks, issue triggers, external integrations, and a public automation API.
- App previews, companion services, browser automation, interactive terminals, or desktop streaming.
- Per-chat model selection and model switching.
- Automatic workspace expiration and retention policies.
- Application upgrades with existing chats, including cross-release runtime compatibility and migration.
- Local model support.
- Remote workers, high availability, and multi-host scaling.

## Glossary

**Project:** A collection of one or more GitHub repositories and configuration for chats, including repository roles, base branches, and an optional setup command. A project has many chats.

**Chat:** A persistent conversation with a coding agent, with its own repository workspace, container, and OpenCode session. Work in a chat may span multiple branches and pull requests. A chat occurs in a project.

**Agent harness:** The software Flora uses to manage model interactions, conversation context, coding tools, and agent execution inside each chat’s container. In this case, OpenCode.

**Core repository:** A project repository automatically downloaded when a chat’s container starts.

**Extra repository:** A project repository fetched on demand rather than automatically downloaded when a chat’s container starts.

**Setup command:** An optional project-configured command run during container setup, before OpenCode starts. This is used to set up project-specific developer tooling.
