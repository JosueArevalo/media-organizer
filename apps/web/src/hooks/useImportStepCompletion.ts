import { useEffect, useState } from 'react';
import { isImportStepComplete, subscribeFolderSelectionChanges } from '../services/folder-selection.store';

export const useImportStepCompletion = () => {
  const [isComplete, setIsComplete] = useState(isImportStepComplete);

  useEffect(() => {
    const unsubscribe = subscribeFolderSelectionChanges(() => {
      setIsComplete(isImportStepComplete());
    });

    return unsubscribe;
  }, []);

  return isComplete;
};