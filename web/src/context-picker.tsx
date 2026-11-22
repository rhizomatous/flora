import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { z } from "zod";

import {
  Button,
  FilesIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  XIcon,
  SearchIcon,
  Input,
  NativeSelect,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@flora/florets";

import { ContextReferenceIcon, ContextReferenceLabel } from "./context-reference";
import { referenceSchema, referenceKey } from "./context-schema";
import { request, errorMessage } from "./request";

const sourceSchema = referenceSchema;
const resultsSchema = z.object({
  items: z.array(sourceSchema),
  note: z.string(),
  repositories: z.array(z.string()),
});

type Source = z.infer<typeof sourceSchema>;
type Reference = z.infer<typeof referenceSchema>;
type Kind = Source["kind"];
const kinds: { kind: Kind; label: string; icon: typeof FilesIcon }[] = [
  { kind: "file", label: "Files", icon: FilesIcon },
  { kind: "chat", label: "Chats", icon: MessageSquareIcon },
  { kind: "pr", label: "Pull requests", icon: GitPullRequestIcon },
];
export type ContextPickerHandle = {
  open: (kind: Kind) => void;
  detect: (value: string, caret: number) => void;
  keydown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  close: () => void;
};
function read(scope: string): Reference[] {
  try {
    return z
      .array(referenceSchema)
      .parse(JSON.parse(sessionStorage.getItem(`flora-context:${scope}`) ?? "[]"));
  } catch {
    return [];
  }
}

/** Drafts retain source identifiers. Source contents are read by the agent when needed. */
export function ContextPicker({
  ref,
  scope,
  projectID,
  textarea,
  onText,
  disabled,
  onCount,
  onActive,
}: {
  ref: Ref<ContextPickerHandle>;
  scope: string;
  projectID: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  disabled: boolean;
  onCount: (count: number) => void;
  onActive: (state: { open: boolean; listID: string; activeID: string | undefined }) => void;
}) {
  const [references, setReferences] = useState(() => read(scope));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("chat");
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const [repositories, setRepositories] = useState<string[]>([]);
  const [mention, setMention] = useState<{ start: number; end: number } | null>(null);
  const [response, setResponse] = useState<{
    key: string;
    data?: z.infer<typeof resultsSchema>;
    error: string;
  }>();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [active, setActive] = useState(0);
  const [revision, setRevision] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const selectionRequest = useRef<AbortController | null>(null);
  const chatID = scope.startsWith("chat:") ? scope.slice(5) : "";
  const listID = `context-options-${scope.replaceAll(":", "-")}`;
  const lookup = `${kind}:${query}:${repository}:${revision}`;
  const result = response?.key === lookup ? response.data : undefined;
  const loading = open && response?.key !== lookup;
  const loadError = response?.key === lookup ? response.error : "";
  useEffect(() => {
    onActive({
      open: open && mention !== null,
      listID,
      activeID: result?.items[active] ? `${listID}-${active}` : undefined,
    });
  }, [open, mention, listID, result, active, onActive]);
  const endpoint = `projects/${encodeURIComponent(projectID)}/context`;
  useEffect(() => {
    onCount(references.length);
    try {
      sessionStorage.setItem(`flora-context:${scope}`, JSON.stringify(references));
    } catch {
      /* Storage may be disabled. */
    }
  }, [references, scope, onCount]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    const form = textarea.current?.form;
    const reset = () => {
      setReferences([]);
      setOpen(false);
    };
    form?.addEventListener("reset", reset);
    return () => {
      form?.removeEventListener("reset", reset);
    };
  }, [textarea]);
  useEffect(() => {
    if (open && mention === null) search.current?.focus();
  }, [open, mention]);
  useEffect(() => {
    if (!open || projectID === "") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setError("");
        setActive(0);
        try {
          const next = await request(
            resultsSchema,
            `${endpoint}?${new URLSearchParams({ kind, query, chat: chatID, repository, revision: lookup })}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setResponse({ key: lookup, data: next, error: "" });
            setRepositories(next.repositories);
          }
        } catch (e) {
          if (!controller.signal.aborted) {
            setResponse({ key: lookup, error: errorMessage(e, "Could not load context.") });
          }
        }
      })();
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, kind, query, chatID, endpoint, projectID, lookup, repository]);
  useEffect(() => {
    panel.current
      ?.querySelector(`#${CSS.escape(listID)}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listID]);
  function close() {
    selectionRequest.current?.abort();
    setOpen(false);
    setMention(null);
    textarea.current?.focus();
  }
  async function select(source: Source) {
    if (adding || disabled) return;
    if (
      references.length >= 5 &&
      !references.some((item) => referenceKey(item) === referenceKey(source))
    ) {
      setError("Use at most 5 context references. Remove one to add another.");
      return;
    }
    setAdding(true);
    setError("");
    const controller = new AbortController();
    selectionRequest.current = controller;
    const range = mention;
    const originalText = textarea.current?.value;
    try {
      const reference = await request(referenceSchema, endpoint, {
        method: "POST",
        body: { chatID, source },
        signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      setReferences((current) =>
        current.some((item) => referenceKey(item) === referenceKey(reference))
          ? current
          : [...current, reference],
      );
      if (range && textarea.current && textarea.current.value === originalText) {
        const { value } = textarea.current;
        onText(value.slice(0, range.start) + value.slice(range.end));
        requestAnimationFrame(() => {
          textarea.current?.setSelectionRange(range.start, range.start);
        });
      }
      close();
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) {
        setError(errorMessage(e, "Could not add this reference. Try again."));
      }
    } finally {
      if (mounted.current) setAdding(false);
    }
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    if (event.key === "Tab" && event.target === textarea.current) {
      setOpen(false);
      setMention(null);
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = result?.items.length ?? 0;
      setActive((current) =>
        count ? (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count : 0,
      );
      return true;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (event.target === textarea.current || event.target === search.current)
    ) {
      event.preventDefault();
      const source = result?.items[active];
      if (source && !loading && !adding) void select(source);
      return true;
    }
    return false;
  }
  useImperativeHandle(ref, () => ({
    open(next) {
      setKind(next);
      setQuery("");
      setMention(null);
      setOpen(true);
    },
    close,
    keydown,
    detect(value, caret) {
      if (disabled || projectID === "") return;
      const match = /(?:^|\s)@([^\s@]*)$/u.exec(value.slice(0, caret));
      if (!match) {
        setOpen(false);
        setMention(null);
        return;
      }
      setMention({ start: caret - (match[1] ?? "").length - 1, end: caret });
      setQuery(match[1] ?? "");
      setOpen(true);
    },
  }));
  function handlePanelKeydown(event: KeyboardEvent<HTMLElement>) {
    keydown(event);
  }
  return (
    <>
      {references.map((item) => (
        <input
          key={referenceKey(item)}
          type="hidden"
          name="references"
          value={JSON.stringify(item)}
        />
      ))}
      {references.length > 0 && (
        <div
          className="composer-attachments flex w-full min-w-0 flex-wrap gap-x-3 gap-y-1"
          aria-label="Draft context"
        >
          {references.map((item) => (
            <span
              key={referenceKey(item)}
              className="inline-flex max-w-full min-w-0 items-center gap-1 text-sm"
            >
              <ContextReferenceLabel reference={item} />
              <Button
                type="button"
                variant="ghost"
                size="icon-compact"
                className="size-6 shrink-0 text-muted-foreground"
                disabled={disabled}
                aria-label={`Remove context ${item.label}`}
                onClick={() => {
                  setReferences((current) =>
                    current.filter((entry) => referenceKey(entry) !== referenceKey(item)),
                  );
                  textarea.current?.focus();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            selectionRequest.current?.abort();
            setMention(null);
          }
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 h-0 w-full"
            />
          }
        />
        <PopoverContent
          ref={panel}
          side="top"
          align="start"
          sideOffset={8}
          initialFocus={() => (mention === null ? search.current : false)}
          finalFocus={false}
          className="context-picker max-h-[min(420px,var(--available-height))] w-[400px]! max-w-[calc(100vw-24px)]! gap-0 overflow-hidden p-0! transition-none"
          role="dialog"
          tabIndex={-1}
          aria-label="Add context"
        >
          <div
            className="flex items-center gap-1 border-b border-border p-2"
            aria-label="Context sources"
          >
            {kinds.map(({ kind: next, label, icon: Icon }) => (
              <Button
                key={next}
                type="button"
                size="compact"
                variant={kind === next ? "secondary" : "ghost"}
                disabled={adding}
                aria-pressed={kind === next}
                onKeyDown={handlePanelKeydown}
                onClick={() => {
                  setKind(next);
                  setActive(0);
                  if (mention) textarea.current?.focus();
                  else search.current?.focus();
                }}
              >
                <Icon />
                {label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon-compact"
              className="ml-auto"
              onKeyDown={handlePanelKeydown}
              aria-label="Close context picker"
              onClick={close}
            >
              <XIcon />
            </Button>
          </div>
          {mention === null ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={search}
                onKeyDown={handlePanelKeydown}
                className="border-0 bg-transparent shadow-none"
                placeholder="Search context"
                aria-label="Search context"
                role="combobox"
                aria-expanded="true"
                aria-controls={listID}
                aria-activedescendant={result?.items[active] ? `${listID}-${active}` : undefined}
                value={query}
                disabled={adding}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
          ) : (
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              {query ? `Results for “${query}”` : "Choose context, or keep typing to search"}
            </p>
          )}
          {kind !== "chat" && repositories.length > 1 && (
            <div className="border-b border-border px-3 py-2">
              <NativeSelect
                aria-label="Context repository"
                className="w-full"
                value={repository}
                disabled={adding}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
                onChange={(event) => {
                  setRepository(event.target.value);
                  setActive(0);
                }}
              >
                <option value="">All repositories</option>
                {repositories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div
            className="min-h-0 overflow-y-auto p-1.5"
            id={listID}
            role="listbox"
            aria-label="Context results"
            aria-busy={loading || adding}
          >
            {loading ? (
              <p className="px-2 py-4 text-muted-foreground" role="status">
                Loading context…
              </p>
            ) : (
              result?.items.map((source, index) => {
                return (
                  <button
                    key={referenceKey(source)}
                    id={`${listID}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    tabIndex={-1}
                    disabled={adding || disabled}
                    onPointerMove={() => {
                      setActive(index);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      void select(source);
                    }}
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-selected:bg-control-hover"
                  >
                    <ContextReferenceIcon reference={source} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{source.label}</span>
                      {source.kind !== "chat" && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {source.repository}
                          {source.kind === "file" ? `/${source.path}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
            {!loading && result?.items.length === 0 && (
              <p className="px-2 py-4 text-muted-foreground">
                No {(kinds.find((k) => k.kind === kind)?.label ?? "sources").toLowerCase()} found
              </p>
            )}
          </div>
          {(adding || error !== "" || loadError !== "" || (result?.note ?? "") !== "") && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {adding && <p role="status">Adding reference…</p>}
              {!adding && (error !== "" || loadError !== "") && (
                <div role="alert">
                  <p className="text-destructive">{error || loadError}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      setRevision((value) => value + 1);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!adding && error === "" && loadError === "" && <p>{result?.note}</p>}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
