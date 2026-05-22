from __future__ import annotations

import argparse
import shutil
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif'}
JPEG_EXTENSIONS = {'.jpg', '.jpeg'}
HEIC_EXTENSIONS = {'.heic', '.heif'}
COPY_ONLY_EXTENSIONS = {'.png', '.webp', '.gif'}


class ToolConfigurationError(Exception):
    pass


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


def build_output_path(source_dir: Path, output_dir: Path, source_file: Path, convert_to_jpg: bool = False) -> Path:
    relative_path = source_file.relative_to(source_dir)
    output_path = output_dir / relative_path

    if convert_to_jpg:
        return output_path.with_suffix('.jpg')

    return output_path


def resolve_unique_output_path(output_file: Path, used_outputs: set[str]) -> Path:
    candidate = output_file
    index = 2

    while normalize_path(str(candidate)) in used_outputs:
        candidate = output_file.with_name(f'{output_file.stem} ({index}){output_file.suffix}')
        index += 1

    used_outputs.add(normalize_path(str(candidate)))
    return candidate


def emit_event(payload: dict):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def iter_image_files(source_dir: Path):
    for root, _, files in os.walk(source_dir):
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() in IMAGE_EXTENSIONS:
                yield file_path


def run_cjpeg(encoder_command: str, quality: int, source_file: Path, output_file: Path):
    command = [
        encoder_command,
        '-quality',
        str(quality),
        '-progressive',
        '-optimize',
        '-outfile',
        str(output_file),
        str(source_file),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    return command


def convert_heic_to_jpeg(source_file: Path, output_file: Path, quality: int, encoder_command: str, imagemagick_command: str):
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.ppm')
    temp_path = Path(temp_file.name)
    temp_file.close()

    magick_command = [
        imagemagick_command,
        str(source_file),
        '-auto-orient',
        '-colorspace',
        'sRGB',
        str(temp_path),
    ]
    cjpeg_command = [
        encoder_command,
        '-quality',
        str(quality),
        '-progressive',
        '-optimize',
        '-outfile',
        str(output_file),
        str(temp_path),
    ]

    try:
        subprocess.run(magick_command, check=True, capture_output=True, text=True)
        subprocess.run(cjpeg_command, check=True, capture_output=True, text=True)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass

    return [*magick_command, '&&', *cjpeg_command]


def ensure_heic_support(imagemagick_command: str):
    result = subprocess.run(
        [imagemagick_command, 'identify', '-list', 'format'],
        check=True,
        capture_output=True,
        text=True,
    )
    output = f'{result.stdout}\n{result.stderr}'.upper()

    if 'HEIC' not in output and 'HEIF' not in output:
        raise ToolConfigurationError('ImageMagick is installed, but HEIC/HEIF support was not found. Install a build with libheif.')


def copy_metadata(source_file: Path, output_file: Path, exiftool_command: str):
    if not exiftool_command:
        return 'ExifTool is not configured; metadata copy was skipped.'

    command = [
        exiftool_command,
        '-overwrite_original',
        '-TagsFromFile',
        str(source_file),
        '-all:all',
        '-unsafe',
        '-icc_profile',
        str(output_file),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        return f'ExifTool command not found: {exiftool_command}'
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or '').strip()
        return stderr or f'Metadata copy failed for {source_file}'

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description='Compress images into a destination folder.')
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--quality', required=True, type=int)
    parser.add_argument('--encoder-command', default='cjpeg')
    parser.add_argument('--imagemagick-command', default='magick')
    parser.add_argument('--exiftool-command', default='')
    parser.add_argument('--selection-scope-json', default='')
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    scope = resolve_scope(source_dir, load_scope(args.selection_scope_json))
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    used_outputs = set()
    heic_support_checked = False

    for source_file in iter_image_files(source_dir):
        selected_for_compression = should_compress(source_file, scope)
        extension = source_file.suffix.lower()
        output_file = build_output_path(
            source_dir,
            output_dir,
            source_file,
            convert_to_jpg=selected_for_compression and extension in HEIC_EXTENSIONS,
        )
        output_file = resolve_unique_output_path(output_file, used_outputs)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        command = []

        status = 'completed'
        error_message = None
        warning_message = None

        if not selected_for_compression:
            shutil.copy2(source_file, output_file)
        elif extension in JPEG_EXTENSIONS:
            try:
                command = run_cjpeg(args.encoder_command, args.quality, source_file, output_file)
            except FileNotFoundError:
                status = 'failed'
                error_message = f"Image encoder command not found: {args.encoder_command}"
            except subprocess.CalledProcessError as error:
                status = 'failed'
                stderr = (error.stderr or '').strip()
                error_message = stderr or f"Image compression failed for {source_file}"
        elif extension in HEIC_EXTENSIONS:
            try:
                if not heic_support_checked:
                    ensure_heic_support(args.imagemagick_command)
                    heic_support_checked = True

                command = convert_heic_to_jpeg(
                    source_file,
                    output_file,
                    args.quality,
                    args.encoder_command,
                    args.imagemagick_command,
                )
                warning_message = copy_metadata(source_file, output_file, args.exiftool_command.strip())
            except FileNotFoundError as error:
                status = 'failed'
                missing_command = error.filename or args.imagemagick_command
                error_message = f"HEIC conversion command not found: {missing_command}"
            except ToolConfigurationError as error:
                status = 'failed'
                error_message = str(error)
            except subprocess.CalledProcessError as error:
                status = 'failed'
                stderr = (error.stderr or '').strip()
                error_message = stderr or f"HEIC conversion failed for {source_file}"
        elif extension in COPY_ONLY_EXTENSIONS:
            shutil.copy2(source_file, output_file)
            warning_message = f"{extension.upper().lstrip('.')} files are copied without compression in this version."
        else:
            shutil.copy2(source_file, output_file)
            warning_message = f"{extension or 'Unknown'} files are copied without compression in this version."

        if status == 'failed' and source_file.suffix.lower() == output_file.suffix.lower():
            shutil.copy2(source_file, output_file)

        item = {
            'source': str(source_file),
            'output': str(output_file),
            'command': command,
            'status': status,
            'error': error_message,
            'warning': warning_message,
        }

        manifest.append(item)
        emit_event({
            'type': 'item',
            'item': item,
        })

    emit_event({
        'type': 'complete',
        'items': manifest,
    })
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
