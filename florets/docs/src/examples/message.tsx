import {
  Avatar,
  AvatarFallback,
  Bubble,
  BubbleContent,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@flora/florets";

export function Example() {
  return (
    <MessageGroup>
      <Message>
        <MessageAvatar>
          <Avatar>
            <AvatarFallback>FL</AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>Flora</MessageHeader>
          <Bubble variant="secondary">
            <BubbleContent>The project is ready for review.</BubbleContent>
          </Bubble>
          <MessageFooter>Just now</MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  );
}
