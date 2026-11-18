import { SparklesIcon } from "@flora/florets";

import anthropic from "./assets/model-icons/anthropic.svg";
import claude from "./assets/model-icons/claude.svg";
import gemini from "./assets/model-icons/gemini.svg";
import google from "./assets/model-icons/google.svg";
import openai from "./assets/model-icons/openai.svg";

// Brand marks are bundled from @lobehub/icons-static-svg 1.103.0 under the
// adjacent MIT license. Masks inherit the control's color in both themes.
export function ModelIcon({
  provider,
  model,
}: {
  provider: string | undefined;
  model: string | undefined;
}) {
  let icon: string;
  if (provider === "anthropic") {
    icon = model?.startsWith("claude-") === true ? claude : anthropic;
  } else if (provider === "google") {
    icon = model?.startsWith("gemini-") === true ? gemini : google;
  } else if (provider === "openai") {
    icon = openai;
  } else {
    return <SparklesIcon aria-hidden="true" className="size-4 shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 bg-current"
      style={{
        maskImage: `url("${icon}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
      }}
    />
  );
}
