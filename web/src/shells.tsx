import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { z } from "zod";

import "@xterm/xterm/css/xterm.css";

import {
  Button,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  TerminalIcon,
  PlusIcon,
  TabsTrigger,
  TabsContent,
  XIcon,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  CloudIcon,
  FlowerMark,
} from "@flora/florets";

import { useChatPanelState } from "./chat-panel-state";
import { chatSchema } from "./chat-schemas";
import { request, errorMessage, isExpired, RequestError } from "./request";
import { useRuntime } from "./runtime-state";

const shellSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.enum(["running", "ended"]),
});
const shellsSchema = z.object({ shells: z.array(shellSchema), count: z.number() });
type Shell = z.infer<typeof shellSchema>;
const shellURL = (id: string) => `chats/${encodeURIComponent(id)}/shells`;

function useShells(chatID: string, active: boolean) {
  const [panel, update] = useChatPanelState(chatID);
  const syncTitles = useEffectEvent((shells: Shell[]) => {
    if (
      !panel.shellTabs.some((tab) =>
        shells.some((shell) => shell.id === tab.id && shell.title !== tab.title),
      )
    ) {
      return;
    }
    update((current) => {
      const shellTabs = current.shellTabs.map((tab) => {
        const saved = shells.find((shell) => shell.id === tab.id);
        return saved && saved.title !== tab.title ? { ...tab, title: saved.title } : tab;
      });
      return { shellTabs };
    });
  });
  const [shells, setShells] = useState<Shell[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await request(shellsSchema, shellURL(chatID), { signal: controller.signal });
        if (!controller.signal.aborted) {
          syncTitles(result.shells);
          setShells(result.shells);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e, "Could not list shells."));
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => {
          void refresh();
        }, 5000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [chatID, active]);
  return { shells, error };
}

export function ShellMenuItems({
  chatID,
  open,
  onSelect,
}: {
  chatID: string;
  open: boolean;
  onSelect: () => void;
}) {
  const [, update] = useChatPanelState(chatID);
  const { shells, error } = useShells(chatID, open);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState("");
  function select(shell: Shell) {
    update((current) => ({
      shellTabs: current.shellTabs.some((tab) => tab.id === shell.id)
        ? current.shellTabs
        : [...current.shellTabs, { id: shell.id, title: shell.title }],
      mainView: `shell:${shell.id}`,
      open: current.open && !window.matchMedia("(max-width: 900px)").matches,
    }));
    onSelect();
  }
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Terminals</DropdownMenuLabel>
      {shells?.map((shell) => (
        <DropdownMenuItem
          key={shell.id}
          onClick={() => {
            select(shell);
          }}
        >
          <TerminalIcon />
          {shell.title}
          <span className="ml-auto text-muted-foreground">
            {shell.state === "ended" ? "Ended" : "Running"}
          </span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        disabled={creating || (shells !== undefined && shells.length >= 8)}
        closeOnClick={false}
        onClick={() => {
          setCreating(true);
          setFailure("");
          async function create() {
            try {
              select(await request(shellSchema, shellURL(chatID), { method: "POST", body: {} }));
            } catch (e) {
              setFailure(errorMessage(e, "Could not create a shell."));
            } finally {
              setCreating(false);
            }
          }
          void create();
        }}
      >
        <PlusIcon />
        {creating ? "Opening shell…" : "New shell"}
      </DropdownMenuItem>
      {(failure || error) && (
        <p role="alert" className="px-2 py-1 text-sm text-destructive">
          {failure || error}
        </p>
      )}
    </DropdownMenuGroup>
  );
}

export function ShellTabs({ chatID }: { chatID: string }) {
  const [state, update] = useChatPanelState(chatID);
  const [closing, setClosing] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      {state.shellTabs.map((shell) => (
        <div
          key={shell.id}
          className="chat-diff-tab workspace-tab"
          data-active={state.mainView === `shell:${shell.id}` || undefined}
        >
          <TabsTrigger
            value={`shell:${shell.id}`}
            data-workspace-view={`shell:${shell.id}`}
            variant="control"
            render={
              <Button variant="ghost" size="compact" className="chat-diff-tab-trigger max-w-56" />
            }
          >
            <TerminalIcon />
            <span className="florets-control-label truncate" title={shell.title}>
              {shell.title}
            </span>
          </TabsTrigger>
          <Button
            variant="ghost"
            size="icon-compact"
            className="chat-diff-tab-close"
            disabled={closing !== ""}
            aria-label={`Close ${shell.title}`}
            title="Close tab and terminate shell"
            onClick={() => {
              setClosing(shell.id);
              setError("");
              async function close() {
                try {
                  try {
                    await request(
                      z.object({ ok: z.boolean() }),
                      `${shellURL(chatID)}/${encodeURIComponent(shell.id)}`,
                      { method: "DELETE" },
                    );
                  } catch (e) {
                    // Another browser may already have closed this shell.
                    if (!(e instanceof RequestError && e.status === 404)) throw e;
                  }
                  update((current) => ({
                    shellTabs: current.shellTabs.filter((tab) => tab.id !== shell.id),
                    mainView: current.mainView === `shell:${shell.id}` ? "chat" : current.mainView,
                  }));
                  requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLButtonElement>(
                        '.chat-main-pane [role="tab"][aria-selected="true"]',
                      )
                      ?.focus();
                  });
                } catch (e) {
                  setError(errorMessage(e, "Could not close shell."));
                } finally {
                  setClosing("");
                }
              }
              void close();
            }}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {error && (
        <span role="alert" className="max-w-64 text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

function ShellTerminal({
  chatID,
  shell,
  active,
  onExpired,
}: {
  chatID: string;
  shell: { id: string; title: string };
  active: boolean;
  onExpired: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [, updatePanel] = useChatPanelState(chatID);
  const { shells, error: listingError } = useShells(chatID, active);
  const saved = shells?.find((item) => item.id === shell.id);
  const ended = shells !== undefined && (saved === undefined || saved.state === "ended");
  const machine = useRuntime(chatID, active && (ended || status === "Disconnected"));
  const expire = useEffectEvent(onExpired);
  const url = `${shellURL(chatID)}/${encodeURIComponent(shell.id)}`;
  const connectionURL = `${url}/connect?attempt=${revision}`;
  const focusActive = useEffectEvent(() => {
    if (active) {
      fit.current?.fit();
      terminal.current?.focus();
    }
  });

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono", monospace',
      fontSize: 13,
      scrollback: 3000,
      cursorBlink: true,
      disableStdin: true,
      screenReaderMode: true,
      allowProposedApi: false,
      theme: {
        background: "#151515",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#555555",
      },
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(host.current);
    terminal.current = term;
    fit.current = addon;
    term.textarea?.setAttribute("aria-description", "Press Shift+Tab to return to the tab bar");
    // Keep clipboard access under browser/user control. Terminal output cannot
    // open links, read the clipboard, or change application navigation.
    term.parser.registerOscHandler(52, () => true);
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.key === "Tab" &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('.chat-main-pane [role="tab"][aria-selected="true"]')
          ?.focus();
        return false;
      }
      return true;
    });
    const input = term.onData((data) => {
      const ws = socket.current;
      if (
        ws?.readyState === WebSocket.OPEN &&
        new TextEncoder().encode(data).length <= 16 * 1024 &&
        ws.bufferedAmount < 64 * 1024
      ) {
        ws.send(data);
      } else if (data) {
        setError("Input was not sent. Reconnect, or paste less than 16 KiB at a time.");
      }
    });
    return () => {
      input.dispose();
      term.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, []);

  useEffect(() => {
    terminal.current?.textarea?.setAttribute("aria-label", `${shell.title} terminal input`);
  }, [shell.title]);

  useEffect(() => {
    if (!active) return;
    const node = host.current;
    if (!node) return;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fit.current?.fit();
        const term = terminal.current;
        if (
          term === null ||
          term.cols === 0 ||
          term.rows === 0 ||
          ended ||
          socket.current?.readyState !== WebSocket.OPEN
        ) {
          return;
        }
        const { rows, cols } = term;
        async function sendSize() {
          try {
            await request(z.object({ ok: z.boolean() }), url, {
              method: "PUT",
              body: {
                rows: Math.max(2, Math.min(500, rows)),
                cols: Math.max(2, Math.min(500, cols)),
              },
            });
          } catch (e) {
            if (isExpired(e)) expire();
          }
        }
        void sendSize();
      }, 150);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [active, ended, url]);

  useEffect(() => {
    if (ended) return;
    let disposed = false;
    let ws: WebSocket | undefined;
    const term = terminal.current;

    // Verify session and shell status before upgrading, so login expiry and
    // stopped machines produce readable errors instead of opaque socket errors.
    const pending = setTimeout(() => {
      setStatus("Connecting…");
      setError("");
    }, 0);
    async function connect() {
      try {
        const result = await request(shellsSchema, shellURL(chatID));
        if (disposed) return;
        if (!result.shells.some((item) => item.id === shell.id && item.state === "running")) {
          setStatus("Shell ended");
          return;
        }
        const target = new URL(`/api/${connectionURL}`, window.location.href);
        target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(target);
        ws.binaryType = "arraybuffer";
        socket.current = ws;
        let queued = 0;
        ws.addEventListener("open", () => {
          term?.reset();
          if (term) term.options.disableStdin = false;
          setStatus("Connected");
          focusActive();
        });
        ws.addEventListener("message", (event: MessageEvent<unknown>) => {
          // Runtime cursor metadata is binary.
          const { data } = event;
          if (typeof data !== "string") return;
          queued += data.length;
          if (queued > 2 * 1024 * 1024) {
            ws?.close();
            setError("Output exceeded the display buffer. Reconnect to replay recent output.");
            return;
          }
          term?.write(data, () => {
            queued -= data.length;
          });
        });
        ws.addEventListener("close", () => {
          if (!disposed) {
            if (term) term.options.disableStdin = true;
            setStatus("Disconnected");
          }
        });
        ws.addEventListener("error", () => {
          if (!disposed) {
            setError("Connection lost. Reconnect to this shell when its machine is available.");
          }
        });
      } catch (e) {
        if (!disposed) {
          setStatus("Disconnected");
          setError(errorMessage(e, "Could not connect."));
          if (isExpired(e)) expire();
        }
      }
    }
    void connect();
    return () => {
      clearTimeout(pending);
      disposed = true;
      if (term) term.options.disableStdin = true;
      ws?.close();
      socket.current = null;
    };
  }, [ended, chatID, shell.id, connectionURL]);

  const machineState = machine.runtime?.state;
  const asleep = machineState === "stopped" || machineState === "failed";
  const missing = machineState === "missing";
  const verifying = ended && (machineState === undefined || machineState === "unknown");
  const starting = machineState === "starting" || pendingAction === "wake";
  const showPanel = ended || status !== "Connected" || error !== "" || listingError !== "";
  let panelTitle = "Shell disconnected";
  if (ended) panelTitle = "Shell ended";
  else if (status === "Connecting…") panelTitle = "Connecting to shell…";
  let description = ended
    ? "Open a new shell to continue."
    : "Reconnect to continue in this shell.";
  if (status === "Connected") {
    panelTitle = "Shell connection";
    description = "";
  }
  if (verifying) {
    panelTitle = "Checking machine state…";
    description = "";
  }
  if (asleep) {
    panelTitle = machineState === "failed" ? "Machine has stopped" : "Machine is asleep";
    description = "Wake the machine to open a new shell.";
  }
  if (missing) {
    panelTitle = "Machine is missing";
    description = "Restore the saved machine to open a shell.";
  }
  if (starting) {
    panelTitle = "Waking machine…";
    description = "";
  }
  if (ended && machineState === "unknown") {
    panelTitle = "Machine state unavailable";
    description = "Refresh machine state to continue.";
  }
  const connecting = status === "Connecting…" && !ended;
  const checking = verifying && machineState === undefined && machine.error === "";
  const busy = pendingAction !== "" || starting || connecting || checking;
  const connectionDiagnostic = asleep || missing || starting ? "" : error || listingError;
  const diagnostic = actionError || connectionDiagnostic || (ended ? machine.error : "");

  function reconnect() {
    socket.current?.close();
    socket.current = null;
    setStatus("Connecting…");
    setRevision((value) => value + 1);
  }
  async function openShell(wake: boolean) {
    setPendingAction(wake ? "wake" : "create");
    setActionError("");
    setError("");
    try {
      if (wake) {
        await request(chatSchema, `chats/${encodeURIComponent(chatID)}/wake`, {
          method: "POST",
          body: {},
        });
      }
      const created = await request(shellSchema, shellURL(chatID), { method: "POST", body: {} });
      updatePanel((current) => ({
        shellTabs: [...current.shellTabs, { id: created.id, title: created.title }],
        mainView: `shell:${created.id}`,
      }));
    } catch (e) {
      setActionError(errorMessage(e, "Could not open a shell."));
      if (isExpired(e)) onExpired();
    } finally {
      setPendingAction("");
    }
  }

  return (
    <section
      aria-label={`${shell.title} terminal`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <span role="status" className="sr-only">
        {showPanel ? panelTitle : "Connected"}
      </span>
      <div
        role="application"
        aria-label="Terminal keyboard controls"
        className="min-h-0 flex-1 overflow-hidden bg-[#151515] p-3 sm:px-8"
      >
        <div ref={host} className="h-full w-full" />
      </div>
      {showPanel && (
        <Empty className="max-h-[55%] min-h-48 flex-none shrink-0 overflow-y-auto rounded-none border-t border-solid border-border py-6 sm:min-h-56">
          <EmptyHeader>
            <EmptyMedia className="text-muted-foreground">
              {busy && <FlowerMark className="animate-pulse text-3xl" />}
              {!busy && (asleep || missing) && <CloudIcon className="size-8" />}
              {!busy && !asleep && !missing && <TerminalIcon className="size-8" />}
            </EmptyMedia>
            <EmptyTitle>{panelTitle}</EmptyTitle>
            {description !== "" && !connecting && (
              <EmptyDescription>{description}</EmptyDescription>
            )}
          </EmptyHeader>
          <EmptyContent>
            {diagnostic !== "" && (
              <p role="alert" className="text-sm text-destructive">
                {diagnostic}
              </p>
            )}
            {asleep && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void openShell(true);
                }}
              >
                Wake machine
              </Button>
            )}
            {missing && (
              <Button
                variant="outline"
                onClick={() => {
                  updatePanel({ mainView: "chat" });
                }}
              >
                Back to chat
              </Button>
            )}
            {ended && machineState === "running" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void openShell(false);
                }}
              >
                {pendingAction === "create" ? "Opening shell…" : "New shell"}
              </Button>
            )}
            {verifying && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void machine.refresh();
                }}
              >
                Refresh
              </Button>
            )}
            {!ended && !asleep && !missing && !starting && !connecting && (
              <Button
                variant="outline"
                title="Reconnect to this shell and replay up to 2 MiB of recent output"
                onClick={reconnect}
              >
                Reconnect
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
    </section>
  );
}

export function ShellPanels({ chatID, onExpired }: { chatID: string; onExpired: () => void }) {
  const [state] = useChatPanelState(chatID);
  return (
    <>
      {state.shellTabs.map((shell) => (
        <TabsContent
          key={shell.id}
          value={`shell:${shell.id}`}
          keepMounted
          className="chat-view-panel -mx-4 min-h-0 min-w-0 flex-1 sm:-mx-8"
        >
          <ShellTerminal
            chatID={chatID}
            shell={shell}
            active={state.mainView === `shell:${shell.id}`}
            onExpired={onExpired}
          />
        </TabsContent>
      ))}
    </>
  );
}
