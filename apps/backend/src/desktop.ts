import type { AddressInfo } from 'node:net';
import { createBackendServer } from './index.js';
import { requestAllCompressionProcessesPause } from './pipeline/compression/compressionProcessRegistry.js';

type DesktopParentMessage = { type?: string };

const server = createBackendServer();

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
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.on('error', (error) => {
  process.send?.({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address() as AddressInfo;
  process.env.PORT = String(address.port);
  process.send?.({ type: 'ready', port: address.port });
});
