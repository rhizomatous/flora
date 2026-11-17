import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { errorMessage, request } from "./request";

export const attachmentSchema = z.object({
  id: z.string(),
  projectID: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
});
export type UploadedAttachment = z.infer<typeof attachmentSchema>;
const policySchema = z.object({ image: z.boolean(), pdf: z.boolean(), reason: z.string() });
type Policy = z.infer<typeof policySchema>;
const draftSchema = attachmentSchema.extend({
  state: z.enum(["uploading", "done", "error"]),
  error: z.string().optional(),
});
type DraftAttachment = z.infer<typeof draftSchema>;
const key = (scope: string) => `flora-attachments:${scope}`;
export const attachmentAccept = ".png,.jpg,.jpeg,.gif,.pdf,.txt,.md,.csv,.json";

function readAttachments(scope: string): DraftAttachment[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key(scope)) ?? "[]");
    return z.array(draftSchema).parse(stored);
  } catch {
    return [];
  }
}
function saveAttachments(scope: string, items: DraftAttachment[]) {
  try {
    sessionStorage.setItem(key(scope), JSON.stringify(items));
  } catch {
    // Storage may be disabled.
  }
}
function unsupported(item: DraftAttachment, policy: Policy | undefined) {
  if (item.mime === "text/plain") return "";
  if (policy === undefined) return "Checking model support…";
  if (
    (item.mime.startsWith("image/") && policy.image) ||
    (item.mime === "application/pdf" && policy.pdf)
  ) {
    return "";
  }
  return policy.reason || "The configured model does not support this file type.";
}

/** Completed uploads survive reloads. Interrupted uploads require the original file to retry. */
export function useAttachments(scope: string, project: string) {
  const [items, setItems] = useState<DraftAttachment[]>(() => readAttachments(scope));
  const current = useRef(items);
  const [policy, setPolicy] = useState<Policy>();
  const [error, setError] = useState("");
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const update = useCallback(
    (next: DraftAttachment[]) => {
      current.current = next;
      saveAttachments(scope, next);
      setItems(next);
    },
    [scope],
  );
  const checkPolicy = useCallback(async () => {
    try {
      const next = await request(policySchema, "attachments/policy");
      if (mounted.current) setPolicy(next);
    } catch {
      if (mounted.current) {
        setPolicy({
          image: false,
          pdf: false,
          reason: "Model support could not be checked. Retry the check or use a text document.",
        });
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const saved = current.current;
    async function restore() {
      if (saved.length === 0) return;
      if (saved.some((item) => item.mime !== "text/plain")) void checkPolicy();
      await Promise.all(
        saved.map(async (item) => {
          try {
            const uploaded = await request(
              attachmentSchema,
              `attachments/${encodeURIComponent(item.id)}`,
            );
            if (mounted.current && current.current.some((entry) => entry.id === item.id)) {
              update(
                current.current.map((entry) =>
                  entry.id === item.id ? { ...uploaded, state: "done" } : entry,
                ),
              );
            }
          } catch {
            if (mounted.current) {
              update(
                current.current.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        state: "error",
                        error: "Upload unavailable. Remove it and choose the file again.",
                      }
                    : entry,
                ),
              );
            }
          }
        }),
      );
    }
    void restore();
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      for (const controller of activeControllers.values()) controller.abort();
    };
  }, [checkPolicy, update]);

  async function upload(id: string) {
    const file = files.current.get(id);
    if (file === undefined) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    update(
      current.current.map((item) =>
        item.id === id ? { ...item, state: "uploading", error: undefined } : item,
      ),
    );
    try {
      const uploaded = await request(
        attachmentSchema,
        `projects/${encodeURIComponent(project)}/attachments/${encodeURIComponent(id)}?name=${encodeURIComponent(file.name)}`,
        { method: "PUT", rawBody: file, signal: controller.signal },
      );
      if (mounted.current && current.current.some((item) => item.id === id)) {
        update(
          current.current.map((item) => (item.id === id ? { ...uploaded, state: "done" } : item)),
        );
      }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) {
        update(
          current.current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  state: "error",
                  error: errorMessage(cause, "Upload failed. Retry or remove this file."),
                }
              : item,
          ),
        );
      }
    } finally {
      controllers.current.delete(id);
    }
  }

  function add(selected: File[]) {
    setError("");
    if (project === "") {
      setError("Choose a project before uploading.");
      return;
    }
    for (const file of selected) {
      const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "gif", "pdf", "txt", "md", "csv", "json"].includes(extension)) {
        setError("Supported files: PNG, JPEG, GIF, PDF, TXT, Markdown, CSV, and JSON.");
        continue;
      }
      let mime = "text/plain";
      if (extension === "pdf") mime = "application/pdf";
      else if (["png", "jpg", "jpeg", "gif"].includes(extension)) {
        mime = `image/${extension === "jpg" ? "jpeg" : extension}`;
      }
      if (
        file.size === 0 ||
        file.size > 5 * 1024 * 1024 ||
        (mime === "text/plain" && file.size > 1024 * 1024)
      ) {
        setError("Files must be nonempty and at most 5 MiB. Text documents must be at most 1 MiB.");
        continue;
      }
      if (
        current.current.length >= 5 ||
        current.current.reduce((sum, item) => sum + item.size, 0) + file.size > 20 * 1024 * 1024
      ) {
        setError("Use at most 5 files, totaling at most 20 MiB per message.");
        break;
      }
      const id = crypto.randomUUID();
      files.current.set(id, file);
      update([
        ...current.current,
        {
          id,
          projectID: project,
          name: file.name,
          mime,
          size: file.size,
          createdAt: new Date().toISOString(),
          state: "uploading",
        },
      ]);
      void upload(id);
    }
    if (current.current.some((item) => item.mime !== "text/plain")) void checkPolicy();
  }
  async function remove(id: string) {
    controllers.current.get(id)?.abort();
    files.current.delete(id);
    update(current.current.filter((item) => item.id !== id));
    // If cancellation races a completed upload, the unused bytes expire in 24 hours.
    try {
      await request(z.object({ removed: z.boolean() }), `attachments/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // The 24-hour cleanup also covers failed deletion.
    }
  }
  function clear() {
    update([]);
    files.current.clear();
    setError("");
  }
  const ready = items.every((item) => item.state === "done" && unsupported(item, policy) === "");
  return {
    items,
    add,
    remove,
    clear,
    ready,
    error,
    retry: upload,
    checkPolicy,
    canRetry: (id: string) => files.current.has(id),
    issue: (item: DraftAttachment) => item.error ?? unsupported(item, policy),
  };
}

export function formatAttachmentSize(size: number) {
  return size < 1000 ? `${size} B` : `${Math.round(size / 1000)} KB`;
}

export function attachmentDetails(file: UploadedAttachment) {
  const extension = file.name.split(".").at(-1)?.toUpperCase() ?? "File";
  return `${formatAttachmentSize(file.size)} · ${extension}`;
}
