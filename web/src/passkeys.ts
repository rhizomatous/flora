import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { z } from "zod";

import { authenticatedSchema } from "./auth-schemas";
import { request } from "./request";

const descriptor = z.object({ id: z.string(), type: z.literal("public-key") });
const rpSchema = z.object({ id: z.string(), name: z.string() });
const userSchema = z.object({ id: z.string(), name: z.string(), displayName: z.string() });
const algorithmSchema = z.object({ type: z.literal("public-key"), alg: z.number() });
const selectionSchema = z.object({
  residentKey: z.literal("required"),
  userVerification: z.literal("required"),
  requireResidentKey: z.boolean().default(true),
});
const creationOptionsSchema = z.object({
  challenge: z.string(),
  rp: rpSchema,
  user: userSchema,
  pubKeyCredParams: algorithmSchema.array(),
  timeout: z.number(),
  excludeCredentials: descriptor.array().default([]),
  authenticatorSelection: selectionSchema,
  attestation: z.literal("none").default("none"),
});
const creationSchema = z.object({ publicKey: creationOptionsSchema });
const assertionOptionsSchema = z.object({
  challenge: z.string(),
  rpId: z.string(),
  timeout: z.number(),
  userVerification: z.literal("required"),
  allowCredentials: descriptor.array().default([]),
});
const assertionSchema = z.object({ publicKey: assertionOptionsSchema });

function supported() {
  if (!browserSupportsWebAuthn()) {
    throw new Error(
      "This browser cannot use passkeys. Use a supported browser, password login, or a host recovery link.",
    );
  }
}
function promptError(error: unknown): never {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (
    cause instanceof Error &&
    (cause.name === "NotAllowedError" ||
      cause.name === "AbortError" ||
      cause.message.includes("timed out") ||
      cause.message.includes("not allowed"))
  ) {
    throw new Error(
      "Passkey prompt cancelled or unavailable. Try again, choose another passkey, or use password login or host recovery.",
    );
  }
  if (cause instanceof Error && cause.name === "InvalidStateError") {
    throw new Error(
      "This passkey is already registered. Choose another authenticator or sign in with it.",
    );
  }
  if (cause instanceof Error && cause.name === "SecurityError") {
    throw new Error(
      "Open Flora at its configured HTTPS address to use passkeys. If the address changed, obtain a recovery link from the host.",
    );
  }
  throw error;
}
export async function registerPasskey(mode: "setup" | "session" | "recovery", name: string) {
  supported();
  const options = await request(creationSchema, "auth/passkeys/register/begin", {
    method: "POST",
    body: { mode, name },
  });
  let credential;
  try {
    credential = await startRegistration({ optionsJSON: options.publicKey });
  } catch (error) {
    promptError(error);
  }
  await request(authenticatedSchema, "auth/passkeys/register/finish", {
    method: "POST",
    body: { mode, credential },
  });
}
export async function signInWithPasskey() {
  supported();
  const options = await request(assertionSchema, "auth/passkeys/login/begin", {
    method: "POST",
    body: {},
  });
  let credential;
  try {
    credential = await startAuthentication({ optionsJSON: options.publicKey });
  } catch (error) {
    promptError(error);
  }
  await request(authenticatedSchema, "auth/passkeys/login/finish", {
    method: "POST",
    body: { credential },
  });
}

const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  origin: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
});
export const passkeysSchema = z.object({
  passkeys: passkeySchema.array(),
  recent: z.boolean(),
  passwordAvailable: z.boolean(),
  origin: z.string(),
  available: z.boolean(),
});
export type Passkeys = z.infer<typeof passkeysSchema>;
