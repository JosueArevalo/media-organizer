import { useEffect, useState } from 'react';

export type RuntimeInfo = {
  version: string;
  platform: string;
  architecture: string;
  mode: 'development' | 'desktop';
};

export const useRuntimeInfo = () => {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/system/runtime', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<RuntimeInfo> : null)
      .then(setRuntime)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return runtime;
};
