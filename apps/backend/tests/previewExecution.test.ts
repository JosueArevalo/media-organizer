import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTaskQueue, runCommand } from '../src/pipeline/grouping/previewExecution.js';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('preview queue runs at most two tasks concurrently', async () => {
  const run = createTaskQueue(2);
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 6 }, () => run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(15);
    active -= 1;
  })));
  assert.equal(maximum, 2);
});

test('async preview commands preserve event-loop responsiveness', async () => {
  const startedAt = Date.now();
  const command = runCommand({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.exit(0), 200)'],
    timeoutMs: 2000
  });
  await delay(30);
  assert.ok(Date.now() - startedAt < 150);
  assert.equal((await command).exitCode, 0);
});

test('preview commands return errors and terminate on timeout', async () => {
  const failed = await runCommand({
    command: process.execPath,
    args: ['-e', 'console.error("bad preview"); process.exit(3)'],
    timeoutMs: 2000
  });
  assert.equal(failed.exitCode, 3);
  assert.match(failed.stderr, /bad preview/);
  await assert.rejects(runCommand({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 30
  }), /timed out/);
});
