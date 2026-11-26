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
  const requestedStep = setupStep(path, state.step);
  const heading = useRef<HTMLHeadingElement>(null);
  // Keep visited editors mounted to retain non-secret drafts during back navigation.
  const [visited, setVisited] = useState<SetupStep[]>([]);
  const [projects, setProjects] = useState<Project[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [projectBusy, setProjectBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const navigating = busy || projectBusy || modelBusy;
  const modelComplete = settings.providerConfigured && settings.model !== "";
  const selected = projects?.find((project) => project.id === state.projectID) ?? projects?.[0];
  const projectComplete = selected !== undefined;
  let availableStep = 1;
  if (modelComplete) availableStep = 2;
  if (modelComplete && settings.githubConfigured) availableStep = 3;
  if (modelComplete && settings.githubConfigured && projectComplete) availableStep = 4;
  const index = Math.min(setupSteps.indexOf(requestedStep), availableStep);
  const step = setupSteps[index] ?? "model";
  const projectsLoaded = projects !== undefined;
  if (!visited.includes(step)) setVisited([...visited, step]);
  const persistRoute = useEffectEvent(() => {
    if (!projectsLoaded) return;
    if (state.step !== step || state.completed || !state.started || path !== `onboarding/${step}`) {
      void run(async () => {
        await onState({ ...state, step, completed: false });
        if (path !== `onboarding/${step}`) window.location.hash = `onboarding/${step}`;
      }, "Could not save setup progress.");
    }
  });
  useEffect(() => {
    persistRoute();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Validate navigation after saved projects have loaded.
  }, [step, projectsLoaded, path]);
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
  const selectedID = projects === undefined ? state.projectID : (selected?.id ?? "");
  async function navigate(next: SetupStep) {
    await onState({ ...state, step: next, completed: false, projectID: selectedID });
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
    // oxlint-disable-next-line react/immutability -- Hash navigation changes the browser route.
    window.location.hash = `onboarding/${next}`;
  }
  function go(next: SetupStep) {
    void run(() => navigate(next), "Could not save setup progress.");
  }
  const canContinue =
    step === "account" ||
    (step === "finish" && availableStep === 4) ||
    (step === "model" && modelComplete) ||
    (step === "github" && settings.githubConfigured) ||
    (step === "project" && projectComplete);
  function finish() {
    void run(async () => {
      await onState({ ...state, step, completed: true, projectID: selectedID });
      window.location.hash = selectedID
        ? `chats/new?project=${encodeURIComponent(selectedID)}`
        : "chats/new";
    }, "Could not finish setup. Try again.");
  }
  return (
    <FirstRunLayout
      actions={
        <Button variant="ghost" disabled={navigating} onClick={onLogout}>
          Log out
        </Button>
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
                disabled={navigating || position > availableStep}
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
            onBusyChange={setModelBusy}
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
                      completed: false,
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
          {step === "model" && !modelComplete && (
            <Button variant="outline" disabled={navigating} onClick={onLogout}>
              Finish later
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
                if (step === "finish") finish();
                else go(setupSteps[index + 1] ?? "finish");
              }}
            >
              {step === "finish" ? "Open Flora" : "Continue"}
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
    </FirstRunLayout>
  );
}
