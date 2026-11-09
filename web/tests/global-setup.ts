// oxlint-disable node/no-sync -- One-time builds complete before browser tests start.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  execFileSync("npm", ["run", "build"], { cwd, stdio: "inherit" });
  execFileSync(
    "go",
    [
      "-C",
      "backend",
      "build",
      "-tags",
      "browserfixture",
      "-o",
      "../bin/browser-fixture",
      "./cmd/browser-fixture",
    ],
    { cwd, stdio: "inherit" },
  );
}
