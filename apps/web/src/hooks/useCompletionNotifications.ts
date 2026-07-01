import { useEffect, useRef } from 'react';
import { useCompressionSessionState } from './useCompressionJobState';
import { useExportJobState } from './useExportJobState';
import { useTranslation } from '../i18n';
import { notifyCompletion } from '../services/completion-notification.service';
import type { ExportJobSnapshot } from '../services/export-job.store';

const getExportCompletionKey = (exportJobState: ExportJobSnapshot) =>
  exportJobState.backendJobId &&
  exportJobState.completedAt &&
  (exportJobState.totalItems ?? 0) > 0
    ? `${exportJobState.backendJobId}:${exportJobState.completedAt}`
    : null;

const getCompressionCompletionKey = (compressionSessionState: ReturnType<typeof useCompressionSessionState>) =>
  compressionSessionState.backendSessionId &&
  compressionSessionState.completedAt &&
  (compressionSessionState.status === 'completed' || compressionSessionState.status === 'failed')
    ? `${compressionSessionState.backendSessionId}:${compressionSessionState.status}:${compressionSessionState.completedAt}`
    : null;

export const useCompletionNotifications = () => {
  const { t } = useTranslation();
  const compressionSessionState = useCompressionSessionState();
  const networkExportJobState = useExportJobState('network-folder');
  const googlePhotosExportJobState = useExportJobState('google-photos');
  const previousCompressionStatusRef = useRef(compressionSessionState.status);
  const previousCompressionCompletionKeyRef = useRef(getCompressionCompletionKey(compressionSessionState));
  const previousExportStatusRef = useRef({
    'network-folder': networkExportJobState.status,
    'google-photos': googlePhotosExportJobState.status
  });
  const previousExportCompletionKeyRef = useRef({
    'network-folder': getExportCompletionKey(networkExportJobState),
    'google-photos': getExportCompletionKey(googlePhotosExportJobState)
  });

  useEffect(() => {
    const previousStatus = previousCompressionStatusRef.current;
    const previousCompletionKey = previousCompressionCompletionKeyRef.current;
    const completionKey = getCompressionCompletionKey(compressionSessionState);
    previousCompressionStatusRef.current = compressionSessionState.status;
    previousCompressionCompletionKeyRef.current = completionKey;
    const isTerminalCompressionStatus =
      compressionSessionState.status === 'completed' ||
      compressionSessionState.status === 'failed';

    if (
      previousStatus !== compressionSessionState.status &&
      isTerminalCompressionStatus &&
      compressionSessionState.backendSessionId &&
      compressionSessionState.completedAt &&
      previousCompletionKey !== completionKey
    ) {
      void notifyCompletion('compressionCompleted', {
        title: t('notifications.compressionCompleted.title'),
        body: compressionSessionState.status === 'failed'
          ? t('notifications.compressionCompletedWithWarnings.body')
          : t('notifications.compressionCompleted.body'),
        dedupeKey: `compression:${compressionSessionState.backendSessionId}:${compressionSessionState.status}:${compressionSessionState.completedAt}`
      });
    }
  }, [
    compressionSessionState.backendSessionId,
    compressionSessionState.completedAt,
    compressionSessionState.status,
    t
  ]);

  useEffect(() => {
    for (const exportJobState of [networkExportJobState, googlePhotosExportJobState]) {
      if (!exportJobState.targetType) continue;

      const previousStatus = previousExportStatusRef.current[exportJobState.targetType];
      const previousCompletionKey = previousExportCompletionKeyRef.current[exportJobState.targetType];
      const completionKey = getExportCompletionKey(exportJobState);
      previousExportStatusRef.current[exportJobState.targetType] = exportJobState.status;
      previousExportCompletionKeyRef.current[exportJobState.targetType] = completionKey;

      if (
        previousStatus !== 'completed' &&
        exportJobState.status === 'completed' &&
        exportJobState.backendJobId &&
        exportJobState.completedAt &&
        previousCompletionKey !== completionKey &&
        (exportJobState.totalItems ?? 0) > 0
      ) {
        void notifyCompletion('exportCompleted', {
          title: t('notifications.exportCompleted.title'),
          body: t('notifications.exportCompleted.body'),
          dedupeKey: `export:${exportJobState.backendJobId}:${exportJobState.completedAt}`
        });
      }
    }
  }, [
    googlePhotosExportJobState,
    networkExportJobState,
    t
  ]);
};
