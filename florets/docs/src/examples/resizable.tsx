import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@flora/florets";

export function Example() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-40 rounded-xl border">
      <ResizablePanel defaultSize="50%" minSize="20%">
        <div className="flex h-40 items-center justify-center text-sm">Sidebar</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50%" minSize="20%">
        <div className="flex h-40 items-center justify-center text-sm">Drag the divider</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
