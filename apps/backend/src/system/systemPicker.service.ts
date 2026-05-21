import path from 'node:path';
import { spawn } from 'node:child_process';
import { isAllowedLocalOrigin } from '../http/localAccess.js';

export type SystemPickerFilter = {
  name: string;
  extensions: string[];
};

export type SystemPickerRequest = {
  title?: string;
  initialPath?: string;
  filters?: SystemPickerFilter[];
};

export type SystemPickerResult =
  | { status: 'selected'; path: string; name: string }
  | { status: 'cancelled' }
  | { status: 'unsupported'; message: string };

export type PickerProcessResult =
  | { status: 'exited'; exitCode: number | null; stdout: string; stderr: string }
  | { status: 'error'; code?: string; message: string };

type PickerPlatform = NodeJS.Platform;

export type PickerDeps = {
  platform: PickerPlatform;
  runProcess: (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<PickerProcessResult>;
};

const cancelExitCodes = new Set([1, 2]);

const defaultRunProcess = (command: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  new Promise<PickerProcessResult>((resolve) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...env
      },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        status: 'error',
        code: error.code,
        message: error.message
      });
    });

    child.on('exit', (exitCode) => {
      resolve({
        status: 'exited',
        exitCode,
        stdout,
        stderr
      });
    });
  });

const defaultDeps: PickerDeps = {
  platform: process.platform,
  runProcess: defaultRunProcess
};

export const isAllowedPickerOrigin = isAllowedLocalOrigin;

const trimSelectedPath = (value: string) => value.trim().replace(/^"|"$/g, '');

const toSelectedResult = (selectedPath: string): SystemPickerResult => {
  const normalizedPath = path.normalize(trimSelectedPath(selectedPath));
  const name = path.basename(normalizedPath) || normalizedPath;

  return {
    status: 'selected',
    path: normalizedPath,
    name
  };
};

const resultFromProcess = (result: PickerProcessResult): SystemPickerResult | null => {
  if (result.status === 'error') {
    return result.code === 'ENOENT'
      ? { status: 'unsupported', message: 'Native picker command is not available on this system.' }
      : { status: 'unsupported', message: result.message };
  }

  if (result.exitCode === 0) {
    const selectedPath = trimSelectedPath(result.stdout);
    return selectedPath ? toSelectedResult(selectedPath) : { status: 'cancelled' };
  }

  if (result.exitCode !== null && cancelExitCodes.has(result.exitCode)) {
    return { status: 'cancelled' };
  }

  return {
    status: 'unsupported',
    message: result.stderr.trim() || 'Native picker failed before returning a selection.'
  };
};

const getInitialDirectory = (initialPath?: string) => {
  const trimmed = initialPath?.trim();

  if (!trimmed) {
    return '';
  }

  const parsed = path.parse(trimmed);
  return parsed.ext ? path.dirname(trimmed) : trimmed;
};

const toPowerShellFileFilter = (filters: SystemPickerFilter[] | undefined) => {
  if (!filters?.length) {
    return 'All files (*.*)|*.*';
  }

  const parts = filters
    .map((filter) => {
      const extensions = filter.extensions
        .map((extension) => extension.trim().replace(/^\./, ''))
        .filter(Boolean);

      if (extensions.length === 0) {
        return null;
      }

      const patterns = extensions.map((extension) => `*.${extension}`).join(';');
      return `${filter.name} (${patterns})|${patterns}`;
    })
    .filter((filter): filter is string => Boolean(filter));

  return [...parts, 'All files (*.*)|*.*'].join('|');
};

const toZenityFileFilters = (filters: SystemPickerFilter[] | undefined) => {
  if (!filters?.length) {
    return [];
  }

  return filters.flatMap((filter) => {
    const extensions = filter.extensions
      .map((extension) => extension.trim().replace(/^\./, ''))
      .filter(Boolean);

    if (extensions.length === 0) {
      return [];
    }

    return ['--file-filter', `${filter.name} | ${extensions.map((extension) => `*.${extension}`).join(' ')}`];
  });
};

const toKdialogFileFilter = (filters: SystemPickerFilter[] | undefined) => {
  if (!filters?.length) {
    return '';
  }

  return filters
    .map((filter) => {
      const extensions = filter.extensions
        .map((extension) => extension.trim().replace(/^\./, ''))
        .filter(Boolean);

      if (extensions.length === 0) {
        return '';
      }

      return `${extensions.map((extension) => `*.${extension}`).join(' ')}|${filter.name}`;
    })
    .filter(Boolean)
    .join('\n');
};

const windowsDirectoryScript = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Width = 1
$owner.Height = 1
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:PICKER_TITLE
$dialog.ShowNewFolderButton = $true
if ($env:PICKER_INITIAL_PATH -and [System.IO.Directory]::Exists($env:PICKER_INITIAL_PATH)) {
  $dialog.SelectedPath = $env:PICKER_INITIAL_PATH
}
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
  exit 0
}
exit 2
`;

const windowsFileScript = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Width = 1
$owner.Height = 1
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = $env:PICKER_TITLE
$dialog.Filter = $env:PICKER_FILTER
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($env:PICKER_INITIAL_PATH) {
  if ([System.IO.File]::Exists($env:PICKER_INITIAL_PATH)) {
    $dialog.FileName = $env:PICKER_INITIAL_PATH
  } elseif ([System.IO.Directory]::Exists($env:PICKER_INITIAL_PATH)) {
    $dialog.InitialDirectory = $env:PICKER_INITIAL_PATH
  }
}
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
  exit 0
}
exit 2
`;

const runWindowsPicker = async (kind: 'directory' | 'file', request: SystemPickerRequest, deps: PickerDeps) => {
  const result = await deps.runProcess(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', kind === 'directory' ? windowsDirectoryScript : windowsFileScript],
    {
      PICKER_TITLE: request.title ?? (kind === 'directory' ? 'Select folder' : 'Select file'),
      PICKER_INITIAL_PATH: request.initialPath?.trim() ?? '',
      PICKER_FILTER: toPowerShellFileFilter(request.filters)
    }
  );

  return resultFromProcess(result) ?? { status: 'unsupported', message: 'Native picker returned an unknown result.' };
};

const runMacPicker = async (kind: 'directory' | 'file', request: SystemPickerRequest, deps: PickerDeps) => {
  const script = kind === 'directory'
    ? 'POSIX path of (choose folder with prompt (system attribute "PICKER_TITLE"))'
    : 'POSIX path of (choose file with prompt (system attribute "PICKER_TITLE"))';
  const result = await deps.runProcess('osascript', ['-e', script], {
    PICKER_TITLE: request.title ?? (kind === 'directory' ? 'Select folder' : 'Select file')
  });

  return resultFromProcess(result) ?? { status: 'unsupported', message: 'Native picker returned an unknown result.' };
};

const runLinuxPicker = async (kind: 'directory' | 'file', request: SystemPickerRequest, deps: PickerDeps) => {
  const title = request.title ?? (kind === 'directory' ? 'Select folder' : 'Select file');
  const initialDirectory = getInitialDirectory(request.initialPath);
  const zenityArgs = kind === 'directory'
    ? ['--file-selection', '--directory', '--title', title, ...(initialDirectory ? ['--filename', initialDirectory] : [])]
    : ['--file-selection', '--title', title, ...(initialDirectory ? ['--filename', initialDirectory] : []), ...toZenityFileFilters(request.filters)];
  const zenityResult = resultFromProcess(await deps.runProcess('zenity', zenityArgs));

  if (zenityResult?.status === 'selected' || zenityResult?.status === 'cancelled') {
    return zenityResult;
  }

  const kdialogArgs = kind === 'directory'
    ? ['--getexistingdirectory', initialDirectory || '~', title]
    : ['--getopenfilename', initialDirectory || '~', toKdialogFileFilter(request.filters), title];
  const kdialogResult = resultFromProcess(await deps.runProcess('kdialog', kdialogArgs));

  if (kdialogResult?.status === 'selected' || kdialogResult?.status === 'cancelled') {
    return kdialogResult;
  }

  return {
    status: 'unsupported',
    message: 'No supported native picker command was found. Install zenity or kdialog, or paste the path manually.'
  };
};

const runPicker = async (kind: 'directory' | 'file', request: SystemPickerRequest, deps: PickerDeps) => {
  if (deps.platform === 'win32') {
    return runWindowsPicker(kind, request, deps);
  }

  if (deps.platform === 'darwin') {
    return runMacPicker(kind, request, deps);
  }

  if (deps.platform === 'linux') {
    return runLinuxPicker(kind, request, deps);
  }

  return {
    status: 'unsupported',
    message: `Native picker is not supported on ${deps.platform}. Paste the path manually.`
  } satisfies SystemPickerResult;
};

export const pickDirectory = (request: SystemPickerRequest, deps: PickerDeps = defaultDeps) =>
  runPicker('directory', request, deps);

export const pickFile = (request: SystemPickerRequest, deps: PickerDeps = defaultDeps) =>
  runPicker('file', request, deps);
