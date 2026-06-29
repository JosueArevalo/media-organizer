import type { TranslationKey } from '../i18n';
import type { DashboardExecution } from '../services/dashboard.service';

export const formatDurationMs = (durationMs: number, t: (key: TranslationKey) => string) => {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '-';
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${t(hours === 1 ? 'dashboard.duration.hour' : 'dashboard.duration.hours')}`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} ${t(minutes === 1 ? 'dashboard.duration.minute' : 'dashboard.duration.minutes')}`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${t(seconds === 1 ? 'dashboard.duration.second' : 'dashboard.duration.seconds')}`);
  }

  return parts.join(' ');
};

export const formatCompressionDuration = (execution: DashboardExecution, t: (key: TranslationKey) => string) => {
  if (typeof execution.compressionActiveDurationMs === 'number') {
    return formatDurationMs(execution.compressionActiveDurationMs, t);
  }

  const startMs = new Date(execution.startedAt).getTime();
  const endMs = execution.finishedAt ? new Date(execution.finishedAt).getTime() : Date.now();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '-';
  }

  return formatDurationMs(endMs - startMs, t);
};
