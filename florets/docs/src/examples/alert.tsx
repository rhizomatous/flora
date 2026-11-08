import { Alert, AlertDescription, AlertTitle } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-3">
      <Alert>
        <AlertTitle>Changes saved</AlertTitle>
        <AlertDescription>Your project settings are up to date.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Connection failed</AlertTitle>
        <AlertDescription>Check your credentials and try again.</AlertDescription>
      </Alert>
    </div>
  );
}
