import { Kbd, KbdGroup } from "@flora/florets";

export function Example() {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      Open search{" "}
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </p>
  );
}
