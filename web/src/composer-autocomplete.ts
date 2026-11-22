import type { KeyboardEvent } from "react";

export type AutocompleteState = { open: boolean; listID: string; activeID: string | undefined };

/** Safari can report the Enter ending composition after isComposing becomes false. */
export function composingKey(event: KeyboardEvent<HTMLElement>) {
  // oxlint-disable-next-line typescript/no-deprecated -- Safari's composition-ending Enter still uses 229.
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

/** Both composer pickers keep typing focus in the textarea while navigating choices. */
export function autocompleteKey(
  event: KeyboardEvent<HTMLElement>,
  actions: {
    move: (delta: number) => void;
    close: () => void;
    select?: () => void;
    closeOnTab?: boolean;
  },
) {
  if (composingKey(event)) return false;
  if (event.key === "Tab") {
    if (actions.closeOnTab !== false) actions.close();
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.close();
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    actions.move(event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (event.key === "Enter" && !event.shiftKey && actions.select) {
    event.preventDefault();
    actions.select();
    return true;
  }
  return false;
}

/** A command occupies the leading token; slashes in paths and prose are literal. */
export function commandQuery(value: string, caret: number) {
  if (caret !== value.length || !/^\/[A-Za-z0-9-]*$/u.test(value)) return null;
  return value.slice(1).toLowerCase();
}
