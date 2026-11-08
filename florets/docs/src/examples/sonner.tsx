import { toast } from "sonner";

import { Button, Toaster } from "@flora/florets";

export function Example({ dark = false }: { dark?: boolean }) {
  return (
    <>
      <Toaster theme={dark ? "dark" : "light"} />
      <Button
        variant="outline"
        onClick={() => {
          toast.success("Settings saved", { description: "This notification is a local preview." });
        }}
      >
        Show toast
      </Button>
    </>
  );
}
