export type BackendLifecycleStatus = 'starting' | 'online' | 'offline' | 'restarting';

export type BackendIncident = {
  occurredAt: string;
  message: string;
  exitCode: number | null;
  reason: string;
  details?: string;
};

export type BackendLifecycleSnapshot = {
  status: BackendLifecycleStatus;
  incident: BackendIncident | null;
};

export type BackendExit = { exitCode: number | null; reason?: string };

export type BackendHandle = {
  port: number;
  pid: number | null;
  requestShutdown: () => void;
  kill: () => void;
  onExit: (listener: (exit: BackendExit) => void) => () => void;
};

type BackendLifecycleOptions = {
  launch: () => Promise<BackendHandle>;
  log: (message: string) => void;
  stopTimeoutMs?: number;
};

export const createBackendLifecycle = ({ launch, log, stopTimeoutMs = 5000 }: BackendLifecycleOptions) => {
  let handle: BackendHandle | null = null;
  let unsubscribeExit: (() => void) | null = null;
  let expectedExit = false;
  let pendingRestart: Promise<BackendLifecycleSnapshot> | null = null;
  let snapshot: BackendLifecycleSnapshot = { status: 'starting', incident: null };
  const listeners = new Set<(next: BackendLifecycleSnapshot) => void>();

  const publish = (next: BackendLifecycleSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };

  const attachHandle = (nextHandle: BackendHandle) => {
    handle = nextHandle;
    unsubscribeExit = nextHandle.onExit((exit) => {
      if (handle !== nextHandle) return;
      handle = null;
      unsubscribeExit?.();
      unsubscribeExit = null;
      const wasExpected = expectedExit;
      expectedExit = false;
      log(`Backend process exited: pid=${nextHandle.pid ?? 'unknown'} code=${exit.exitCode ?? 'unknown'} reason=${exit.reason ?? 'exit'} expected=${String(wasExpected)}`);
      if (!wasExpected) {
        publish({
          status: 'offline',
          incident: {
            occurredAt: new Date().toISOString(),
            message: 'The backend stopped unexpectedly.',
            exitCode: exit.exitCode,
            reason: exit.reason ?? 'exit'
          }
        });
      }
    });
  };

  const start = async (status: 'starting' | 'restarting') => {
    publish({ status, incident: snapshot.incident });
    log(status === 'starting' ? 'Starting backend.' : 'Restarting backend.');
    try {
      const nextHandle = await launch();
      attachHandle(nextHandle);
      publish({ status: 'online', incident: null });
      log(`Backend is online: pid=${nextHandle.pid ?? 'unknown'}.`);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Backend start failed: ${message}`);
      publish({
        status: 'offline',
        incident: {
          occurredAt: new Date().toISOString(),
          message,
          exitCode: null,
          reason: 'start-failed'
        }
      });
      throw error;
    }
  };

  const stopCurrent = async () => {
    const current = handle;
    if (!current) return;
    expectedExit = true;
    const exited = new Promise<void>((resolve) => {
      const unsubscribe = current.onExit(() => {
        unsubscribe();
        resolve();
      });
    });
    current.requestShutdown();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(true), stopTimeoutMs);
      })
    ]);
    if (timeout) clearTimeout(timeout);
    if (timedOut) {
      log(`Backend did not stop within ${stopTimeoutMs}ms; terminating it.`);
      current.kill();
      await exited;
    }
  };

  return {
    getSnapshot: () => snapshot,
    getPort: () => handle?.port ?? null,
    subscribe(listener: (next: BackendLifecycleSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => start('starting'),
    restart() {
      if (pendingRestart) return pendingRestart;
      pendingRestart = (async () => {
        publish({ status: 'restarting', incident: snapshot.incident });
        log('Manual backend restart requested.');
        await stopCurrent();
        return await start('restarting');
      })().finally(() => {
        pendingRestart = null;
      });
      return pendingRestart;
    },
    reportUnresponsive(details?: string) {
      publish({
        status: snapshot.status,
        incident: {
          occurredAt: new Date().toISOString(),
          message: 'The backend health check stayed offline while the backend process was still running.',
          exitCode: null,
          reason: 'health-offline-timeout',
          details
        }
      });
    },
    async stop() {
      await stopCurrent();
    }
  };
};
