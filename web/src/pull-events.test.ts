import { expect, test } from "vitest";

import { pullEvents } from "./pull-events";
import type { Pull } from "./pull-schemas";

const pull: Pull = {
  url: "https://github.com/example/core/pull/7",
  number: 7,
  state: "open",
  draft: false,
};
const message = (ID: string, Role: string, Text: string) => ({
  ID,
  Role,
  Text,
  Payload: { parts: [] },
});
test("each PR gets one event card for its creation announcement", () => {
  const events = pullEvents(
    [
      message("user", "user", `Please inspect ${pull.url}`),
      message("opened", "assistant", `Opened [PR #7](${pull.url}).`),
      message("updated", "assistant", `Updated ${pull.url}/files.`),
      message("closed", "assistant", `Closed ${pull.url}.`),
    ],
    [pull],
  );
  expect([...events.keys()]).toEqual(["opened"]);
  expect(events.get("opened")).toEqual([{ pull, opened: true }]);
});
test("ordinary mentions are not labeled as PR creation or matched by number prefix", () => {
  const events = pullEvents(
    [
      message("other", "assistant", `${pull.url}0`),
      message("mention", "assistant", `See ${pull.url}.`),
    ],
    [pull],
  );
  expect(events.size).toBe(0);
});
