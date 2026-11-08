import { NativeSelect, NativeSelectOption } from "@flora/florets";

export function Example() {
  return (
    <NativeSelect aria-label="Repository access" defaultValue="read" className="w-full">
      <NativeSelectOption value="read">Read only</NativeSelectOption>
      <NativeSelectOption value="write">Read and write</NativeSelectOption>
    </NativeSelect>
  );
}
