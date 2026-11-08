import { useState } from "react";

import { Calendar } from "@flora/florets";

export function Example() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 10, 7));
  return (
    <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-xl border" />
  );
}
