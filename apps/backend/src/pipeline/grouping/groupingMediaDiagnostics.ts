import { randomUUID } from 'node:crypto';

type ActiveOperation = { requestId: string; operation: string; sessionId: string; itemId: string; fileName: string; startedAt: number };
type OperationStatus = 'completed' | 'failed' | 'aborted';

const SLOW_OPERATION_MS = 5_000;
const MEDIA_TRACE_ENV = 'MEDIA_ORGANIZER_MEDIA_TRACE';
const activeOperations = new Map<string, ActiveOperation>();

const isVerboseMediaTraceEnabled = () => process.env[MEDIA_TRACE_ENV] === '1';

const formatOperationContext = (operation: ActiveOperation) =>
  `request=${operation.requestId} operation=${operation.operation} session=${operation.sessionId} item=${operation.itemId} file=${JSON.stringify(operation.fileName)}`;

export const beginGroupingMediaOperation = (input: Omit<ActiveOperation, 'requestId' | 'startedAt'>) => {
  const operation: ActiveOperation = { ...input, requestId: randomUUID(), startedAt: Date.now() };
  activeOperations.set(operation.requestId, operation);
  const verbose = isVerboseMediaTraceEnabled();
  if (verbose) {
    console.log(`[grouping-media] start ${formatOperationContext(operation)}`);
  }
  let finished = false;
  return {
    finish(status: OperationStatus, error?: unknown) {
      if (finished) return;
      finished = true;
      activeOperations.delete(operation.requestId);
      const durationMs = Date.now() - operation.startedAt;
      const detail = error ? ` error=${JSON.stringify(error instanceof Error ? error.message : String(error))}` : '';
      if (verbose) {
        console.log(`[grouping-media] finish request=${operation.requestId} status=${status} durationMs=${durationMs}${detail}`);
      } else if (status === 'failed') {
        console.error(`[grouping-media] failed ${formatOperationContext(operation)} durationMs=${durationMs}${detail}`);
      } else if (durationMs >= SLOW_OPERATION_MS) {
        console.warn(`[grouping-media] slow ${formatOperationContext(operation)} status=${status} durationMs=${durationMs}`);
      }
    }
  };
};

export const getActiveGroupingMediaOperations = () => [...activeOperations.values()].map((operation) => ({
  requestId: operation.requestId,
  operation: operation.operation,
  sessionId: operation.sessionId,
  itemId: operation.itemId,
  fileName: operation.fileName,
  durationMs: Date.now() - operation.startedAt
}));
