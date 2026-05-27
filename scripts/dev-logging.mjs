const DEFAULT_MAX_RECENT_LINES = 20;
const DEFAULT_MAX_LINE_LENGTH = 240;

const WINDOWS_NATIVE_EXIT_CODES = new Map([
  [
    0xc0000409,
    {
      label: "native process crash / fast fail",
      detail: "This usually comes from a native dependency or runtime crash, not a normal HTTP or app error."
    }
  ]
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const truncateLine = (line, maxLineLength = DEFAULT_MAX_LINE_LENGTH) => {
  if (line.length <= maxLineLength) {
    return line;
  }

  return `${line.slice(0, Math.max(0, maxLineLength - 3))}...`;
};

export const toUnsignedExitCode = (code) => {
  if (!Number.isInteger(code)) {
    return null;
  }

  return code < 0 ? code >>> 0 : code;
};

export const formatExitCode = (code) => {
  const unsignedCode = toUnsignedExitCode(code);

  if (unsignedCode === null) {
    return code === null ? "none" : String(code);
  }

  return `${code} (0x${unsignedCode.toString(16).toUpperCase()})`;
};

export const describeExitCode = (code) => {
  const unsignedCode = toUnsignedExitCode(code);

  if (unsignedCode === null) {
    return null;
  }

  return WINDOWS_NATIVE_EXIT_CODES.get(unsignedCode) ?? null;
};

export const sanitizeLogLine = (line, { repoRoot, maxLineLength = DEFAULT_MAX_LINE_LENGTH } = {}) => {
  let sanitized = String(line);

  if (repoRoot) {
    const normalizedRepoRoot = repoRoot.replaceAll("/", "\\");
    sanitized = sanitized.replace(new RegExp(escapeRegExp(repoRoot), "gi"), "<repo>");
    sanitized = sanitized.replace(new RegExp(escapeRegExp(normalizedRepoRoot), "gi"), "<repo>");
  }

  sanitized = sanitized
    .replace(/\b(authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, "$1=<redacted>")
    .replace(/\b(token|secret|password|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[^"',;\s]+["']?/gi, "$1=<redacted>")
    .replace(/(["'])(token|secret|password|api[_-]?key|access[_-]?key|authorization)\1\s*:\s*(["']).*?\3/gi, "$1$2$1: $3<redacted>$3")
    .replace(
      /\b[A-Za-z]:\\.*?(?=\s+(?:token|secret|password|api[_-]?key|access[_-]?key|authorization)\s*=|[\s,;]*$|[,\r\n])/gi,
      "<path>"
    )
    .replace(
      /(?<![:\w])\/(?:Users|home|var|tmp|mnt|Volumes)\/.*?(?=\s+(?:token|secret|password|api[_-]?key|access[_-]?key|authorization)\s*=|[\s,;]*$|[,\r\n])/gi,
      "<path>"
    );

  return truncateLine(sanitized, maxLineLength);
};

export const createRecentLineBuffer = ({ limit = DEFAULT_MAX_RECENT_LINES } = {}) => {
  const lines = [];

  return {
    push(line) {
      lines.push(line);

      while (lines.length > limit) {
        lines.shift();
      }
    },
    getLines() {
      return [...lines];
    }
  };
};

export const createLineCollector = ({ onLine }) => {
  let pending = "";

  return {
    push(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";

      for (const line of lines) {
        onLine(line);
      }
    },
    flush() {
      if (!pending) {
        return;
      }

      onLine(pending);
      pending = "";
    }
  };
};

export const buildFailureSummary = ({
  name,
  command,
  code,
  signal,
  recentLines,
  repoRoot,
  maxRecentLines = DEFAULT_MAX_RECENT_LINES,
  maxLineLength = DEFAULT_MAX_LINE_LENGTH
}) => {
  const lines = [
    `[dev-all] ${name} process exited unexpectedly.`,
    `[dev-all] Command: ${command}`,
    `[dev-all] Exit code: ${formatExitCode(code)}${signal ? `, signal: ${signal}` : ""}`
  ];
  const exitDescription = describeExitCode(code);

  if (exitDescription) {
    lines.push(`[dev-all] Meaning: ${exitDescription.label}. ${exitDescription.detail}`);
  }

  const sanitizedRecentLines = recentLines
    .slice(-maxRecentLines)
    .map((line) => sanitizeLogLine(line, { repoRoot, maxLineLength }))
    .filter((line) => line.trim().length > 0);

  if (sanitizedRecentLines.length > 0) {
    lines.push(`[dev-all] Last ${sanitizedRecentLines.length} ${name} log line(s), sanitized:`);

    for (const line of sanitizedRecentLines) {
      lines.push(`[dev-all]   ${line}`);
    }
  } else {
    lines.push(`[dev-all] No recent ${name} logs were captured before the exit.`);
  }

  lines.push(
    "[dev-all] Next steps: check the first error line above, restart with npm run dev, and isolate repeated failures with npm run dev:web or npm run dev:backend."
  );

  return lines;
};
