# Flora: Product Requirements Document

## Context

Flora is a free and open-source, self-hostable tool for delegating coding work through a browser. The target user is a developer maintaining GitHub repositories who wants persistent, remotely accessible coding tasks, but also wants to self-host. Flora brings task execution, conversation, review, and publication into one workflow. With Flora a user can describe a task, let an agent work, review the result, and turn it into a pull request. Flora is packaged as a single binary for easy installation. 

Flora also has an emphasis on simplicity and ease of maintenance. Flora is packaged as a single binary for easy installation. It wraps an existing coding runtime rather than building another agent harness.

Flora is inspired by autonomous coding agents like [Google Jules](https://jules.google/), [Devin](https://devin.ai/), and [Capy](https://capy.ai/).

## Objectives

1. **Delegate coding work from a browser.** Connect a GitHub repository, describe a task, and follow the agent’s progress.
2. **Refine work through persistent conversations.** Send follow-ups against the same workspace and context, including after disconnects or restarts.
3. **Review and publish changes.** Inspect diffs and command results, request refinements, and create a draft PR containing the reviewed changes.
4. **Run multiple tasks independently.** Execute tasks in isolated workspaces with configurable concurrency and cancellation.
5. **Self-host with minimal setup.** Install and operate Flora on one Linux host using your own GitHub credentials and model provider. One application binary, Docker, persistent local storage, and an HTTPS reverse proxy suffice. No separate database, message broker, or Flora-operated service is required.

## Use Cases

**Viv, repository maintainer: take a bug fix from prompt to pull request.** Viv connects a private GitHub repository, chooses its base branch and environment, and asks Flora to fix a bug. She leaves the browser while the agent works, then returns to its conversation, test output, and diff. A follow-up refines the same workspace. Once satisfied, she creates a draft PR containing the changes she reviewed.

**Sam, self-hosting developer: continue a task after restarting Flora.** Sam restarts the Flora service during a long-running task. Flora reconnects if the agent is still verifiably working. If execution stopped unexpectedly or its outcome is uncertain, Flora marks the task failed, explains what it could establish, and preserves available work. Sam inspects the state and explicitly continues. Flora does not replay a prompt that may already have caused changes.

**Alex, maintainer of several projects: queue three tasks and cancel one task.** Alex submits three tasks to a host configured for two concurrent executions. Two run in separate workspaces while one remains queued. The agents execute commands and edit files without waiting for per-action approval. Alex cancels one task without losing its files or stopping unrelated work.

## Requirements

**Priorities:** P10: ship-blocking; P7–P9: important; P4–P6: valuable but deferrable; P1–P3: optional.

### 1. Installation and access

1.1 Flora shall support installation on a Linux host using one application binary with embedded frontend assets, Docker, persistent local storage, and an HTTPS reverse proxy. Installation shall not require OpenCode or project language runtimes on the host. (P10)

1.2 Flora shall provide a first-time setup screen to create the administrator account and a login screen for subsequent access. (P10)

1.3 Flora shall document a consistent backup and restore procedure covering product records, workspaces, and agent state. After restoring a backup on another Linux host and configuring credentials, the administrator shall be able to inspect and continue saved tasks. (P8)

1.4 Flora shall report actionable configuration and dependency failures, including unavailable Docker, invalid credentials, and unwritable storage, without exposing credential values. (P8)

1.5 Flora shall require authenticated access to project data, conversations, logs, diffs, live events, and mutations. Unauthenticated requests and cross-site mutation attempts shall be rejected. (P10)

### 2. Projects and execution environments

2.1 A user shall be able to configure a project with a public or authorized private GitHub repository, base branch, project-defined container image, and optional setup command. (P10)

2.2 Flora shall allow projects to use any languages, frameworks, and development tools. These tools shall run inside its Linux container execution environment. Users shall be able to supply these tools through project-defined container images and setup commands without modifying Flora. (P9)

2.3 Flora shall make the agent runtime available in project-defined execution environments. (P9)

2.4 Each task shall record its starting commit, task branch, environment image identity, and agent runtime version. Changes to project defaults or application upgrades shall not silently change these identities for existing tasks. (P8)

2.5 Setup shall run inside the task environment with a separate configurable timeout and visible output and exit status. Failure or timeout shall prevent the agent turn from starting. Diagnostic output shall be retained. (P9)

2.6 Recreating a task container shall preserve its repository files and persisted agent context and reestablish the configured environment before a follow-up. Setup commands shall be documented as needing to tolerate reruns. (P9)

### 3. Tasks, conversations, and scheduling

3.1 A user shall be able to submit an instruction against a project and create a persistent task queued for the agent to work on. Duplicate requests caused by repeated clicks or network retries shall create only one task. (P10)

3.2 A user shall be able to send follow-up messages within a task. The agent shall continue using the task’s existing workspace and conversation history. (P10)

3.3 Flora shall enforce a configurable limit on the number of tasks active at once across the host. It shall process only one instruction at a time within each task. With the limit set to two, a third task shall remain queued until capacity becomes available. Provisioning, setup, agent work, and cancellation shall count toward the limit until their execution slot is released. (P9)

3.4 Flora shall display one of five task statuses: Queued, Working, Waiting, Failed, or Idle. Queued shall indicate work awaiting available execution capacity. Working shall indicate active setup or agent work. Waiting shall indicate work blocked on user input or an external operation, with the reason shown. Failed shall indicate an error or an unexpected interruption, with an explanation of what is known. Idle shall indicate no active or pending work after completion or user cancellation. Completion shall not imply that tests passed or the change is correct. (P9)

3.5 The task list shall expose current status and support status filtering. Task detail shall expose conversation, tool activity, command output, changed files, diff, follow-up, cancellation, and publication actions as applicable. (P8)

3.6 The agent shall execute commands and edit files within the task’s container without requiring per-action approval. (P9)

3.7 Flora shall support administrator-configured hosted provider and model selection through OpenCode. A user shall be able to see which provider and model produced each agent response. Unavailable models or provider failures shall produce a visible failure without silently switching providers. (P8)

3.8 A user shall be able to submit follow-up messages while a task is queued or active. Flora shall retain these as pending messages in submission order and show their pending status. The agent shall process them after preceding work finishes. (P9)

3.9 A user shall be able to cancel a pending message before the agent begins processing it. Cancelled messages shall not be delivered to the agent. (P9)

3.10 Flora shall notify the user when the agent finishes work on a task. The notification shall identify the task and link to its conversation and results. (P8)

3.11 A user shall be able to delete tasks. Deleting a task shall remove its workspace, conversation history, logs, and associated execution resources, reclaiming their storage. (P9)

3.12 Flora shall automatically delete inactive task workspaces after a configurable retention period to reclaim disk space. (P9)

### 4. Isolation and execution control

4.1 Each task shall execute in its own container and independent repository workspace. Concurrently running tasks shall not share writable repository metadata, agent state, or task files. (P10)

4.2 Agent and setup execution shall run as a non-root container user without privileged mode, the Docker socket, or access to other tasks' storage. CPU, memory, process-count, and execution-time limits shall be configurable and enforced. (P10)

4.3 Flora shall keep its GitHub publishing token outside agent-accessible containers and persisted repository configuration. Checkout and publication shall not leave credentials in repository URLs, task output, or agent configuration. (P10)

4.4 Runtime endpoints shall be private to the execution/application boundary and authenticated. Users shall interact through Flora rather than a publicly exposed OpenCode server. (P9)

4.5 A user shall be able to cancel a queued task before it starts. (P9)

4.6 A user shall be able to stop active work on a task. Flora shall ask the agent to stop, then forcibly stop its container if it does not respond within a configured time limit. Stopping work shall retain available files and logs without rolling back changes already made. (P9)

4.7 Flora shall allow users to configure a time limit for agent work. When the limit is reached, Flora shall stop the agent and retain its files and logs. (P9)

4.8 A task's setup failure, container crash, or resource-limit termination shall not cancel unrelated tasks. Flora shall preserve available evidence and show why work on the affected task failed or was interrupted. (P9)

4.9 Task containers shall have unrestricted outbound network access, subject to the host’s network configuration. Flora shall not impose destination allowlists or per-request network approvals. (P9)

### 5. Progress, persistence, and recovery

5.1 Flora shall save task messages, status changes, and agent activity. Refreshing the browser shall restore the saved task history. (P10)

5.2 Browser disconnection shall not cancel execution. When the browser reconnects, Flora shall show activity missed during the disconnection, then continue showing live updates. (P9)

5.3 After application restart or loss of connection to the agent, Flora shall check previously active tasks against their containers and agent sessions. It shall reconnect where live state can be established. If execution stopped unexpectedly or its outcome cannot be established, Flora shall mark the task Failed and explain the interruption or uncertainty in the task history. (P10)

5.4 A user shall be able to continue a failed task using its saved workspace and conversation history. Flora shall wait for the user to choose to continue. (P10)

5.5 After a restart or connection loss, Flora shall recover available agent activity and indicate any known gaps in the task history. (P9)

5.6 When agent output is truncated, Flora shall indicate this and allow the user to open the retained full output. (P7)

### 6. Review and controlled publication

6.1 A user shall be able to view the task’s changed files and diffs, including changes not yet committed. Files whose contents cannot be displayed, such as binaries, shall still be listed. (P10)

6.2 A user shall be able to create a draft GitHub pull request from the task’s changes against the project’s configured repository and base branch. (P10)

6.3 Flora shall create or update pull requests only while the task is idle. (P10)

6.4 Repeated clicks or network retries when creating a pull request shall not create duplicate pull requests. Flora shall return the link to the existing pull request. (P9)

6.5 If creating a pull request fails, Flora shall show the error and allow the user to retry without losing the task’s changes. (P9)

6.6 Successful publication shall display and retain the draft PR URL. (P9)

6.7 The Create PR action shall be disabled when the task has no changes to publish. (P9)

6.8 Flora shall not automatically merge changes. (P9)

6.9 If the remote branch contains changes missing from the task’s branch, Flora shall report a conflict rather than overwrite those changes. (P9)

6.10 A user shall be able to continue working on a task after creating its pull request and publish subsequent changes to that same pull request. (P10)

6.11 A user shall be able to reopen a closed, unmerged pull request associated with a task and continue updating it. If GitHub cannot reopen the pull request, Flora shall explain why. (P9)

6.12 After a task’s pull request is merged, further coding work shall require a new task. The original task’s conversation and results shall remain available for review. (P9)

## Approach

Flora runs on one Linux host. Flora’s backend manages authentication, projects, task scheduling, activity history, execution environments, and GitHub publication. OpenCode provides model interaction, conversation context, and coding tools through a pinned headless runtime. Each task has an independent repository clone and persistent agent state; its Docker container can stop when idle and be recreated for a follow-up.

Flora’s web interface provides project configuration, a task list, and task detail with conversation and review tools. Task data remains on local persistent storage. Hosted model providers receive the prompts and code needed for execution. GitHub access uses an administrator-supplied fine-grained token restricted to selected repositories; the application publishes reviewed changes separately from agent execution.

## Scope Boundaries

The initial release supports one trusted administrator running selected repositories on one Linux host, using Docker, GitHub, and hosted model APIs. It does not support mutually untrusted tenants or offline operation.

Out of scope for the initial release:

- Multiple users, shared team accounts, organizations, and role-based access.
- Failure and attention notifications, usage accounting, and application-enforced budgets.
- Selectable steer, interrupt-and-send, and queue messaging modes, plus editing pending messages. Basic follow-up queuing and cancellation of pending messages are included in the initial release.
- Inline review annotations, task search, labels, and archiving.
- GitHub App onboarding, CI/review feedback ingestion, and automatic merging.
- Schedules, webhooks, issue triggers, external integrations, and a public automation API.
- App previews, companion services, browser automation, interactive terminals, and desktop streaming.
- Multiple agent runtimes, autonomous delegation, and task hierarchies.
- Local-model support, remote workers, high availability, and multi-host scaling.

## Glossary

**Project:** A GitHub repository and its execution defaults, including base branch, environment, and setup command.

**Task:** A persistent conversation about one piece of work, with its own repository workspace, branch, and agent session.

**Agent runtime:** The existing software that manages model interaction and coding tools; initially OpenCode.

**Publication:** The application-controlled operation that pushes reviewed changes and creates or reconciles a draft GitHub PR.
