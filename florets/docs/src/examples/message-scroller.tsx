import {
  Bubble,
  BubbleContent,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@flora/florets";

export function Example() {
  return (
    <div className="h-56 w-full rounded-xl border">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              {Array.from({ length: 12 }, (_, index) => index + 1).map((number) => (
                <MessageScrollerItem key={number}>
                  <Bubble variant="secondary">
                    <BubbleContent>Message {number}: workspace update</BubbleContent>
                  </Bubble>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}
