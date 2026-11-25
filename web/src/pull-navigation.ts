import { useContext, type MouseEvent } from "react";

import { ChatIdentityContext, type ChatIdentity } from "./chat-identity";
import { useChatPanelState } from "./chat-panel-state";
import type { Pull } from "./pull-schemas";

export function usePullNavigation(override?: ChatIdentity) {
  const currentChat = useContext(ChatIdentityContext);
  const chat = override ?? currentChat;
  const [state, update] = useChatPanelState(chat?.ID ?? "");
  return {
    available: chat !== undefined,
    open(pull: Pull) {
      if (!chat) return;
      update({
        open: true,
        view: `pull:${pull.url}`,
        pullTabs: [...new Set([...state.pullTabs, pull.url])],
      });
      if (window.location.hash.split("?")[0] !== `#chats/${chat.PublicID}`) {
        window.location.hash = `chats/${chat.PublicID}`;
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
