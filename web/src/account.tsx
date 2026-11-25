import { useEffect, useRef } from "react";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  FieldLabel,
  Heading,
  Input,
  Text,
} from "@flora/florets";

import { authenticatedSchema, type Status } from "./auth-schemas";
import { registerPasskey, signInWithPasskey } from "./passkeys";
import { request } from "./request";
import { text } from "./ui";

export function Account({
  status,
  busy,
  run,
  onLogin,
}: {
  status: Status;
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
  onLogin: () => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const recovery = status.recoveryAuthorized;
  if (status.setupRequired && !status.setupAuthorized) {
    return (
      <section aria-labelledby="account-heading">
        <Heading level={1} ref={heading} tabIndex={-1} id="account-heading">
          Open your setup link
        </Heading>
        <Text tone="muted" className="mt-3">
          Use the Flora setup URL from your installer terminal or ask the host owner for a new link.
        </Text>
      </section>
    );
  }
  const enrolling = status.setupRequired || recovery;
  let action = status.setupRequired ? "Create administrator" : "Log in";
  let endpoint = status.setupRequired ? "bootstrap" : "login";
  if (recovery) {
    action = "Recover account";
    endpoint = "recover-password";
  }
  const passwordAvailable = enrolling || status.passwordAvailable;
  return (
    <section aria-labelledby="account-heading" className="mx-auto max-w-sm">
      <Heading level={1} ref={heading} tabIndex={-1} id="account-heading">
        {action}
      </Heading>
      {status.passkeysAvailable &&
        (enrolling ? (
          <form
            className="mt-8 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const name = text(new FormData(event.currentTarget), "name");
              void run(async () => {
                await registerPasskey(recovery ? "recovery" : "setup", name);
                await onLogin();
              }, "Could not register passkey. Try again.");
            }}
          >
            <FieldLabel className="w-full flex-col items-start">
              Passkey name
              <Input
                name="name"
                className="mt-2"
                autoComplete="off"
                required
                maxLength={100}
                disabled={busy}
              />
            </FieldLabel>
            <Button className="w-full" type="submit" disabled={busy}>
              {recovery ? "Recover with passkey" : "Create administrator with passkey"}
            </Button>
          </form>
        ) : (
          <Button
            className="mt-8 w-full"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await signInWithPasskey();
                await onLogin();
              }, "Could not sign in with passkey. Try again.");
            }}
          >
            Sign in with passkey
          </Button>
        ))}
      {!passwordAvailable && !status.passkeysAvailable && status.passkeyError && (
        <Text className="mt-4">{status.passkeyError}</Text>
      )}
      {recovery && (
        <Text className="mt-4" tone="muted">
          Recovery replaces your password and passkeys and signs out every browser
        </Text>
      )}
      {passwordAvailable && (
        <form
          className="mt-8 space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const password = text(new FormData(form), "password");
            void run(async () => {
              await request(authenticatedSchema, `auth/${endpoint}`, {
                method: "POST",
                body: { password },
              });
              form.reset();
              await onLogin();
            }, "Request failed. Try again.");
          }}
        >
          <FieldLabel className="w-full flex-col items-start">
            {recovery ? "New password" : "Password"}
            <Input
              className="mt-2"
              type="password"
              name="password"
              autoComplete={enrolling ? "new-password" : "current-password"}
              minLength={enrolling ? 12 : undefined}
              maxLength={1024}
              required
              disabled={busy}
            />
          </FieldLabel>
          <Button className="w-full" type="submit" disabled={busy}>
            {recovery ? "Recover with password" : action}
          </Button>
        </form>
      )}
      {!enrolling && (
        <Collapsible className="mt-6">
          <CollapsibleTrigger render={<Button variant="link" className="p-0" />}>
            Recover account
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Text tone="muted" className="mt-3">
              Ask the host owner for a recovery link
            </Text>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
