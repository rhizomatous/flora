import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@flora/florets";

export function Example() {
  const frameworks = ["React", "Vue", "Svelte", "Solid"];
  return (
    <Combobox items={frameworks}>
      <ComboboxInput aria-label="Choose a framework" placeholder="Choose a framework" />
      <ComboboxContent>
        <ComboboxEmpty>No framework found.</ComboboxEmpty>
        <ComboboxList>
          {(framework: string) => (
            <ComboboxItem key={framework} value={framework}>
              {framework}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
