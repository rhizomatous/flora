import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Alert, Button, Section, SettingsGroup, SettingsRow, Text } from "@flora/florets";

import type { OnboardingState } from "./onboarding-state";
import { readinessResponseSchema, type Readiness } from "./readiness-state";
import { errorMessage, isExpired, request } from "./request";

export function SetupReadiness({
  onFinished,
  onExpired,
  onBusyChange,
}: {
  onFinished: (state: OnboardingState) => void;
  onExpired: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [result, setResult] = useState<Readiness>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const handoff = useRef<AbortController | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const reportBusy = useEffectEvent(onBusyChange);
  const expired = useEffectEvent(onExpired);
  useEffect(() => {
    const controller = new AbortController();
    reportBusy(true);
    async function check() {
      try {
        const response = await request(readinessResponseSchema, "onboarding/readiness", {
          method: "POST",
          body: {},
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setResult(response.readiness);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setResult(undefined);
        setError(errorMessage(cause, "Could not check setup. Retry checks."));
        if (isExpired(cause)) expired();
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false);
          reportBusy(false);
        }
      }
    }
    void check();
    return () => {
      controller.abort();
      handoff.current?.abort();
      reportBusy(false);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each retry requests fresh diagnostics.
  }, [attempt]);

  async function finish() {
    const controller = new AbortController();
    handoff.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const response = await request(readinessResponseSchema, "onboarding/readiness", {
        method: "POST",
        body: { finish: true },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult(response.readiness);
      if (response.readiness.ready && response.onboarding.completed) {
        onFinished(response.onboarding);
        window.location.hash = `chats/new?project=${encodeURIComponent(response.readiness.projectID)}`;
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setResult(undefined);
      setError(errorMessage(cause, "Could not open the composer. Retry checks."));
      if (isExpired(cause)) onExpired();
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  let status = "Setup needs attention";
  if (result?.ready === true) status = "Setup checks passed";
  if (busy) status = "Checking setup…";
  return (
    <Section aria-label="Setup readiness" aria-busy={busy}>
      <div role="status" aria-live="polite">
        {status}
      </div>
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      {result && (
        <SettingsGroup>
          {result.checks.map((check) => {
            let checkStatus = check.ok ? "Passed" : "Needs attention";
            if (busy) checkStatus = "Checking…";
            return (
              <SettingsRow
                key={check.id}
                label={check.name}
                htmlFor={`readiness-${check.id}`}
                description={
                  check.ok ? (
                    ["model", "project"].includes(check.id) ? (
                      check.message
                    ) : undefined
                  ) : (
                    <>
                      {check.message}{" "}
                      <a className="underline" href={`#${check.fixPath}`}>
                        {check.fixLabel}
                      </a>
                    </>
                  )
                }
              >
                <output id={`readiness-${check.id}`} className="text-sm">
                  {checkStatus}
                </output>
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      )}
      {result?.ready === true && !busy && (
        <Text tone="muted">Describe a task in your first chat</Text>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          Retry checks
        </Button>
        <Button
          disabled={busy || result?.ready !== true}
          onClick={() => {
            void finish();
          }}
        >
          Open Flora
        </Button>
      </div>
    </Section>
  );
}
