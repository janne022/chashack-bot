"""contractorphans — the DECLARED ``contract-orphans`` gate (t_721843ff).

The spec-file gate (``contract-drift``) says what was DECLARED; the graph
says what is actually WIRED. A service can add an endpoint, message, or
public symbol nothing consumes and every other gate stays green, so this
gate reads the graph projection's **actionable unmatched** contracts and
fails only when the diff under review touches one.

What it deliberately ignores:

* **Matched contracts.** Both sides present; nothing to act on.
* **Unmatched rows the diff does not touch.** Scoping is the point — a
  repository can hold pre-existing orphans; this gate judges the change.
* **Every non-actionable classification.** The ``local-contract`` noise
  (a method reached through a receiver, a name the source binds without a
  definition node) is marked not-actionable by the projection for exactly
  this reason; failing on it would train everyone to ignore the gate.

The diff and its base are NOT resolved here: the ladder reads the diff
once (``diffsource``, card t_2f933f3c) and hands every gate the same
bytes, so this gate cannot see a different base than its siblings.

Self-contained on purpose (see init.VENDORED_MODULES): the graph reader is
imported lazily so the flat vendored copy imports with only pyyaml, and a
repository whose graph cannot be built gets a loud skip, never a pass.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def run(repo_root: Path, diff: str) -> tuple[list[str], list[str]]:
    """Run the gate. Returns ``(violations, notes)``.

    Violations use the ladder's ``GATE:<rule>:<path>:<line>: <evidence>``
    shape: the contract's file, its line, and the projection's own reading
    of why the row is actionable.
    """
    violations: list[str] = []
    notes: list[str] = []
    touched = _touched_files(diff)

    rows, warned = _actionable_rows(repo_root)
    notes.extend(warned)
    if rows is None:
        # A graph that cannot be built is a skip, said out loud — never a
        # silent pass and never a FAIL on missing evidence.
        return violations, notes

    notes.append(
        f"contract-orphans: read the graph projection's actionable unmatched "
        f"contracts; considered {len(rows)} row(s); "
        f"diff touches {len(touched)} file(s)"
    )
    if touched:
        notes.append(
            "contract-orphans: diff files: " + ", ".join(sorted(touched))
        )
    if not rows:
        notes.append("contract-orphans: no actionable unmatched contract exists")
        return violations, notes
    notes.append(
        "contract-orphans: considered contracts: "
        + ", ".join(f"{row['name']} ({row.get('file') or 'unresolved'})"
                    for row in rows)
    )

    for row in rows:
        for file in _row_files(row):
            if file in touched:
                violations.append(_violation(row, file))
    return violations, notes


def _touched_files(diff: str) -> set[str]:
    """Paths named by the diff, both sides, minus the /dev/null of additions."""
    touched: set[str] = set()
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            for part in line.split(" "):
                if part.startswith(("a/", "b/")) and part[2:] != "/dev/null":
                    touched.add(part[2:])
    return touched


def _row_files(row: dict[str, Any]) -> set[str]:
    """The repository files a contract row sits in.

    A row's own definition file leads; every publisher and consumer path is
    a file the row touches too, because adding a call to an unresolved
    contract is the same finding as defining one.
    """
    files: set[str] = set()
    if row.get("file"):
        files.add(str(row["file"]))
    for side in ("publishers", "consumers"):
        for ref in row.get(side) or []:
            text = str(ref)
            if ":" in text and "/" in text:
                # "python:svc/src/app.py#sym" / "file:src/app.py" — take the
                # path between the first ':' and any '#'.
                candidate = text.split(":", 1)[1].split("#", 1)[0]
                if "/" in candidate:
                    files.add(candidate)
    return files


def _violation(row: dict[str, Any], file: str) -> str:
    line = 0
    span = row.get("span") or []
    if len(span) == 2:
        line = span[0]
    reading = row.get("classification_reading") or ""
    return (
        f"GATE:contract-orphans:{file}:{line}: contract {row['name']!r} is "
        f"unmatched ({row.get('unmatched_reason')}) and classified actionable "
        f"— {reading}"
    )


def _actionable_rows(
    repo_root: Path, build: bool = True
) -> tuple[list[dict[str, Any]] | None, list[str]]:
    """The actionable unmatched contract rows of the graph, uncapped.

    ``project_graph`` caps the rows it ships for a reader, so the gate
    reads the population instead: the cap must never hide a finding from a
    verdict. ``None`` means the graph could not be built; the reason is in
    the returned notes and the gate skips loudly.
    """
    try:
        # The module lives beside this one: the installed package's
        # `graph_view` in src/, a sibling flat `graph_view` in the vendored
        # runner. `__package__` tells the two apart without a try/except
        # chain around the import.
        module = f"{__package__}.graph_view" if __package__ else "graph_view"
        actionable_unmatched_contracts = (
            __import__(module, fromlist=["actionable_unmatched_contracts"])
            .actionable_unmatched_contracts
        )
        try:
            return actionable_unmatched_contracts(repo_root, build=build), []
        except Exception as exc:  # noqa: BLE001 — the gate reports, never crashes
            return None, [
                (
                    "contract-orphans: skipped — the graph projection is unreadable "
                    f"({exc}); build it with `hpipe graph build` and re-run"
                )
            ]
    except ImportError:
        pass
    # No graph module in this environment (the vendored flat runner ships no
    # graph support): a loud skip, never a silent pass.
    return None, [
        (
            "contract-orphans: skipped — the graph projection is not available in "
            "this runner; declare the gate only where `hpipe graph` is available"
        )
    ]
