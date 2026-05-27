import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFailureSummary,
  createLineCollector,
  createRecentLineBuffer,
  describeExitCode,
  formatExitCode,
  sanitizeLogLine
} from "./dev-logging.mjs";

test("formats known Windows native crash exit codes with a useful description", () => {
  assert.equal(formatExitCode(3221226505), "3221226505 (0xC0000409)");
  assert.deepEqual(describeExitCode(3221226505), {
    label: "native process crash / fast fail",
    detail: "This usually comes from a native dependency or runtime crash, not a normal HTTP or app error."
  });
});

test("formats normal exit codes without adding a native crash description", () => {
  assert.equal(formatExitCode(1), "1 (0x1)");
  assert.equal(describeExitCode(1), null);
});

test("formats signal-only exits without a numeric code", () => {
  assert.equal(formatExitCode(null), "none");
});

test("sanitizes repository paths while keeping relative context", () => {
  const repoRoot = "D:\\Software Development\\media-organizer";
  const line = "path D:\\Software Development\\media-organizer\\apps\\web";

  assert.equal(sanitizeLogLine(line, { repoRoot }), "path <repo>\\apps\\web");
});

test("sanitizes external paths and common secret shapes", () => {
  const line = "Authorization: Bearer abc123 password=hunter2 api_key='xyz' file=C:\\Users\\josue\\Pictures\\private.jpg";

  assert.equal(
    sanitizeLogLine(line),
    "Authorization=<redacted> password=<redacted> api_key=<redacted> file=<path>"
  );
});

test("limits line length", () => {
  assert.equal(sanitizeLogLine("abcdef", { maxLineLength: 5 }), "ab...");
});

test("recent line buffer keeps only the configured number of lines", () => {
  const buffer = createRecentLineBuffer({ limit: 2 });

  buffer.push("one");
  buffer.push("two");
  buffer.push("three");

  assert.deepEqual(buffer.getLines(), ["two", "three"]);
});

test("line collector preserves partial chunks until flush", () => {
  const lines = [];
  const collector = createLineCollector({ onLine: (line) => lines.push(line) });

  collector.push("one\nt");
  collector.push("wo");
  assert.deepEqual(lines, ["one"]);

  collector.flush();
  assert.deepEqual(lines, ["one", "two"]);
});

test("failure summaries include sanitized recent logs and next steps", () => {
  const summary = buildFailureSummary({
    name: "web",
    command: "npm.cmd run dev --workspace apps/web",
    code: 3221226505,
    signal: null,
    recentLines: ["crashed at C:\\Users\\josue\\Pictures\\private.jpg token=abc"],
    repoRoot: "D:\\Software Development\\media-organizer"
  });

  assert(summary.some((line) => line.includes("3221226505 (0xC0000409)")));
  assert(summary.some((line) => line.includes("native process crash / fast fail")));
  assert(summary.some((line) => line.includes("crashed at <path> token=<redacted>")));
  assert(summary.some((line) => line.includes("npm run dev:web")));
});
