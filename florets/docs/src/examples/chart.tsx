import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@flora/florets";

export function Example() {
  return (
    <ChartContainer
      config={{ completed: { label: "Completed", color: "var(--chart-1)" } }}
      className="h-52 w-full"
    >
      <BarChart
        accessibilityLayer
        data={[
          { day: "Mon", completed: 4 },
          { day: "Tue", completed: 7 },
          { day: "Wed", completed: 5 },
        ]}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="completed" fill="var(--color-completed)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
