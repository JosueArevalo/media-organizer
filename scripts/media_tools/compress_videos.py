from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


VIDEO_EXTENSIONS = {'.mp4', '.mov', '.m4v', '.avi', '.mkv'}


def build_output_path(source_dir: Path, output_dir: Path, source_file: Path) -> Path:
    relative_path = source_file.relative_to(source_dir)
    return output_dir / relative_path


def iter_video_files(source_dir: Path):
    for root, _, files in os.walk(source_dir):
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() in VIDEO_EXTENSIONS:
                yield file_path


def main() -> int:
    parser = argparse.ArgumentParser(description='Compress videos into a destination folder.')
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--preset', default='balanced')
    parser.add_argument('--encoder-command', default='HandBrakeCLI')
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = []

    for source_file in iter_video_files(source_dir):
        output_file = build_output_path(source_dir, output_dir, source_file)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        command = [
            args.encoder_command,
            '-i',
            str(source_file),
            '-o',
            str(output_file),
            '--preset',
            args.preset,
        ]

        subprocess.run(command, check=True)

        manifest.append({
            'source': str(source_file),
            'output': str(output_file),
            'command': command,
        })

    print(json.dumps({'items': manifest}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())