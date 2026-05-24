import { spawn } from "node:child_process";
import { platform } from "node:process";

const childProcesses = [];
const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
const command = platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npmCommand;

const formatExitCode = (code) => {
  if (typeof code !== "number") {
    return String(code);
  }

  return `${code} (0x${code.toString(16)})`;
};

const run = (name, args) => {
  const commandArgs = platform === "win32" ? ["/d", "/s", "/c", npmCommand, ...args] : args;
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    shell: false
  });

  child.on("error", (err) => {
    console.error(`[dev-all] Failed to start ${name}:`, err);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev-all] ${name} exited with code ${formatExitCode(code)}`);
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
run("backend", ["run", "dev", "--workspace", "apps/backend"]);
run("web", ["run", "dev", "--workspace", "apps/web"]);
