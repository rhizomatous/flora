import { createContext, useContext } from "react";

import type { Chat } from "./chat-schemas";

export const ChatIdentityContext = createContext<Chat[] | undefined>(undefined);

/** Links use public IDs while saved browser state continues to use internal keys. */
export function useChatReference() {
  const chats = useContext(ChatIdentityContext);
  return (id: string) => chats?.find((chat) => chat.ID === id)?.PublicID ?? id;
}
