/** Reads a text field from submitted form data. Missing fields and file inputs read as "". */
export function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads every text value submitted under one field name, in document order. */
export const texts = (form: FormData, name: string) =>
  form.getAll(name).filter((value) => typeof value === "string");
