import { randomUUID } from 'node:crypto';

type ActiveOperation = { requestId: string; operation: string; sessionId: string; itemId: string; fileName: string; startedAt: number };
const activeOperations = new Map<string, ActiveOperation>();

export const beginGroupingMediaOperation = (input: Omit<ActiveOperation, 'requestId' | 'startedAt'>) => {
  const operation: ActiveOperation = { ...input, requestId: randomUUID(), startedAt: Date.now() };
  activeOperations.set(operation.requestId, operation);
  console.log(`[grouping-media] start request=${operation.requestId} operation=${operation.operation} session=${operation.sessionId} item=${operation.itemId} file=${JSON.stringify(operation.fileName)}`);
  let finished = false;
  return {
    finish(status: 'completed' | 'failed' | 'aborted', error?: unknown) {
      if (finished) return;
      finished = true;
      activeOperations.delete(operation.requestId);
      const detail = error ? ` error=${JSON.stringify(error instanceof Error ? error.message : String(error))}` : '';
      console.log(`[grouping-media] finish request=${operation.requestId} status=${status} durationMs=${Date.now() - operation.startedAt}${detail}`);
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
