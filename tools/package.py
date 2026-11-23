#!/usr/bin/env python3
"""Build Stargazer's BEacon ZIP (dist/Stargazer.zip) for Store -> Upload ZIP or a release.

    python3 tools/package.py [--output dist/Stargazer.zip]

Layout (BEam docs/custom-skills.md): manifest.json, icon.png, banner.png and README.md at the root,
where README.md is the owner's text that the 5x1 Store reads from the repository and BEacon shows from
the ZIP (BEacon's simple Markdown: headings, paragraphs, flat lists, bold; no tables); DEVELOPMENT.md stays out,
and one package root, stargazer/, holding the @be/stargazer asset-pack with its
JavaScript main. No npm or build step runs on the robot, so the ZIP carries everything.
The ZIP is deterministic (sorted entries, fixed timestamps, no exec bits) and checked
against BEacon's limits: 32 MB compressed, 64 MB expanded, 1,024 entries.
"""
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SKILL = 'stargazer'
MAX_ZIP, MAX_EXPANDED, MAX_ENTRIES = 32 * 1024 * 1024, 64 * 1024 * 1024, 1024
STAMP = (2026, 1, 1, 0, 0, 0)
STORE_FILES = {'manifest.json': 'manifest.json', 'icon.png': 'icon.png', 'banner.png': 'banner.png',
               'README.md': 'README.md'}     # ZIP name: source file


def check_package():
    manifest = json.loads((HERE / 'manifest.json').read_text())
    package = json.loads((HERE / SKILL / 'package.json').read_text())
    if manifest.get('type') != 'skill' or not manifest.get('supported'):
        sys.exit('manifest.json needs type "skill" and a "supported" jibo-tbd version')
    if manifest['version'] != package['version']:
        sys.exit('manifest.json and package.json versions differ')
    if package['name'] != '@be/' + SKILL or package['jibo']['type'] != 'asset-pack':
        sys.exit(f'{SKILL}/package.json must be the @be/{SKILL} asset-pack')
    main = package.get('main', 'index.js')
    if not main.endswith('.js') or not (HERE / SKILL / main).is_file():
        sys.exit(f'package main {main} is missing')
    return manifest['version']


def collect():
    entries = {name: (HERE / source).read_bytes() for name, source in STORE_FILES.items()}
    entries[f'{SKILL}/LICENSE'] = (HERE / 'LICENSE').read_bytes()     # the MIT licence travels with the code
    for file in sorted((HERE / SKILL).rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('.'):
            entries[f'{SKILL}/{file.relative_to(HERE / SKILL).as_posix()}'] = file.read_bytes()
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--output', type=Path, default=HERE / 'dist' / 'Stargazer.zip')
    args = parser.parse_args()
    version = check_package()
    entries = collect()
    if len(entries) > MAX_ENTRIES:
        sys.exit(f'{len(entries)} entries; BEacon accepts {MAX_ENTRIES}')
    expanded = sum(len(data) for data in entries.values())
    if expanded > MAX_EXPANDED:
        sys.exit(f'{expanded} bytes expanded; BEacon accepts {MAX_EXPANDED}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, entries[name])
    size = temporary.stat().st_size
    if size > MAX_ZIP:
        temporary.unlink()
        sys.exit(f'{size} bytes compressed; BEacon accepts {MAX_ZIP}')
    temporary.replace(args.output)
    print(json.dumps({'zip': str(args.output), 'version': version, 'entries': len(entries), 'expanded': expanded,
                      'compressed': size, 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}, indent=2))


if __name__ == '__main__':
    main()
