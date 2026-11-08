import { useState } from "react";

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@flora/florets";

export function Example() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <Questionnaire
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <QuestionnaireItem name="destination">
        <QuestionnaireTitle>Where should settings live?</QuestionnaireTitle>
        <QuestionnaireDescription>Choose an option for this preview.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="menu">Workspace menu</QuestionnaireChoice>
          <QuestionnaireChoice value="sidebar">Sidebar</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit />
      </QuestionnaireActions>
      <p role="status" className="text-sm">
        {submitted ? "Answer received for this preview." : ""}
      </p>
    </Questionnaire>
  );
}
