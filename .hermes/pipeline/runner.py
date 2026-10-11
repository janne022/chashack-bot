"""runner — `hpipe check`: execute the gate plan, write the artifact, map exit codes.

Exit codes: 0 pass / 1 violation / 2 config error.
Ladder order per C3; stop at first FAIL unless `--all`.
Statuses: PASS / FAIL / SKIP / WARN.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

import contractorphans, dbguard, decisions, docclaims, g0, prchecklist, secrets, supplychain
from manifest import ManifestError, load_validate, plan_gates, resolve_defaults

GENERIC_ORDER = (
    "g0-laziness",
    "secrets",
    "db-guard",
    "pr-checklist",
    "supply-chain",
    "decision-citation",
)

# Gates that read the PR body: enforced on pull_request, skipped elsewhere.
PR_BODY_GATES = frozenset({"pr-checklist", "decision-citation"})


def _gate_entry(name: str, kind: str, status: str, violations: list[str],
                warnings: list[str], notes: list[str]) -> dict[str, Any]:
    return {
        "name": name,
        "kind": kind,
        "status": status,
        "violations": violations,
        "warnings": warnings,
        "notes": notes,
    }


def format_gate_report(gate: dict[str, Any]) -> list[str]:
    """The lines a reader of this run should see for one gate.

    ONE implementation for TWO surfaces: the `hpipe` CLI and the vendored
    `run_gate.py` that the generated CI workflow executes. When notes were
    recorded but only the CLI printed them, a CI log could not distinguish
    "the gate looked and decided" from "the rule never fired" — which is the
    confusion card t_3b542ea9 D-ENT.3 exists to remove. The two surfaces must
    not be able to disagree about what a run reported, so the formatting lives
    here and both call it.

    Notes are printed, not just recorded: `.hermes/artifacts/` is gitignored
    and no workflow step uploads it, so a note that lives only in the artifact
    is invisible to everyone who reads the run.
    """
    lines = [f"{gate['status']}: {gate['name']}"]
    for line in gate["violations"]:
        lines.append(f"  {line}")
    for line in gate["warnings"]:
        lines.append(f"  WARNING: {line}")
    for line in gate.get("notes", []):
        lines.append(f"  note: {line}")
    return lines


def run_checks(
    repo_root: Path,
    diff: str = "",
    pr_body: str | None = None,
    all_gates: bool = False,
    only: list[str] | None = None,
    base_ref: str | None = None,
    env: dict[str, str] | None = None,
    diff_receipt: dict[str, Any] | None = None,
) -> int:
    """Run the gate ladder against `diff`. Returns the process exit code.

    `env` is the PARENT environment for declared-gate subprocesses (defaults
    to os.environ); each gate's manifest env is layered on top of it — the
    child environment is never stripped of PATH/HOME (review finding 6).

    `diff_receipt` is what the caller resolved and scanned (card t_2f933f3c).
    It is recorded in the artifact so a reader can tell "scanned" from
    "assumed" without re-running anything. Callers that pass a diff string
    directly may omit it.
    """
    repo_root = Path(repo_root)
    parent_env = dict(env) if env is not None else dict(os.environ)
    try:
        manifest = load_validate(repo_root / ".hermes" / "pipeline.yaml")
        manifest = resolve_defaults(manifest, repo_root)
    except ManifestError as e:
        _write_artifact(repo_root, {
            "exit_code": 2,
            "errors": e.errors,
            "gates": [],
            "diff": _receipt_or_none(diff_receipt, base_ref),
        })
        return 2

    plan = plan_gates(manifest)
    if only:
        # An `only=` name that selects nothing means the caller asked for a gate
        # this repo cannot run. Filtering it away leaves an empty plan, and an
        # empty plan is indistinguishable from a clean run: `gates: []`, exit
        # 0, on a diff that may contain a real hit. Since every generated CI job
        # invokes the ladder with its own name as the sole `only=` value, that
        # is a green job that ran nothing — the exact defect card t_9e963c3f
        # exists to remove, one layer down. Exit 2 is this runner's existing
        # config-error code (an untrustworthy manifest); a caller naming a gate
        # that is not in the plan is the same class of mistake.
        planned = {g["name"] for g in plan}
        unknown = [name for name in only if name not in planned]
        if unknown:
            _write_artifact(repo_root, {
                "exit_code": 2,
                "errors": [
                    f"unknown or undeclared gate(s) requested: {', '.join(unknown)}; "
                    f"this repo's plan has: {', '.join(sorted(planned))}"
                ],
                "gates": [],
                "diff": _receipt_or_none(diff_receipt, base_ref),
            })
            return 2
        plan = [g for g in plan if g["name"] in only]

    results: list[dict[str, Any]] = []
    stop = False

    for gate in plan:
        name, kind = gate["name"], gate["kind"]
        if stop:
            results.append(
                _gate_entry(name, kind, "SKIP", [], [], ["stopped at first FAIL"])
            )
            continue

        entry = _run_gate(gate, repo_root, manifest, diff, pr_body, parent_env)

        # pr-checklist and decision-citation are only enforced on pull_request:
        # both read the PR body, so outside that context there is nothing to check.
        if name in PR_BODY_GATES and pr_body is None:
            entry = _gate_entry(name, kind, "SKIP", [], [], ["not a pull_request context"])

        results.append(entry)
        if entry["status"] == "FAIL" and not all_gates:
            stop = True

    failed = any(r["status"] == "FAIL" for r in results)
    exit_code = 1 if failed else 0
    artifact = {
        "exit_code": exit_code,
        "gates": results,
        "stopped_early": stop,
        "diff": _receipt_or_none(diff_receipt, base_ref),
    }
    _write_artifact(repo_root, artifact)
    return exit_code


def _receipt_or_none(
    diff_receipt: Any, base_ref: str | None
) -> dict[str, Any] | None:
    """Accept a DiffReceipt or an already-serialised mapping."""
    if diff_receipt is None:
        if base_ref is None:
            return None
        return {"state": "SCANNED", "base": base_ref, "source": "caller"}
    if hasattr(diff_receipt, "to_dict"):
        return diff_receipt.to_dict()
    return dict(diff_receipt)


def _run_gate(
    gate: dict[str, Any],
    repo_root: Path,
    manifest,
    diff: str,
    pr_body: str | None,
    parent_env: dict[str, str] | None = None,
) -> dict[str, Any]:
    name, kind = gate["name"], gate["kind"]
    base_env = parent_env if parent_env is not None else dict(os.environ)

    if name == "doc-claims":
        # Declared, toolkit-implemented and diff-independent: it reads the
        # manifest's file set, not the change under review, so a doc that has
        # drifted from the code is caught on the run that touches nothing else.
        res = docclaims.run(repo_root, gate.get("spec"))
        violations = [v.format() for v in res.violations]
        return _gate_entry(
            name, kind, "FAIL" if violations else "PASS", violations, [], res.notes
        )

    if name == "contract-orphans":
        # Declared and toolkit-implemented (t_721843ff), but diff-scoped
        # where doc-claims is diff-independent: the gate reads the graph
        # projection's actionable unmatched contracts and fails only when
        # the diff under review touches one. The `diff` bytes here are the
        # ladder's one receipt — this gate never resolves its own base.
        violations, notes = contractorphans.run(repo_root, diff)
        status = "FAIL" if violations else ("SKIP" if _skipped(notes) else "PASS")
        return _gate_entry(name, kind, status, violations, [], notes)

    if kind == "generic":
        if name == "g0-laziness":
            res = g0.g0_scan(diff, stacks=manifest.stacks)
            violations = [v.format() for v in res.violations]
            warnings = [v.format() for v in res.warnings]
            notes = res.notes
        elif name == "secrets":
            res = secrets.scan_secrets(diff)
            violations = [v.format() for v in res.violations]
            warnings = []
            notes = res.notes
        elif name == "db-guard":
            res = dbguard.scan_db_guard(diff, pattern=manifest.db_guard_pattern)
            violations = [v.format() for v in res.violations]
            warnings = []
            notes = res.notes
        elif name == "pr-checklist":
            res = prchecklist.check_pr_body(pr_body)
            violations = [v.format() for v in res.violations]
            warnings = []
            notes = res.notes
        elif name == "supply-chain":
            res = supplychain.check_supply_chain(
                repo_root, pnpm_minimum_release_age=manifest.pnpm_minimum_release_age
            )
            violations = [v.format() for v in res.violations]
            # An uncovered ecosystem (NuGet/uv) is advisory: WARN, exit 0.
            warnings = list(res.warnings)
            notes = res.notes
            if res.skipped:
                entry = _gate_entry(
                    "supply-chain", "generic", "SKIP", [], [], notes
                )
                return entry
        elif name == "decision-citation":
            # Card D1.5 trigger is "a CHANGED file falls under an accepted
            # record's scope prefix". A deletion is a change: removing code a
            # decision governs is exactly when that decision's standing matters.
            touched = [f.path for f in g0.parse_diff(diff)]
            found = decisions.violations_for(repo_root, touched, pr_body)
            violations = [v.format() for v in found]
            warnings = []
            notes = [] if found else [
                "decision-citation: no accepted record governs the changed paths"
            ]
        else:  # pragma: no cover — canonical names are closed
            violations, warnings, notes = [], [], []
        status = "FAIL" if violations else ("WARN" if warnings else "PASS")
        return _gate_entry(name, kind, status, violations, warnings, notes)

    # declared gate: run cmd in workdir with env/timeout
    cmd = gate.get("cmd")
    if not cmd:
        return _gate_entry(name, kind, "SKIP", [], [], ["no command configured"])

    workdir = repo_root / gate.get("workdir", ".")
    env = {**base_env, **(gate.get("env") or {})}
    timeout = gate.get("timeout_minutes", 15) * 60

    if name == "e2e":
        return _run_e2e(gate, repo_root, workdir, env, timeout)

    if name == "contract-drift":
        return _run_contract_drift(gate, repo_root, workdir, env, timeout)

    started = time.time()
    try:
        proc = subprocess.run(
            cmd, shell=True, cwd=workdir, env=env, capture_output=True,
            text=True, timeout=timeout,
        )
        ok = proc.returncode == 0
        detail = (proc.stdout + proc.stderr).strip()[-2000:]
    except (subprocess.TimeoutExpired, OSError) as e:
        ok = False
        detail = str(e)
    _ = started
    status = "PASS" if ok else "FAIL"
    return _gate_entry(name, kind, status, [] if ok else [f"{cmd}: {detail}"], [], [])


def _skipped(notes: list[str]) -> bool:
    """Whether the contract-orphans notes carry a loud skip (no graph)."""
    return any("skipped" in note for note in notes)


def _run_contract_drift(
    gate: dict[str, Any], repo_root: Path, workdir: Path, env: dict, timeout: int
) -> dict[str, Any]:
    """Spec §4 steps 1-3: (1) assert the committed spec exists; (2) run
    gen_cmd (a failed generation fails the gate — it must never silently
    pass check_cmd on an unchanged tree); (3) run check_cmd; drift -> FAIL
    with fail_hint embedded."""
    spec_rel = gate.get("spec", "")
    check_cmd = gate.get("check_cmd", "")
    fail_hint = gate.get("fail_hint")
    gen_cmd = gate.get("cmd")

    if not spec_rel or not (repo_root / spec_rel).exists():
        return _gate_entry(
            "contract-drift",
            "declared",
            "FAIL",
            [f"contract-drift: spec file not found: {spec_rel or '<unset>'}"],
            [],
            [],
        )

    try:
        gen = subprocess.run(gen_cmd, shell=True, cwd=workdir, env=env,
                             capture_output=True, text=True, timeout=timeout,
                             check=False)
        if gen.returncode != 0:
            detail = (gen.stdout + gen.stderr).strip()[-2000:]
            msg = f"gen_cmd failed (exit {gen.returncode}): {gen_cmd}: {detail}"
            if fail_hint:
                msg += f" — {fail_hint}"
            return _gate_entry("contract-drift", "declared", "FAIL", [msg], [], [])
        proc = subprocess.run(check_cmd, shell=True, cwd=repo_root, env=env,
                              capture_output=True, text=True, timeout=timeout)
        drift = proc.returncode != 0
        detail = (proc.stdout + proc.stderr).strip()[-2000:]
    except (subprocess.TimeoutExpired, OSError) as e:
        drift = True
        detail = str(e)
    if drift:
        msg = f"contract drift detected: {detail}"
        if fail_hint:
            msg += f" — {fail_hint}"
        return _gate_entry("contract-drift", "declared", "FAIL", [msg], [], [])
    return _gate_entry("contract-drift", "declared", "PASS", [], [], [])


def _run_e2e(
    gate: dict[str, Any], repo_root: Path, workdir: Path, env: dict, timeout: int
) -> dict[str, Any]:
    services = gate.get("services") or []
    compose_file = gate.get("compose_file", "docker-compose.yml")
    journeys_precheck = gate.get("journeys_precheck", True)
    notes: list[str] = []

    if journeys_precheck:
        res = _journeys_precheck(repo_root, gate)
        if res is not None:
            return res
        journeys_rel = gate.get("journeys_dir") or ".hermes/journeys"
        journeys_dir = repo_root / journeys_rel
        if not journeys_dir.exists():
            # D-B3: never a silent pass — the PR reader must see the skip.
            notes.append(f"journeys pre-check skipped: no {journeys_rel} directory")
        elif not any(journeys_dir.glob("*.feature")):
            notes.append(
                f"journeys pre-check skipped: no *.feature files in {journeys_rel}"
            )
        else:
            notes.append("journeys pre-check: all feature stems covered")

    if services:
        try:
            subprocess.run(
                f"docker compose -f {compose_file} up -d {' '.join(services)}",
                shell=True, cwd=repo_root, capture_output=True, text=True,
                timeout=timeout, check=True,
            )
        except (subprocess.SubprocessError, OSError) as e:
            subprocess.run(
                f"docker compose -f {compose_file} down", shell=True, cwd=repo_root,
                capture_output=True, text=True, timeout=60, check=False,
            )
            return _gate_entry("e2e", "declared", "FAIL",
                               [f"compose up failed: {e}"], [], notes)

    try:
        proc = subprocess.run(gate["cmd"], shell=True, cwd=workdir, env=env,
                              capture_output=True, text=True, timeout=timeout)
        ok = proc.returncode == 0
        detail = (proc.stdout + proc.stderr).strip()[-2000:]
    except (subprocess.TimeoutExpired, OSError) as e:
        ok = False
        detail = str(e)
    finally:
        if services:
            subprocess.run(
                f"docker compose -f {compose_file} down", shell=True, cwd=repo_root,
                capture_output=True, text=True, timeout=60, check=False,
            )

    if ok:
        return _gate_entry("e2e", "declared", "PASS", [], [], notes)
    return _gate_entry("e2e", "declared", "FAIL", [f"{gate['cmd']}: {detail}"], [], notes)


JOURNEY_TEST_GLOBS = ("**/*.spec.ts", "**/*.spec.tsx", "**/*.test.ts",
                      "**/*.test.tsx", "**/*Tests.cs", "**/*_test.py")

# Rule 2 (skill §A) is conditional: it binds only a feature that has forms,
# lists, or network calls (D-B5). The trigger is a word-exact scan of
# Given/When step lines — a lint, never a Gherkin semantic model.
#
# A token earns its place only when its bare presence in a step is evidence of
# the condition. `put` (HTTP-only), `table` and `row` (common container nouns:
# "the table of contents", "a row of tabs") were dropped as bare English
# homographs — a false FAIL blocks a real PR (D-B5); `list`/`grid` still carry
# the list case. `save`/`post`/`field`/`form` stay (see PR blind spots).
_JOURNEY_TRIGGER_TOKENS = (
    "form", "field", "input", "textarea", "checkbox", "select", "dropdown",
    "toggle", "button", "list", "grid", "submit", "save",
    "request", "fetch", "upload", "send", "create", "update", "delete",
    "post", "patch",
)
# Whole-word match plus common inflections only: `form`/`list`/`post`/`select`
# must NOT fire on `format`, `listen`, `postal`, `selection`.
JOURNEY_TRIGGER_RE = re.compile(
    r"\b(?:" + "|".join(_JOURNEY_TRIGGER_TOKENS) + r")(?:s|es|ed|d|ing)?\b",
    re.IGNORECASE,
)
# Rule 2's required states are read off the `state` half of the title
# ("Add a recipe - validation failure" -> "validation failure"), per D-B4.
JOURNEY_FAILURE_RE = re.compile(
    r"fail|error|invalid|reject|cannot|can't|unable|missing|denied|conflict|"
    r"timeout|offline"
)
JOURNEY_EMPTY_RE = re.compile(
    r"empty|no results?|no items?|no entr|no records?|no data|\bnone\b|\bzero\b|blank"
)


def _journey_scenario_titles(feature_text: str) -> list[str]:
    """`Scenario:`/`Scenario Outline:` titles in file order (tolerant scan)."""
    titles: list[str] = []
    for raw in feature_text.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        m = re.match(r"Scenario\s*(?:Outline\s*)?:", line, re.IGNORECASE)
        if m:
            titles.append(line[m.end():].strip())
    return titles


def _journey_state_suffix(title: str) -> str | None:
    """The `state` half of a `Capability - state` title, or None when absent."""
    idx = title.rfind(" - ")
    if idx == -1:
        return None
    return title[idx + 3:].strip().lower() or None


def _journey_triggers_rule2(feature_text: str) -> bool:
    """True when a Given/When step names a form field, a list, or a request.

    And/But inherit the preceding keyword; every other line is not a step.
    Vocabulary the regex does not know does NOT trigger the rule: a false FAIL
    would block a real PR (D-B5).
    """
    keyword = None
    for raw in feature_text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("@"):
            continue
        m = re.match(r"(Given|When|Then|And|But)\b", line, re.IGNORECASE)
        if not m:
            keyword = None
            continue
        kw = m.group(1).lower()
        if kw in ("and", "but"):
            kw = keyword
        else:
            keyword = kw
        if kw in ("given", "when") and JOURNEY_TRIGGER_RE.search(line):
            return True
    return False


def _journeys_precheck(repo_root: Path, gate: dict[str, Any]) -> dict[str, Any] | None:
    """Journey validity pre-check for the declared ``e2e`` gate (§A).

    Mechanical and stdlib-only (D-B6):

    * every ``*.feature`` stem appears as ``@journey:<stem>`` in e2e sources;
    * rule 4 — every ``Scenario:`` title is shaped ``Capability - state``;
    * rule 2 — a feature whose Given/When steps name a form, a list, or a
      network action carries both a failure and an empty-state scenario.

    Returns a FAIL entry when any check fires, else None. Every FAIL records its
    inference in ``notes`` so a reader can see which titles it counted (D-B4).
    An absent (or feature-less) journeys dir is a skip, never a silent pass.
    """
    journeys_dir = repo_root / (gate.get("journeys_dir") or ".hermes/journeys")
    if not journeys_dir.exists():
        return None  # no journeys declared -> pre-check skipped
    features = sorted(journeys_dir.glob("*.feature"))
    if not features:
        return None

    tagged: set[str] = set()
    for pattern in JOURNEY_TEST_GLOBS:
        for path in repo_root.glob(pattern):
            try:
                tagged.update(
                    re.findall(
                        r"@journey:([\w-]+)",
                        path.read_text(encoding="utf-8", errors="replace"),
                    )
                )
            except OSError:
                continue

    violations: list[str] = []
    notes: list[str] = []
    for feature in features:
        if feature.stem not in tagged:
            violations.append(
                f"journeys pre-check: no @journey:{feature.stem} tag in e2e sources"
            )
        try:
            # errors="replace": a cp1252/latin-1 feature is mojibake here, not a
            # crash with no gate status. A lint never fails on the encoding.
            text = feature.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        titles = _journey_scenario_titles(text)
        suffixes = {t: _journey_state_suffix(t) for t in titles}
        unshaped = [t for t, s in suffixes.items() if s is None]
        if unshaped:
            violations.append(
                f"journeys pre-check: {feature.name}: scenario title(s) lack the "
                f"'Capability - state' shape (rule 4): " + "; ".join(unshaped)
            )
            notes.append(
                f"rule 4: {feature.name} read scenario titles: "
                + ("; ".join(titles) or "(none)")
            )
        if _journey_triggers_rule2(text):
            states = sorted({s for s in suffixes.values() if s})
            missing = []
            if not any(JOURNEY_FAILURE_RE.search(s) for s in states):
                missing.append("failure")
            if not any(JOURNEY_EMPTY_RE.search(s) for s in states):
                missing.append("empty-state")
            if missing:
                violations.append(
                    f"journeys pre-check: {feature.name}: happy-path-only feature "
                    f"(rule 2) — forms/lists/network steps present, but no "
                    f"{' and no '.join(missing)} scenario"
                )
                notes.append(
                    f"rule 2: {feature.name} counted scenario titles: "
                    + ("; ".join(titles) or "(none)")
                    + " | states: " + (", ".join(states) or "(none)")
                    + f" | missing: {', '.join(missing)}"
                )
    if violations:
        return _gate_entry("e2e", "declared", "FAIL", violations, [], notes)
    return None


def _cell(value: Any) -> str:
    """One markdown table cell: a pipe in the value is escaped, not literal."""
    return "`" + str(value).replace("|", r"\|") + "`"


def format_run_summary(
    gates: list[dict[str, Any]], diff_receipt: dict[str, Any] | None
) -> str:
    """The run as one markdown block: the diff, then every gate.

    A reader of a CI run asks two questions — what was scanned, and did every
    gate actually run? — and the answer to the second is not "the run was
    green". `db-guard`, `pr-checklist` and `supply-chain` legitimately SKIP on
    a repo with no governed scope, and a summary that only listed failures
    would render those skips invisible, so "all gates green" and "three
    gates did not run" would be the same text.

    `SKIP` rows carry the reason, because an unexplained skip cannot be told
    apart from a rule that never fired.
    """
    lines: list[str] = ["## Gate ladder", ""]
    if diff_receipt:
        base = diff_receipt.get("base") or "unresolved"
        command = diff_receipt.get("command") or "no diff command recorded"
        lines += [
            f"- base: `{base}`",
            f"- command: `{command}`",
            f"- state: `{diff_receipt.get('state', 'unknown')}`",
            "",
        ]
    if not gates:
        lines.append("_no gate ran (an empty ladder is not a pass)_")
        return "\n".join(lines) + "\n"
    lines += ["| gate | status | detail |", "| --- | --- | --- |"]
    for gate in gates:
        detail = gate["violations"] or gate.get("notes") or gate.get("warnings") or []
        # Markdown splits a table row on `|`, and a violation embeds a
        # rendered excerpt of the offending line — so code under review
        # containing a pipe would silently add a column and the row would no
        # longer line up with its header. Backticks do not protect a pipe.
        rows = [f"| `{gate['name']}` | **{gate['status']}** | {_cell(d)} |"
                for d in detail]
        lines += rows or [f"| `{gate['name']}` | **{gate['status']}** | — |"]
    return "\n".join(lines) + "\n"


def write_step_summary(text: str, env: Any = None) -> bool:
    """Append the run summary to `$GITHUB_STEP_SUMMARY` when CI set one.

    Returns whether it was written. Absence of the variable is the normal
    local case and is not an error; an unwritable path is also not the run's
    verdict — the log carries the same report, and a reporting problem must
    not be able to turn a real FAIL into a green run or vice versa.
    """
    env = os.environ if env is None else env
    path = env.get("GITHUB_STEP_SUMMARY")
    if not path:
        return False
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text if text.endswith("\n") else text + "\n")
    except OSError:
        return False
    return True


def _write_artifact(repo_root: Path, data: dict[str, Any]) -> None:
    artifacts = repo_root / ".hermes" / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "last-check.json").write_text(
        json.dumps(data, indent=2, sort_keys=True)
    )
