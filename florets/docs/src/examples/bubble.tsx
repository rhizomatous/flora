import { Bubble, BubbleContent } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-3">
      <Bubble align="end">
        <BubbleContent>Can you check this project?</BubbleContent>
      </Bubble>
      <Bubble variant="secondary">
        <BubbleContent>The checks passed. It is ready for review.</BubbleContent>
      </Bubble>
    </div>
  );
}
