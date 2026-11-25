/* oxlint-disable import/max-dependencies -- App composes workspace navigation alongside its routed views. */
import { StrictMode, useEffect, useEffectEvent, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Alert,
  Button,
  LoadingStatus,
  Toaster,
  SidebarProvider,
  SidebarInset,
} from "@flora/florets";

import { Account } from "./account";
import { statusSchema, authenticatedSchema, type Status } from "./auth-schemas";
import { Automations } from "./automations";
import { FolderProvider } from "./chat-folders";
import { Chats } from "./chats";
import { ConnectionsPage } from "./connections";
import { FirstRunLayout } from "./first-run-layout";
import { Installation } from "./installation";
import { MCPs } from "./mcps";
import { ModelsPage } from "./models-page";
import { useNotifications } from "./notifications";
import { Onboarding } from "./onboarding";
import { onboardingSchema, type OnboardingState } from "./onboarding-state";
import { Projects } from "./projects";
import { PullRequests } from "./pull-requests-page";
import { errorMessage, request } from "./request";
import { settingsSchema, type Settings } from "./settings-schemas";
import { redeemSetupLink } from "./setup-link";
import { Sidebar } from "./sidebar";
import { CompletionToasts } from "./toasts";

import "./styles.css";

import { UsagePage } from "./usage-page";
import { WorkspaceMenu } from "./workspace-menu";

async function openSetupLink() {
  try {
    await redeemSetupLink();
    return "";
  } catch (error) {
    return errorMessage(error, "Could not open setup. Obtain a new setup link from the host.");
  }
}
let setupExchange = openSetupLink();

const currentPath = () => window.location.hash.slice(1) || "chats/new";

function App() {
  const [status, setStatus] = useState<Status>();
  const [onboarding, setOnboarding] = useState<OnboardingState>();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(currentPath);
  const [automationTopbar, setAutomationTopbar] = useState<HTMLDivElement | null>(null);
  const ready =
    status?.authenticated === true && !status.recoveryAuthorized && settings !== undefined;

  // Re-reads the session so an expired one shows the login screen. A failure here keeps the
  // current view; the action that prompted the check has already reported its own error.
  async function recheckSession() {
    try {
      setStatus(await request(statusSchema, "auth/status"));
    } catch {
      // Keep the last known status.
    }
  }
  function onExpired() {
    void recheckSession();
  }

  const notifications = useNotifications(ready, settings?.preferences.sound === true, onExpired);

  async function refresh() {
    const next = await request(statusSchema, "auth/status");
    setStatus(next);
    if (next.authenticated && !next.recoveryAuthorized) {
      const [savedSettings, progress] = await Promise.all([
        request(settingsSchema, "settings"),
        request(onboardingSchema, "onboarding"),
      ]);
      setSettings(savedSettings);
      setOnboarding(progress);
      if (progress.started && !progress.paused && !currentPath().startsWith("onboarding/")) {
        window.location.hash = `onboarding/${progress.step}`;
      }
    } else {
      setSettings(undefined);
      setOnboarding(undefined);
    }
  }
  async function load() {
    try {
      const setupError = await setupExchange;
      if (setupError !== "") setError(setupError);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not load Flora."));
    }
  }
  const loadOnMount = useEffectEvent(load);
  useEffect(() => {
    const changed = () => {
      if (
        window.location.hash.startsWith("#setup/") ||
        window.location.hash.startsWith("#recover/")
      ) {
        setupExchange = openSetupLink();
        void loadOnMount();
      }
      setPath(currentPath());
      setError("");
      setNotice("");
    };
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
    };
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load sets state only after awaiting the request.
    void loadOnMount();
  }, []);

  // Runs a user action with the busy flag set. On failure it shows the error and rechecks the
  // session, so an expired one shows login. Unsaved settings are cleared on unmount.
  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e, fallback));
      await recheckSession();
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    void run(async () => {
      await request(authenticatedSchema, "auth/logout", { method: "POST" });
      await refresh();
    }, "Logout failed. Try again.");
  }

  function saved(next: Settings) {
    setSettings(next);
    setNotice("Settings saved. Credentials are not shown.");
  }

  async function saveOnboarding(next: OnboardingState) {
    const progress = await request(onboardingSchema, "onboarding", { method: "PUT", body: next });
    setOnboarding(progress);
  }

  if (ready && onboarding && path.startsWith("onboarding")) {
    return (
      <Onboarding
        actionError={error}
        path={path}
        state={onboarding}
        settings={settings}
        onSaved={setSettings}
        onState={saveOnboarding}
        onExpired={onExpired}
        onLogout={logout}
        busy={busy}
        run={run}
      />
    );
  }
  if (!ready) {
    return (
      <FirstRunLayout>
        {error && (
          <Alert variant="destructive" role="alert" className="mb-6">
            {error}
          </Alert>
        )}
        {status && (!status.authenticated || status.recoveryAuthorized) && (
          <Account
            key={`${String(status.setupRequired)}-${String(status.setupAuthorized)}-${String(status.recoveryAuthorized)}`}
            status={status}
            busy={busy}
            run={run}
            onLogin={refresh}
          />
        )}
        {(!status || (status.authenticated && !status.recoveryAuthorized)) && (
          <>
            {error !== "" && (
              <Button
                onClick={() => {
                  setError("");
                  void load();
                }}
              >
                Retry loading Flora
              </Button>
            )}
            {error === "" && <LoadingStatus />}
          </>
        )}
      </FirstRunLayout>
    );
  }

  const Layout = SidebarProvider;
  const newChat = path.startsWith("chats/new");
  const conversation = path.startsWith("chats/") && !newChat;
  const pullsPage = path === "pulls";
  const chatsPage = path.split("?")[0] === "chats";
  const mcpPage = path.startsWith("mcps");
  const automationsPage = path === "automations";
  const connectionsPage = path === "connections" || path === "connections/github";
  const modelsPage = path === "models";
  const automationEditor = path.startsWith("automations/");
  let contentLayout = "mx-auto w-full max-w-6xl p-4 sm:p-8";
  if (mcpPage || pullsPage || chatsPage || automationsPage) {
    contentLayout = "flex min-h-0 flex-1 flex-col";
  } else if (modelsPage || connectionsPage) {
    contentLayout = "min-h-0 flex-1 overflow-y-auto";
  } else if (automationEditor) {
    contentLayout = "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8";
  } else if (conversation) contentLayout = "flex min-h-0 flex-1 flex-col px-4 pb-2 sm:px-8";
  const frameLayout =
    mcpPage ||
    conversation ||
    pullsPage ||
    chatsPage ||
    automationsPage ||
    automationEditor ||
    modelsPage ||
    connectionsPage
      ? "h-dvh min-h-0 min-w-0 overflow-hidden md:h-[calc(100dvh-1rem)]"
      : "min-w-0";
  const Content = SidebarInset;

  const layout = (
    <Layout className="min-h-svh">
      <Toaster id="chat-organization" position="bottom-right" closeButton />
      <Sidebar path={path} chats={notifications.chats} onExpired={onExpired}>
        <WorkspaceMenu
          sound={settings.preferences.sound}
          audio={notifications.audio}
          busy={busy}
          onLogout={logout}
          setupPath={`onboarding/${onboarding?.step ?? "model"}`}
        />
      </Sidebar>
      <Content id="main-content" tabIndex={-1} className={frameLayout}>
        {!mcpPage && !newChat && !conversation && !pullsPage && !chatsPage && !automationsPage && (
          <header className="florets-topbar flex shrink-0 items-center gap-2 border-b px-3">
            <span className="sidebar-toggle-space" aria-hidden="true" />
            {path.startsWith("automations") && (
              <div ref={setAutomationTopbar} className="flex min-w-0 flex-1 items-center gap-2" />
            )}
          </header>
        )}
        <div className={contentLayout}>
          {error !== "" && (
            <Alert variant="destructive" role="alert" className="mb-6">
              {error}
            </Alert>
          )}
          {notice !== "" && (
            <Alert role="status" className="mb-6">
              {notice}
            </Alert>
          )}
          {notifications.error !== "" && (
            <Alert role="status" className="mb-6">
              {notifications.error}
            </Alert>
          )}
          <CompletionToasts toasts={notifications.toasts} dismiss={notifications.dismiss} />
          {mcpPage && <MCPs path={path} onExpired={onExpired} />}
          {connectionsPage && (
            <ConnectionsPage path={path} onSaved={setSettings} onExpired={onExpired} />
          )}
          {modelsPage && (
            <ModelsPage settings={settings} onSaved={setSettings} onExpired={onExpired} />
          )}
          {path === "settings" && (
            <Installation settings={settings} busy={busy} run={run} onSaved={saved} />
          )}
          {path.startsWith("automations") && (
            <Automations key={path} path={path} onExpired={onExpired} topbar={automationTopbar} />
          )}
          {path === "usage" && <UsagePage onExpired={onExpired} />}
          {pullsPage && (
            <PullRequests chats={notifications.chats} disconnected={notifications.error !== ""} />
          )}
          {!path.startsWith("mcps") &&
            !path.startsWith("automations") &&
            path !== "models" &&
            !connectionsPage &&
            path !== "settings" &&
            path !== "pulls" &&
            path !== "usage" &&
            (path.startsWith("chats") ? (
              <Chats
                key={path.startsWith("chats/new") ? path : path.split("?")[0]}
                path={path}
                list={notifications.chats}
                listError={notifications.error}
                messageBytes={settings.preferences.messageBytes}
                onExpired={onExpired}
              />
            ) : (
              <Projects key={path} path={path} onExpired={onExpired} />
            ))}
        </div>
      </Content>
    </Layout>
  );
  return <FolderProvider enabled={ready}>{layout}</FolderProvider>;
}

const root = document.querySelector("#root");
if (root === null) throw new Error("Flora cannot start: index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
