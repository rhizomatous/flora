import { expect, test } from "vitest";

import { defaultSidebarPreferences, parseSidebarPreferences } from "./sidebar-preferences";

test("missing, malformed and obsolete preferences use safe field defaults", () => {
  for (const raw of [null, "broken", "null", "[]"]) {
    expect(parseSidebarPreferences(raw)).toEqual(defaultSidebarPreferences);
  }
  expect(
    parseSidebarPreferences(
      JSON.stringify({
        sort: "title",
        status: "deleted",
        details: false,
        collapsed: ["folder:release"],
        grouping: "old",
        unread: "yes",
      }),
    ),
  ).toEqual({
    ...defaultSidebarPreferences,
    details: false,
    collapsed: ["folder:release"],
  });
});
