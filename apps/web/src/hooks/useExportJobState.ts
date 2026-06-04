import { useEffect, useState } from 'react';
import {
  loadExportJobSnapshot,
  subscribeExportJobChanges,
  type ExportJobSnapshot,
  type ExportJobSnapshotContext
} from '../services/export-job.store';
import type { ExportTargetType } from '../services/export.service';

export const useExportJobState = (targetType?: ExportTargetType, context?: ExportJobSnapshotContext) => {
  const groupingSessionId = context?.groupingSessionId ?? null;
  const sourceRoot = context?.sourceRoot ?? null;
  const loadSnapshot = () => loadExportJobSnapshot(targetType, { groupingSessionId, sourceRoot });
  const [snapshot, setSnapshot] = useState<ExportJobSnapshot>(loadSnapshot);

  useEffect(() => {
    setSnapshot(loadSnapshot());
    const unsubscribe = subscribeExportJobChanges(() => {
      setSnapshot(loadSnapshot());
    });

    return unsubscribe;
  }, [groupingSessionId, sourceRoot, targetType]);

  return snapshot;
};
