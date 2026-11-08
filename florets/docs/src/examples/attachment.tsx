import { FileIcon } from "lucide-react";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@flora/florets";

export function Example() {
  return (
    <Attachment>
      <AttachmentMedia>
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>settings.json</AttachmentTitle>
        <AttachmentDescription>JSON · 2 KB</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );
}
