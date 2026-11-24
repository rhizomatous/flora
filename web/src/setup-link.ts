import { z } from "zod";

import { request } from "./request";

// Remove ownership material before making requests or mounting the app. Keep the
// exchange promise outside React so StrictMode cannot redeem the link twice.
export function redeemSetupLink(): Promise<unknown> {
  const prefix = "#setup/";
  if (!window.location.hash.startsWith(prefix)) return Promise.resolve();
  const secret = window.location.hash.slice(prefix.length);
  window.history.replaceState(null, "", `${window.location.pathname}#chats/new`);
  return request(z.object({ setupAuthorized: z.boolean() }), "auth/setup", {
    method: "POST",
    body: { secret },
  });
}
