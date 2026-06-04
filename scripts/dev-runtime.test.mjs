import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  findUnavailablePorts,
  formatUnavailablePorts
} from "./dev-runtime.mjs";

const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen({ host: "127.0.0.1", port: 0 }, resolve);
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test("reports a port that is already listening", async () => {
  const server = net.createServer();
  await listen(server);

  try {
    const address = server.address();
    assert(address && typeof address !== "string");

    const unavailable = await findUnavailablePorts([
      { name: "web", port: address.port }
    ]);

    assert.equal(unavailable.length, 1);
    assert.equal(unavailable[0].name, "web");
    assert.equal(unavailable[0].port, address.port);
  } finally {
    await close(server);
  }
});

test("reports an available port as available", async () => {
  const server = net.createServer();
  await listen(server);
  const address = server.address();
  assert(address && typeof address !== "string");
  await close(server);

  assert.deepEqual(await findUnavailablePorts([
    { name: "web", port: address.port }
  ]), []);
});

test("formats a clear occupied-port error", () => {
  assert.deepEqual(
    formatUnavailablePorts([{ name: "web", port: 5173 }]),
    [
      "[dev-all] Cannot start because a required port is already in use:",
      "[dev-all]   web: http://127.0.0.1:5173",
      "[dev-all] Stop the existing development server before running npm run dev again."
    ]
  );
});

test("formats IPv6 listeners without producing an ambiguous URL", () => {
  assert.equal(
    formatUnavailablePorts([{ name: "web (IPv6)", host: "::1", port: 5173 }])[1],
    "[dev-all]   web (IPv6): http://[::1]:5173"
  );
});
