"""Small stdlib integration check for the repository's pipeline wiring."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / ".hermes" / "pipeline"
sys.path.insert(0, str(PIPELINE))

import yaml
from prchecklist import check_pr_body


class PipelineAdoptionTest(unittest.TestCase):
    def test_ci_database_urls_match_the_disposable_service(self):
        from urllib.parse import urlsplit

        job = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())["jobs"]["verify"]
        service = job["services"]["postgres"]["env"]
        for step in job["steps"]:
            url = step.get("env", {}).get("DATABASE_URL")
            if url:
                parsed = urlsplit(url)
                self.assertEqual(parsed.username, service["POSTGRES_USER"], step["name"])
                self.assertEqual(parsed.password, service["POSTGRES_PASSWORD"], step["name"])
                self.assertEqual(parsed.path, "/" + service["POSTGRES_DB"], step["name"])

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
        manifest = yaml.safe_load((ROOT / ".hermes/pipeline.yaml").read_text())
        self.assertTrue(manifest["gates"]["unit"]["cmd"].endswith("&& pnpm ui:verify"))
        self.assertIn("should-run-ui-verify.mjs", ci)
        self.assertIn("github.event.before", ci)

    def test_browser_gate_selection_executes_for_harness_and_gate_changes(self):
        selector = ROOT / "scripts/should-run-ui-verify.mjs"
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            for key, value in (("user.name", "janne022"), ("user.email", "jannis020609@gmail.com")):
                subprocess.run(["git", "-C", str(repo), "config", key, value], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "commit.gpgsign", "false"], check=True)
            paths = ("apps/bot/scripts/organizer-browser.mjs", "apps/bot/scripts/participant-browser.mjs", "apps/admin-ui/src/App.tsx", "apps/bot/src/index.ts", "apps/bot/scripts/chrome-path.mjs", "apps/bot/scripts/chrome-startup.mjs", "apps/bot/scripts/chrome-startup.test.mjs", "package.json", ".github/workflows/ci.yml", ".hermes/pipeline.yaml", ".hermes/pipeline/test_adoption.py", "scripts/should-run-ui-verify.mjs", "unrelated.txt")
            for path in paths:
                target = repo / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("initial\n")
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
            subprocess.run(["git", "-C", str(repo), "commit", "-qm", "base"], check=True)
            base = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
            for path in paths:
                subprocess.run(["git", "-C", str(repo), "reset", "--hard", base], check=True, stdout=subprocess.DEVNULL)
                (repo / path).write_text("changed\n")
                subprocess.run(["git", "-C", str(repo), "add", path], check=True)
                subprocess.run(["git", "-C", str(repo), "commit", "-qm", path], check=True)
                result = subprocess.run(["node", str(selector), base], cwd=repo, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1"})
                self.assertEqual(result.returncode, 0 if path != "unrelated.txt" else 1, path)
            # Execute the actual workflow shell for PR/push and fallback paths.
            ci = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
            step = next(s for s in ci["jobs"]["verify"]["steps"] if s.get("name") == "Browser journey gates")
            script = step["run"].replace('${{ github.event.pull_request.base.sha || github.event.before }}', '${EVENT_BASE}')
            (repo / "scripts/should-run-ui-verify.mjs").write_text(selector.read_text())
            bin_dir = repo / "bin"
            bin_dir.mkdir()
            pnpm = bin_dir / "pnpm"
            pnpm.write_text('#!/bin/sh\nprintf "journeys invoked\\n"\nexit "${JOURNEY_EXIT:-0}"\n')
            pnpm.chmod(0o755)
            (repo / "package.json").write_text("changed gate\n")
            subprocess.run(["git", "add", "package.json"], cwd=repo, check=True)
            subprocess.run(["git", "commit", "-qm", "gate change"], cwd=repo, check=True)
            for revision, should_run in ((base, True), ("HEAD~1", True), ("HEAD", False), ("", True), ("0" * 40, True)):
                result = subprocess.run(["bash", "-e", "-c", script], cwd=repo, env={**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"], "EVENT_BASE": revision}, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual("journeys invoked" in result.stdout, should_run)
            for revision, expected in ((base, 23), ("", 23), ("missing-revision", 128)):
                result = subprocess.run(["bash", "-e", "-c", script], cwd=repo, env={**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"], "EVENT_BASE": revision, "JOURNEY_EXIT": "23"}, capture_output=True)
                self.assertEqual(result.returncode, expected)

    def test_checklist_gate_refuses_missing_acceptance_heading(self):
        valid = check_pr_body("## Requirements\n- item\n## Acceptance\n- evidence")
        invalid = check_pr_body("## Requirements\n- item")
        self.assertEqual(len(valid), 0)
        self.assertTrue(any("Acceptance" in item.evidence for item in invalid))


if __name__ == "__main__":
    unittest.main()
