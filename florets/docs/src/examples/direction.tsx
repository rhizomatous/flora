import { DirectionProvider, Tabs, TabsContent, TabsList, TabsTrigger } from "@flora/florets";

export function Example() {
  return (
    <DirectionProvider dir="rtl">
      <div dir="rtl" className="w-full">
        <Tabs defaultValue="first">
          <TabsList>
            <TabsTrigger value="first">الأول</TabsTrigger>
            <TabsTrigger value="second">الثاني</TabsTrigger>
          </TabsList>
          <TabsContent value="first">المحتوى الأول</TabsContent>
          <TabsContent value="second">المحتوى الثاني</TabsContent>
        </Tabs>
        <p className="mt-3 text-sm text-muted-foreground" dir="ltr">
          Right-to-left tabs. Try the arrow keys.
        </p>
      </div>
    </DirectionProvider>
  );
}
