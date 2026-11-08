import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@flora/florets";

export function Example() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Project status</CardTitle>
        <CardDescription>Latest workspace activity</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">All checks passed. No changes are waiting.</p>
      </CardContent>
      <CardFooter>
        <Badge variant="secondary">Ready for review</Badge>
      </CardFooter>
    </Card>
  );
}
