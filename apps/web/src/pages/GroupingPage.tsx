import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import {
  completeGroupingSession,
  failGroupingSession,
  pauseGroupingSession,
  resetGroupingSession,
  resumeGroupingSession,
  startGroupingSession
} from '../services/grouping-job.store';
import {
  getGroupingProgressRequest,
  getGroupingSessionRequest,
  pauseGroupingSessionRequest,
  resumeGroupingSessionRequest,
  startGroupingSessionRequest,
  type GroupingProgressApiResponse
} from '../services/grouping.service';

const formatStatus = (status: string) => {
  const statusLabels: Record<string, string> = {
    idle: 'Not started',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled'
  };

  return statusLabels[status] ?? status;
};

const getFileName = (sourcePath: string) => sourcePath.split(/[\\/]/).pop() || sourcePath;

export const GroupingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const groupingSessionState = useGroupingSessionState();
  const [progressData, setProgressData] = useState<GroupingProgressApiResponse | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isStartingGrouping, setIsStartingGrouping] = useState(false);
  const [autoRename, setAutoRename] = useState(true);
  const [strategy, setStrategy] = useState<'date' | 'source-kind'>('date');
  const pollTimerRef = useRef<number | null>(null);

  const backendSessionId = groupingSessionState.backendSessionId;
  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const canStartGrouping = Boolean(sourcePath && destinationPath && compressionSessionState.backendSessionId);
  const totalProcessed = progressData ? progressData.completed + progressData.failed : 0;
  const progressPercent = useMemo(() => {
    if (!progressData?.total) {
      return 0;
    }

    return Math.min(100, Math.round((totalProcessed / progressData.total) * 100));
  }, [progressData, totalProcessed]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!backendSessionId) {
      return;
    }

    let isActive = true;

    const refresh = async () => {
      try {
        const [session, progress] = await Promise.all([
          getGroupingSessionRequest(backendSessionId),
          getGroupingProgressRequest(backendSessionId)
        ]);

        if (!isActive) {
          return;
        }

        setProgressData(progress);
        setBackendError(null);

        if (session.session.status === 'completed') {
          completeGroupingSession();
          return;
        }

        if (session.session.status === 'paused') {
          pauseGroupingSession();
          return;
        }

        if (session.session.status === 'failed' || session.session.status === 'cancelled') {
          failGroupingSession(`Grouping session ended with status: ${session.session.status}`);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        setBackendError(error instanceof Error ? error.message : 'Could not refresh grouping session.');
      }
    };

    void refresh();

    return () => {
      isActive = false;
    };
  }, [backendSessionId]);

  const scheduleProgressPoll = (sessionId: string) => {
    const poll = async () => {
      try {
        const progress = await getGroupingProgressRequest(sessionId);
        setProgressData(progress);
        setBackendError(null);

        if (progress.status === 'completed') {
          completeGroupingSession();
          setIsStartingGrouping(false);
          return;
        }

        if (progress.status === 'failed' || progress.status === 'cancelled') {
          failGroupingSession(`Grouping session ended with status: ${progress.status}`);
          setIsStartingGrouping(false);
          return;
        }

        if (progress.status === 'paused') {
          pauseGroupingSession();
          setIsStartingGrouping(false);
          return;
        }

        pollTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 1500);
      } catch (error) {
        setBackendError(error instanceof Error ? error.message : 'Failed to poll grouping progress.');
        pollTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 2500);
      }
    };

    void poll();
  };

  const handleBack = () => {
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/compression');
  };

  const handleStartGrouping = async () => {
    if (!canStartGrouping || !compressionSessionState.backendSessionId) {
      setBackendError('Grouping needs a completed backend compression session and selected source/destination folders.');
      return;
    }

    setBackendError(null);
    setIsStartingGrouping(true);

    try {
      const started = await startGroupingSessionRequest({
        sourceDir: sourcePath,
        outputDir: destinationPath,
        compressionSessionId: compressionSessionState.backendSessionId,
        strategy,
        autoRename
      });

      startGroupingSession({
        backendSessionId: started.session.id,
        outputRootLabel: started.manifest?.outputRoot ?? destinationPath
      });

      scheduleProgressPoll(started.session.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start grouping session.';
      failGroupingSession(message);
      setBackendError(message);
      setIsStartingGrouping(false);
    }
  };

  const handlePauseGrouping = async () => {
    if (!backendSessionId) {
      return;
    }

    try {
      await pauseGroupingSessionRequest(backendSessionId);
      pauseGroupingSession();
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not pause grouping session.');
    }
  };

  const handleResumeGrouping = async () => {
    if (!backendSessionId) {
      return;
    }

    try {
      await resumeGroupingSessionRequest(backendSessionId);
      resumeGroupingSession();
      setBackendError(null);
      scheduleProgressPoll(backendSessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not resume grouping session.');
    }
  };

  const isGroupingRunning = groupingSessionState.status === 'running' || isStartingGrouping;
  const isGroupingPaused = groupingSessionState.status === 'paused';

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Review the final structure</h2>
        <p className="page-subtitle">
          Review how compressed media will be grouped before the final organization step.
        </p>
      </div>

      <div className="page-card">
        <p className="page-section-title">Grouping session</p>
        <p className="page-summary-note">
          Status: <strong>{formatStatus(groupingSessionState.status)}</strong>
          {groupingSessionState.outputRootLabel ? ` - Output: ${groupingSessionState.outputRootLabel}` : ''}
        </p>
        {!canStartGrouping && (
          <p className="error">
            Grouping is available after backend compression completes and source/destination folders are still selected.
          </p>
        )}
        {backendError && <p className="error">{backendError}</p>}
      </div>

      <div className="page-grid-2">
        <div className="page-card">
          <p className="page-section-title">Grouping rules</p>
          <div className="page-option-list">
            <label className="page-option">
              <input type="radio" name="grouping-strategy" checked={strategy === 'date'} onChange={() => setStrategy('date')} />
              <span className="page-option-label">
                <strong>Date folders</strong> using capture date when available
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="grouping-strategy" checked={strategy === 'source-kind'} onChange={() => setStrategy('source-kind')} />
              <span className="page-option-label">
                <strong>Source kind folders</strong> using camera, WhatsApp, screenshot, or unknown
              </span>
            </label>
          </div>
        </div>

        <div className="page-card">
          <p className="page-section-title">Folder naming</p>
          <label className="page-option">
            <input type="checkbox" checked={autoRename} onChange={(event) => setAutoRename(event.target.checked)} />
            <span className="page-option-label">
              <strong>Auto-rename folders with consistent naming pattern</strong>
            </span>
          </label>
          <p className="page-summary-note">Pattern: YYYY.MM - Event Name</p>
        </div>
      </div>

      {progressData && (
        <div className="page-card compression-progress-card">
          <p className="page-section-title">Grouping progress</p>
          <div className="compression-progress-stats">
            <div className="progress-stat">
              <span className="progress-label">Total:</span>
              <span className="progress-value">{progressData.total} files</span>
            </div>
            <div className="progress-stat">
              <span className="progress-label">Completed:</span>
              <span className="progress-value" style={{ color: '#10b981' }}>{progressData.completed}</span>
            </div>
            <div className="progress-stat">
              <span className="progress-label">Failed:</span>
              <span className="progress-value" style={{ color: progressData.failed > 0 ? '#ef4444' : '#6b7280' }}>{progressData.failed}</span>
            </div>
          </div>

          <div className="compression-progress-bar">
            <div className="compression-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="page-summary-note">{totalProcessed}/{progressData.total} items processed</p>
        </div>
      )}

      {progressData && progressData.groups.length > 0 && (
        <div className="page-card">
          <p className="page-section-title">Proposed folder structure</p>
          <ul className="page-folder-list">
            {progressData.groups.map((folder) => (
              <li key={folder.label} className="page-folder-row">
                <div className="page-folder-card">
                  <span aria-hidden="true" style={{ fontSize: '14px' }}>Folder</span>
                  <div className="page-folder-meta">
                    <p className="page-folder-title">{folder.label}</p>
                    <p className="page-folder-subtitle">
                      {folder.total} files - {folder.completed} completed - {folder.failed} failed
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {progressData && (
        <div className="page-card">
          <p className="page-section-title">Processed items</p>
          {progressData.processedItems.length > 0 ? (
            <div className="compression-logs-list">
              {progressData.processedItems.map((item) => (
                <div key={item.id} className={`compression-log-item compression-log-${item.status}`}>
                  <span className="compression-log-status">{item.status === 'completed' ? 'OK' : item.status.toUpperCase()}</span>
                  <span className="compression-log-name">
                    {getFileName(item.sourcePath)}
                    {item.targetGroupLabel ? ` -> ${item.targetGroupLabel}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="page-summary-note">No grouped items have been processed yet.</p>
          )}
        </div>
      )}

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={handleBack}>
          Back
        </button>
        {isGroupingPaused ? (
          <button className="btn btn-primary" type="button" onClick={() => void handleResumeGrouping()}>
            Resume Grouping
          </button>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void handleStartGrouping()}
            disabled={isGroupingRunning || groupingSessionState.status === 'completed' || !canStartGrouping}
          >
            {isGroupingRunning ? 'Grouping running...' : groupingSessionState.status === 'completed' ? 'Grouping completed' : 'Start Grouping Session'}
          </button>
        )}
        {isGroupingRunning && (
          <button className="btn btn-secondary" type="button" onClick={() => void handlePauseGrouping()}>
            Pause
          </button>
        )}
        {groupingSessionState.status === 'failed' && (
          <button className="btn btn-ghost" type="button" onClick={() => resetGroupingSession()}>
            Try Again
          </button>
        )}
      </div>
    </div>
  );
};

export default GroupingPage;
