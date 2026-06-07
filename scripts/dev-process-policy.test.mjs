import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldShutdownAfterChildFailure } from "./dev-process-policy.mjs";

test("web failures do not shut down the dev supervisor", () => {
  assert.equal(shouldShutdownAfterChildFailure("web"), false);
});

test("backend failures shut down the dev supervisor", () => {
  assert.equal(shouldShutdownAfterChildFailure("backend"), true);
});

test("unknown child failures shut down the dev supervisor by default", () => {
  assert.equal(shouldShutdownAfterChildFailure("worker"), true);
});
