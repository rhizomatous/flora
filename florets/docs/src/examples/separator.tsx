import { Separator } from "@flora/florets";

export function Example() {
  return (
    <div className="w-full space-y-4">
      <p className="text-sm font-medium">Project settings</p>
      <Separator />
      <div className="flex h-5 items-center gap-4 text-sm">
        <span>General</span>
        <Separator orientation="vertical" />
        <span>Notifications</span>
      </div>
    </div>
  );
}
