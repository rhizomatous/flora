import { AspectRatio } from "@flora/florets";

export function Example() {
  return (
    <div className="w-full">
      <AspectRatio ratio={16 / 9}>
        <div className="flex size-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
          16:9 preview
        </div>
      </AspectRatio>
    </div>
  );
}
