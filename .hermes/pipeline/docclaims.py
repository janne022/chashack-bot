"""docclaims — the declared ``doc-claims`` gate: cited-id + md-table.

The two mechanical halves of the ``claim-integrity`` procedure, ported from that
skill's ``check_cited_ids.py`` and ``check_md_tables.py`` (stdlib only):

* ``cited-id`` — every ``id_pattern`` citation in the scanned markdown must be
  defined by one of ``citation_registers``. Prose has no compiler, so a citation
  to something that does not exist survives review and then misleads every
  reader who trusts it.
* ``md-table`` — every markdown table row has its header's cell count. An
  escaped pipe inside a cell adds a column; the failure is invisible in a
  rendered diff.

Self-contained on purpose: no package imports, so the copy ``hpipe init``
vendors to ``.hermes/pipeline/docclaims.py`` is byte-identical to this file.

Three silent failures this module refuses to reproduce, all of them grammar
traps the citation pattern cannot save you from:

* **Bounded quantifiers.** ``D[0-9]{1,2}`` matches nothing once the register
  reaches three digits, so the sweep reports clean while policing nothing. The
  declared pattern is used verbatim and an unbounded ``D[0-9]+`` is the
  documented form — and a pattern that matches no identifier in the register is
  REPORTED, never swallowed.
* **Word boundaries.** ``\\b`` is blind to an underscore (a word character), so
  a citation glued to an identifier (``D18_plan``, ``prior_D18``) is missed
  while a string that merely contains the letters (``OBD2``) can be caught. Use
  lookarounds rejecting letters and digits on either side:
  ``(?<![A-Za-z0-9])ID(?![A-Za-z0-9])``.
* **Fixtures that are citations.** A test that spells a citation literally is
  itself a citation as far as this gate is concerned. Assemble probe strings at
  runtime in the test; do not exempt the test file from its own scan.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ID_PATTERN = r"D[0-9]+"
DEFAULT_MARKDOWN = ("**/*.md",)

# Directories a tree walk never enters: VCS metadata, dependency trees, build
# output and generated gate state. Same set the reference script skips.
SKIP_DIRS = frozenset({
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".hermes",
})


@dataclass
class Finding:
    """One violation, formatted the way every gate reports one."""

    rule: str
    path: str
    line: int
    evidence: str

    def format(self) -> str:
        return f"GATE:{self.rule}:{self.path}:{self.line}: {self.evidence}"


@dataclass
class DocClaimsResult:
    violations: list[Finding] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)


def _read(path: Path) -> str:
    """Decode leniently: a mojibake prose file is a finding, never a crash."""
    return path.read_text(encoding="utf-8", errors="ignore")


def ids_from(text: str, pattern: re.Pattern[str]) -> set[str]:
    """Identifiers `pattern` matches: group 1 when it has one, else the match."""
    return {
        (m.group(1) if m.groups() else m.group(0)) for m in pattern.finditer(text)
    }


def count_cells(line: str) -> int:
    """Cells in a markdown table row; a backslash-escaped pipe is not a boundary."""
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|"):
        text = text[:-1]

    cells = 1
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2  # the escaped character cannot be a cell boundary
            continue
        if char == "|":
            cells += 1
        index += 1
    return cells


def markdown_files(repo_root: Path, patterns) -> list[str]:
    """Declared markdown paths, relative, de-duplicated and sorted.

    A declared glob list is a SET, not a sequence: ``**/*.md`` and ``README.md``
    both match README, and scanning it twice would report one defect twice.
    """
    repo_root = Path(repo_root)
    found: set[str] = set()
    for pattern in patterns:
        for path in repo_root.glob(pattern):
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(repo_root)
            except ValueError:  # pragma: no cover — glob never leaves the root
                continue
            if SKIP_DIRS.intersection(rel.parts):
                continue
            found.add(rel.as_posix())
    return sorted(found)


def check_md_tables(repo_root: Path, rel: str) -> list[Finding]:
    """Rows whose cell count disagrees with their table's header row."""
    findings: list[Finding] = []
    in_fence = False
    header_line = 0
    expected: int | None = None

    for number, raw in enumerate(_read(Path(repo_root) / rel).splitlines(), 1):
        if raw.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if raw.lstrip().startswith("|"):
            cells = count_cells(raw)
            if expected is None:
                header_line, expected = number, cells
            elif cells != expected:
                findings.append(
                    Finding(
                        "md-table",
                        rel,
                        number,
                        f"row has {cells} cells, but the table starting at line "
                        f"{header_line} has {expected}",
                    )
                )
        else:
            expected = None
    return findings


def check_cited_ids(
    repo_root: Path, rel: str, pattern: re.Pattern[str], defined: set[str]
) -> list[Finding]:
    """Citations in one file whose identifier no register defines.

    Line-scoped, and the evidence carries BOTH sides: the undefined id and the
    ids the register does define, so a reader can tell a typo from a register
    that never received the entry.
    """
    findings: list[Finding] = []
    known = ", ".join(sorted(defined))
    for number, line in enumerate(_read(Path(repo_root) / rel).splitlines(), 1):
        for ident in sorted(ids_from(line, pattern)):
            if ident in defined:
                continue
            findings.append(
                Finding(
                    "cited-id",
                    rel,
                    number,
                    f"cited {ident} is not defined; undefined=[{ident}] "
                    f"defined=[{known}]",
                )
            )
    return findings


def run(repo_root: Path, spec) -> DocClaimsResult:
    """Scan the declared markdown with the declared citation grammar.

    `spec` is duck-typed (``citation_registers`` / ``markdown`` / ``id_pattern``)
    so this module needs no import of the manifest dataclasses and stays
    byte-identical when vendored.

    An empty ``citation_registers`` is a per-repo decision made at manifest
    validation, not here: [] means "the table check alone".
    """
    repo_root = Path(repo_root)
    registers = list(getattr(spec, "citation_registers", None) or [])
    patterns = list(getattr(spec, "markdown", None) or DEFAULT_MARKDOWN)
    id_pattern = getattr(spec, "id_pattern", None) or DEFAULT_ID_PATTERN
    pattern = re.compile(id_pattern)

    result = DocClaimsResult()
    files = markdown_files(repo_root, patterns)

    defined: set[str] = set()
    missing: list[str] = []
    for rel in registers:
        register = repo_root / rel
        if not register.is_file():
            missing.append(rel)
            continue
        defined |= ids_from(_read(register), pattern)

    result.notes.append(
        f"doc-claims: pattern {id_pattern!r}; "
        + (
            f"registers {registers} define {len(defined)} id(s); "
            if registers
            else "no citation_registers declared, citation check not run; "
        )
        + f"scanned {len(files)} markdown file(s)"
    )

    for rel in missing:
        result.violations.append(
            Finding("cited-id", rel, 0, "citation register not found")
        )

    if registers and not defined and not missing:
        # The register exists but the grammar reads nothing out of it. Reporting
        # "every citation is dangling" would be a false alarm, and reporting
        # clean is the vacuity this guard exists to catch: say so instead.
        result.violations.append(
            Finding(
                "cited-id",
                registers[0],
                0,
                f"the citation grammar {id_pattern!r} matched no identifier in "
                f"the register(s) — refusing to report a clean scan (check "
                f"id_pattern)",
            )
        )
    elif registers:
        for rel in files:
            result.violations.extend(
                check_cited_ids(repo_root, rel, pattern, defined)
            )

    for rel in files:
        result.violations.extend(check_md_tables(repo_root, rel))

    return result
