// oxlint-disable import/max-dependencies -- The chat view imports its feature controls and boundary schemas directly.
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  GitBranchIcon,
  XIcon,
  Alert,
  ArrowDownIcon,
  Button,
  ButtonLink,
  FlowerMark,
  Heading,
  Text,
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@flora/florets";

import { authenticatedSchema } from "./auth-schemas";
import { AutomationRunJump } from "./automation-run-jump";
import { Changes } from "./changes";
import {
  ChatTurnNavigation,
  ChatPullProvider,
  ChatTitle,
  ChatHeaderActions,
  ChatComposerFooter,
  ChatReviewStrip,
} from "./chat-controls";
import { ChatList } from "./chat-list";
import { latestOrganization } from "./chat-organization";
import { useChatPanelState } from "./chat-panel-state";
import {
  type Chat,
  type Question,
  activitySchema,
  requestIdentitySchema,
  detailSchema,
  questionSchema,
  chatSchema,
  acceptanceSchema,
  type Activity,
  type Detail,
} from "./chat-schemas";
import { ChatSidePanel } from "./chat-side-panel";
import { chatStatus } from "./chat-status";
import { Composer } from "./composer";
import { ConversationMessage, WorkSummary } from "./conversation";
import { NewChatComposer } from "./new-chat-composer";
import { projectSummarySchema, type ProjectSummary } from "./project-schemas";
import { pullEvents } from "./pull-events";
import { QuestionForm } from "./question";
import { errorMessage, isExpired, request } from "./request";
import { useMarkViewed } from "./sidebar-status";
import { SubagentConversation } from "./subagent-conversation";
import { SubagentsContext, subagentLabel } from "./subagent-state";
import { buildTranscript } from "./transcript";
import { text } from "./ui";
import { WorkspaceTabs, WorkspacePanels } from "./workspace-tabs";

const requestKey = (scope: string) => `flora-request:${scope}`;

// Keep the accepted identity across ambiguous responses and page reloads.
// A changed input is a new request, never an edit to an accepted turn.
function identity(scope: string, input: unknown) {
  const key = requestKey(scope);
  const body = JSON.stringify(input);
  try {
    const saved = requestIdentitySchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );
    if (saved.success && saved.data.body === body) return saved.data.id;
  } catch {
    /* Invalid or unavailable session storage does not prevent sending. */
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(key, JSON.stringify({ body, id }));
  } catch {
    /* Private browsing can disable storage. */
  }
  return id;
}

function forgetIdentity(scope: string) {
  try {
    sessionStorage.removeItem(requestKey(scope));
  } catch {
    /* Storage may be disabled. */
  }
}

export function Chats({
  path,
  messageBytes,
  onExpired,
  list,
  listError,
}: {
  path: string;
  messageBytes: number;
  onExpired: () => void;
  list: Chat[] | undefined;
  listError: string;
}) {
  // Undefined until the project list loads.
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [detail, setDetail] = useState<Detail>();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionError, setQuestionError] = useState("");
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = path.startsWith("chats/") ? (path.slice(6).split("?")[0] ?? "") : "";
  const readError = useMarkViewed(detail?.chat.ID === id ? detail.chat : undefined);
  const isNew = id === "new" || id.startsWith("new?");
  const projectID = new URLSearchParams(path.split("?")[1]).get("project") ?? "";
  const [selectedProjectID, setSelectedProjectID] = useState(() => {
    if (projectID !== "") return projectID;
    try {
      return sessionStorage.getItem("flora-new-chat-project") ?? "";
    } catch {
      return "";
    }
  });
  const selectedProject =
    projects?.find((project) => project.id === selectedProjectID) ?? projects?.[0];
  const chatPath = `chats/${encodeURIComponent(id)}`;

  function report(e: unknown) {
    setError(errorMessage(e, "Could not load chat."));
    if (isExpired(e)) onExpired();
  }
  const fail = useEffectEvent(report);
  const expire = useEffectEvent(onExpired);

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    const load = async () => {
      try {
        const rows = await request(projectSummarySchema.array(), "projects");
        if (active) setProjects(rows);
      } catch (e) {
        if (active) fail(e);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (id === "" || isNew) return;
    let active = true;
    const base = `chats/${encodeURIComponent(id)}`;

    // One detail load runs at a time. Refreshes requested meanwhile collapse into one more
    // load, so the final state reflects every event seen so far.
    let loading = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (loading) return;
      loading = true;
      try {
        while (dirty) {
          dirty = false;
          // oxlint-disable-next-line no-await-in-loop -- Loads must run one after another so a stale response never overwrites a newer one.
          const next = await request(detailSchema, base);
          if (!active) return;
          setDetail(next);
        }
      } catch (e) {
        if (active) fail(e);
      } finally {
        loading = false;
      }
    };
    void refresh();

    const source = new EventSource(`/api/${base}/events`);
    // EventSource reconnects on its own. A failure may mean the session ended, in which case
    // retrying is pointless.
    const checkSession = async () => {
      try {
        const status = await request(authenticatedSchema, "auth/status");
        if (active && !status.authenticated) {
          source.close();
          expire();
        }
      } catch {
        /* The check is advisory. The EventSource keeps retrying. */
      }
    };
    // A burst of activity triggers one detail refresh 100 ms after its first event.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("open", () => {
      setDisconnected(false);
    });
    source.addEventListener("error", () => {
      setDisconnected(true);
      void checkSession();
    });
    source.addEventListener("activity", (event: MessageEvent<string>) => {
      let row: Activity;
      try {
        row = activitySchema.parse(JSON.parse(event.data));
      } catch {
        setError("Could not read saved activity. Reload to reconnect.");
        return;
      }
      setActivity((rows) =>
        rows.some((r) => r.Sequence === row.Sequence) ? rows : [...rows, row],
      );
      debounce ??= setTimeout(() => {
        debounce = undefined;
        void refresh();
      }, 100);
    });

    const pollQuestions = async () => {
      try {
        const rows = await request(questionSchema.array(), `${base}/questions`);
        if (!active) return;
        setQuestions(rows);
        setQuestionError("");
      } catch (e) {
        if (!active) return;
        setQuestions([]);
        setQuestionError("Live questions unavailable. Saved questions may no longer be pending.");
        if (isExpired(e)) expire();
      }
    };
    void pollQuestions();
    const timer = setInterval(() => {
      void pollQuestions();
    }, 1000);

    return () => {
      active = false;
      source.close();
      clearInterval(timer);
      clearTimeout(debounce);
    };
  }, [id, isNew]);

  async function send(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const message = text(fields, "text");
    const attachments = fields
      .getAll("attachments")
      .filter((value): value is string => typeof value === "string");
    if (
      (message.trim() === "" && attachments.length === 0) ||
      new TextEncoder().encode(message).length > messageBytes
    ) {
      setError(`Enter a message of at most ${messageBytes.toLocaleString()} UTF-8 bytes.`);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    const project = text(fields, "project");
    // Forty-five Unicode code points fit within the server's 200-byte title limit.
    const chatTitle =
      // oxlint-disable-next-line typescript/no-misused-spread -- Bound code points to stay below the UTF-8 byte limit without splitting surrogate pairs.
      [...(message.trim().replaceAll(/\s+/gu, " ") || "Attached files")].slice(0, 45).join("");
    const rawExecution = text(fields, "execution");
    const execution = rawExecution ? (JSON.parse(rawExecution) as unknown) : undefined;
    const input = isNew
      ? {
          title: chatTitle,
          text: message,
          attachments,
          execution,
          branches: JSON.parse(text(fields, "branches") || "{}") as unknown,
        }
      : { text: message, attachments, execution };
    const scope = isNew ? `project:${project}` : `chat:${id}`;
    try {
      const requestID = identity(scope, input);
      if (isNew) {
        const chat = await request(chatSchema, `projects/${encodeURIComponent(project)}/chats`, {
          method: "POST",
          body: {
            ...input,
            requestID,
          },
        });
        form.reset();
        try {
          sessionStorage.removeItem(`flora-branches:${project}`);
        } catch {
          /* Storage may be disabled. */
        }
        window.location.hash = `chats/${chat.ID}`;
      } else {
        await request(acceptanceSchema, `${chatPath}/messages`, {
          method: "POST",
          body: {
            ...input,
            requestID,
          },
        });
        form.reset();
        saveDraft(id, "");
        setDetail(await request(detailSchema, chatPath));
      }
      forgetIdentity(scope);
    } catch (e) {
      report(e);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function controlWork(action: "interrupt" | "stop") {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await request(chatSchema, `${chatPath}/${action}`, { method: "POST", body: {} });
      setQuestions([]);
    } catch (e) {
      report(e);
    }
    // Show the outcome whether or not the action succeeded.
    try {
      setDetail(await request(detailSchema, chatPath));
    } catch (e) {
      report(e);
    }
    submitting.current = false;
    setBusy(false);
  }

  const [panelState, updatePanel] = useChatPanelState(id);

  if (id === "") {
    return (
      <ChatList
        list={list}
        projects={projects}
        error={error || listError}
        archived={new URLSearchParams(path.split("?")[1]).get("view") === "archived"}
      />
    );
  }

  const currentChat = detail?.chat
    ? latestOrganization(
        detail.chat,
        list?.find((chat) => chat.ID === id),
      )
    : undefined;
  const pulls = list?.find((chat) => chat.ID === id)?.pulls ?? detail?.chat.pulls;
  const existingChat = !isNew && id !== "";
  const headerLayout = existingChat
    ? "florets-topbar chat-header [&_h1]:flex-[0_1_auto] max-[560px]:gap-0.5 max-[560px]:[&_h1]:flex-1 max-[560px]:[&>[aria-disabled=true]]:hidden -mx-4 flex shrink-0 items-center gap-1 border-b px-3 sm:-mx-8"
    : "mx-auto flex w-full max-w-[880px] shrink-0 items-center justify-between gap-4 pb-3";
  const chatLayout = id === "" ? "mx-auto max-w-4xl min-w-0" : "flex min-h-0 flex-1 flex-col";

  function title() {
    if (isNew) return "New chat";
    if (id === "") return "Chats";
    const saved = currentChat?.Title ?? "";
    return saved === "" ? "Chat" : saved;
  }

  const sideOpen = existingChat && panelState.open;
  const agents = detail?.chat.ID === id ? detail.subagents : [];
  const mainAgents = agents.filter((agent) => panelState.mainSubagentTabs.includes(agent.id));
  const workspaceTabbed =
    panelState.filesOpen || panelState.workspaceTabs.length > 0 || panelState.shellTabs.length > 0;
  const mainTabbed = panelState.mainDiffOpen || workspaceTabbed || mainAgents.length > 0;
  const activeDiff = panelState.mainView === "diffs";
  function selectMain(view: string) {
    updatePanel({ mainView: view });
  }

  return (
    <SubagentsContext
      value={{ chatID: id, agents: detail?.chat.ID === id ? detail.subagents : [] }}
    >
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={{ conversation: 100 - panelState.width, review: panelState.width }}
        onLayoutChanged={(layout, meta) => {
          const width = (meta.requestedLayout ?? layout).review;
          if (sideOpen && meta.isUserInteraction && width !== undefined) updatePanel({ width });
        }}
        className={`chat-split -mx-4 min-h-0 w-auto! flex-1 sm:-mx-8 ${sideOpen ? "chat-split-open" : ""}`}
      >
        <ResizablePanel
          id="conversation"
          defaultSize={`${100 - panelState.width}%`}
          minSize="300px"
          className="chat-main-pane flex min-w-0 flex-col px-4 sm:px-8"
        >
          <Tabs
            value={panelState.mainView}
            onValueChange={(value) => {
              selectMain(String(value));
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <section
              aria-labelledby="chats-heading"
              className={isNew ? "mx-auto my-12 w-full max-w-[720px] md:mt-[25svh]" : chatLayout}
            >
              <div className={isNew ? "sr-only" : headerLayout}>
                {existingChat && <span className="sidebar-toggle-space" aria-hidden="true" />}
                <Heading
                  level={1}
                  id="chats-heading"
                  aria-label={title()}
                  ref={heading}
                  tabIndex={-1}
                  className={mainTabbed ? "sr-only" : "min-w-0 truncate text-base"}
                >
                  {existingChat && !mainTabbed ? (
                    <ChatTitle title={title()} chat={currentChat} pulls={pulls} />
                  ) : (
                    title()
                  )}
                </Heading>
                {mainTabbed && (
                  <TabsList
                    aria-label="Chat views"
                    className={`chat-view-tabs h-auto! min-w-0 shrink justify-start gap-1 bg-transparent p-0 ${workspaceTabbed ? "[&_.chat-title]:max-w-56 [&_.chat-title]:shrink-0" : ""}`}
                  >
                    <ChatTitle
                      title={title()}
                      chat={currentChat}
                      pulls={pulls}
                      tabbed
                      active={panelState.mainView === "chat"}
                    />
                    <WorkspaceTabs chatID={id} />
                    {panelState.mainDiffOpen && (
                      <div className="chat-diff-tab" data-active={activeDiff || undefined}>
                        <TabsTrigger
                          value="diffs"
                          variant="control"
                          render={
                            <Button
                              variant={activeDiff ? "secondary" : "ghost"}
                              size="compact"
                              className="chat-diff-tab-trigger tracking-tight"
                            />
                          }
                        >
                          <GitBranchIcon />
                          <span className="florets-control-label">Diffs</span>
                        </TabsTrigger>
                        <Button
                          variant="ghost"
                          size="icon-compact"
                          className="chat-diff-tab-close"
                          aria-label="Close Diffs"
                          title="Close Diffs"
                          onClick={() => {
                            updatePanel({
                              mainDiffOpen: false,
                              mainView: activeDiff ? "chat" : panelState.mainView,
                            });
                            document
                              .querySelector<HTMLButtonElement>('button[aria-label="Chat views"]')
                              ?.focus();
                          }}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    )}
                    {mainAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="chat-diff-tab chat-subagent-tab"
                        data-active={panelState.mainView === `subagent:${agent.id}` || undefined}
                      >
                        <TabsTrigger
                          value={`subagent:${agent.id}`}
                          variant="control"
                          render={
                            <Button
                              variant="ghost"
                              size="compact"
                              className="chat-diff-tab-trigger"
                            />
                          }
                        >
                          <span className="florets-control-label">{subagentLabel(agent)}</span>
                        </TabsTrigger>
                        <Button
                          variant="ghost"
                          size="icon-compact"
                          className="chat-diff-tab-close"
                          aria-label={`Close ${subagentLabel(agent)}`}
                          onClick={() => {
                            updatePanel({
                              mainSubagentTabs: panelState.mainSubagentTabs.filter(
                                (value) => value !== agent.id,
                              ),
                              mainView:
                                panelState.mainView === `subagent:${agent.id}`
                                  ? "chat"
                                  : panelState.mainView,
                            });
                            document
                              .querySelector<HTMLButtonElement>('button[aria-label="Chat views"]')
                              ?.focus();
                          }}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </TabsList>
                )}
                {existingChat && (
                  <ChatHeaderActions
                    chat={currentChat}
                    sideOpen={sideOpen}
                    onSideToggle={() => {
                      updatePanel({ open: !sideOpen });
                    }}
                    usage={detail?.usage}
                    onFilesOpen={() => {
                      updatePanel({
                        open: panelState.open && !window.matchMedia("(max-width: 900px)").matches,
                        filesOpen: true,
                        mainView: "files",
                      });
                      requestAnimationFrame(() => {
                        document
                          .querySelector<HTMLButtonElement>(
                            '.chat-main-pane [data-workspace-view="files"]',
                          )
                          ?.focus();
                      });
                    }}
                    filesOpen={panelState.mainView === "files"}
                    overviewActive={panelState.mainView === "chat"}
                    diffsOpen={activeDiff}
                    onDiffsChange={(open) => {
                      updatePanel({
                        mainDiffOpen: open || panelState.mainDiffOpen,
                        mainView: open ? "diffs" : "chat",
                      });
                    }}
                  />
                )}
              </div>
              {currentChat?.Archived === true && (
                <div
                  role="status"
                  className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground"
                >
                  <span>Archived chat</span>
                  <a href="#chats?view=archived" className="shrink-0 underline underline-offset-4">
                    View archived chats
                  </a>
                </div>
              )}
              {(error !== "" || readError !== "") && (
                <Alert role="alert" className="mt-6">
                  {error || readError}
                </Alert>
              )}
              {isNew && projects === undefined && error === "" && (
                <Text role="status">Loading projects…</Text>
              )}
              {isNew && projects?.length === 0 && (
                <div className="space-y-5">
                  <Heading level={2}>Connect your first project</Heading>
                  <Text tone="muted">Choose a GitHub repository so Flora can start working.</Text>
                  <ButtonLink href="#projects/new">Connect a project</ButtonLink>
                </div>
              )}
              {isNew && projects !== undefined && projects.length > 0 && (
                <NewChatComposer
                  key={selectedProject?.id ?? ""}
                  projects={projects}
                  selectedProject={selectedProject}
                  onProjectChange={(selected) => {
                    setSelectedProjectID(selected);
                    setError("");
                    try {
                      sessionStorage.setItem("flora-new-chat-project", selected);
                    } catch {
                      // Draft selection remains available until this page closes.
                    }
                  }}
                  onBranchesChange={() => {
                    setError("");
                  }}
                  busy={busy}
                  onSend={(event) => {
                    void send(event);
                  }}
                />
              )}
              {id !== "" && !isNew && detail === undefined && error === "" && (
                <Text size="md" role="status" className="mt-8">
                  Loading…
                </Text>
              )}
              {detail && (
                <div className="chat-review-layout">
                  <TabsContent
                    value="chat"
                    keepMounted
                    className="chat-view-panel min-h-0 min-w-0 flex-1"
                  >
                    <div className="flex h-full min-h-0 min-w-0 flex-col">
                      <ChatDetail
                        runMessageID={new URLSearchParams(path.split("?")[1]).get("run") ?? ""}
                        pulls={pulls}
                        id={id}
                        detail={detail}
                        activity={activity}
                        disconnected={disconnected}
                        busy={busy}
                        onControl={(action) => {
                          void controlWork(action);
                        }}
                        onSend={(event) => {
                          void send(event);
                        }}
                      >
                        {questionError !== "" && (
                          <Text className="mt-6" role="status">
                            {questionError}
                          </Text>
                        )}
                        {questions.map((q) => (
                          <QuestionForm
                            key={q.id}
                            question={q}
                            chatID={id}
                            onError={report}
                            onAnswered={() => {
                              setQuestions((rows) => rows.filter((row) => row.id !== q.id));
                            }}
                          />
                        ))}
                      </ChatDetail>
                    </div>
                  </TabsContent>
                  <WorkspacePanels chatID={id} onExpired={onExpired} />
                  {panelState.mainDiffOpen && (
                    <TabsContent
                      value="diffs"
                      keepMounted
                      className="chat-view-panel -mx-4 min-h-0 min-w-0 flex-1 sm:-mx-8"
                    >
                      <Changes key={id} chatID={id} onExpired={onExpired} />
                    </TabsContent>
                  )}
                  {mainAgents.map((agent) => (
                    <TabsContent
                      key={agent.id}
                      value={`subagent:${agent.id}`}
                      keepMounted
                      className="chat-view-panel -mx-4 min-h-0 min-w-0 flex-1 sm:-mx-8"
                    >
                      <SubagentConversation agent={agent} onExpired={onExpired} />
                    </TabsContent>
                  ))}
                </div>
              )}
            </section>
          </Tabs>
        </ResizablePanel>
        {sideOpen && (
          <>
            <ResizableHandle aria-label="Resize side panel" className="chat-split-handle" />
            <ResizablePanel
              id="review"
              defaultSize={`${panelState.width}%`}
              minSize="300px"
              className="chat-side-pane min-w-0"
            >
              <ChatSidePanel
                key={id}
                chatID={id}
                chatTitle={title()}
                pulls={pulls}
                onExpired={onExpired}
                onClose={() => {
                  updatePanel({ open: false });
                  requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLButtonElement>('button[aria-label="Open side panel"]')
                      ?.focus();
                  });
                }}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </SubagentsContext>
  );
}

/** Keeps pending questions above the composer while the transcript scrolls independently. */
function ChatDetail({
  runMessageID,
  pulls,
  id,
  detail,
  activity,
  disconnected,
  busy,
  onControl,
  onSend,
  children,
}: {
  id: string;
  runMessageID: string;
  detail: Detail;
  pulls: Chat["pulls"];
  activity: Activity[];
  disconnected: boolean;
  busy: boolean;
  onControl: (action: "interrupt" | "stop") => void;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const { chat } = detail;
  const activeTurn = chat.Status === "working" || chat.Status === "waiting";
  const stopped = chat.Status === "stopped";
  const blocked = detail.continuationBlockedReason !== "";
  const rows = buildTranscript(detail.messages, chat.Status);
  const events = pullEvents(detail.messages, pulls?.items ?? []);
  const visibleActivity = rows.some((row) => row.kind === "work" && row.active);

  return (
    <ChatPullProvider value={pulls}>
      <MessageScrollerProvider autoScroll>
        <AutomationRunJump messageID={runMessageID} />
        <MessageScroller className="-mx-4 w-auto flex-1 sm:-mx-8">
          <MessageScrollerViewport aria-label="Conversation" className="chat-transcript-viewport">
            <MessageScrollerContent className="mx-auto w-full max-w-[900px] gap-6 px-4 py-6">
              {disconnected && <Alert role="status">Disconnected. Reconnecting…</Alert>}
              {activity.some((row) => row.ChatID === id && row.Kind === "capture.gap") && (
                <Alert role="note">
                  Some live activity could not be captured. Recovered messages and tool snapshots
                  are shown; transient output may be missing.
                </Alert>
              )}
              {rows.map((row) => (
                <MessageScrollerItem
                  key={row.id}
                  messageId={row.id}
                  scrollAnchor={row.kind === "message" && row.message.Role === "user"}
                >
                  {detail.automationRuns
                    .filter((run) => run.messageID === row.id)
                    .map((run) => (
                      <div
                        key={run.id}
                        className="mb-4 border-b pb-2 text-xs text-muted-foreground"
                      >
                        <a
                          className="underline underline-offset-4"
                          href={`#automations/${run.automationID}`}
                        >
                          Automation run
                        </a>
                        {" · "}
                        {new Date(run.scheduledAt).toLocaleString()}
                      </div>
                    ))}
                  {row.kind === "work" ? (
                    <WorkSummary steps={row.steps} active={row.active} failed={row.failed} />
                  ) : (
                    <ConversationMessage
                      message={row.message}
                      pullEvents={events.get(row.message.ID)}
                    />
                  )}
                </MessageScrollerItem>
              ))}
              {activeTurn && !visibleActivity && (
                <div role="status" aria-label={chatStatus(chat).label} title={chat.StatusReason}>
                  <FlowerMark
                    className={
                      chatStatus(chat).pulse
                        ? "text-muted-foreground motion-safe:animate-pulse"
                        : "text-muted-foreground"
                    }
                  />
                </div>
              )}
              {(chat.Status === "failed" ||
                chat.Status === "stopped" ||
                chat.StatusReason.includes("interrupted")) &&
                chat.StatusReason !== "" && (
                  <Text role="status" className="text-xs text-muted-foreground">
                    {chat.StatusReason}
                  </Text>
                )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ChatTurnNavigation rows={rows} />
        </MessageScroller>
        <div className="chat-composer-dock mx-auto max-h-[70dvh] w-full max-w-[900px] shrink-0 overflow-y-auto pt-2 pb-[env(safe-area-inset-bottom)]">
          <div className="chat-pending-questions max-h-[50dvh] overflow-y-auto empty:hidden [&_form]:mt-0 [&_form]:mb-3">
            {children}
          </div>
          <ChatReviewStrip key={`review-${id}`} pulls={pulls}>
            <MessageScrollerButton
              aria-label="Jump to latest"
              size="sm"
              className="composer-accessory chat-scroll-latest h-7 gap-1.5 border border-border px-2.5 text-xs [&_svg]:size-[13px]!"
            >
              <ArrowDownIcon />
              Scroll to end
            </MessageScrollerButton>
          </ChatReviewStrip>
          <FollowUpComposer
            execution={detail.chat.Execution}
            projectID={detail.chat.ProjectID}
            contextUsage={detail.contextUsage}
            key={id}
            id={id}
            busy={busy}
            activeTurn={activeTurn}
            blocked={blocked}
            stopped={stopped}
            onSend={onSend}
            onControl={onControl}
          />
        </div>
      </MessageScrollerProvider>
    </ChatPullProvider>
  );
}

function saveDraft(id: string, value: string) {
  try {
    sessionStorage.setItem(`flora-draft:${id}`, value);
  } catch {
    /* Drafting still works when browser storage is unavailable. */
  }
}

function readDraft(id: string) {
  try {
    return sessionStorage.getItem(`flora-draft:${id}`) ?? "";
  } catch {
    return "";
  }
}

function FollowUpComposer({
  execution,
  projectID,
  contextUsage,
  id,
  busy,
  activeTurn,
  blocked,
  stopped,
  onSend,
  onControl,
}: {
  execution: Detail["chat"]["Execution"];
  contextUsage: Detail["contextUsage"];
  id: string;
  projectID: string;
  busy: boolean;
  activeTurn: boolean;
  blocked: boolean;
  stopped: boolean;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onControl: (action: "interrupt" | "stop") => void;
}) {
  const [draft, setDraft] = useState(() => readDraft(id));
  const sendLabel = stopped ? "Resume" : "Send message";
  const canSend = !busy && !activeTurn && !blocked;

  return (
    <form
      className="chat-composer follow-up-composer"
      onSubmit={(event) => {
        if (!canSend) {
          event.preventDefault();
          return;
        }
        onSend(event);
      }}
      onReset={() => {
        setDraft("");
      }}
    >
      <Composer
        execution={execution}
        activeTurn={activeTurn}
        id="follow-up-message"
        projectID={projectID}
        draftScope={`chat:${id}`}
        label="Follow-up"
        message={draft}
        onChange={(value) => {
          setDraft(value);
          saveDraft(id, value);
        }}
        disabled={busy || blocked}
        canSend={canSend}
        sendLabel={blocked ? "Continuation unavailable" : sendLabel}
        onInterrupt={
          activeTurn && !blocked
            ? () => {
                onControl("interrupt");
              }
            : undefined
        }
      />
      <ChatComposerFooter
        id={id}
        contextUsage={contextUsage}
        busy={busy}
        blocked={blocked}
        stopped={stopped}
        onControl={onControl}
      />
    </form>
  );
}
