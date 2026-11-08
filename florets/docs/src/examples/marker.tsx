import { Marker, MarkerContent } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-4">
      <Marker>
        <MarkerContent>Checkpoint saved</MarkerContent>
      </Marker>
      <Marker variant="separator">
        <MarkerContent>Today</MarkerContent>
      </Marker>
    </div>
  );
}
