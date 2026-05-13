import { spawn } from 'node:child_process';
import { resolveToolCommand } from './toolCommandResolver.js';

export type HandBrakePresetOption = {
  category: string;
  name: string;
  description: string | null;
  isDefault: boolean;
};

export type HandBrakePresetList = {
  command: string;
  resolvedCommand: string;
  presets: HandBrakePresetOption[];
  defaultPreset: string | null;
};

type HandBrakePresetDraft = {
  category: string;
  name: string;
  isDefault: boolean;
  descriptionLines: string[];
  indent: number;
};

const DEFAULT_PRESET_NAME = 'Fast 1080p30';

const countLeadingWhitespace = (value: string) => {
  let index = 0;

  while (index < value.length && /\s/.test(value[index])) {
    index += 1;
  }

  return index;
};

const stripDefaultMarker = (name: string) =>
  name
    .replace(/\((?:default|por defecto)\)$/i, '')
    .trim();

const finalizePreset = (draft: HandBrakePresetDraft | null, presets: HandBrakePresetOption[]) => {
  if (!draft) {
    return;
  }

  presets.push({
    category: draft.category,
    name: draft.name,
    isDefault: draft.isDefault,
    description: draft.descriptionLines.length > 0 ? draft.descriptionLines.join(' ') : null
  });
};

export const parseHandBrakePresetListOutput = (output: string): HandBrakePresetOption[] => {
  const lines = output.split(/\r?\n/);
  const presets: HandBrakePresetOption[] = [];
  let currentCategory: string | null = null;
  let categoryIndent = 0;
  let currentPreset: HandBrakePresetDraft | null = null;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const indent = countLeadingWhitespace(line);
    const trimmed = line.trim();

    if (trimmed.endsWith('/') && !trimmed.includes('://')) {
      finalizePreset(currentPreset, presets);
      currentPreset = null;
      currentCategory = trimmed.slice(0, -1).trim();
      categoryIndent = indent;
      continue;
    }

    if (!currentCategory) {
      continue;
    }

    const expectedPresetIndent = categoryIndent + 4;

    if (indent === expectedPresetIndent) {
      finalizePreset(currentPreset, presets);
      const isDefault = /\((?:default|por defecto)\)$/i.test(trimmed);

      currentPreset = {
        category: currentCategory,
        name: stripDefaultMarker(trimmed),
        isDefault,
        descriptionLines: [],
        indent
      };
      continue;
    }

    if (currentPreset && indent > currentPreset.indent) {
      currentPreset.descriptionLines.push(trimmed);
      continue;
    }

    if (indent <= categoryIndent) {
      finalizePreset(currentPreset, presets);
      currentPreset = null;
      currentCategory = null;
    }
  }

  finalizePreset(currentPreset, presets);

  const deduplicated = new Map<string, HandBrakePresetOption>();

  for (const preset of presets) {
    const key = `${preset.category}::${preset.name}`.toLowerCase();

    if (!deduplicated.has(key)) {
      deduplicated.set(key, preset);
    }
  }

  return [...deduplicated.values()];
};

const pickDefaultPreset = (presets: HandBrakePresetOption[]) => {
  if (presets.length === 0) {
    return null;
  }

  const explicitDefault = presets.find((preset) => preset.isDefault);

  if (explicitDefault) {
    return explicitDefault.name;
  }

  const fast1080 = presets.find((preset) => preset.name.toLowerCase() === DEFAULT_PRESET_NAME.toLowerCase());

  if (fast1080) {
    return fast1080.name;
  }

  return presets[0].name;
};

const executePresetListCommand = async (command: string) => {
  return await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command, ['--preset-list'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim()
      });
    });
  });
};

export const listHandBrakePresets = async (requestedCommand?: string): Promise<HandBrakePresetList> => {
  const command = requestedCommand?.trim() || 'HandBrakeCLI';
  const resolvedCommand = resolveToolCommand(command) ?? command;
  const result = await executePresetListCommand(resolvedCommand);
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const presets = parseHandBrakePresetListOutput(combinedOutput);

  if (presets.length === 0) {
    const detail = result.stderr || result.stdout || `Command exited with code ${String(result.code)}`;
    throw new Error(`Could not load HandBrake presets. ${detail}`);
  }

  return {
    command,
    resolvedCommand,
    presets,
    defaultPreset: pickDefaultPreset(presets)
  };
};
