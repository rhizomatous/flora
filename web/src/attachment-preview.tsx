import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
  FilesIcon,
  XIcon,
  RefreshCwIcon,
  Spinner,
} from "@flora/florets";

import { formatAttachmentSize, type UploadedAttachment } from "./attachments";

export function AttachmentPreview({
  file,
  state = "done",
  description,
  onRemove,
  onRetry,
  disabled = false,
}: {
  file: UploadedAttachment;
  state?: "uploading" | "done" | "error";
  description?: string;
  onRemove?: () => void;
  onRetry?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const url = `/api/attachments/${encodeURIComponent(file.id)}/content`;
  let media = <FilesIcon />;
  if (state === "uploading") media = <Spinner />;
  else if (file.mime.startsWith("image/") && state === "done") media = <img src={url} alt="" />;
  return (
    <Attachment size="sm" state={state} className="max-w-full min-w-0 grow-0 basis-[220px]">
      <AttachmentMedia
        variant={file.mime.startsWith("image/") && state === "done" ? "image" : "icon"}
      >
        {media}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
        <AttachmentDescription title={description}>
          {description ?? formatAttachmentSize(file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      {state === "done" && (
        <AttachmentTrigger
          aria-label={`Open ${file.name}`}
          render={
            <a
              aria-label={`Open ${file.name}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        />
      )}
      {onRemove && (
        <AttachmentActions>
          {onRetry && (
            <AttachmentAction
              type="button"
              aria-label={`Retry ${file.name}`}
              disabled={disabled}
              onClick={onRetry}
            >
              <RefreshCwIcon />
            </AttachmentAction>
          )}
          <AttachmentAction
            type="button"
            aria-label={`${state === "uploading" ? "Cancel upload of" : "Remove"} ${file.name}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      )}
    </Attachment>
  );
}
