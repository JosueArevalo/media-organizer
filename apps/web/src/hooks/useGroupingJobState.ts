import { useEffect, useState } from 'react';
import {
  loadGroupingSessionSnapshot,
  subscribeGroupingSessionChanges,
  type GroupingSessionSnapshot
} from '../services/grouping-job.store';

export const useGroupingSessionState = () => {
  const [jobSnapshot, setJobSnapshot] = useState<GroupingSessionSnapshot>(loadGroupingSessionSnapshot);

  useEffect(() => {
    const unsubscribe = subscribeGroupingSessionChanges(() => {
      setJobSnapshot(loadGroupingSessionSnapshot());
    });

    return unsubscribe;
  }, []);

  return jobSnapshot;
};
