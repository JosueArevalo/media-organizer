import { spawn } from "node:child_process";
import { cwd, platform } from "node:process";
import {
  buildFailureSummary,
  createLineCollector,
  createRecentLineBuffer,
  sanitizeLogLine
} from "./dev-logging.mjs";
import {
  findUnavailablePorts,
  formatUnavailablePorts,
  terminateProcessTree
} from "./dev-runtime.mjs";

const childProcesses = [];
const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
const command = platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npmCommand;
const repoRoot = cwd();
let shuttingDown = false;

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
    detached: platform !== "win32",
    stdio: ["inherit", "pipe", "pipe"],
    shell: false
  });
  const commandText = formatCommand(args);

  const flushOutput = attachOutput({ child, name, recentLines });

  child.on("error", (err) => {
    console.error(`[dev-all] Failed to start ${name}:`, err);
  });

  child.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

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
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log("[dev-all] Shutting down...");

  for (const child of childProcesses) {
    terminateProcessTree(child);
  }

  process.exit(code);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const unavailablePorts = await findUnavailablePorts([
  { name: "backend (IPv4)", host: "127.0.0.1", port: 4000 },
  { name: "backend (IPv6)", host: "::1", port: 4000 },
  { name: "web (IPv4)", host: "127.0.0.1", port: 5173 },
  { name: "web (IPv6)", host: "::1", port: 5173 }
]);

if (unavailablePorts.length > 0) {
  for (const line of formatUnavailablePorts(unavailablePorts)) {
    console.error(line);
  }

  process.exit(1);
}

console.log("[dev-all] Starting backend and web...");
run("backend", ["run", "dev", "--workspace", "apps/backend"]);
run("web", ["run", "dev", "--workspace", "apps/web"]);
