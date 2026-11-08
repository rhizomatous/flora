import { Spinner } from "@flora/florets";

export function Example() {
  return (
    <div className="flex items-center gap-2 text-sm" role="status">
      <Spinner />
      Validating settings…
    </div>
  );
}
