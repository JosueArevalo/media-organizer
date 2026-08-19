from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


VIDEO_EXTENSIONS = {'.mp4', '.mov', '.m4v', '.avi', '.mkv'}
DEFAULT_PRESET = 'Fast 1080p30'

ABOVE_NORMAL_PRIORITY_CLASS = 0x00008000
PROCESS_POWER_THROTTLING = 4
PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1
PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1


def configure_utf8_stdio() -> None:
    for handle_name, errors in (('stdout', 'strict'), ('stderr', 'replace')):
        handle = getattr(sys, handle_name, None)

        if handle is None or not hasattr(handle, 'reconfigure'):
            continue

        try:
            handle.reconfigure(encoding='utf-8', errors=errors)
        except (ValueError, OSError):
            continue


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


def load_resume_items(value: str):
    if not value:
        return []

    parsed = json.loads(value)

    if not isinstance(parsed, list):
        return []

    items = []
    for item in parsed:
        if not isinstance(item, dict):
            continue

        source = item.get('source')
        output = item.get('output')

        if isinstance(source, str) and isinstance(output, str):
            items.append({'source': source, 'output': output})

    return items


def load_resume_items_from_file(file_path: str):
    if not file_path:
        return []

    resume_file = Path(file_path)

    if not resume_file.is_file():
        return []

    return load_resume_items(resume_file.read_text(encoding='utf-8'))


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


def build_output_path(source_dir: Path, output_dir: Path, source_file: Path, output_format_mode: str, operation: str) -> Path:
    relative_path = source_file.relative_to(source_dir)
    output_file = output_dir / relative_path

    if operation == 'compress' and output_format_mode == 'mp4':
        return output_file.with_suffix('.mp4')

    return output_file


def emit_event(payload: dict):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def now_ms() -> int:
    return int(time.time() * 1000)


def has_same_file_metadata(source_file: Path, output_file: Path) -> bool:
    if not output_file.exists():
        return False

    try:
        source_stat = source_file.stat()
        output_stat = output_file.stat()
    except OSError:
        return False

    return source_stat.st_size == output_stat.st_size and source_stat.st_mtime_ns == output_stat.st_mtime_ns


def copy_if_changed(source_file: Path, output_file: Path) -> bool:
    if has_same_file_metadata(source_file, output_file):
        return True

    temp_file = build_temp_output_path(output_file)

    try:
        shutil.copy2(source_file, temp_file)
        os.replace(temp_file, output_file)
    finally:
        try:
            temp_file.unlink(missing_ok=True)
        except OSError:
            pass

    return False


def build_temp_output_path(output_file: Path) -> Path:
    return output_file.with_name(f'.{output_file.name}.media-organizer-tmp-{os.getpid()}-{time.time_ns()}{output_file.suffix}')


def should_keep_larger_mp4_conversion(source_file: Path, output_format_mode: str) -> bool:
    return output_format_mode == 'mp4' and source_file.suffix.lower() != '.mp4'


def cleanup_stale_temp_outputs(output_file: Path):
    pattern = f'.{output_file.name}.media-organizer-tmp-*{output_file.suffix}'

    for candidate in output_file.parent.glob(pattern):
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            pass


def is_handbrake_performance_mode_enabled() -> bool:
    return os.name == 'nt'


class ProcessPowerThrottlingState(ctypes.Structure):
    _fields_ = [
        ('Version', ctypes.c_ulong),
        ('ControlMask', ctypes.c_ulong),
        ('StateMask', ctypes.c_ulong),
    ]


def disable_windows_power_throttling(process_handle) -> None:
    if os.name != 'nt':
        return

    state = ProcessPowerThrottlingState(
        Version=PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask=PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask=0,
    )

    ctypes.windll.kernel32.SetProcessInformation(
        ctypes.wintypes.HANDLE(process_handle),
        PROCESS_POWER_THROTTLING,
        ctypes.byref(state),
        ctypes.sizeof(state),
    )


def apply_windows_performance_mode(process: subprocess.Popen) -> None:
    if not is_handbrake_performance_mode_enabled():
        return

    try:
        ctypes.windll.kernel32.SetPriorityClass(ctypes.wintypes.HANDLE(process._handle), ABOVE_NORMAL_PRIORITY_CLASS)
        disable_windows_power_throttling(process._handle)
    except Exception:
        # Performance hints are best-effort; compression must keep working if Windows rejects them.
        return


def handbrake_creationflags() -> int:
    if not is_handbrake_performance_mode_enabled():
        return 0

    return ABOVE_NORMAL_PRIORITY_CLASS


def resolve_handbrake_hw_decode() -> str | None:
    return 'qsv' if os.name == 'nt' else None


def append_hw_decode(command: list[str], hw_decode: str | None) -> list[str]:
    if not hw_decode:
        return command

    return [*command, '--enable-hw-decoding', hw_decode]


def run_handbrake_process(command: list[str], *, capture: bool) -> subprocess.CompletedProcess[str]:
    stdout = subprocess.PIPE if capture else subprocess.DEVNULL
    stderr = subprocess.PIPE if capture else subprocess.DEVNULL
    process = subprocess.Popen(
        command,
        stdout=stdout,
        stderr=stderr,
        text=True,
        creationflags=handbrake_creationflags(),
    )
    apply_windows_performance_mode(process)
    stdout_text, stderr_text = process.communicate()

    if process.returncode != 0:
        raise subprocess.CalledProcessError(process.returncode, command, output=stdout_text, stderr=stderr_text)

    return subprocess.CompletedProcess(command, process.returncode, stdout_text, stderr_text)


def run_handbrake(command: list[str], fallback_command: list[str] | None):
    try:
        run_handbrake_process(command, capture=False)
        return
    except subprocess.CalledProcessError as first_error:
        if fallback_command is None:
            result = subprocess.run(command, check=False, capture_output=True, text=True)
            stderr = (result.stderr or result.stdout or '').strip()
            raise subprocess.CalledProcessError(result.returncode, command, output=result.stdout, stderr=stderr) from first_error

    try:
        run_handbrake_process(fallback_command, capture=False)
    except subprocess.CalledProcessError as fallback_error:
        result = subprocess.run(fallback_command, check=False, capture_output=True, text=True)
        stderr = (result.stderr or result.stdout or '').strip()
        raise subprocess.CalledProcessError(result.returncode, fallback_command, output=result.stdout, stderr=stderr) from fallback_error


def iter_video_files(source_dir: Path):
    for root, _, files in os.walk(source_dir):
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() in VIDEO_EXTENSIONS:
                yield file_path


def parse_handbrake_presets(output: str):
    presets = []
    current_category = None
    category_indent = 0

    for line in output.splitlines():
        if not line.strip():
            continue

        stripped = line.strip()
        indent = len(line) - len(line.lstrip())

        if stripped.endswith('/'):
            current_category = stripped[:-1].strip()
            category_indent = indent
            continue

        if current_category is None:
            continue

        if indent == category_indent + 4:
            preset_name = stripped.replace('(Default)', '').replace('(Por defecto)', '').strip()
            if preset_name:
                presets.append(preset_name)
            continue

        if indent <= category_indent:
            current_category = None

    return presets


def resolve_preset(encoder_command: str, requested_preset: str) -> str:
    normalized_requested = (requested_preset or '').strip()

    if not normalized_requested:
        return DEFAULT_PRESET

    try:
        result = subprocess.run(
            [encoder_command, '--preset-list'],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:
        return normalized_requested

    output = '\n'.join(part for part in [result.stdout, result.stderr] if part)
    presets = parse_handbrake_presets(output)

    if not presets:
        return normalized_requested

    presets_map = {preset.lower(): preset for preset in presets}
    exact_match = presets_map.get(normalized_requested.lower())

    if exact_match:
        return exact_match

    default_match = presets_map.get(DEFAULT_PRESET.lower())

    if default_match:
        return default_match

    return presets[0]


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description='Compress videos into a destination folder.')
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--preset', default=DEFAULT_PRESET)
    parser.add_argument('--output-format-mode', choices=['preserve', 'mp4'], default='preserve')
    parser.add_argument('--encoder-command', default='HandBrakeCLI')
    parser.add_argument('--video-mode', choices=['compress', 'copy'], default='compress')
    parser.add_argument('--selection-scope-json', default='')
    parser.add_argument('--resume-skip-file', default='')
    parser.add_argument('--resume-skip-json', default='')
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    scope = resolve_scope(source_dir, load_scope(args.selection_scope_json))
    resolved_preset = resolve_preset(args.encoder_command, args.preset) if args.video_mode == 'compress' else args.preset
    hw_decode = resolve_handbrake_hw_decode() if args.video_mode == 'compress' else None
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    resume_items = load_resume_items_from_file(args.resume_skip_file) or load_resume_items(args.resume_skip_json)
    skipped_sources = {normalize_path(item['source']) for item in resume_items}

    for source_file in iter_video_files(source_dir):
        if normalize_path(str(source_file)) in skipped_sources:
            continue

        operation = 'compress' if args.video_mode == 'compress' and should_compress(source_file, scope) else 'copy'
        output_file = build_output_path(source_dir, output_dir, source_file, args.output_format_mode, operation)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        cleanup_stale_temp_outputs(output_file)
        command_output_file = build_temp_output_path(output_file) if operation == 'compress' else output_file

        fallback_command = [] if operation == 'copy' else [
            args.encoder_command,
            '-i',
            str(source_file),
            '-o',
            str(command_output_file),
            '--preset',
            resolved_preset,
        ]
        if args.output_format_mode == 'mp4' and operation == 'compress':
            fallback_command.extend(['--format', 'av_mp4'])

        command = append_hw_decode(fallback_command, hw_decode)
        status = 'completed'
        error_message = None
        skipped = False
        outcome = None
        source_bytes = None
        encoded_bytes = None
        started_at = now_ms()

        emit_event({
            'type': 'start',
            'item': {
                'source': str(source_file),
                'output': str(output_file),
                'command': command,
                'operation': operation,
                'startedAt': started_at,
            },
        })

        if operation == 'copy':
            skipped = copy_if_changed(source_file, output_file)
        else:
            try:
                run_handbrake(command, fallback_command if hw_decode else None)
                source_bytes = source_file.stat().st_size
                encoded_bytes = command_output_file.stat().st_size

                if encoded_bytes >= source_bytes and not should_keep_larger_mp4_conversion(source_file, args.output_format_mode):
                    outcome = 'original-retained-size'
                    copy_if_changed(source_file, output_file)
                else:
                    os.replace(command_output_file, output_file)
            except FileNotFoundError:
                status = 'failed'
                error_message = f"Video encoder command not found: {args.encoder_command}"
            except subprocess.CalledProcessError as error:
                status = 'failed'
                stderr = (error.stderr or '').strip()
                error_message = stderr or f"Video compression failed for {source_file}"
            finally:
                if operation == 'compress':
                    try:
                        command_output_file.unlink(missing_ok=True)
                    except OSError:
                        pass

        if status == 'failed':
            copy_if_changed(source_file, output_file)

        finished_at = now_ms()
        item = {
            'source': str(source_file),
            'output': str(output_file),
            'command': command,
            'status': status,
            'operation': operation,
            'startedAt': started_at,
            'finishedAt': finished_at,
            'durationMs': finished_at - started_at,
            'skipped': skipped,
            'error': error_message,
            'outcome': outcome,
            'sourceBytes': source_bytes,
            'encodedBytes': encoded_bytes,
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
