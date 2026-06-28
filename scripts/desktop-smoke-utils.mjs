import path from 'node:path';

const resolvePortableExecutable = (argv, workingDirectory) => {
  const executableArgumentIndex = argv.indexOf('--executable');
  if (executableArgumentIndex < 0) {
    return null;
  }

  const executableArgument = argv[executableArgumentIndex + 1];
  return executableArgument ? path.resolve(workingDirectory, executableArgument) : '';
};

export const resolveDesktopExecutable = ({
  argv = process.argv.slice(2),
  workingDirectory = process.cwd(),
  electronResolver
} = {}) => {
  const portableExecutable = resolvePortableExecutable(argv, workingDirectory);
  if (portableExecutable) {
    return {
      executable: portableExecutable,
      portableExecutable,
      source: 'portable'
    };
  }

  const developmentExecutable = electronResolver?.();
  if (typeof developmentExecutable !== 'string' || developmentExecutable.length === 0) {
    throw new Error(
      'Desktop executable could not be resolved. Pass --executable <path> or ensure the electron package exposes a development executable.'
    );
  }

  return {
    executable: developmentExecutable,
    portableExecutable: null,
    source: 'development'
  };
};
