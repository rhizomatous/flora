import { useEffect, useEffectEvent } from "react";

import { useMessageScroller } from "@flora/florets";

/** Opens a saved run at its first message after the transcript has mounted. */
export function AutomationRunJump({ messageID }: { messageID: string }) {
  const { scrollToMessage } = useMessageScroller();
  const jump = useEffectEvent(() => {
    if (messageID) {
      scrollToMessage(messageID, { align: "start", behavior: "instant", scrollMargin: 28 });
    }
  });
  useEffect(() => {
    if (!messageID) return;
    const frame = requestAnimationFrame(() => {
      jump();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [messageID]);
  return null;
}
