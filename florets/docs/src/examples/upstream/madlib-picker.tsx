import { useState } from "react";

import {
  Card,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MadlibPicker,
  MadlibSelect,
} from "@flora/florets";

import { Example, ExampleWrapper } from "../example";

export function Preview() {
  const [days, setDays] = useState(["Monday"]);
  return (
    <ExampleWrapper>
      <Example title="Choices in a sentence">
        <Card className="w-full flex-row flex-wrap items-center gap-2 p-4">
          <MadlibSelect aria-label="Frequency" defaultValue="weekly">
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
          </MadlibSelect>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <MadlibPicker prefix="on" aria-label="Days">
                  {days.length > 0 ? days.join(", ") : "Choose days"}
                </MadlibPicker>
              }
            />
            <DropdownMenuContent className="min-w-40">
              {["Monday", "Wednesday", "Friday"].map((day) => (
                <DropdownMenuCheckboxItem
                  key={day}
                  checked={days.includes(day)}
                  closeOnClick={false}
                  onCheckedChange={(checked) => {
                    setDays((current) =>
                      checked ? [...current, day] : current.filter((value) => value !== day),
                    );
                  }}
                >
                  {day}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <MadlibPicker prefix="in" disabled>
            UTC
          </MadlibPicker>
        </Card>
      </Example>
    </ExampleWrapper>
  );
}
