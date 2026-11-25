/* oxlint-disable import/max-dependencies -- Setup composes the existing account, model, connection, and project editors. */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  ChevronLeftIcon,
  ChevronRightIcon,
  Button,
  Heading,
  LoadingStatus,
  SettingsGroup,
  SettingsRow,
  Text,
  Toaster,
} from "@flora/florets";

import { AccountSettings } from "./account-settings";
import { ConnectionsPage } from "./connections";
import { FirstRunLayout } from "./first-run-layout";
import { ModelsPage } from "./models-page";
import { setupStep, setupSteps, type OnboardingState, type SetupStep } from "./onboarding-state";
import { projectSchema, type Project } from "./project-schemas";
import { Projects } from "./projects";
import { errorMessage, request } from "./request";
import type { Settings } from "./settings-schemas";

const labels = {
  account: "Secure Flora",
  model: "Connect a model",
  github: "Connect GitHub",
  project: "Connect a project",
  finish: "Review setup",
};

export function Onboarding({
  actionError,
  path,
  state,
  settings,
  onSaved,
  onState,
  onExpired,
  onLogout,
  busy,
  run,
}: {
  actionError: string;
  path: string;
  state: OnboardingState;
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onState: (state: OnboardingState) => Promise<void>;
  onExpired: () => void;
  onLogout: () => void;
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const step = setupStep(path, state.step);
  const index = setupSteps.indexOf(step);
  const heading = useRef<HTMLHeadingElement>(null);
  // Keep visited editors mounted to retain non-secret drafts during back navigation.
  const [visited, setVisited] = useState<SetupStep[]>([step]);
  if (!visited.includes(step)) setVisited([...visited, step]);
  const [projects, setProjects] = useState<Project[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [projectBusy, setProjectBusy] = useState(false);
  const navigating = busy || projectBusy;
  const persistRoute = useEffectEvent(() => {
    if (state.step !== step || state.paused || !state.started) {
      void run(() => onState({ ...state, step, paused: false }), "Could not save setup progress.");
    }
  });
  useEffect(() => {
    persistRoute();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refocus and persist when the route changes.
  }, [step]);
  useEffect(() => {
    heading.current?.focus();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refocus and persist when the route changes.
  }, [step]);
  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const list = await request(projectSchema.array(), "projects");
        if (active) {
          setProjects(list);
          setError("");
        }
      } catch (cause) {
        if (active) setError(errorMessage(cause, "Could not load projects."));
      }
    }
    void loadProjects();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry explicitly reloads the saved project list.
  }, [revision]);
  const selected = projects?.find((project) => project.id === state.projectID) ?? projects?.[0];
  const selectedID = projects === undefined ? state.projectID : (selected?.id ?? "");
  async function navigate(next: SetupStep) {
    await onState({ ...state, step: next, paused: false, projectID: selectedID });
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
    // oxlint-disable-next-line react/immutability -- Hash navigation changes the browser route.
    window.location.hash = `onboarding/${next}`;
  }
  function go(next: SetupStep) {
    void run(() => navigate(next), "Could not save setup progress.");
  }
  const modelComplete = settings.providerConfigured && settings.model !== "";
  const projectComplete = selected !== undefined;
  const canContinue =
    step === "account" ||
    step === "finish" ||
    (step === "model" && modelComplete) ||
    (step === "github" && settings.githubConfigured) ||
    (step === "project" && projectComplete);
  function leave() {
    void run(async () => {
      await onState({ ...state, step, paused: true, projectID: selectedID });
      window.location.hash = selectedID
        ? `chats/new?project=${encodeURIComponent(selectedID)}`
        : "chats/new";
    }, "Could not leave setup. Try again.");
  }
  return (
    <FirstRunLayout
      actions={
        <>
          <Button variant="ghost" disabled={navigating} onClick={leave}>
            Leave setup
          </Button>
          <Button variant="ghost" disabled={navigating} onClick={onLogout}>
            Log out
          </Button>
        </>
      }
      progress={
        <nav aria-label="Setup progress" className="mt-5 flex justify-center">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-panel/80 p-1">
            {setupSteps.map((item, position) => (
              <Button
                key={item}
                aria-label={`${position + 1}. ${labels[item]}`}
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                aria-current={step === item ? "step" : undefined}
                disabled={navigating}
                onClick={() => {
                  go(item);
                }}
              >
                <span
                  className={`size-1.5 rounded-full ${step === item ? "bg-foreground" : "bg-muted-foreground/40"}`}
                />
              </Button>
            ))}
          </div>
        </nav>
      }
    >
      <Toaster id="chat-organization" position="bottom-right" closeButton />
      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-6">
          {actionError}
        </Alert>
      )}
      <Heading ref={heading} tabIndex={-1} level={1} className="mb-6">
        {labels[step]}
      </Heading>
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          {error}
          <Button
            variant="link"
            onClick={() => {
              setRevision((value) => value + 1);
            }}
          >
            Retry projects
          </Button>
        </Alert>
      )}
      {visited.includes("account") && (
        <div hidden={step !== "account"}>
          <AccountSettings compact busy={busy} run={run} />
        </div>
      )}
      {visited.includes("model") && (
        <div hidden={step !== "model"}>
          <ModelsPage
            embedded
            active={step === "model"}
            settings={settings}
            onSaved={onSaved}
            onExpired={onExpired}
          />
        </div>
      )}
      {visited.includes("github") && (
        <div hidden={step !== "github"}>
          <ConnectionsPage
            embedded
            path="connections/github"
            onSaved={onSaved}
            onExpired={onExpired}
          />
        </div>
      )}
      {visited.includes("project") && (
        <div hidden={step !== "project"}>
          {projects === undefined && !error && <LoadingStatus />}
          {projects && projectComplete && (
            <SettingsGroup>
              <SettingsRow label="Project" htmlFor="setup-project">
                <output id="setup-project">{selected.name}</output>
              </SettingsRow>
            </SettingsGroup>
          )}
          {projects && !projectComplete && !settings.githubConfigured && (
            <Button
              variant="outline"
              onClick={() => {
                go("github");
              }}
            >
              Connect GitHub
            </Button>
          )}
          {projects && !projectComplete && settings.githubConfigured && (
            <Projects
              embedded
              onBusyChange={setProjectBusy}
              path="projects/new"
              onExpired={onExpired}
              onCreated={async (project) => {
                setProjects((current) => [...(current ?? []), project]);
                await run(
                  () =>
                    onState({
                      ...state,
                      step: "project",
                      paused: false,
                      projectID: project.id,
                    }),
                  "Could not save setup progress.",
                );
              }}
            />
          )}
        </div>
      )}
      {step === "finish" && (
        <SettingsGroup>
          <SettingsRow label="Model" htmlFor="setup-model">
            <output id="setup-model">{modelComplete ? settings.model : "Not connected"}</output>
          </SettingsRow>
          <SettingsRow label="GitHub" htmlFor="setup-github">
            <output id="setup-github">
              {settings.githubConfigured ? "Connected" : "Not connected"}
            </output>
          </SettingsRow>
          <SettingsRow label="Project" htmlFor="setup-summary-project">
            <output id="setup-summary-project">{selected?.name ?? "Not connected"}</output>
          </SettingsRow>
        </SettingsGroup>
      )}
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          className="-ml-1 px-1"
          disabled={navigating || index === 0}
          onClick={() => {
            go(setupSteps[index - 1] ?? "account");
          }}
        >
          <ChevronLeftIcon aria-hidden="true" />
          Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {step !== "account" && step !== "finish" && !canContinue && (
            <Button
              variant="ghost"
              className="px-1"
              disabled={navigating}
              onClick={() => {
                go(setupSteps[index + 1] ?? "finish");
              }}
            >
              Skip
            </Button>
          )}
          {step === "project" && !projectComplete && settings.githubConfigured && projects && (
            <Button type="submit" form="onboarding-project" disabled={navigating}>
              {projectBusy ? "Connecting…" : "Connect project"}
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          )}
          {canContinue && (
            <Button
              disabled={navigating}
              onClick={() => {
                if (step === "finish") leave();
                else go(setupSteps[index + 1] ?? "finish");
              }}
            >
              {step === "finish" ? "Open Flora" : "Continue"}
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
      {step === "finish" && (!modelComplete || !projectComplete) && (
        <Text tone="muted" className="mt-4">
          {!modelComplete && !projectComplete && "Connect a model and project to start chats"}
          {!modelComplete && projectComplete && "Connect a model to start chats"}
          {modelComplete && !projectComplete && "Connect a project to start chats"}
        </Text>
      )}
    </FirstRunLayout>
  );
}
