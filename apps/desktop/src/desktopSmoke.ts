export type DesktopSmokeProbeOptions = {
  marker: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

const escapeForTemplateLiteral = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');

export const buildDesktopSmokeProbeScript = ({
  marker,
  timeoutMs = 15_000,
  pollIntervalMs = 50
}: DesktopSmokeProbeOptions) => {
  const escapedMarker = escapeForTemplateLiteral(marker);

  return `(() => (async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (window.__mediaOrganizerReady !== true) {
      const bootstrapFailed = window.__mediaOrganizerBootstrapFailed;
      if (bootstrapFailed) {
        throw new Error(\`Renderer bootstrap failed before the smoke probe completed: \${String(bootstrapFailed)}\`);
      }
      if (Date.now() >= deadline) {
        throw new Error('Renderer did not become ready before the smoke probe timed out.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, ${pollIntervalMs}));
    }

    const previous = localStorage.getItem('media-organizer:desktop-smoke');
    localStorage.setItem('media-organizer:desktop-smoke', ${JSON.stringify(escapedMarker)});
    const response = await fetch('/api/system/runtime');
    const bridge = window.mediaOrganizerDesktop;
    const backendState = bridge ? await bridge.getBackendState() : null;
    return {
      previous,
      runtime: await response.json(),
      status: response.status,
      rendered: window.__mediaOrganizerReady === true,
      bridgeAvailable: Boolean(bridge),
      backendState
    };
  })())();`;
};
