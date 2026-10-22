"""Small stdlib integration check for the repository's pipeline wiring."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / ".hermes" / "pipeline"
sys.path.insert(0, str(PIPELINE))

import yaml
from prchecklist import check_pr_body


class PipelineAdoptionTest(unittest.TestCase):
    def test_manifest_and_existing_ci_are_wired_without_duplicate_commands(self):
        manifest = yaml.safe_load((ROOT / ".hermes/pipeline.yaml").read_text())
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertEqual(manifest["base"], "origin/main")
        self.assertEqual(manifest["supply_chain"]["pnpm_minimumReleaseAge"], 4320)
        self.assertEqual(manifest["gates"]["typecheck"]["cmd"], "pnpm typecheck")
        self.assertIn("pnpm build && pnpm test && node apps/bot/scripts/smoke-admin.mjs", manifest["gates"]["unit"]["cmd"])
        for command in ("pnpm typecheck", "pnpm build", "pnpm test", "node apps/bot/scripts/smoke-admin.mjs"):
            self.assertEqual(ci.count(command), 1, command)
        self.assertIn("fetch-depth: 0", ci)
        self.assertIn("HPIPE_DIFF_SOURCE", ci)
        self.assertIn("run_gate.py g0-laziness secrets db-guard pr-checklist supply-chain decision-citation", ci)
        self.assertIn("GITHUB_EVENT_PATH: ${{ github.event_path }}", ci)

    def test_ui_journeys_are_gated_on_rendered_surface_changes(self):
        package = json.loads((ROOT / "package.json").read_text())
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        verify = package["scripts"]["ui:verify"]
        for harness in ("organizer-browser.mjs", "participant-browser.mjs"):
            self.assertIn(harness, verify)
        self.assertIn("pnpm ui:verify", ci)
        self.assertIn("apps/admin-ui apps/bot/src", ci)

    def test_checklist_gate_refuses_missing_acceptance_heading(self):
        valid = check_pr_body("## Requirements\n- item\n## Acceptance\n- evidence")
        invalid = check_pr_body("## Requirements\n- item")
        self.assertEqual(len(valid), 0)
        self.assertTrue(any("Acceptance" in item.evidence for item in invalid))


if __name__ == "__main__":
    unittest.main()
