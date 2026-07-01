import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

type CliOptions = {
  input: string;
  output: string;
  quality: number;
};

const parseArgs = (argv: string[]): CliOptions => {
  let input = '';
  let output = '';
  let quality: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--input' && next) {
      input = next;
      index += 1;
      continue;
    }

    if (value === '--output' && next) {
      output = next;
      index += 1;
      continue;
    }

    if (value === '--quality' && next) {
      quality = Number.parseInt(next, 10);
      index += 1;
    }
  }

  if (!input || !output || quality === null || Number.isNaN(quality)) {
    throw new Error('Usage: orientedJpegCompression.cli --input <path> --output <path> --quality <number>');
  }

  return { input, output, quality };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await fs.promises.mkdir(path.dirname(options.output), { recursive: true });

  await sharp(options.input, { animated: false })
    .rotate()
    .withMetadata({ orientation: 1 })
    .jpeg({
      quality: options.quality,
      mozjpeg: true
    })
    .toFile(options.output);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
