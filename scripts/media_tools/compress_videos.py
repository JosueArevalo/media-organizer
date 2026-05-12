from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


VIDEO_EXTENSIONS = {'.mp4', '.mov', '.m4v', '.avi', '.mkv'}


def normalize_path(value: str) -> str:
    return str(Path(value).resolve()).replace('\\', '/').lower()


def load_scope(value: str):
    if not value:
        return {
            'excludedDirectories': [],
            'excludedFiles': [],
            'includedDirectories': [],
            'includedFiles': [],
            'updatedAt': 0,
        }

    return json.loads(value)


def resolve_scope_path(source_dir: Path, scope_path: str) -> str:
    trimmed = scope_path.strip().replace('\\', '/')

    if not trimmed:
        return normalize_path(str(source_dir))

    candidate = Path(trimmed)

    if candidate.is_absolute():
        return normalize_path(str(candidate.resolve()))

    segments = [segment for segment in trimmed.lstrip('/').split('/') if segment]
    source_root_name = source_dir.name.lower()

    if segments and segments[0].lower() == source_root_name:
        segments = segments[1:]

    return normalize_path(str(source_dir.joinpath(*segments).resolve()))


def resolve_scope(source_dir: Path, scope):
    return {
        'excludedDirectories': {resolve_scope_path(source_dir, value) for value in scope.get('excludedDirectories', [])},
        'excludedFiles': {resolve_scope_path(source_dir, value) for value in scope.get('excludedFiles', [])},
        'includedDirectories': {resolve_scope_path(source_dir, value) for value in scope.get('includedDirectories', [])},
        'includedFiles': {resolve_scope_path(source_dir, value) for value in scope.get('includedFiles', [])},
        'updatedAt': scope.get('updatedAt', 0),
    }


def is_under_excluded_ancestor(source_file: Path, excluded_directories: set[str], included_directories: set[str]) -> bool:
    normalized = normalize_path(str(source_file))
    segments = normalized.split('/')
    current_path = ''
    ancestor_excluded = False

    for segment in segments[:-1]:
        current_path = f'{current_path}/{segment}' if current_path else segment

        if current_path in excluded_directories:
            ancestor_excluded = True

        if ancestor_excluded and current_path in included_directories:
            ancestor_excluded = False

    return ancestor_excluded


def should_compress(source_file: Path, scope) -> bool:
    normalized = normalize_path(str(source_file))
    excluded_directories = scope['excludedDirectories']
    excluded_files = scope['excludedFiles']
    included_directories = scope['includedDirectories']
    included_files = scope['includedFiles']

    if normalized in excluded_files:
        return False

    if not is_under_excluded_ancestor(source_file, excluded_directories, included_directories):
        return True

    return normalized in included_files


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
    parser.add_argument('--selection-scope-json', default='')
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    scope = resolve_scope(source_dir, load_scope(args.selection_scope_json))
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

        status = 'completed'
        error_message = None

        if not should_compress(source_file, scope):
            shutil.copy2(source_file, output_file)
        else:
            try:
                subprocess.run(command, check=True, capture_output=True, text=True)
            except FileNotFoundError:
                status = 'failed'
                error_message = f"Video encoder command not found: {args.encoder_command}"
            except subprocess.CalledProcessError as error:
                status = 'failed'
                stderr = (error.stderr or '').strip()
                error_message = stderr or f"Video compression failed for {source_file}"

        if status == 'failed':
            shutil.copy2(source_file, output_file)

        manifest.append({
            'source': str(source_file),
            'output': str(output_file),
            'command': command,
            'status': status,
            'error': error_message,
        })

    print(json.dumps({'items': manifest}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())