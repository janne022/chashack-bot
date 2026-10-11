"""db-guard gate (C5): destructive DB ops must target names matching the pattern.

Op list = G-C union: DROP DATABASE|DROP SCHEMA|DROP TABLE|TRUNCATE|  # db-guard:allow:db-name-unparseable hpipe-vendor: self-describing op list, not a statement
CREATE DATABASE|migrate --down|db drop|db reset|db:schema:load|seed-fake-data.  # db-guard:allow:db-name-unparseable hpipe-vendor: self-describing op list, not a statement
Name extraction (t_0b7d66f8 c6): identifier following the SQL op, else last
path segment of --database / DATABASE_URL. Unparseable name = violation.
The default allows a complete delimiter-separated `test` or `ci` token; an
explicit configured regex retains Python regex search semantics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from g0 import Violation, parse_diff


@dataclass
class DbGuardResult:
    violations: list[Violation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)


SQL_OPS = re.compile(
    r"\b(DROP\s+DATABASE|DROP\s+SCHEMA|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?|CREATE\s+DATABASE)\b\s*(.*?);?\s*$",  # db-guard:allow:db-name-unparseable hpipe-vendor: op regex literal, not a statement
    re.I,
)
CLI_OPS = [
    re.compile(r"\bmigrate\s+--down\b", re.I),
    re.compile(r"\bdb\s+drop\b", re.I),
    re.compile(r"\bdb\s+reset\b", re.I),
    re.compile(r"\bdb:schema:load\b"),
    re.compile(r"\bseed-fake-data\b", re.I),
]
# command line naming a database explicitly
CLI_DB_FLAG = re.compile(r"--(?:database|db)[= ](\S+)")
CLI_DB_URL = re.compile(r"DATABASE_URL[=:]\s*(\S+)")
URL_DB = re.compile(r"[_a-zA-Z0-9.-]+/([A-Za-z0-9_.-]+?)(?:\?.*)?$")

_NAME = re.compile(r"[`\"'\[]?([A-Za-z0-9_.\-]+)[`\"'\]]?")

# `db-guard:allow:<rule> <reference>` on an offending line — the same
# fail-closed escape g0 has had all along. Only a pragma naming the rule the
# scanner actually fires for that line is consulted, and a pragma with no
# reference is itself a `pragma-no-reference` violation. Rationale (t_17e366ac):
# vendoring this module into `.hermes/pipeline/` made any diff touching it fail
# db-guard on this file's own docstring and op regex, with no way to record the
# escape.
DB_PRAGMA_RE = re.compile(r"db-guard:allow:([\w-]+)\s*(.*)")


def _pragma_reference(text: str, rule: str) -> str | None:
    """Reference from an allow-pragma for `rule` on `text`, else None.

    None means "no pragma for this rule here"; "" means a pragma for this rule
    with no reference (its own `pragma-no-reference` violation). Comment
    punctuation such as `*/`/`*/}` is not a reference either, exactly as in g0.
    """
    pm = DB_PRAGMA_RE.search(text)
    if pm is None or pm.group(1) != rule:
        return None
    reference = pm.group(2).strip()
    if reference in ("*/", "*/}", "*/)", "*/};", "*/,"):
        return ""
    return reference


def _maybe_allow(result: DbGuardResult, f, line_no: int, text: str, rule: str, emit) -> None:
    """Emit a violation unless an allow-pragma with a reference covers the line."""
    reference = _pragma_reference(text, rule)
    if reference is not None:
        if reference:
            result.notes.append(
                f"db-guard: allowed {rule} at {f.path}:{line_no} (reference: {reference})"
            )
            return
        result.violations.append(
            Violation("pragma-no-reference", f.path, line_no, text.strip(), gate="db-guard")
        )
        return
    emit()


_DEFAULT_PATTERN = r"(?:^|[_\-.])(?:test|ci)(?:$|[_\-.])"


def _allowed(name: str, pattern: str) -> bool:
    try:
        return bool(re.search(pattern, name))
    except re.error:
        return False


def _check(result: DbGuardResult, f, line_no: int, name: str | None, op: str, pattern: str,
           text: str = "") -> None:
    rule = "db-name-unparseable" if name is None else "db-name-guard"

    def emit() -> None:
        if name is None:
            result.violations.append(
                Violation(
                    "db-name-unparseable",
                    f.path,
                    line_no,
                    f"destructive op '{op}' with unparseable database name",
                    gate="db-guard",
                )
            )
            return
        result.violations.append(
            Violation(
                "db-name-guard",
                f.path,
                line_no,
                f"destructive op '{op}' on non-matching database name '{name}' "
                f"(pattern: {pattern})",
                gate="db-guard",
            )
        )

    if name is not None and _allowed(name, pattern):
        result.notes.append(f"db-guard: '{name}' matches pattern for {op}")
        return
    _maybe_allow(result, f, line_no, text, rule, emit)


def scan_db_guard(diff_text: str, pattern: str = _DEFAULT_PATTERN) -> DbGuardResult:
    """Scan ADDED lines for destructive DB ops; validate target names."""
    result = DbGuardResult()
    files = parse_diff(diff_text)
    for f in files:
        for line_no, text in f.added:
            stripped = text.strip()

            m = SQL_OPS.search(stripped)
            if m:
                op = re.sub(r"\s+", " ", m.group(1)).upper()
                rest = m.group(2).strip()
                nm = _NAME.match(rest) if rest else None
                # TRUNCATE TABLE <name> / DROP TABLE <name>: name follows op;  # db-guard:allow:db-name-unparseable hpipe-vendor: comment names op, not a statement
                # for TRUNCATE alone (no name) it is the table in context —  # db-guard:allow:db-name-guard hpipe-vendor: comment names op, not a statement
                # table ops still name-checked when a name is present.
                if rest and not nm:
                    _check(result, f, line_no, None, op, pattern, text)
                elif nm:
                    _check(result, f, line_no, nm.group(1), op, pattern, text)
                else:
                    _check(result, f, line_no, None, op, pattern, text)
                continue

            for cli in CLI_OPS:
                if not cli.search(stripped):
                    continue
                op = cli.pattern.replace("\\b", "").replace("\\s+", " ").strip()
                fm = CLI_DB_FLAG.search(stripped)
                if fm:
                    _check(result, f, line_no, fm.group(1), op, pattern, text)
                    continue
                um = CLI_DB_URL.search(stripped)
                if um:
                    dm = URL_DB.search(um.group(1))
                    name = dm.group(1) if dm else um.group(1)
                    _check(result, f, line_no, name, op, pattern, text)
                    continue
                # no explicit name: CLI ops target the configured DB -> unparseable
                # but still a name-guard violation (fail-closed per C5)
                _maybe_allow(
                    result, f, line_no, text, "db-name-guard",
                    lambda: result.violations.append(
                        Violation(
                            "db-name-guard",
                            f.path,
                            line_no,
                            f"destructive op '{op}' with no parseable target database "
                            f"(pattern: {pattern})",
                            gate="db-guard",
                        )
                    ),
                )
                break
    return result
