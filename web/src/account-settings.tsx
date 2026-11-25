import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import {
  Alert,
  Button,
  Heading,
  Input,
  LoadingStatus,
  Section,
  SectionHeader,
  SectionStack,
  SettingsGroup,
  SettingsRow,
  Text,
} from "@flora/florets";

import { authenticatedSchema } from "./auth-schemas";
import { passkeysSchema, registerPasskey, signInWithPasskey, type Passkeys } from "./passkeys";
import { request } from "./request";
import { text } from "./ui";

type Props = {
  compact?: boolean;
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
};
export function AccountSettings({ compact = false, busy, run }: Props) {
  const [data, setData] = useState<Passkeys>();
  const [failed, setFailed] = useState(false);
  async function load() {
    setData(await request(passkeysSchema, "auth/passkeys"));
    setFailed(false);
  }
  const initialLoad = useEffectEvent(async () => {
    try {
      await load();
    } catch {
      setFailed(true);
    }
  });
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Initial state comes from the awaited account request.
    void initialLoad();
  }, []);
  function act(task: () => Promise<void>) {
    void run(async () => {
      try {
        await task();
      } finally {
        await load();
      }
    }, "Could not update passkeys. Try again.");
  }
  if (failed) {
    return (
      <Section>
        <Alert role="alert">Could not load passkeys.</Alert>
        <Button
          onClick={() => {
            act(load);
          }}
        >
          Retry passkeys
        </Button>
      </Section>
    );
  }
  if (!data) return <LoadingStatus>Loading passkeys…</LoadingStatus>;
  if (compact && !data.available) {
    return (
      <SettingsGroup>
        <SettingsRow label="Sign-in method" htmlFor="setup-sign-in-method">
          <output id="setup-sign-in-method">
            {data.passwordAvailable ? "Password" : "Passkey"}
          </output>
        </SettingsRow>
      </SettingsGroup>
    );
  }
  return (
    <SectionStack>
      <Section>
        <SectionHeader inset>
          <Heading level={2}>Passkeys</Heading>
          {!compact && (
            <Text tone="muted" className="break-all">
              {data.origin}
            </Text>
          )}
        </SectionHeader>
        {!data.recent && (
          <div className="mb-4 space-y-4">
            <Text>Sign in again to change passkeys</Text>
            {data.available && (
              <Button
                disabled={busy}
                onClick={() => {
                  act(signInWithPasskey);
                }}
              >
                Confirm with passkey
              </Button>
            )}
            {data.passwordAvailable && (
              <form
                className="flex flex-wrap gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const password = text(new FormData(form), "password");
                  act(async () => {
                    await request(authenticatedSchema, "auth/login", {
                      method: "POST",
                      body: { password },
                    });
                    form.reset();
                  });
                }}
              >
                <Input
                  type="password"
                  name="password"
                  aria-label="Confirm administrator password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  className="min-w-0"
                />
                <Button type="submit" disabled={busy}>
                  Confirm with password
                </Button>
              </form>
            )}
          </div>
        )}
        <div className="space-y-4">
          {data.passkeys.length > 0 && (
            <SettingsGroup>
              {data.passkeys.map((key) => (
                <SettingsRow
                  key={key.id}
                  label={<span className="wrap-anywhere">{key.name}</span>}
                  htmlFor={`passkey-${key.id}`}
                  description={
                    key.origin === data.origin ? undefined : "Registered at another address"
                  }
                >
                  <form
                    className="flex min-w-0 flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = text(new FormData(event.currentTarget), "name");
                      act(async () => {
                        await request(
                          z.object({ saved: z.boolean() }),
                          `auth/passkeys/${encodeURIComponent(key.id)}`,
                          { method: "PATCH", body: { name } },
                        );
                      });
                    }}
                  >
                    <Input
                      id={`passkey-${key.id}`}
                      name="name"
                      aria-label={`Name for ${key.name}`}
                      key={key.name}
                      defaultValue={key.name}
                      required
                      maxLength={100}
                      disabled={busy || !data.recent}
                      className="min-w-0"
                    />
                    <Button
                      type="submit"
                      disabled={busy || !data.recent}
                      aria-label={`Rename ${key.name}`}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="destructive"
                      type="button"
                      disabled={
                        busy ||
                        !data.recent ||
                        (!data.passwordAvailable &&
                          key.origin === data.origin &&
                          data.passkeys.filter((entry) => entry.origin === data.origin).length <= 1)
                      }
                      aria-label={`Remove ${key.name}`}
                      onClick={() => {
                        act(async () => {
                          await request(
                            z.object({ saved: z.boolean() }),
                            `auth/passkeys/${encodeURIComponent(key.id)}`,
                            { method: "DELETE" },
                          );
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </form>
                </SettingsRow>
              ))}
            </SettingsGroup>
          )}
          {data.passkeys.length === 0 && <Text tone="muted">No passkeys</Text>}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = text(new FormData(form), "name");
              act(async () => {
                await registerPasskey("session", name);
                form.reset();
              });
            }}
          >
            <SettingsGroup>
              <SettingsRow label="Passkey name" htmlFor="new-passkey-name">
                <Input
                  id="new-passkey-name"
                  name="name"
                  autoComplete="off"
                  required
                  maxLength={100}
                  disabled={busy || !data.recent || !data.available}
                />
              </SettingsRow>
            </SettingsGroup>
            <Button type="submit" disabled={busy || !data.recent || !data.available}>
              Add passkey
            </Button>
          </form>
        </div>
      </Section>
      {!compact && (
        <Section>
          <SectionHeader inset>
            <Heading level={2}>Account recovery</Heading>
            <Text tone="muted">
              If you lose access or change Flora&apos;s address, run the installed Flora binary on
              the host with <code>-recover-account</code> and the service&apos;s{" "}
              <code>-data-dir</code> and <code>-public-url</code>. Open the recovery link to replace
              your sign-in methods.
            </Text>
          </SectionHeader>
        </Section>
      )}
    </SectionStack>
  );
}
