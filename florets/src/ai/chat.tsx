import { MessageScroller as Primitive } from "@shadcn/react/message-scroller";
import type { ComponentProps } from "react";

import { Button } from "../components/button";
import { cn } from "../lib/utils";

// Uses the headless implementation recommended by shadcn's Chat pattern.
export const ChatProvider = Primitive.Provider;
export const ChatItem = Primitive.Item;
export function Chat({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="chat"
      className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}
export function ChatViewport({ className, ...props }: ComponentProps<typeof Primitive.Viewport>) {
  return (
    <Primitive.Viewport
      data-slot="chat-viewport"
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}
export function ChatContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      data-slot="chat-content"
      className={cn("flex min-h-full flex-col", className)}
      {...props}
    />
  );
}
export function ChatScrollButton({
  className,
  children = "Jump to latest",
  ...props
}: ComponentProps<typeof Primitive.Button>) {
  return (
    <Primitive.Button
      className={cn(
        "absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md data-[active=false]:hidden",
        className,
      )}
      render={<Button variant="outline" size="sm" />}
      {...props}
    >
      {children}
    </Primitive.Button>
  );
}
