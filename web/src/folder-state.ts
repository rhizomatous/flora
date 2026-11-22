import { createContext, useContext, type RefObject } from "react";
import { z } from "zod";

import type { Chat } from "./chat-schemas";

export const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
});
export type ChatFolder = z.infer<typeof folderSchema>;
export type FolderDialogInput = {
  chat?: Chat;
  folder?: ChatFolder;
  remove?: boolean;
  finalFocus?: RefObject<HTMLButtonElement | null>;
};
export const FolderContext = createContext<{
  folders: ChatFolder[] | undefined;
  error: string;
  refresh: () => Promise<ChatFolder[]>;
  changed: () => void;
  openFolder: (input?: FolderDialogInput) => void;
} | null>(null);
export function useFolders() {
  const value = useContext(FolderContext);
  if (!value) throw new Error("Folder actions require FolderProvider.");
  return value;
}
