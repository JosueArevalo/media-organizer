import { useEffect, useState } from 'react';
import {
  loadCompressionJobSnapshot,
  subscribeCompressionJobChanges,
  type CompressionJobSnapshot
} from '../services/compression-job.store';

export const useCompressionJobState = () => {
  const [jobSnapshot, setJobSnapshot] = useState<CompressionJobSnapshot>(loadCompressionJobSnapshot);

  useEffect(() => {
    const unsubscribe = subscribeCompressionJobChanges(() => {
      setJobSnapshot(loadCompressionJobSnapshot());
    });

    return unsubscribe;
  }, []);

  return jobSnapshot;
};