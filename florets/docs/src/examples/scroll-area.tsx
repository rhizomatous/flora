import { ScrollArea } from "@flora/florets";

export function Example() {
  return (
    <ScrollArea className="h-48 w-full rounded-xl border">
      <div className="p-4">
        {Array.from({ length: 15 }, (_, index) => index + 1).map((number) => (
          <div key={number} className="border-b py-3 text-sm last:border-0">
            Project {number}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
