import { useState, type ReactNode } from "react";

import { Button } from "@flora/florets";
import {
  Chat,
  ChatProvider,
  ChatViewport,
  ChatContent,
  ChatItem,
  ChatScrollButton,
  Message,
  MessageContent,
  Bubble,
  MessageResponse,
  ChainOfThought,
  Checkpoint,
  Confirmation,
  Context,
  FileTree,
  InlineCitation,
  ModelSelector,
  Plan,
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  Queue,
  Reasoning,
  Sources,
  StackTrace,
  Subagent,
  Suggestion,
  Task,
  Terminal,
  TestResults,
  Tool,
  CodeBlock,
} from "@flora/florets/ai";

function Pattern({ name, children }: { name: string; children: ReactNode }) {
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-border p-5">
      <h3 className="font-medium">{name}</h3>
      {children}
    </article>
  );
}

/** Exercises all AI Elements patterns without model calls or a transport dependency. */
export function AIElementsGuide() {
  const [action, setAction] = useState("No action selected");
  const [model, setModel] = useState("fast");
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Import from <code>@flora/florets/ai</code>. These reusable compositions follow{" "}
        <a className="underline" href="https://ui.shadcn.com/docs/ai-elements">
          shadcn AI Elements
        </a>
        , use Florets tokens, and accept application-owned data and callbacks. Chat uses
        @shadcn/react; MessageResponse uses Streamdown.
      </p>
      <p role="status" className="text-sm">
        {action}
      </p>
      <div className="grid min-w-0 gap-4">
        <Pattern name="Chat">
          <div className="h-64">
            <ChatProvider autoScroll>
              <Chat>
                <ChatViewport>
                  <ChatContent className="gap-4 p-3">
                    {Array.from({ length: 6 }, (_, i) => (
                      <ChatItem key={i} messageId={`demo-${i}`} scrollAnchor={i % 2 === 0}>
                        <Message align={i % 2 === 0 ? "end" : "start"}>
                          <MessageContent>
                            {i % 2 === 0 ? (
                              <Bubble>Check the workspace.</Bubble>
                            ) : (
                              <p>The checks passed.</p>
                            )}
                          </MessageContent>
                        </Message>
                      </ChatItem>
                    ))}
                  </ChatContent>
                </ChatViewport>
                <ChatScrollButton />
              </Chat>
            </ChatProvider>
          </div>
        </Pattern>
        <Pattern name="Message">
          <Message>
            <MessageContent>
              <MessageResponse>
                {
                  "## Ready to review\n\n- Keyboard navigation works.\n- Focus returns to the trigger.\n\n`npm test` passed."
                }
              </MessageResponse>
            </MessageContent>
          </Message>
        </Pattern>
        <Pattern name="Chain of Thought">
          <ChainOfThought title="3 steps completed">
            <Task status="completed">Read the settings page</Task>
            <Task status="completed">Update navigation</Task>
            <Task status="completed">Check keyboard focus</Task>
          </ChainOfThought>
        </Pattern>
        <Pattern name="Checkpoint">
          <Checkpoint
            onClick={() => {
              setAction("Checkpoint selected");
            }}
          >
            Before navigation changes
          </Checkpoint>
        </Pattern>
        <Pattern name="Confirmation">
          <Confirmation
            onApprove={() => {
              setAction("Approved");
            }}
            onReject={() => {
              setAction("Rejected");
            }}
          >
            Run the deployment command?
          </Confirmation>
        </Pattern>
        <Pattern name="Context">
          <Context used={24_000} total={128_000} />
        </Pattern>
        <Pattern name="File Tree">
          <FileTree
            entries={[
              {
                name: "src",
                path: "src",
                children: [{ name: "settings.tsx", path: "src/settings.tsx" }],
              },
            ]}
            onSelect={(path) => {
              setAction(`Selected ${path}`);
            }}
          />
        </Pattern>
        <Pattern name="Inline Citation">
          <p>
            See the{" "}
            <InlineCitation
              href="https://ui.shadcn.com/docs/ai-elements"
              title="shadcn AI Elements"
            >
              component documentation
            </InlineCitation>
            .
          </p>
        </Pattern>
        <Pattern name="Model Selector">
          <ModelSelector
            models={[
              { id: "fast", name: "Fast model" },
              { id: "thorough", name: "Thorough model" },
            ]}
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
        </Pattern>
        <Pattern name="Plan">
          <Plan title="Improve settings navigation" defaultOpen>
            <Task status="completed">Inspect the sidebar</Task>
            <Task status="running">Move settings into the menu</Task>
            <Task>Verify keyboard controls</Task>
          </Plan>
        </Pattern>
        <Pattern name="Prompt Input">
          <PromptInput
            onSubmit={(event) => {
              event.preventDefault();
              setAction("Prompt submitted locally");
            }}
          >
            <PromptInputTextarea
              aria-label="Example prompt"
              placeholder="What are we building?"
              required
            />
            <PromptInputActions>
              <span className="text-xs text-muted-foreground">Local example</span>
              <Button type="submit" size="sm">
                Send
              </Button>
            </PromptInputActions>
          </PromptInput>
        </Pattern>
        <Pattern name="Queue">
          <Queue title="2 queued tasks" defaultOpen>
            <Task>Update the sidebar</Task>
            <Task>Add a keyboard shortcut</Task>
          </Queue>
        </Pattern>
        <Pattern name="Reasoning">
          <Reasoning>
            I will inspect the existing focus behavior before moving the settings link.
          </Reasoning>
        </Pattern>
        <Pattern name="Sources">
          <Sources
            sources={[
              { title: "shadcn AI Elements", href: "https://ui.shadcn.com/docs/ai-elements" },
            ]}
          />
        </Pattern>
        <Pattern name="Stack Trace">
          <StackTrace
            error="Unable to load settings"
            stack={"Error: response timed out\n  at loadSettings (settings.ts:24)"}
          />
        </Pattern>
        <Pattern name="Subagent">
          <Subagent title="Review accessibility" description="Completed">
            <Task status="completed">Verified labels and keyboard focus</Task>
          </Subagent>
        </Pattern>
        <Pattern name="Suggestion">
          <Suggestion
            onClick={() => {
              setAction("Suggested: review the changes");
            }}
          >
            Review the changes
          </Suggestion>
        </Pattern>
        <Pattern name="Task">
          <Task status="running">Checking keyboard navigation</Task>
          <Task status="error">Browser check failed</Task>
        </Pattern>
        <Pattern name="Terminal">
          <Terminal command="npm test" output={"11 tests passed\n0 failed"} />
        </Pattern>
        <Pattern name="Test Results">
          <TestResults
            results={[
              {
                name: "Keyboard navigation",
                status: "passed",
                output: "Focus returns to the trigger.",
              },
              {
                name: "Narrow viewport",
                status: "failed",
                output: "Expected no horizontal overflow.",
              },
            ]}
          />
        </Pattern>
        <Pattern name="Tool">
          <Tool title="Read settings.tsx" description="Completed">
            <CodeBlock title="Input">{'{"path":"src/settings.tsx"}'}</CodeBlock>
            <CodeBlock title="Output">{"export function Settings() {}"}</CodeBlock>
          </Tool>
        </Pattern>
      </div>
    </div>
  );
}
