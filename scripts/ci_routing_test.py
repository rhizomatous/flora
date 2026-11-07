"""Exercise Nx itself so dependency changes cannot silently drop required jobs."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ci_plan', Path(__file__).with_name('ci-plan.py'))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class RoutingTest(unittest.TestCase):
    def test_task_selection(self):
        cases = [
            ('florets/src/components/button.tsx', {'frontend-check', 'styleguide', 'smoke', 'browser'}),
            ('florets/docs/src/guide.tsx', {'frontend-check', 'styleguide'}),
            ('web/src/main.tsx', {'frontend-check', 'smoke', 'browser'}),
            ('backend/internal/storage/store.go', {'go-check', 'race', 'smoke', 'browser', 'container-check', 'package-check'}),
            ('agent/image/Dockerfile', {'container-check', 'package-check'}),
            ('packaging/flora.service', {'package-check'}),
            ('README.md', set()),
            ('INSTALL.md', set()),
            ('LICENSE', set()),
            ('specs/PRD.md', set()),
            ('AGENTS.md', set()),
            ('new-component/file.go', set(ci.TARGETS)),
            ('package-lock.json', set(ci.TARGETS)),
            ('flake.lock', set(ci.TARGETS)),
            ('.github/workflows/ci.yml', set(ci.TARGETS)),
            ('backend/project.json', set(ci.TARGETS)),
        ]
        for path, expected in cases:
            with self.subTest(path=path):
                self.assertEqual(set(ci.plan([path])), expected)

    def test_full_and_empty_selection(self):
        self.assertEqual(set(ci.plan()), set(ci.TARGETS))
        self.assertEqual(ci.plan([]), [])

    def test_move_between_components_checks_both_sides(self):
        self.assertEqual(set(ci.plan(['florets/src/removed.ts', 'backend/added.go'])), set(ci.TARGETS))
