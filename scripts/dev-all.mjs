import { spawn } from "node:child_process";
import { cwd, platform } from "node:process";
import {
  buildFailureSummary,
  createLineCollector,
  createRecentLineBuffer,
  sanitizeLogLine
} from "./dev-logging.mjs";

const childProcesses = [];
const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
const command = platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npmCommand;
const repoRoot = cwd();

const formatCommand = (args) => [npmCommand, ...args].join(" ");

const attachOutput = ({ child, name, recentLines }) => {
  const handleLine = (line, writer) => {
    const sanitizedLine = sanitizeLogLine(line, { repoRoot });
    recentLines.push(sanitizedLine);
    writer.write(`[${name}] ${sanitizedLine}\n`);
  };
  const stdoutCollector = createLineCollector({
    onLine: (line) => handleLine(line, process.stdout)
  });
  const stderrCollector = createLineCollector({
    onLine: (line) => handleLine(line, process.stderr)
  });

  child.stdout?.on("data", (chunk) => stdoutCollector.push(chunk));
  child.stderr?.on("data", (chunk) => stderrCollector.push(chunk));

  return () => {
    stdoutCollector.flush();
    stderrCollector.flush();
  };
};

const run = (name, args) => {
  const commandArgs = platform === "win32" ? ["/d", "/s", "/c", npmCommand, ...args] : args;
  const recentLines = createRecentLineBuffer();
  const child = spawn(command, commandArgs, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false
  });
  const commandText = formatCommand(args);

  const flushOutput = attachOutput({ child, name, recentLines });

  child.on("error", (err) => {
    console.error(`[dev-all] Failed to start ${name}:`, err);
  });

  child.on("close", (code, signal) => {
    if ((code !== 0 && code !== null) || (code === null && signal !== null)) {
      flushOutput();

      for (const line of buildFailureSummary({
        name,
        command: commandText,
        code,
        signal,
        recentLines: recentLines.getLines(),
        repoRoot
      })) {
        console.error(line);
      }

      shutdown(code ?? 1);
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
