"use strict";

const { execSync } = require("node:child_process");
const path = require("node:path");

function bootstrapConvex() {
  try {
    console.log("Checking Convex project...");
    execSync("npx convex dev --once --configure existing", {
      cwd: path.resolve(__dirname, "..", "apps", "web"),
      stdio: "pipe",
      timeout: 60000,
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
