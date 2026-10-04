import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { useExportJobState } from './useExportJobState';
import { resetExportJobSnapshot, saveExportJobSnapshot } from '../services/export-job.store';
import {
  createExportJobRequest, getExportJobRequest, getExportProgressRequest, listExportJobsRequest,
  pauseExportJobRequest, previewExportRequest, retryExportItemRequest, retryFailedExportItemsRequest,
  startExportJobRequest, updateExportJobScopeRequest,
  type ExportJobSnapshot, type ExportPreview, type ExportProgress
} from '../services/export.service';
import {
  createExportItemState, deriveExportGroupView, mergeExportProgressItems, type ExportItemState
} from '../services/export-progress-view';
import {
  getExportDestinationKey, getExportJobGroupSelection, getExportJobTarget, withExportGroupSelection,
  type ExportWorkflowAdapter
} from '../services/export-workflow';

type Options = {
  sourceRoot: string;
  groupingSessionId: string | null;
  adapter: ExportWorkflowAdapter;
  enabled?: boolean;
  fixedJobId?: string;
  onJobChange?: () => void;
};

type WorkflowState = {
  key: string; preview: ExportPreview | null; job: ExportJobSnapshot | null;
  progress: ExportProgress | null; items: ExportItemState; selected: Set<string>; expanded: Set<string>;
};
const emptyState = (key: string): WorkflowState => ({ key, preview: null, job: null, progress: null, items: {}, selected: new Set(), expanded: new Set() });

export const useExportWorkflow = (options: Options) => {
  const { t } = useTranslation();
  const exportJobState = useExportJobState(options.adapter.target.type, {
    groupingSessionId: options.groupingSessionId, sourceRoot: options.sourceRoot
  });
  const key = JSON.stringify([options.adapter.target.type, options.sourceRoot, options.groupingSessionId,
    getExportDestinationKey(options.adapter.target), options.fixedJobId ?? null]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tokenRef = useRef({ key, version: 0 });
  if (tokenRef.current.key !== key) tokenRef.current = { key, version: tokenRef.current.version + 1 };
  const [state, setState] = useState(() => emptyState(key));
  const current = state.key === key ? state : emptyState(key);
  const stateRef = useRef(current);
  stateRef.current = current;
  const snapshotRef = useRef(exportJobState);
  snapshotRef.current = exportJobState;
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isUpdatingScope, setIsUpdatingScope] = useState(false);
  const [isScopeConfirmed, setIsScopeConfirmed] = useState(true);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const jobIdRef = useRef<string | null>(null);
  const scopeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationRef = useRef(false);
  const progressRequestRef = useRef<{ token: typeof tokenRef.current; jobId: string; promise: Promise<ExportProgress> } | null>(null);
  const reconciliationKeysRef = useRef(new Set<string>());
  const isCurrent = useCallback((token: typeof tokenRef.current) => tokenRef.current === token, []);
  const setError = useCallback((message: string | null) => {
    setErrorState(message ? { key: tokenRef.current.key, message } : null);
  }, []);

  const syncSnapshot = useCallback((progress: ExportProgress) => {
    const opt = optionsRef.current;
    if (opt.fixedJobId) return;
    const previous = snapshotRef.current;
    const sameJob = previous.backendJobId === progress.jobId;
    saveExportJobSnapshot({
      backendJobId: progress.jobId, status: progress.status, sourceRoot: opt.sourceRoot,
      groupingSessionId: opt.groupingSessionId, destinationPath: opt.adapter.destinationLabel,
      googlePhotosAccountId: opt.adapter.target.type === 'google-photos' ? opt.adapter.target.accountId : null,
      targetType: opt.adapter.target.type, totalItems: progress.total,
      startedAt: sameJob ? previous.startedAt ?? Date.now() : Date.now(),
      completedAt: ['completed', 'failed', 'cancelled'].includes(progress.status)
        ? sameJob ? previous.completedAt ?? Date.now() : Date.now() : null,
      errorMessage: progress.failed ? t('export.completedWithErrors', { count: progress.failed }) : null,
      updatedAt: Date.now()
    });
  }, [t]);

  const applyProgress = useCallback((progress: ExportProgress, token: typeof tokenRef.current) => {
    if (!isCurrent(token) || jobIdRef.current !== progress.jobId) return null;
    setState((previous) => previous.key !== token.key ? previous : {
      ...previous, progress, items: mergeExportProgressItems(previous.items, progress.recentItems)
    });
    syncSnapshot(progress);
    return progress;
  }, [isCurrent, syncSnapshot]);

  const requestProgress = useCallback(async (jobId: string, token: typeof tokenRef.current, fresh = false) => {
    const existing = progressRequestRef.current;
    if (existing?.jobId === jobId && existing.token === token) {
      if (!fresh) return existing.promise;
      try { await existing.promise; } catch { /* A post-mutation read still needs its own request. */ }
      if (progressRequestRef.current === existing) progressRequestRef.current = null;
    }
    const request = { token, jobId, promise: getExportProgressRequest(jobId) };
    progressRequestRef.current = request;
    try { return await request.promise; }
    finally { if (progressRequestRef.current === request) progressRequestRef.current = null; }
  }, []);

  const loadPreview = useCallback(async (token: typeof tokenRef.current, job: ExportJobSnapshot | null, restoreSelection: boolean) => {
    const opt = optionsRef.current;
    const preview = await previewExportRequest({
      sourceRoot: opt.sourceRoot, groupingSessionId: opt.groupingSessionId,
      target: opt.adapter.target, jobId: job?.job.id,
      jobOnly: Boolean(opt.fixedJobId && job && ['completed', 'failed', 'cancelled'].includes(job.job.status))
    });
    if (!isCurrent(token)) return null;
    setState((previous) => ({
      ...(previous.key === token.key ? previous : emptyState(token.key)), preview,
      items: createExportItemState(preview),
      selected: getExportJobGroupSelection(preview, restoreSelection ? job : null)
    }));
    return preview;
  }, [isCurrent]);

  useEffect(() => {
    const token = tokenRef.current;
    let cancelled = false;
    setState(emptyState(key));
    jobIdRef.current = null;
    setErrorState(null);
    setIsPreviewing(false); setIsStarting(false); setIsUpdatingScope(false); setRetryingItemId(null);
    setIsScopeConfirmed(true);
    mutationRef.current = false;
    scopeQueueRef.current = Promise.resolve();
    reconciliationKeysRef.current = new Set();
    setIsRestoring(true);
    const restore = async () => {
      const opt = optionsRef.current;
      if (!opt.sourceRoot || !getExportDestinationKey(opt.adapter.target)) return;
      let job: ExportJobSnapshot | null;
      if (opt.fixedJobId) {
        job = await getExportJobRequest(opt.fixedJobId);
      } else {
        const jobs = await listExportJobsRequest({ targetType: opt.adapter.target.type,
          groupingSessionId: opt.groupingSessionId, sourceRoot: opt.sourceRoot });
        const matches = jobs.filter((candidate) => {
          const target = getExportJobTarget(candidate);
          return target && getExportDestinationKey(target) === getExportDestinationKey(opt.adapter.target);
        });
        const resumable = matches.find((candidate) => ['running', 'paused', 'draft'].includes(candidate.job.status));
        const saved = matches.find((candidate) => candidate.job.id === snapshotRef.current.backendJobId);
        job = resumable ?? saved ?? matches[0] ?? null;
        // Executions predating history linkage can still be restored from their provider snapshot.
        const savedSnapshot = snapshotRef.current;
        if (!job && savedSnapshot.backendJobId && savedSnapshot.sourceRoot === opt.sourceRoot
          && savedSnapshot.groupingSessionId === opt.groupingSessionId) {
          const candidate = await getExportJobRequest(savedSnapshot.backendJobId);
          const target = getExportJobTarget(candidate);
          if (target && getExportDestinationKey(target) === getExportDestinationKey(opt.adapter.target)) job = candidate;
        }
      }
      if (cancelled || !isCurrent(token) || !job) return;
      const target = getExportJobTarget(job);
      if (job.job.sourceRoot !== opt.sourceRoot || !target || target.type !== opt.adapter.target.type
        || getExportDestinationKey(target) !== getExportDestinationKey(opt.adapter.target)) return;
      jobIdRef.current = job.job.id;
      if (['completed', 'failed', 'cancelled'].includes(job.job.status)) {
        reconciliationKeysRef.current.add(`${job.job.id}:${job.job.status}`);
      }
      setState((previous) => ({ ...previous, job }));
      setIsPreviewing(true);
      await loadPreview(token, job, ['running', 'paused', 'draft'].includes(job.job.status));
    };
    void restore().catch((error) => {
      if (!cancelled && isCurrent(token)) setError(error instanceof Error ? error.message : t('export.progressError'));
    }).finally(() => {
      if (!cancelled && isCurrent(token)) { setIsRestoring(false); setIsPreviewing(false); }
    });
    return () => {
      cancelled = true;
      if (isCurrent(token)) tokenRef.current = { key, version: token.version + 1 };
    };
  }, [key, isCurrent, loadPreview, setError, t]);

  const backendJobId = current.job?.job.id ?? null;
  const status = current.progress?.status ?? current.job?.job.status;
  const isRunning = status === 'running';
  const isPaused = status === 'paused' || status === 'draft';
  const isWaitingForRunner = isPaused && Boolean(current.progress?.runnerActive);
  useEffect(() => {
    if (!backendJobId) return;
    const token = tokenRef.current;
    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      try {
        const progress = await requestProgress(backendJobId, token);
        if (cancelled || !isCurrent(token)) return;
        applyProgress(progress, token);
        if (progress.status === 'running' || progress.runnerActive) timeoutId = window.setTimeout(() => void poll(), 1000);
      } catch (error) {
        if (cancelled || !isCurrent(token)) return;
        setError(error instanceof Error ? error.message : t('export.progressError'));
        if (isRunning || isWaitingForRunner) timeoutId = window.setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [backendJobId, key, isRunning, isWaitingForRunner, applyProgress, requestProgress, isCurrent, setError, t]);

  useEffect(() => {
    if (!backendJobId || !status || !['completed', 'failed', 'cancelled'].includes(status)) return;
    const token = tokenRef.current;
    const reconciliationKey = `${backendJobId}:${status}`;
    if (reconciliationKeysRef.current.has(reconciliationKey)) return;
    reconciliationKeysRef.current.add(reconciliationKey);
    setIsPreviewing(true);
    void getExportJobRequest(backendJobId).then(async (job) => {
      if (!isCurrent(token)) return;
      await loadPreview(token, job, false);
      if (isCurrent(token)) optionsRef.current.onJobChange?.();
    }).catch((error) => {
      if (isCurrent(token)) setError(error instanceof Error ? error.message : t('export.progressError'));
    }).finally(() => { if (isCurrent(token)) setIsPreviewing(false); });
  }, [backendJobId, status, key, isCurrent, loadPreview, setError, t]);

  const groups = (current.preview?.groups ?? []).map((group) => deriveExportGroupView({ group,
    itemState: current.items, groupProgress: current.progress?.groupProgress?.find((entry) => entry.groupId === group.id), isPaused }));
  const selectedPending = groups.filter((group) => !group.isComplete && current.selected.has(group.id));
  const selectable = (groupId: string) => {
    const group = groups.find((entry) => entry.id === groupId);
    const started = group && (group.selectionLocked || group.completedCount + group.skippedCount + group.failedCount > 0
      || group.items.some((item) => ['running', 'paused'].includes(item.status))
      || current.preview?.groups.find((entry) => entry.id === groupId)?.items.some((item) => (item.attemptCount ?? 0) > 0));
    return Boolean(group && !group.isComplete && !isRunning && !isStarting && !isWaitingForRunner && (!isPaused || !started));
  };

  const toggleSelection = (groupId: string) => {
    if (!selectable(groupId)) return;
    const token = tokenRef.current;
    const next = new Set(stateRef.current.selected);
    next.has(groupId) ? next.delete(groupId) : next.add(groupId);
    stateRef.current = { ...stateRef.current, selected: next };
    setState((previous) => ({ ...previous, selected: next }));
    if (!isPaused || !backendJobId) return;
    setIsUpdatingScope(true);
    setIsScopeConfirmed(false);
    scopeQueueRef.current = scopeQueueRef.current.then(async () => {
      if (!isCurrent(token)) return;
      try {
        const job = await updateExportJobScopeRequest(backendJobId, [...next]);
        if (!isCurrent(token)) return;
        setState((previous) => ({ ...previous, job }));
        applyProgress(await requestProgress(backendJobId, token, true), token);
        setError(null);
      } catch (error) {
        if (!isCurrent(token)) return;
        // Reconcile with the backend even if the mutation response was lost.
        try {
          const job = await getExportJobRequest(backendJobId);
          if (isCurrent(token)) await loadPreview(token, job, true);
        } catch { /* Keep the original failure visible if recovery is also unavailable. */ }
        if (isCurrent(token)) setError(error instanceof Error ? error.message : t('export.progressError'));
      }
    });
    const queued = scopeQueueRef.current;
    void queued.finally(() => {
      if (!isCurrent(token) || scopeQueueRef.current !== queued) return;
      void getExportJobRequest(backendJobId).then((job) => {
        if (!isCurrent(token) || scopeQueueRef.current !== queued) return;
        const preview = stateRef.current.preview;
        if (preview) {
          const selected = getExportJobGroupSelection(preview, job);
          stateRef.current = { ...stateRef.current, selected, job };
          setState((previous) => ({ ...previous, selected, job }));
          setIsScopeConfirmed(true);
        }
      }).catch((error) => { if (isCurrent(token)) setError(String(error)); })
        .finally(() => { if (isCurrent(token) && scopeQueueRef.current === queued) setIsUpdatingScope(false); });
    });
  };

  const handlePreview = async () => {
    if (isRunning || isPaused || isPreviewing || isRestoring || !optionsRef.current.sourceRoot) return;
    const token = tokenRef.current;
    setIsPreviewing(true);
    try {
      await optionsRef.current.adapter.prepare?.();
      if (!isCurrent(token)) return;
      await loadPreview(token, null, false);
      setError(null);
    } catch (error) { if (isCurrent(token)) setError(error instanceof Error ? error.message : t('export.progressError')); }
    finally { if (isCurrent(token)) setIsPreviewing(false); }
  };

  const activateJob = useCallback((job: ExportJobSnapshot, token: typeof tokenRef.current) => {
    if (!isCurrent(token)) return;
    jobIdRef.current = job.job.id;
    setState((previous) => ({ ...previous, job, progress: null }));
    applyProgress({ jobId: job.job.id, status: job.job.status, total: job.job.totalItems,
      completed: job.job.completedItems, failed: job.job.failedItems, skipped: job.job.skippedItems,
      pending: job.job.totalItems - job.job.completedItems - job.job.failedItems - job.job.skippedItems,
      recentItems: job.recentItems }, token);
  }, [applyProgress, isCurrent]);

  const runAction = async (action: (token: typeof tokenRef.current) => Promise<void>) => {
    if (mutationRef.current) return;
    const token = tokenRef.current;
    mutationRef.current = true; setIsStarting(true);
    try {
      await scopeQueueRef.current;
      if (!isCurrent(token)) return;
      await optionsRef.current.adapter.prepare?.();
      if (!isCurrent(token)) return;
      await action(token);
      if (isCurrent(token)) { setError(null); optionsRef.current.onJobChange?.(); }
    } catch (error) { if (isCurrent(token)) setError(error instanceof Error ? error.message : t('export.startError')); }
    finally { if (isCurrent(token)) { mutationRef.current = false; setIsStarting(false); setRetryingItemId(null); } }
  };

  const handleStart = async (groupId?: string) => {
    if (!canStart) return;
    await runAction(async (token) => {
      const opt = optionsRef.current;
      const selected = groupId ? [groupId] : selectedPending.map((group) => group.id);
      if (!selected.length) return;
      let job = isPaused && backendJobId ? await getExportJobRequest(backendJobId) : await createExportJobRequest({
        name: groupId ? opt.adapter.groupJobName?.(groups.find((group) => group.id === groupId)?.label ?? '') ?? opt.adapter.defaultJobName : opt.adapter.defaultJobName,
        sourceRoot: opt.sourceRoot, groupingSessionId: opt.groupingSessionId ?? undefined,
        target: withExportGroupSelection(opt.adapter.target, selected)
      });
      if (!isCurrent(token)) return;
      if (job.job.totalItems === 0) { await loadPreview(token, job, false); return; }
      activateJob(job, token);
      if (groupId) setState((previous) => ({ ...previous, expanded: new Set([...previous.expanded, groupId]) }));
      job = await startExportJobRequest(job.job.id);
      if (!isCurrent(token)) return;
      activateJob(job, token);
      applyProgress(await requestProgress(job.job.id, token, true), token);
    });
  };

  const handlePause = async () => {
    if (!backendJobId || !isRunning) return;
    const token = tokenRef.current;
    try {
      const job = await pauseExportJobRequest(backendJobId);
      activateJob(job, token);
      applyProgress(await requestProgress(backendJobId, token, true), token);
      if (isCurrent(token)) { setError(null); optionsRef.current.onJobChange?.(); }
    } catch (error) { if (isCurrent(token)) setError(error instanceof Error ? error.message : t('export.pauseError')); }
  };

  const handleRetryFailed = async () => {
    if (!backendJobId || isRunning || isWaitingForRunner || isUpdatingScope || !isScopeConfirmed) return;
    await runAction(async (token) => {
      const job = await retryFailedExportItemsRequest(backendJobId);
      activateJob(job, token);
      applyProgress(await requestProgress(backendJobId, token, true), token);
    });
  };

  const handleRetryItem = async (itemId: string, itemJobId?: string | null) => {
    const jobId = itemJobId ?? backendJobId;
    if (!jobId || isRunning || isWaitingForRunner || isUpdatingScope || !isScopeConfirmed) return;
    setRetryingItemId(itemId);
    await runAction(async (token) => {
      const job = await retryExportItemRequest(jobId, itemId);
      if (!isCurrent(token)) return;
      activateJob(job, token);
      await startExportJobRequest(jobId);
      applyProgress(await requestProgress(jobId, token, true), token);
    });
  };

  useEffect(() => {
    if (!isRunning && !isPaused) return;
    const active = current.progress?.groupProgress?.find((group) => group.status === 'running')
      ?? current.progress?.groupProgress?.find((group) => group.completed + group.skipped < group.total);
    if (active) setState((previous) => previous.expanded.size ? previous : { ...previous, expanded: new Set([active.groupId]) });
  }, [current.progress, isRunning, isPaused]);

  const reset = () => {
    tokenRef.current = { key, version: tokenRef.current.version + 1 };
    jobIdRef.current = null; setState(emptyState(key)); setErrorState(null);
    setIsPreviewing(false); setIsStarting(false); setIsUpdatingScope(false); setRetryingItemId(null);
    setIsScopeConfirmed(true);
    scopeQueueRef.current = Promise.resolve(); mutationRef.current = false;
    reconciliationKeysRef.current.clear();
    if (!options.fixedJobId) resetExportJobSnapshot(options.adapter.target.type);
  };
  const canStart = Boolean(options.sourceRoot && (options.enabled !== false || isPaused) && current.preview
    && !isRunning && !isStarting && !isWaitingForRunner && !isUpdatingScope && isScopeConfirmed && !isPreviewing && !isRestoring && selectedPending.length);
  return {
    preview: current.preview, groups, progress: current.progress, job: current.job, backendJobId,
    selectedGroupIds: current.selected, expandedGroupIds: current.expanded,
    isRunning, isPaused, isWaitingForRunner, isPreviewing, isStarting, isUpdatingScope, isScopeConfirmed, isRestoring, retryingItemId,
    error: errorState?.key === key ? errorState.message : null, setError, reset, canStart,
    canPreview: Boolean(options.sourceRoot && options.enabled !== false && !isRunning && !isPaused
      && !isPreviewing && !isRestoring && (!current.preview || options.adapter.allowPreviewRefresh)),
    selectedPendingCount: selectedPending.length,
    excludedPendingCount: groups.filter((group) => !group.isComplete).length - selectedPending.length,
    selectable, toggleSelection,
    toggleExpanded: (id: string) => setState((previous) => {
      const expanded = new Set(previous.expanded); expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      return { ...previous, expanded };
    }),
    handlePreview, handleStart, handlePause, handleRetryFailed, handleRetryItem
  };
};

export type ExportWorkflow = ReturnType<typeof useExportWorkflow>;
