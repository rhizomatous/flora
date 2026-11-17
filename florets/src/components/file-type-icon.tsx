// oxlint-disable-next-line import/no-unassigned-import -- Loads the virtual module declaration for consumers of this shared component.
import "../file-icons";
import manifest, { icons } from "virtual:flora-file-icons";

import { fileIcon } from "../lib/file-icon";

export function FileTypeIcon({ path }: { path: string }) {
  const dark = icons[fileIcon(path, manifest)];
  const light = icons[fileIcon(path, manifest, true)];
  return (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0">
      <img src={light} alt="" className="size-4 dark:hidden" loading="lazy" />
      <img src={dark} alt="" className="hidden size-4 dark:block" loading="lazy" />
    </span>
  );
}
