import type { Message, Part } from "@opencode-ai/sdk/v2";

import type { Pull } from "../../web/src/pull.ts";
import type { Frame } from "./server.ts";

export const projects = [
  {
    id: "preview",
    name: "Flora",
    configuration: {
      repositories: [
        {
          name: "flora",
          url: "https://github.com/example/flora",
          baseBranch: "main",
          role: "core",
        },
      ],
      setupCommand: "npm ci",
    },
  },
  {
    id: "garden",
    name: "Garden storefront",
    configuration: {
      repositories: [
        {
          name: "storefront",
          url: "https://github.com/example/storefront",
          baseBranch: "main",
          role: "core",
        },
        {
          name: "catalog",
          url: "https://github.com/example/catalog",
          baseBranch: "develop",
          role: "extra",
        },
      ],
      setupCommand: "npm ci\nnpm run generate",
    },
  },
  {
    id: "fieldnotes",
    name: "Fieldnotes API",
    configuration: {
      repositories: [
        {
          name: "fieldnotes",
          url: "https://github.com/example/fieldnotes",
          baseBranch: "develop",
          role: "core",
        },
      ],
      setupCommand: "go mod download",
    },
  },
];

type Step = { text: string } | { tool: string; input: Record<string, unknown>; output: string };
type Turn = { user: string; steps: Step[] };

// Authored conversations use SDK message shapes; each tool has a running and completed frame.
function conversation(id: string, turns: Turn[]): Frame[] {
  const frames: Frame[] = [];
  const history: Frame["history"] = [];
  const sessionID = `session-${id}`;
  let tick = Date.parse("2026-01-01T12:00:00Z");
  const snapshot = () => frames.push(structuredClone({ history, questions: [] }));
  for (const turn of turns) {
    const parentID = `${id}-${history.length}`;
    const user: Message = {
      id: parentID,
      sessionID,
      role: "user",
      time: { created: tick },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    };
    history.push({
      info: user,
      parts: [
        { id: `${parentID}-text`, messageID: parentID, sessionID, type: "text", text: turn.user },
      ],
    });
    snapshot();
    for (const step of turn.steps) {
      tick += 4000;
      const messageID = `${id}-${history.length}`;
      const info: Message = {
        id: messageID,
        sessionID,
        parentID,
        role: "assistant",
        time: { created: tick },
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        mode: "build",
        agent: "build",
        path: { cwd: "/workspace", root: "/workspace" },
        cost: 0,
        tokens: { input: 400, output: 120, reasoning: 0, cache: { read: 0, write: 0 } },
      };
      const common = { id: `${messageID}-part`, messageID, sessionID };
      const part: Part =
        "text" in step
          ? { ...common, type: "text", text: step.text }
          : {
              ...common,
              type: "tool",
              callID: `${messageID}-call`,
              tool: step.tool,
              state: { status: "running", input: step.input, time: { start: tick } },
            };
      history.push({ info, parts: [part] });
      snapshot();
      tick += 3000;
      info.time.completed = tick;
      if (part.type === "tool" && "tool" in step) {
        part.state = {
          status: "completed",
          input: step.input,
          output: step.output,
          title: typeof step.input.description === "string" ? step.input.description : step.tool,
          metadata: {},
          time: { start: tick - 3000, end: tick },
        };
      }
      snapshot();
    }
  }
  return frames;
}

function edit(filePath: string, oldString: string, newString: string): Step {
  return {
    tool: "edit",
    input: { filePath, oldString, newString },
    output: "Edit applied successfully.",
  };
}
function check(command: string, output: string): Step {
  return { tool: "bash", input: { command, description: command }, output };
}

export const stories = [
  {
    id: "checkout",
    projectID: "garden",
    title: "Keep the cart after signing in",
    pulls: [
      {
        repository: "example/storefront",
        url: "https://github.com/example/storefront/pull/42",
        number: 42,
        title: "Keep the cart after signing in",
        additions: 86,
        deletions: 24,
        state: "open",
        draft: true,
      },
    ] satisfies Pull[],
    files: [
      {
        path: "src/cart.ts",
        before: "return accountCart;",
        after: "return mergeCart(guestCart, accountCart);",
      },
      {
        path: "src/cart-notice.tsx",
        before: "return null;",
        after: 'return <p role="status">{notice}</p>;',
      },
      {
        path: "src/cart.test.ts",
        before: "// Cart tests",
        after: "test('combines guest and account quantities', testMerge);",
      },
    ],
    turns: [
      {
        user: "Customers lose their cart when they sign in. Can you fix that and add coverage?",
        steps: [
          {
            text: "I'll trace how the guest cart moves into the account, then check quantities and unavailable items.",
          },
          check(
            "rg -n 'accountCart|guestCart' src",
            "src/cart.ts:18: return accountCart;\nsrc/login.ts:42: loadCart(account.id);",
          ),
          {
            text: "Signing in replaces the guest cart with the saved account cart. I'll merge items by product ID and keep the account's shipping preferences.",
          },
          edit("src/cart.ts", "return accountCart;", "return mergeCart(guestCart, accountCart);"),
          edit(
            "src/cart.test.ts",
            "// Cart tests",
            "test('combines guest and account quantities', testMerge);",
          ),
          check("npm test -- cart", "8 tests passed"),
          {
            text: "The cart now survives sign-in. Matching products combine quantities, and account shipping preferences stay intact. All eight cart tests pass.",
          },
        ],
      },
      {
        user: "What if combining the carts goes over the stock limit? Keep the item but show the customer what happened.",
        steps: [
          {
            text: "Good catch. I'll cap the merged quantity at available stock and return a notice for each adjusted item.",
          },
          edit(
            "src/cart.ts",
            "quantity: guest.quantity + saved.quantity",
            "quantity: Math.min(stock, guest.quantity + saved.quantity)",
          ),
          edit("src/cart-notice.tsx", "return null;", 'return <p role="status">{notice}</p>;'),
          check(
            "npm test -- cart",
            "12 tests passed, including out-of-stock and quantity limit cases",
          ),
          {
            text: "If the guest cart has 3 pots and the account has 4, but only 5 are available, the merged cart keeps 5 and explains the adjustment. Unavailable products stay visible with quantity zero.",
          },
        ],
      },
      {
        user: "Looks good. Open a draft PR, please.",
        steps: [
          check(
            "git diff --check && npm run typecheck",
            "No whitespace errors. Type check passed.",
          ),
          check(
            "gh pr create --draft --title 'Preserve guest cart on sign-in'",
            "https://github.com/example/storefront/pull/42",
          ),
          {
            text: "Opened [draft PR #42](https://github.com/example/storefront/pull/42). It includes the merge, stock notices, and regression coverage. The checkout flow is ready for review.",
          },
        ],
      },
    ],
  },
  {
    id: "pagination",
    projectID: "fieldnotes",
    title: "Fix duplicate notes between pages",
    pulls: [
      {
        repository: "example/fieldnotes",
        url: "https://github.com/example/fieldnotes/pull/18",
        number: 18,
        title: "Stabilize notes pagination",
        additions: 35,
        deletions: 36,
        state: "closed",
        draft: false,
      },
      {
        repository: "example/fieldnotes",
        url: "https://github.com/example/fieldnotes/pull/19",
        number: 19,
        title: "Stabilize notes pagination",
        additions: 35,
        deletions: 36,
        state: "open",
        draft: false,
      },
    ] satisfies Pull[],
    files: [
      {
        path: "internal/notes/list.go",
        before: "ORDER BY created_at DESC",
        after: "ORDER BY created_at DESC, id DESC",
      },
      {
        path: "internal/notes/cursor.go",
        before: "return encode(createdAt)",
        after: "return encode(createdAt, id)",
      },
    ],
    turns: [
      {
        user: "The notes feed sometimes repeats a note on the next page. Investigate and fix it.",
        steps: [
          check("go test ./internal/notes/...", "ok fieldnotes/internal/notes"),
          {
            text: "The query sorts only by timestamp. Notes created at the same time can switch order between requests. I'll add the note ID as a tie-breaker and include it in the cursor.",
          },
          edit(
            "internal/notes/list.go",
            "ORDER BY created_at DESC",
            "ORDER BY created_at DESC, id DESC",
          ),
          edit(
            "internal/notes/cursor.go",
            "return encode(createdAt)",
            "return encode(createdAt, id)",
          ),
          check("go test ./internal/notes/... -count=20", "ok fieldnotes/internal/notes (20 runs)"),
          {
            text: "Pagination now uses a stable timestamp and ID ordering. A regression test pages through 50 notes sharing one timestamp and checks every ID appears exactly once.",
          },
        ],
      },
      {
        user: "Existing clients may still have the old cursors. Can we accept those too?",
        steps: [
          edit(
            "internal/notes/cursor.go",
            "return decodePair(cursor)",
            "return decodeCompatible(cursor)",
          ),
          check(
            "go test ./...",
            "All packages passed, including legacy cursor and malformed cursor cases",
          ),
          {
            text: "Old timestamp-only cursors still work. New responses use the timestamp-and-ID format. Malformed cursors return the existing 400 response.",
          },
        ],
      },
      {
        user: "Please open the PR.",
        steps: [
          check(
            "gh pr create --title 'Stabilize notes pagination'",
            "https://github.com/example/fieldnotes/pull/18",
          ),
          {
            text: "Opened [PR #18](https://github.com/example/fieldnotes/pull/18), including compatibility coverage for existing cursors.",
          },
        ],
      },
      {
        user: "The release branch is ready. Close this PR and open a replacement against release.",
        steps: [
          check("gh pr close 18", "Closed pull request #18 (Stabilize notes pagination)"),
          check(
            "gh pr create --base release --title 'Stabilize notes pagination'",
            "https://github.com/example/fieldnotes/pull/19",
          ),
          {
            text: "Closed [PR #18](https://github.com/example/fieldnotes/pull/18) without merging and opened [PR #19](https://github.com/example/fieldnotes/pull/19) against release with the same pagination fix and cursor compatibility coverage.",
          },
        ],
      },
    ],
  },
  {
    id: "focus",
    projectID: "preview",
    title: "Restore focus after removing a repository",
    pulls: [
      {
        repository: "example/flora",
        url: "https://github.com/example/flora/pull/73",
        number: 73,
        title: "Restore repository form focus",
        additions: 12,
        deletions: 0,
        state: "merged",
        draft: false,
      },
    ] satisfies Pull[],
    files: [
      {
        path: "web/src/projects.tsx",
        before: "removeRow(key);",
        after: "removeRow(key);\naddButton.current?.focus();",
      },
    ],
    turns: [
      {
        user: "Removing a repository row loses keyboard focus. Move it to Add repository.",
        steps: [
          edit(
            "web/src/projects.tsx",
            "removeRow(key);",
            "removeRow(key);\naddButton.current?.focus();",
          ),
          check("npm run test:browser", "Repository keyboard navigation passed"),
          {
            text: "Focus returns to Add repository after a row is removed. Keyboard users can add another row or continue to the setup command.",
          },
        ],
      },
      {
        user: "Please also check the last row and then open a PR.",
        steps: [
          check(
            "npm run test:browser -- projects",
            "First, middle, and last row removal passed. Single remaining row cannot be removed.",
          ),
          check(
            "gh pr create --title 'Restore repository form focus'",
            "https://github.com/example/flora/pull/73",
          ),
          {
            text: "Opened [PR #73](https://github.com/example/flora/pull/73). Removing the last removable row also returns focus correctly.",
          },
        ],
      },
      { user: "Merged, thanks!", steps: [{ text: "You're welcome! The focus fix is on main." }] },
    ],
  },
].map(({ turns, ...story }) => ({ ...story, frames: conversation(story.id, turns) }));
