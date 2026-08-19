from __future__ import annotations

import sys

import compress_images
import compress_videos


def configure_utf8_stdio() -> None:
    for handle_name, errors in (('stdout', 'strict'), ('stderr', 'replace')):
        handle = getattr(sys, handle_name, None)

        if handle is None or not hasattr(handle, 'reconfigure'):
            continue

        try:
            handle.reconfigure(encoding='utf-8', errors=errors)
        except (ValueError, OSError):
            continue


def main() -> int:
    configure_utf8_stdio()
    if len(sys.argv) < 2 or sys.argv[1] not in {'images', 'videos'}:
        print('Usage: media-organizer-worker <images|videos> [arguments...]', file=sys.stderr)
        return 2

    phase = sys.argv.pop(1)
    if phase == 'images':
        return compress_images.main()

    return compress_videos.main()


if __name__ == '__main__':
    raise SystemExit(main())
