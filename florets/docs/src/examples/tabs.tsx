import { Tabs, TabsContent, TabsList, TabsTrigger } from "@flora/florets";

export function Example() {
  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="rounded-xl border p-4 text-sm">
        Your project is ready for new tasks.
      </TabsContent>
      <TabsContent value="activity" className="rounded-xl border p-4 text-sm">
        Last task completed five minutes ago.
      </TabsContent>
    </Tabs>
  );
}
