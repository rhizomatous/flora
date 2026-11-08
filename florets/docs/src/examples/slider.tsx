import { Slider } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-4">
      <Slider aria-label="Volume" defaultValue={[50]} max={100} step={1} />
      <Slider aria-label="Disabled slider" defaultValue={[25]} disabled />
    </div>
  );
}
