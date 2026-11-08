import { Avatar, AvatarFallback } from "@flora/florets";

export function Example() {
  return (
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarFallback>FL</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>VS</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AI</AvatarFallback>
      </Avatar>
    </div>
  );
}
