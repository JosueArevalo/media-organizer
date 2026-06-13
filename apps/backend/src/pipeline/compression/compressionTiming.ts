export type CompressionTimingReason = 'pause' | 'resume' | 'complete' | 'fail' | 'interrupted';

export type CompressionTimingSegment = {
  startedAt: string;
  endedAt?: string | null;
  reason?: CompressionTimingReason;
};

export type CompressionTiming = {
  segments: CompressionTimingSegment[];
};

export type CompressionTimingSnapshot = {
  durationMs: number;
  activeStartedAt: string | null;
};

const toTime = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const createCompressionTiming = (startedAt: string): CompressionTiming => ({
  segments: [{ startedAt }]
});

export const isCompressionTiming = (value: unknown): value is CompressionTiming => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CompressionTiming>;
  return Array.isArray(candidate.segments);
};

export const normalizeCompressionTiming = (value: unknown, fallbackStartedAt: string | null = null): CompressionTiming => {
  if (!isCompressionTiming(value)) {
    return fallbackStartedAt ? createCompressionTiming(fallbackStartedAt) : { segments: [] };
  }

  return {
    segments: value.segments
      .filter((segment): segment is CompressionTimingSegment =>
        Boolean(segment && typeof segment === 'object' && typeof segment.startedAt === 'string')
      )
      .map((segment) => ({
        startedAt: segment.startedAt,
        ...(typeof segment.endedAt === 'string' || segment.endedAt === null ? { endedAt: segment.endedAt } : {}),
        ...(segment.reason ? { reason: segment.reason } : {})
      }))
  };
};

export const openCompressionTimingSegment = (timing: CompressionTiming, startedAt: string): CompressionTiming => {
  const segments = [...timing.segments];
  const last = segments.at(-1);

  if (last && !last.endedAt) {
    return { segments };
  }

  return {
    segments: [...segments, { startedAt }]
  };
};

export const closeCompressionTimingSegment = (
  timing: CompressionTiming,
  endedAt: string,
  reason: CompressionTimingReason
): CompressionTiming => {
  const segments = [...timing.segments];
  const last = segments.at(-1);

  if (!last || last.endedAt) {
    return { segments };
  }

  segments[segments.length - 1] = {
    ...last,
    endedAt,
    reason
  };

  return { segments };
};

export const getCompressionTimingSnapshot = (
  timing: CompressionTiming,
  now: string,
  includeOpenSegment: boolean
): CompressionTimingSnapshot => {
  let durationMs = 0;
  let activeStartedAt: string | null = null;
  const nowMs = toTime(now);

  for (const segment of timing.segments) {
    const startedMs = toTime(segment.startedAt);

    if (startedMs === null) {
      continue;
    }

    const endedMs = toTime(segment.endedAt);
    if (endedMs !== null) {
      durationMs += Math.max(0, endedMs - startedMs);
      continue;
    }

    activeStartedAt = segment.startedAt;
    if (includeOpenSegment && nowMs !== null) {
      durationMs += Math.max(0, nowMs - startedMs);
    }
  }

  return {
    durationMs,
    activeStartedAt
  };
};
