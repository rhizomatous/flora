import {
  Button,
  Field,
  FieldLabel,
  Input,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@flora/florets";

export function Example() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open settings sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Project settings</SheetTitle>
          <SheetDescription>Preview a panel alongside the current page.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <Field>
            <FieldLabel htmlFor="example-sheet-name">Name</FieldLabel>
            <Input id="example-sheet-name" defaultValue="Flora" />
          </Field>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button>Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
