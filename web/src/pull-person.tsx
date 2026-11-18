import { Avatar, AvatarFallback, AvatarImage } from "@flora/florets";

export function PullPerson({ name, avatar }: { name: string; avatar?: string | undefined }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar size="xs" shape="squircle">
        <AvatarImage src={avatar} alt="" />
        <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}
