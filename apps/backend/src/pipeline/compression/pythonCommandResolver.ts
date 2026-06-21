import { resolveToolCommand } from './toolCommandResolver.js';

export type PythonRuntimeStatusSnapshot = {
  command: string;
  resolvedPath: string | null;
  status: 'ready' | 'missing';
  candidates: string[];
  source?: 'python' | 'packaged-worker';
};

const getDefaultPythonCandidates = () => (process.platform === 'win32' ? ['python'] : ['python3', 'python']);

export const resolvePythonRuntime = (): PythonRuntimeStatusSnapshot => {
  const packagedWorker = process.env.MEDIA_ORGANIZER_WORKER_PATH?.trim();
  const resolvedWorker = packagedWorker ? resolveToolCommand(packagedWorker) : null;

  if (resolvedWorker) {
    return {
      command: resolvedWorker,
      resolvedPath: resolvedWorker,
      status: 'ready',
      candidates: [resolvedWorker],
      source: 'packaged-worker'
    };
  }

  const override = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND?.trim();
  const candidates = override ? [override] : getDefaultPythonCandidates();

  for (const command of candidates) {
    const resolvedPath = resolveToolCommand(command);

    if (resolvedPath) {
      return {
        command,
        resolvedPath,
        status: 'ready',
        candidates,
        source: 'python'
      };
    }
  }

  return {
    command: candidates[0],
    resolvedPath: null,
    status: 'missing',
    candidates,
    source: 'python'
  };
};

export const getPythonCommand = () => resolvePythonRuntime().resolvedPath ?? resolvePythonRuntime().command;

export const getPackagedWorkerCommand = () => {
  const runtime = resolvePythonRuntime();
  return runtime.source === 'packaged-worker' ? runtime.resolvedPath : null;
};
