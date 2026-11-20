import { useContext, type MouseEvent } from "react";

import { useChatPanelState } from "./chat-panel-state";
import type { Pull } from "./pull-schemas";
import { SubagentsContext } from "./subagent-state";

export function usePullNavigation(override?: string) {
  const { chatID: currentChat } = useContext(SubagentsContext);
  const chatID = override ?? currentChat;
  const [state, update] = useChatPanelState(chatID);
  return {
    available: chatID !== "",
    open(pull: Pull) {
      update({
        open: true,
        view: `pull:${pull.url}`,
        pullTabs: [...new Set([...state.pullTabs, pull.url])],
      });
      if (window.location.hash.split("?")[0] !== `#chats/${chatID}`) {
        window.location.hash = `chats/${chatID}`;
      }
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(`[role="tab"][data-pull-url="${CSS.escape(pull.url)}"]`)
          ?.focus();
      });
    },
  };
}

export function openPull(
  event: MouseEvent<HTMLAnchorElement>,
  pull: Pull,
  navigation: ReturnType<typeof usePullNavigation>,
) {
  if (
    !navigation.available ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigation.open(pull);
}
