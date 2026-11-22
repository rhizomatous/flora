import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Popover, PopoverTrigger, PopoverContent, SearchIcon } from "@flora/florets";

import { autocompleteKey, commandQuery, type AutocompleteState } from "./composer-autocomplete";
import type { ContextPickerHandle } from "./context-picker";
import { errorMessage, request } from "./request";

const commandSchema = z.object({ name: z.string(), description: z.string(), source: z.string() });
const schema = z.object({ items: z.array(commandSchema) });
type Command = z.infer<typeof schema>["items"][number];
export type CommandPickerHandle = Pick<ContextPickerHandle, "detect" | "keydown" | "close">;

/** Selecting a command edits the draft. Only submitting the form starts work. */
export function CommandPicker({
  ref,
  scope,
  textarea,
  onText,
  disabled,
  activeTurn,
  onActive,
}: {
  ref: Ref<CommandPickerHandle>;
  scope: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  disabled: boolean;
  activeTurn: boolean;
  onActive: (state: AutocompleteState) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const listID = `command-options-${scope.replaceAll(":", "-")}`;
  const open = query !== null && !disabled;
  const items = useMemo(
    () => commands.filter((item) => item.name.includes(query ?? "")),
    [commands, query],
  );
  const chatID = scope.startsWith("chat:") ? scope.slice(5) : "";
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await request(schema, `commands?${new URLSearchParams({ chat: chatID })}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setCommands(result.items.filter((item) => item.source !== "skill"));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setCommands([]);
          setQuery(null);
          toast.error(errorMessage(error, "Could not load commands."), {
            toasterId: "chat-organization",
          });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, chatID]);
  useEffect(() => {
    onActive({
      open: open && items.length > 0,
      listID,
      activeID: items[active] ? `${listID}-${active}` : undefined,
    });
  }, [open, items, active, listID, onActive]);
  useEffect(() => {
    panel.current
      ?.querySelector(`#${CSS.escape(listID)}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listID]);
  useEffect(() => {
    const form = textarea.current?.form;
    const reset = () => {
      setQuery(null);
    };
    form?.addEventListener("reset", reset);
    return () => {
      form?.removeEventListener("reset", reset);
    };
  }, [textarea]);
  function close() {
    setQuery(null);
  }
  function select(item: Command | undefined) {
    if (item === undefined || disabled || activeTurn) return;
    close();
    onText(`/${item.name} `);
    textarea.current?.focus();
    requestAnimationFrame(() => {
      textarea.current?.setSelectionRange(item.name.length + 2, item.name.length + 2);
    });
  }
  useImperativeHandle(ref, () => ({
    close,
    detect(value, caret) {
      setQuery(disabled ? null : commandQuery(value, caret));
      setActive(0);
    },
    keydown(event) {
      if (!open || items.length === 0) return false;
      return autocompleteKey(event, {
        close,
        move(delta) {
          setActive((current) => (current + delta + items.length) % items.length);
        },
        select() {
          select(items[active]);
        },
      });
    },
  }));
  return (
    <Popover
      open={open && items.length > 0}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverTrigger
        render={
          <span
            className="pointer-events-none absolute top-0 left-3 h-px w-px"
            aria-hidden="true"
          />
        }
      />
      <PopoverContent
        ref={panel}
        aria-label="Commands"
        side="top"
        align="start"
        className="composer-menu w-[320px]! max-w-[calc(100vw-24px)]! gap-0 p-1.5! transition-none"
        initialFocus={false}
        finalFocus={false}
      >
        <div id={listID} role="listbox" aria-label="Commands" className="max-h-60 overflow-y-auto">
          {items.map((item, index) => (
            <button
              type="button"
              tabIndex={-1}
              key={item.name}
              id={`${listID}-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={activeTurn}
              className={`flex w-full cursor-default items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${index === active ? "bg-accent" : ""} ${activeTurn ? "text-muted-foreground opacity-50" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseMove={() => {
                setActive(index);
              }}
              onClick={() => {
                select(item);
              }}
            >
              <SearchIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={item.description}>
                /{item.name}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
