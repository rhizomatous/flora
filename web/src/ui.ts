export const control =
  "mt-2 w-full rounded-md border border-foreground/30 bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";
export const button =
  "rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
export const link = "underline underline-offset-4";

/** Reads a text field from submitted form data. Missing fields and file inputs read as "". */
export function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads every text value submitted under one field name, in document order. */
export const texts = (form: FormData, name: string) =>
  form.getAll(name).filter((value) => typeof value === "string");
