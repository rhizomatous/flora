import { Streamdown, type StreamdownProps } from "streamdown";

/** Streaming Markdown with inert raw HTML and the renderer's default URL filtering. */
export function MessageResponse(props: StreamdownProps) {
  return <Streamdown skipHtml linkSafety={{ enabled: false }} {...props} />;
}
