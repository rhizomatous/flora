import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@flora/florets";

export function Example() {
  return (
    <Select defaultValue="review">
      <SelectTrigger aria-label="Task status" className="w-full">
        <SelectValue placeholder="Choose a status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="working">Working</SelectItem>
        <SelectItem value="review">Ready for review</SelectItem>
        <SelectItem value="done">Completed</SelectItem>
      </SelectContent>
    </Select>
  );
}
