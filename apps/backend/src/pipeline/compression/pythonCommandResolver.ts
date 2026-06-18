import { resolveToolCommand } from './toolCommandResolver.js';

export type PythonRuntimeStatusSnapshot = {
  command: string;
  resolvedPath: string | null;
  status: 'ready' | 'missing';
  candidates: string[];
};

const getDefaultPythonCandidates = () => (process.platform === 'win32' ? ['python'] : ['python3', 'python']);

export const resolvePythonRuntime = (): PythonRuntimeStatusSnapshot => {
  const override = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND?.trim();
  const candidates = override ? [override] : getDefaultPythonCandidates();

  for (const command of candidates) {
    const resolvedPath = resolveToolCommand(command);

    if (resolvedPath) {
      return {
        command,
        resolvedPath,
        status: 'ready',
        candidates
      };
    }
  }

  return {
    command: candidates[0],
    resolvedPath: null,
    status: 'missing',
    candidates
  };
};

export const getPythonCommand = () => resolvePythonRuntime().resolvedPath ?? resolvePythonRuntime().command;
