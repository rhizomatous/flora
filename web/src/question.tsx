import { useState } from "react";

import { FieldSet, Button, FieldLabel, Input } from "@flora/florets";

import { request } from "./request";
import { text, texts } from "./ui";

export type Question = {
  id: string;
  questions: {
    question: string;
    header: string;
    multiple: boolean;
    custom?: boolean;
    options: { label: string; description: string }[];
  }[];
};

/** Answers one pending OpenCode question request. Each typed answer replaces selected options. */
export function QuestionForm({
  question: q,
  chatID,
  onError,
  onAnswered,
}: {
  question: Question;
  chatID: string;
  onError: (error: unknown) => void;
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function answer(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const answers = q.questions.map((_, i) => {
      const custom = text(fields, `custom-${i}`).trim();
      return custom === "" ? texts(fields, `option-${i}`) : [custom];
    });
    if (answers.some((a) => a.length === 0)) {
      onError(new Error("Answer each question before continuing."));
      return;
    }
    setBusy(true);
    try {
      await request(
        `chats/${encodeURIComponent(chatID)}/questions/${encodeURIComponent(q.id)}/reply`,
        "POST",
        { answers },
      );
      onAnswered();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void answer(event);
      }}
      className="mt-8 space-y-5 rounded-md border p-4"
    >
      <h2 className="font-semibold">Flora needs your answer</h2>
      {q.questions.map((question, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- Questions have no id, and the list never changes for one request because the form is keyed by the request id.
        <FieldSet key={i} disabled={busy} className="space-y-3">
          <legend className="mb-3 text-sm font-medium">
            {question.header}: {question.question}
          </legend>
          {question.options.map((option) => (
            <label key={option.label} className="flex gap-3 text-sm">
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={`option-${i}`}
                value={option.label}
              />
              <span>
                {option.label}
                <span className="block text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
          {question.custom !== false && (
            <FieldLabel className="font-normal">
              Other answer (replaces selected options)
              <Input name={`custom-${i}`} className="mt-2" maxLength={8192} />
            </FieldLabel>
          )}
        </FieldSet>
      ))}
      <Button type="submit" disabled={busy}>
        {busy ? "Answering…" : "Answer and continue"}
      </Button>
    </form>
  );
}
