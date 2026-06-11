import { spawn, type ChildProcess } from 'node:child_process';

const activeCompressionProcesses = new Map<string, ChildProcess>();
const pauseRequestedSessions = new Set<string>();

const killProcessTree = (child: ChildProcess) => {
  if (child.killed) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });

    killer.on('error', () => {
      child.kill();
    });
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 2000).unref();
};

export const registerCompressionProcess = (sessionId: string, child: ChildProcess) => {
  activeCompressionProcesses.set(sessionId, child);

  if (pauseRequestedSessions.has(sessionId)) {
    killProcessTree(child);
  }
};

export const unregisterCompressionProcess = (sessionId: string, child: ChildProcess) => {
  if (activeCompressionProcesses.get(sessionId) === child) {
    activeCompressionProcesses.delete(sessionId);
  }
};

export const requestCompressionProcessPause = (sessionId: string) => {
  pauseRequestedSessions.add(sessionId);
  const child = activeCompressionProcesses.get(sessionId);

  if (child) {
    killProcessTree(child);
  }
};

export const isCompressionPauseRequested = (sessionId: string) => pauseRequestedSessions.has(sessionId);

export const clearCompressionPauseRequest = (sessionId: string) => {
  pauseRequestedSessions.delete(sessionId);
};
