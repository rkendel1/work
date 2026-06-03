import { execSync } from "node:child_process";
import path from "node:path";

export function bootstrapConvex() {
  try {
    console.log("Checking Convex project...");
    execSync("npx convex dev --once --configure existing", {
      cwd: path.resolve(__dirname, "..", "apps", "web"),
      stdio: "pipe",
      timeout: 60_000,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
      },
    });
    console.log("Convex initialized / connected");
  } catch {
    console.log("Convex already configured or skipped in CI");
  }
}

bootstrapConvex();
