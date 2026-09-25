import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(`${root}public`, { recursive: true });
for (const size of [16, 24, 32, 48]) {
  execFileSync(
    "sips",
    ["-z", String(size), String(size), `${root}logo.png`, "--out", `${root}public/logo-${size}.png`],
    { stdio: "ignore" },
  );
}
