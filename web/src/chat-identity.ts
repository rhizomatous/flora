import { createContext } from "react";

import type { Chat } from "./chat-schemas";

export type ChatIdentity = Pick<Chat, "ID" | "PublicID">;
export const ChatIdentityContext = createContext<ChatIdentity | undefined>(undefined);
