import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, openSettings } from "../helpers.ts";

test.use({ scenario: "passkeys" });

test("passkey setup, sign-in, management, replay rejection and host recovery", async ({ page, backend }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(backend.url);
  await expect(page.getByRole("heading", { name: "Open your setup link" })).toBeVisible();
  const denied = await page.request.post("/api/auth/passkeys/register/begin", {
    headers: { Origin: backend.url }, data: { mode: "setup", name: "Intruder" },
  });
  expect(denied.status()).toBe(403);
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  await expect(page).not.toHaveURL(/fixture-installer/);
  await page.getByLabel("Passkey name", { exact: true }).fill("My phone");
  await page.getByRole("button", { name: "Create administrator with passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel("Name for My phone", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove My phone", exact: true })).toBeDisabled();
  const original = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
  await page.getByLabel("Passkey name", { exact: true }).fill("Spare key");
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByLabel("Name for Spare key", { exact: true })).toBeVisible();
  await page.getByLabel("Name for My phone", { exact: true }).fill("Phone renamed");
  await page.getByRole("button", { name: "Rename My phone", exact: true }).click();
  await expect(page.getByLabel("Name for Phone renamed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Spare key", exact: true }).click();
  await expect(page.getByLabel("Name for Spare key", { exact: true })).toHaveCount(0);
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
  for (const credential of original.credentials) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  await assertFitsPhone(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const logout = await page.request.post("/api/auth/logout", { headers: { Origin: backend.url } });
  expect(logout.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with passkey", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  const finished = page.waitForRequest((request) => request.url().endsWith("/auth/passkeys/login/finish"));
  await page.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
  const loginRequest = await finished;
  await expect(page.getByRole("heading", { name: "Installation settings", exact: true })).toBeVisible();
  const replay = await page.request.post("/api/auth/passkeys/login/finish", { headers: { Origin: backend.url }, data: loginRequest.postDataJSON() });
  expect(replay.status()).toBe(400);
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials.length).toBe(1);
  for (const credential of credentials) await cdp.send("WebAuthn.removeCredential", { authenticatorId, credentialId: credential.credentialId });
  const recovery = await page.request.post("/__fixture/recovery");
  const { link } = await recovery.json();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#recover/);
  await expect(page.getByRole("heading", { name: "Recover account", exact: true })).toBeVisible();
  await page.getByLabel("Passkey name", { exact: true }).fill("Recovered phone");
  await page.getByRole("button", { name: "Recover with passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel("Name for Recovered phone", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Name for Phone renamed", { exact: true })).toHaveCount(0);
  const passwordRecovery = await page.request.post("/__fixture/recovery");
  await page.goto((await passwordRecovery.json()).link);
  await page.getByLabel("New password", { exact: true }).fill("recovered browser password");
  await page.getByRole("button", { name: "Recover with password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByText("No passkeys", { exact: true })).toBeVisible();
  await page.request.post("/api/auth/logout", { headers: { Origin: backend.url } });
  await page.reload();
  await page.getByLabel("Password", { exact: true }).fill("recovered browser password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installation settings", exact: true })).toBeVisible();
});

test("password administrators can add a passkey and cancelled prompts keep password login", async ({ page, backend }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  await page.getByLabel("Password", { exact: true }).fill("existing administrator password");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await openSettings(page);
  await page.getByLabel("Passkey name", { exact: true }).fill("Desktop");
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByLabel("Name for Desktop", { exact: true })).toBeVisible();
  await page.request.post("/__fixture/auth-age");
  await page.reload();
  await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toBeDisabled();
  await page.getByLabel("Confirm administrator password", { exact: true }).fill("existing administrator password");
  await page.getByRole("button", { name: "Confirm with password", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toBeEnabled();
  await page.request.post("/api/auth/logout", { headers: { Origin: backend.url } });
  await page.reload();
  await page.evaluate(() => {
    navigator.credentials.get = () => Promise.reject(new DOMException("Prompt cancelled", "NotAllowedError"));
  });
  await page.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Passkey prompt cancelled");
  await page.getByLabel("Password", { exact: true }).fill("existing administrator password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installation settings", exact: true })).toBeVisible();
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});

test("long passkey names fit wide and narrow settings with keyboard focus", async ({ page, backend }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  const name = "Phone".repeat(20);
  await page.getByLabel("Passkey name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create administrator with passkey", exact: true }).click();
  await openSettings(page);
  await expect(page.getByLabel(`Name for ${name}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toBeEnabled();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((dark) => { document.documentElement.classList.toggle("dark", dark); }, theme === "dark");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const nameInput = page.getByLabel("Passkey name", { exact: true });
      await nameInput.focus();
      await expect(nameInput).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toBeFocused();
      await page.getByRole("heading", { name: "Passkeys", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`passkeys-${width}-${theme}.png`) });
    }
  }
});
