#!/usr/bin/env python3
"""Vendored gate entry: run the generic gates and exit with the ladder code.

Usage: python .hermes/pipeline/run_gate.py [gate ...]
Self-contained: needs only pyyaml. No cross-repo imports.

The diff is NAMED, not guessed (card t_2f933f3c). HPIPE_DIFF_SOURCE is set by
the generated workflow; GITHUB_BASE_REF is the older CI convention and still
honoured. When neither names a diff, the base is resolved and printed — and
there is no HEAD~1 fallback, because on a single-commit branch that fallback
is right by accident and wrong on every other branch.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # .hermes/pipeline -> repo root

sys.path.insert(0, str(HERE))

from runner import (
    format_gate_report, format_run_summary, run_checks, write_step_summary,
)  # noqa: E402


def _declared_source():
    """The diff the caller named, or None to resolve one."""
    named = os.environ.get("HPIPE_DIFF_SOURCE")
    if named:
        return named
    base = os.environ.get("GITHUB_BASE_REF")
    if base:
        subprocess.run(
            ["git", "fetch", "--no-tags", "--quiet", "origin", base],
            cwd=ROOT, check=False,
        )
        return f"refs/remotes/origin/{base}...HEAD"
    return None


def _spec_base(spec: str) -> str:
    """The base a diff spec names. `A...B` and `A..B` both name A.

    Splitting only on `...` returned the whole spec for a two-dot range, so
    the receipt claimed a base it never scanned — and the push-to-default
    workflow names a two-dot range (`github.event.before..HEAD`, card
    t_82bbec73).
    """
    head, three_dot, _ = spec.partition("...")
    if three_dot:
        return head
    return spec.partition("..")[0]


def _read_diff():
    """Return (diff_text, receipt). Raises SystemExit(2) when the diff cannot
    be obtained — never returns a scannable empty string for a failed command.

    Both ways of naming a diff (a declared HPIPE_DIFF_SOURCE/GITHUB_BASE_REF,
    and a resolved base) fall through ONE classification of the diff bytes.
    Two branches each classifying their own copy of the result is how the
    declared branch came to record a SCANNED pass for a diff that named no
    files (card t_f4729c55): the base was right, the state was assumed.
    """
    spec = _declared_source()
    if spec:
        base = _spec_base(spec)
        resolved_via = "--diff-source"
        declared = spec
    else:
        base, resolved_via = _resolve_base()
        if base is None:
            print(f"vendored runner: could not resolve a base for the diff: "
                  f"{resolved_via}. Name it with HPIPE_DIFF_SOURCE=<ref-range> "
                  "— there is no HEAD~1 fallback.", file=sys.stderr)
            raise SystemExit(2)
        spec = f"{base}...HEAD"
        declared = None

    command = f"git diff --unified=0 {spec}"
    proc = subprocess.run(
        ["git", "diff", "--unified=0", spec],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        print(f"vendored runner: `{command}` exited {proc.returncode}: "
              f"{(proc.stderr or '').strip()}", file=sys.stderr)
        print("no gate ran: the diff could not be obtained.", file=sys.stderr)
        raise SystemExit(2)

    receipt = {
        "state": "SCANNED", "source": "git", "base": base,
        "resolved_via": resolved_via, "command": command, "returncode": 0,
    }
    if declared is not None:
        receipt["declared"] = declared
    if not proc.stdout.strip():
        receipt["state"] = "EMPTY"
        receipt["state_reason"] = f"no changes against {base}"
        print(f"EMPTY (no changes against {base})", file=sys.stderr)
    else:
        print(f"base: {base}", file=sys.stderr)
        print(f"command: {command}", file=sys.stderr)
    return proc.stdout, receipt


def _git(*args):
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=False
    )


def _readable(ref):
    """The shortest name for `ref` that git can still resolve, or None."""
    short = ref.replace("refs/remotes/", "").replace("refs/heads/", "")
    for candidate in (short, ref):
        if _git("rev-parse", "--verify", "--quiet",
                f"{candidate}^{{commit}}").returncode == 0:
            return candidate
    return None


def _nearest_ancestor(exclude):
    """The remote-tracking ref whose merge-base with HEAD is nearest HEAD.

    Same semantics as the `src/` resolver (card t_1a5bf7be, blocker 2), and
    the generated CI workflow runs THIS copy, so the two must not drift:

    1. **Ancestry.** Only genuine ancestors of HEAD are candidates. Without
       this, "first ref alphabetically" answers with an unrelated open PR
       branch, and `git diff side...HEAD` reports the two branches' combined
       divergence — the gate scans another PR's files.
    2. **Distance 0 is never a base.** A ref at distance 0 has a merge-base of
       HEAD with HEAD: the base IS the tip, so the diff is empty by
       construction and the runner reports a scan that never happened. The
       branch's own remote-tracking ref is exactly this, and in a
       `--single-branch` clone it is often the only ancestor ref present.

    `exclude` is a THIRD guard, supplied by the caller, and it is not
    redundant with the two above. Guard 2 only ever sees distance 0; the
    self-ref sits at distance > 0 whenever a developer has unpushed local
    commits, because `origin/<branch>` records the last *pushed* state. There
    it is a genuine ancestor that passes guard 1 and is nearer than the real
    base, so only `exclude` refuses it. Guard 2 covers the `--single-branch`
    clone; the caller's `exclude` covers unpushed commits.

    Returns None when nothing qualifies, which is the correct outcome: the
    caller then fails loudly rather than inventing a base.
    """
    listing = _git("for-each-ref", "--format=%(refname:short)", "refs/remotes")
    if listing.returncode != 0:
        return None
    candidates = []
    for ref in listing.stdout.split():
        if not ref.startswith("origin/") or ref == "origin/HEAD":
            continue
        if ref in exclude:
            continue
        if _git("merge-base", "--is-ancestor", ref, "HEAD").returncode != 0:
            continue
        counted = _git("rev-list", "--count", f"{ref}...HEAD")
        if counted.returncode != 0:
            continue
        try:
            distance = int(counted.stdout.strip())
        except ValueError:
            continue
        if distance == 0:
            continue
        candidates.append((distance, ref))
    if not candidates:
        return None
    # Nearest first; the name only breaks a genuine tie, so the result is
    # stable across runs rather than depending on the filesystem's order.
    distance, ref = min(candidates, key=lambda item: (item[0], item[1]))
    return _readable(ref)


def _self_refs():
    """The checked-out branch's own remote-tracking refs, by name."""
    refs = set()
    head = _git("symbolic-ref", "--quiet", "--short", "HEAD")
    branch = head.stdout.strip() if head.returncode == 0 else ""
    if branch:
        refs.add(f"origin/{branch}")
        refs.add(f"refs/remotes/origin/{branch}")
    return refs


def _resolve_base():
    """(base, resolved_via) or (None, reason). The target of origin/HEAD, else
    the nearest real ancestor. No HEAD~1."""
    proc = _git("symbolic-ref", "refs/remotes/origin/HEAD")
    if proc.returncode == 0 and proc.stdout.strip():
        target = _readable(proc.stdout.strip())
        if target:
            return target, "origin/HEAD"
    nearest = _nearest_ancestor(exclude=_self_refs())
    if nearest:
        return nearest, "nearest ancestor of HEAD"
    return None, ("no remote-tracking ref is a real ancestor of HEAD at "
                  "distance > 0 (the branch's own ref is the tip, never a base)")


def _pr_body():
    path = os.environ.get("GITHUB_EVENT_PATH")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            event = json.load(fh)
        body = (event.get("pull_request") or {}).get("body")
        return None if body is None else str(body)
    except (OSError, ValueError):
        return None


def _write_empty_artifact(receipt):
    """EMPTY still gets an artifact. A reader must never find a missing or
    green-looking artifact and conclude the ladder passed."""
    out = ROOT / ".hermes" / "artifacts" / "last-check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"exit_code": 0, "gates": [], "stopped_early": False, "diff": receipt},
        indent=2, sort_keys=True,
    ))


def main() -> int:
    gates = sys.argv[1:]
    diff, receipt = _read_diff()
    if receipt.get("state") == "EMPTY":
        _write_empty_artifact(receipt)
        print("no gate ran: there is nothing to scan (EMPTY is not a pass).",
              file=sys.stderr)
        return 0
    code = run_checks(
        ROOT, diff=diff, pr_body=_pr_body(),
        all_gates=bool(gates), only=gates or None, diff_receipt=receipt,
    )
    # Print the report from the artifact this run actually wrote, using the
    # same formatter the `hpipe` CLI uses. CI reads THIS stdout: no workflow
    # step uploads `.hermes/artifacts/`, so a note recorded but not printed
    # here is invisible in CI — a reader of the log could not tell "the gate
    # looked and decided" from "the rule never fired" (card t_3b542ea9
    # D-ENT.3). Read the artifact rather than reusing `run_checks`' return
    # value, so what is printed cannot drift from what was recorded.
    out = ROOT / ".hermes" / "artifacts" / "last-check.json"
    try:
        artifact = json.loads(out.read_text(encoding="utf-8"))
        gates_recorded = artifact["gates"]
    except (OSError, ValueError, KeyError):
        artifact, gates_recorded = {}, []
    for gate in gates_recorded:
        for line in format_gate_report(gate):
            print(line)
    # The workflow summary is where a reader of the run looks first, and it
    # is the only place a SKIP can be told apart from a gate that never
    # fired (card t_9e963c3f, D-CI.3). Written from the SAME artifact the
    # log was printed from, so the two cannot disagree.
    write_step_summary(
        format_run_summary(gates_recorded, artifact.get("diff", receipt))
    )
    return code


if __name__ == "__main__":
    sys.exit(main())
