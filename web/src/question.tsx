import { useRef, useState } from "react";

import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireInput,
  QuestionnaireError,
  QuestionnaireActions,
  QuestionnairePrevious,
  QuestionnaireNext,
  QuestionnaireSubmit,
  QuestionnaireProgress,
} from "@flora/florets";

import { request } from "./request";

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
  const submitting = useRef(false);
  const [answers, setAnswers] = useState<string[][]>(() => q.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => q.questions.map(() => ""));
  const items = q.questions.map((question, index) => ({
    name: `question-${index}`,
    required: true,
    choices: question.options.map((option) => ({ value: option.label })),
  }));

  function choose(index: number, value: string, checked: boolean) {
    setCustom((rows) => rows.map((text, i) => (i === index ? "" : text)));
    setAnswers((rows) =>
      rows.map((values, i) => {
        if (i !== index) return values;
        if (!checked) return values.filter((item) => item !== value);
        return q.questions[index]?.multiple === true
          ? [...values.filter((item) => item !== value), value]
          : [value];
      }),
    );
  }

  function write(index: number, value: string) {
    setCustom((rows) => rows.map((text, i) => (i === index ? value : text)));
    setAnswers((rows) => rows.map((values, i) => (i === index ? [] : values)));
  }

  async function answer(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const submitted = q.questions.map((_, index) => {
      const value = custom[index]?.trim() ?? "";
      return value === "" ? (answers[index] ?? []) : [value];
    });
    if (submitted.some((values) => values.length === 0)) return;
    submitting.current = true;
    setBusy(true);
    try {
      await request(
        `chats/${encodeURIComponent(chatID)}/questions/${encodeURIComponent(q.id)}/reply`,
        "POST",
        { answers: submitted },
      );
      onAnswered();
    } catch (error) {
      onError(error);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Questionnaire
      items={items}
      aria-label="Questions"
      onSubmit={(event) => {
        void answer(event);
      }}
      className="rounded-xl border p-4"
    >
      {q.questions.length > 1 && <QuestionnaireProgress />}
      {q.questions.map((question, index) => (
        <QuestionnaireItem
          key={items[index]?.name}
          name={`question-${index}`}
          multiple={question.multiple}
          required
          disabled={busy}
        >
          <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
          <QuestionnaireChoices>
            {question.options.map((option) => (
              <QuestionnaireChoice
                key={option.label}
                value={option.label}
                checked={answers[index]?.includes(option.label) ?? false}
                onChange={(event) => {
                  choose(index, option.label, event.target.checked);
                }}
              >
                <span className="font-medium">{option.label}</span>
                {option.description !== "" && (
                  <QuestionnaireChoiceDescription>
                    {option.description}
                  </QuestionnaireChoiceDescription>
                )}
              </QuestionnaireChoice>
            ))}
            {question.custom !== false && (
              <QuestionnaireInput
                aria-label={question.options.length === 0 ? "Answer" : "Other answer"}
                placeholder={question.options.length === 0 ? "Answer…" : "Other answer…"}
                maxLength={8192}
                value={custom[index] ?? ""}
                onChange={(event) => {
                  write(index, event.target.value);
                }}
              />
            )}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious disabled={busy} />
        <QuestionnaireNext disabled={busy} />
        <QuestionnaireSubmit disabled={busy}>
          {busy ? "Answering…" : "Answer and continue"}
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
