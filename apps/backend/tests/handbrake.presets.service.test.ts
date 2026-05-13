import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHandBrakePresetListOutput } from '../src/pipeline/compression/handbrakePresets.service.js';

test('parseHandBrakePresetListOutput extracts presets grouped by category', () => {
  const output = `
HandBrake 1.11.1
    General/
        Fast 1080p30
            H.264 video and AAC stereo audio.
        HQ 1080p30 Surround
            High quality H.264 video and surround audio.
    Web/
        Creator 1080p60
            Online publishing preset.
`;

  const presets = parseHandBrakePresetListOutput(output);

  assert.equal(presets.length, 3);
  assert.deepEqual(
    presets.map((preset) => ({ category: preset.category, name: preset.name })),
    [
      { category: 'General', name: 'Fast 1080p30' },
      { category: 'General', name: 'HQ 1080p30 Surround' },
      { category: 'Web', name: 'Creator 1080p60' }
    ]
  );
  assert.equal(presets[0].description, 'H.264 video and AAC stereo audio.');
});

test('parseHandBrakePresetListOutput strips default marker and deduplicates', () => {
  const output = `
    General/
        Fast 1080p30 (Default)
        Fast 1080p30 (Default)
`;

  const presets = parseHandBrakePresetListOutput(output);

  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, 'Fast 1080p30');
  assert.equal(presets[0].isDefault, true);
});
