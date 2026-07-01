import { useEffect, useState } from 'react';
import {
  loadCompressionSessionSnapshot,
  subscribeCompressionSessionChanges,
  type CompressionSessionSnapshot
} from '../services/compression-job.store';

export const useCompressionSessionState = () => {
  const [jobSnapshot, setJobSnapshot] = useState<CompressionSessionSnapshot>(loadCompressionSessionSnapshot);

  useEffect(() => {
    const unsubscribe = subscribeCompressionSessionChanges(() => {
      setJobSnapshot(loadCompressionSessionSnapshot());
    });

    return unsubscribe;
  }, []);

  return jobSnapshot;
};