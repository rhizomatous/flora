import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@flora/florets";

export function Example() {
  return (
    <Table>
      <TableCaption>Recent tasks</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Update styles</TableCell>
          <TableCell>Completed</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Add examples</TableCell>
          <TableCell>In review</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
