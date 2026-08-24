import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginGroupingMediaOperation,
  getActiveGroupingMediaOperations
} from '../src/pipeline/grouping/groupingMediaDiagnostics.js';

const traceEnvironmentKey = 'MEDIA_ORGANIZER_MEDIA_TRACE';

const captureConsole = () => {
  const messages = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  const originals = { log: console.log, warn: console.warn, error: console.error };
  console.log = (message?: unknown) => messages.log.push(String(message));
  console.warn = (message?: unknown) => messages.warn.push(String(message));
  console.error = (message?: unknown) => messages.error.push(String(message));
  return {
    messages,
    restore() {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  };
};

test('normal grouping media operations stay silent while remaining visible to the watchdog', () => {
  const consoleCapture = captureConsole();
  const previousTrace = process.env[traceEnvironmentKey];
  delete process.env[traceEnvironmentKey];
  try {
    const trace = beginGroupingMediaOperation({ operation: 'thumbnail', sessionId: 'session-1', itemId: 'item-1', fileName: 'photo.jpg' });
    assert.equal(getActiveGroupingMediaOperations()[0]?.fileName, 'photo.jpg');
    trace.finish('completed');

    const aborted = beginGroupingMediaOperation({ operation: 'poster', sessionId: 'session-1', itemId: 'item-2', fileName: 'clip.mp4' });
    aborted.finish('aborted');

    assert.equal(getActiveGroupingMediaOperations().length, 0);
    assert.deepEqual(consoleCapture.messages, { log: [], warn: [], error: [] });
  } finally {
    if (previousTrace === undefined) delete process.env[traceEnvironmentKey];
    else process.env[traceEnvironmentKey] = previousTrace;
    consoleCapture.restore();
  }
});

test('failed grouping media operations emit one contextual error', () => {
  const consoleCapture = captureConsole();
  const previousTrace = process.env[traceEnvironmentKey];
  delete process.env[traceEnvironmentKey];
  try {
    const trace = beginGroupingMediaOperation({ operation: 'thumbnail', sessionId: 'session-1', itemId: 'item-1', fileName: 'photo.jpg' });
    trace.finish('failed', new Error('broken image'));

    assert.equal(consoleCapture.messages.log.length, 0);
    assert.equal(consoleCapture.messages.warn.length, 0);
    assert.equal(consoleCapture.messages.error.length, 1);
    assert.match(consoleCapture.messages.error[0], /failed.*operation=thumbnail.*session=session-1.*item=item-1.*photo\.jpg.*broken image/);
  } finally {
    if (previousTrace === undefined) delete process.env[traceEnvironmentKey];
    else process.env[traceEnvironmentKey] = previousTrace;
    consoleCapture.restore();
  }
});

test('slow grouping media operations emit one contextual warning', (context) => {
  const consoleCapture = captureConsole();
  const previousTrace = process.env[traceEnvironmentKey];
  delete process.env[traceEnvironmentKey];
  let now = 1_000;
  context.mock.method(Date, 'now', () => now);
  try {
    const trace = beginGroupingMediaOperation({ operation: 'poster', sessionId: 'session-2', itemId: 'item-2', fileName: 'clip.mp4' });
    now += 5_000;
    trace.finish('aborted');

    assert.equal(consoleCapture.messages.log.length, 0);
    assert.equal(consoleCapture.messages.error.length, 0);
    assert.equal(consoleCapture.messages.warn.length, 1);
    assert.match(consoleCapture.messages.warn[0], /slow.*operation=poster.*session=session-2.*item=item-2.*status=aborted.*durationMs=5000/);
  } finally {
    if (previousTrace === undefined) delete process.env[traceEnvironmentKey];
    else process.env[traceEnvironmentKey] = previousTrace;
    consoleCapture.restore();
  }
});

test('verbose grouping media tracing restores start and finish logs', () => {
  const consoleCapture = captureConsole();
  const previousTrace = process.env[traceEnvironmentKey];
  process.env[traceEnvironmentKey] = '1';
  try {
    const trace = beginGroupingMediaOperation({ operation: 'poster', sessionId: 'session-3', itemId: 'item-3', fileName: 'clip.mov' });
    trace.finish('completed');

    assert.equal(consoleCapture.messages.log.length, 2);
    assert.match(consoleCapture.messages.log[0], /start.*operation=poster.*session=session-3.*item=item-3.*clip\.mov/);
    assert.match(consoleCapture.messages.log[1], /finish.*status=completed.*durationMs=/);
    assert.equal(consoleCapture.messages.warn.length, 0);
    assert.equal(consoleCapture.messages.error.length, 0);
  } finally {
    if (previousTrace === undefined) delete process.env[traceEnvironmentKey];
    else process.env[traceEnvironmentKey] = previousTrace;
    consoleCapture.restore();
  }
});
