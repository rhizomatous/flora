import { z } from "zod";

import { FileTypeIcon } from "@flora/florets";

import { useChatPanelState, workspaceFileView } from "./chat-panel-state";
import { useWorkspaceResource, workspaceURL } from "./workspace-data";

const searchSchema = z.object({ paths: z.array(z.string()), truncated: z.boolean() });

export function WorkspaceSearch({
  chatID,
  repository,
  query,
  active,
  onExpired,
}: {
  chatID: string;
  repository: string;
  query: string;
  active: boolean;
  onExpired: () => void;
}) {
  const [state, update] = useChatPanelState(chatID);
  const url = `${workspaceURL(chatID, { repository, path: "." })}&action=search&query=${encodeURIComponent(query)}`;
  const { data, error } = useWorkspaceResource(searchSchema, url, {
    active,
    onExpired,
    delay: 150,
  });
  return (
    <section aria-label={`${repository} search results`} className="mb-4">
      <h3 className="mb-1 text-sm font-medium">{repository}</h3>
      {error && (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Searching files…
        </p>
      )}
      {data?.paths.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">No matching files.</p>
      )}
      {data?.paths.map((path) => (
        <button
          type="button"
          key={path}
          className="workspace-tree-row px-2!"
          onClick={() => {
            const file = { repository, path };
            const view = workspaceFileView(file);
            update({
              workspaceTabs: state.workspaceTabs.some((tab) => workspaceFileView(tab) === view)
                ? state.workspaceTabs
                : [...state.workspaceTabs, file],
              mainView: view,
            });
          }}
        >
          <FileTypeIcon path={path} />
          <span className="truncate" title={path}>
            {path}
          </span>
        </button>
      ))}
      {data?.truncated === true && (
        <p role="status" className="py-2 text-xs text-muted-foreground">
          Search is incomplete. Refresh or narrow your search.
        </p>
      )}
    </section>
  );
}
