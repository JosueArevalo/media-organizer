import { useEffect, useState } from 'react';
import {
  loadExportJobSnapshot,
  subscribeExportJobChanges,
  type ExportJobSnapshot
} from '../services/export-job.store';

export const useExportJobState = () => {
  const [snapshot, setSnapshot] = useState<ExportJobSnapshot>(loadExportJobSnapshot);

  useEffect(() => {
    const unsubscribe = subscribeExportJobChanges(() => {
      setSnapshot(loadExportJobSnapshot());
    });

    return unsubscribe;
  }, []);

  return snapshot;
};
