import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackendLifecycle, type BackendExit, type BackendHandle } from '../src/backendLifecycle.js';

const createHandle = (port: number, exits: BackendExit[] = []) => {
  const listeners = new Set<(exit: BackendExit) => void>();
  let killed = false;
  const handle: BackendHandle & { emitExit: (exit: BackendExit) => void; wasKilled: () => boolean } = {
    port,
    pid: port,
    requestShutdown: () => {
      const exit = exits.shift();
      if (exit) queueMicrotask(() => handle.emitExit(exit));
    },
    kill: () => {
      killed = true;
      queueMicrotask(() => handle.emitExit({ exitCode: 1, reason: 'killed' }));
    },
    onExit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitExit(exit) {
      for (const listener of [...listeners]) listener(exit);
    },
    wasKilled: () => killed
  };
  return handle;
};

test('backend lifecycle reports unexpected exits and restarts on a new port', async () => {
  const first = createHandle(4100, [{ exitCode: 0 }]);
  const second = createHandle(4200);
  const launches = [first, second];
  const lifecycle = createBackendLifecycle({ launch: async () => launches.shift()!, log: () => undefined });
  await lifecycle.start();
  assert.equal(lifecycle.getPort(), 4100);
  first.emitExit({ exitCode: 7, reason: 'crashed' });
  assert.equal(lifecycle.getSnapshot().status, 'offline');
  assert.equal(lifecycle.getSnapshot().incident?.exitCode, 7);
  await lifecycle.restart();
  assert.equal(lifecycle.getSnapshot().status, 'online');
  assert.equal(lifecycle.getPort(), 4200);
});

test('backend restart is shared and force-kills a blocked process after timeout', async () => {
  const blocked = createHandle(4100);
  const replacement = createHandle(4200);
  let launches = 0;
  const lifecycle = createBackendLifecycle({
    launch: async () => (++launches === 1 ? blocked : replacement),
    log: () => undefined,
    stopTimeoutMs: 5
  });
  await lifecycle.start();
  const firstRestart = lifecycle.restart();
  const secondRestart = lifecycle.restart();
  assert.equal(firstRestart, secondRestart);
  await firstRestart;
  assert.equal(blocked.wasKilled(), true);
  assert.equal(launches, 2);
});

test('backend lifecycle keeps a failed restart offline with an incident', async () => {
  const first = createHandle(4100, [{ exitCode: 0 }]);
  let launches = 0;
  const lifecycle = createBackendLifecycle({
    launch: async () => {
      if (++launches === 1) return first;
      throw new Error('launch failed');
    },
    log: () => undefined
  });
  await lifecycle.start();
  await assert.rejects(lifecycle.restart(), /launch failed/);
  assert.equal(lifecycle.getSnapshot().status, 'offline');
  assert.match(lifecycle.getSnapshot().incident?.message ?? '', /launch failed/);
});

test('backend lifecycle records sustained health outages as incidents without changing status', async () => {
  const handle = createHandle(4100);
  const lifecycle = createBackendLifecycle({ launch: async () => handle, log: () => undefined });
  await lifecycle.start();
  lifecycle.reportUnresponsive('Active grouping media operations: request=abc operation=media file="clip.mp4"');
  const snapshot = lifecycle.getSnapshot();
  assert.equal(snapshot.status, 'online');
  assert.equal(snapshot.incident?.reason, 'health-offline-timeout');
  assert.match(snapshot.incident?.details ?? '', /clip\.mp4/);
});
