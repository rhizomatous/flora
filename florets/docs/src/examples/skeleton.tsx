import { Skeleton } from "@flora/florets";

export function Example() {
  return (
    <div className="flex w-full items-center gap-4" role="status" aria-label="Loading profile">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
