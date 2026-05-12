import { spawn } from "node:child_process";
import { platform } from "node:process";

const childProcesses = [];
const npmCommand = platform === "win32" ? "npm.cmd" : "npm";

const run = (name, script) => {
  const child = spawn(npmCommand, ["run", script], {
    stdio: "inherit",
    shell: platform === "win32" ? true : false
  });

  child.on("error", (err) => {
    console.error(`[dev-all] Failed to start ${name}:`, err);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev-all] ${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  childProcesses.push(child);
  return child;
};

const shutdown = (code = 0) => {
  console.log("[dev-all] Shutting down...");
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev-all] Starting backend and web...");
run("backend", "dev:backend");
run("web", "dev:web");
