import { spawnSync } from "node:child_process";
import net from "node:net";

const probePort = ({ host, port }) => new Promise((resolve) => {
  const server = net.createServer();

  server.unref();
  server.once("error", (error) => {
    resolve({
      available: error.code === "EADDRNOTAVAIL",
      error
    });
  });
  server.listen({ host, port, exclusive: true }, () => {
    server.close(() => {
      resolve({
        available: true,
        error: null
      });
    });
  });
});

export const findUnavailablePorts = async (ports, { host = "127.0.0.1" } = {}) => {
  const results = await Promise.all(
    ports.map(async ({ name, port, host: portHost = host }) => ({
      name,
      port,
      host: portHost,
      ...await probePort({ host: portHost, port })
    }))
  );

  return results.filter((result) => !result.available);
};

const formatHostForUrl = (host) => host.includes(":") ? `[${host}]` : host;

export const formatUnavailablePorts = (ports, { host = "127.0.0.1" } = {}) => [
  `[dev-all] Cannot start because ${ports.length === 1 ? "a required port is" : "required ports are"} already in use:`,
  ...ports.map(({ name, port, host: portHost = host }) => `[dev-all]   ${name}: http://${formatHostForUrl(portHost)}:${port}`),
  "[dev-all] Stop the existing development server before running npm run dev again."
];

export const terminateProcessTree = (child, { platform = process.platform } = {}) => {
  if (!child?.pid) {
    return;
  }

  if (platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
};
