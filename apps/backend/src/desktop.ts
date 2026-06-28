import type { AddressInfo } from 'node:net';
import { createBackendServer } from './index.js';
import { requestAllCompressionProcessesPause } from './pipeline/compression/compressionProcessRegistry.js';
import { getActiveGroupingMediaOperations } from './pipeline/grouping/groupingMediaDiagnostics.js';

type DesktopParentMessage = { type?: string };
type UtilityParentPort = {
  on: (event: 'message', listener: (message: { data?: DesktopParentMessage } | DesktopParentMessage) => void) => void;
  postMessage: (message: unknown) => void;
};

const utilityParentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
const sendParentMessage = (message: unknown) => {
  if (utilityParentPort) {
    utilityParentPort.postMessage(message);
    return;
  }

  process.send?.(message);
};

const server = createBackendServer();
let expectedWatchdogAt = Date.now() + 1000;
setInterval(() => {
  const now = Date.now();
  const lagMs = now - expectedWatchdogAt;
  expectedWatchdogAt = now + 1000;
  if (lagMs >= 5000) {
    console.error(`[backend-watchdog] event-loop-lag durationMs=${lagMs} activeGroupingMedia=${JSON.stringify(getActiveGroupingMediaOperations())}`);
  }
}, 1000).unref();

const shutdown = () => {
  requestAllCompressionProcessesPause();
  setTimeout(() => server.close(() => process.exit(0)), 500).unref();
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('message', (message: DesktopParentMessage) => {
  if (message?.type === 'shutdown') {
    shutdown();
  }
});
utilityParentPort?.on('message', (event) => {
  const message: DesktopParentMessage | undefined = 'data' in event
    ? event.data
    : event as DesktopParentMessage;
  if (message?.type === 'shutdown') {
    shutdown();
  }
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.on('error', (error) => {
  sendParentMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address() as AddressInfo;
  process.env.PORT = String(address.port);
  sendParentMessage({ type: 'ready', port: address.port });
});
