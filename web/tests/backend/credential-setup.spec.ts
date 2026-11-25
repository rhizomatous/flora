import { test, expect, savedSettingsURL } from "../fixtures.ts";
import { assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

for (const first of ["GitHub", "model"] as const) {
  test(`${first} can be saved before the other connection`, async ({ page, backend, request }) => {
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password",{exact:true}).fill("browser test password");
    await page.getByRole("button",{name:"Create administrator",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Connect a model",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Leave setup",exact:true}).click();
    await expect(page).toHaveURL(/#chats\/new/);
    await page.route("https://github.com/**",async route => {
      const url=new URL(route.request().url());
      const state=url.searchParams.get("state");
      const creating=url.pathname === "/settings/apps/new";
      const callback=new URL(`${backend.url}/github/callback`);
      callback.searchParams.set("state",state ?? "");
      callback.searchParams.set(creating ? "code" : "installation_id",creating ? "fixture-code" : "40");
      await route.fulfill({contentType:"text/html",body:`<h1>GitHub approval</h1><a href="${callback.toString().replaceAll("&","&amp;")}">${creating ? "Create GitHub App" : "Install GitHub App"}</a>`});
    });
    async function save(connection:"GitHub" | "model") {
      await page.goto(connection === "model" ? "/#models" : "/#connections/github");
      if (connection === "GitHub") {
        await page.getByRole("button",{name:"Connect GitHub",exact:true}).click();
        await page.getByRole("link",{name:"Create GitHub App",exact:true}).click();
        await expect(page.getByRole("button",{name:"Install GitHub App",exact:true})).toBeVisible();
        await page.getByRole("button",{name:"Install GitHub App",exact:true}).click();
        await page.getByRole("link",{name:"Install GitHub App",exact:true}).click();
        await expect(page.getByRole("heading",{name:"Repositories",exact:true})).toBeVisible();
        await expect(page.getByRole("textbox")).toHaveCount(0);
      } else {
        await page.getByRole("button",{name:"Add connection",exact:true}).click();
        await page.getByRole("menuitem",{name:"Anthropic",exact:true}).click();
        const dialog=page.getByRole("dialog",{name:"Connect Anthropic",exact:true});
        await dialog.getByLabel("API key",{exact:true}).fill("fixture-provider-only");
        await dialog.getByRole("button",{name:"Connect",exact:true}).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button",{name:"Update Anthropic key",exact:true})).toBeVisible();
      }
    }
    await save(first);
    expect(await (await page.request.get("/api/settings")).json()).toMatchObject({githubConfigured:first === "GitHub",providerConfigured:first === "model"});
    await page.reload();await assertFitsPhone(page);
    await save(first === "GitHub" ? "model" : "GitHub");
    expect(await (await request.get(savedSettingsURL(backend))).json()).toMatchObject({providerKey:"fixture-provider-only",githubToken:""});
    const body=await (await page.request.get("/api/settings")).text();
    expect(body).not.toContain("fixture-provider-only");expect(body).not.toContain("fixture-installation-token");
  });
}
