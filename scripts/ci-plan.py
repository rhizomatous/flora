"""Select checks from Nx task inputs; unknown paths require the full suite."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

TARGETS = ('frontend-check', 'styleguide', 'go-check', 'race', 'smoke', 'browser',
           'container-check', 'package-check')


def plan(files=None):
    # Unclassified directories must not silently escape test coverage.
    known = ('web/', 'florets/', 'backend/', 'agent/', 'packaging/', 'scripts/',
             'specs/', '.github/')
    if files is not None and any(
            ('/' in path and not path.startswith(known)) or
            ('/' not in path and not (path.endswith(('.md', '.json', '.lock', '.nix')) or
                                      path.startswith('.') or path in ('Makefile', 'LICENSE')))
            for path in files):
        files = None
    with tempfile.TemporaryDirectory() as directory:
        graph = Path(directory) / 'graph.json'
        command = ['node', 'node_modules/.bin/nx',
                   'run-many' if files is None else 'affected',
                   '-t', ','.join(TARGETS), '--graph=' + str(graph)]
        if files is not None:
            if not files:
                return []
            # Use Nx's file-list argument rather than shell interpolation.
            command += ['--files', *files]
        subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True,
                       env=dict(os.environ, NX_DAEMON='false'))
        tasks = json.loads(graph.read_text())['tasks']['tasks'].values()
        selected = {task['target']['target'] for task in tasks}
        return [target for target in TARGETS if target in selected]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--base')
    parser.add_argument('--head', default='HEAD')
    parser.add_argument('--files', nargs='*')
    parser.add_argument('--github-output')
    args = parser.parse_args()
    files = args.files
    if not args.all and files is None:
        if not args.base:
            parser.error('--base, --files, or --all is required')
        # Disabling rename detection includes both old and new names in routing.
        files = subprocess.check_output(['git', 'diff', '--name-only', '--no-renames',
                                         '-z', args.base + '...' + args.head], text=True).split('\0')
        files = [path for path in files if path]
    selected = plan(None if args.all else files)
    checks = [target for target in selected if target not in ('container-check', 'package-check')]
    result = {'check': bool(checks), 'agent': 'container-check' in selected,
              'package': 'package-check' in selected, 'check_targets': ','.join(checks)}
    print(json.dumps(result))
    if args.github_output:
        with open(args.github_output, 'a') as output:
            for key, value in result.items():
                output.write(f'{key}={str(value).lower() if isinstance(value, bool) else value}\n')


if __name__ == '__main__':
    main()
