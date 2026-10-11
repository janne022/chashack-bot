"""decision records: ADR-shaped markdown beside the feature it governs.

The FILES are the truth. `.hermes/decisions.json` is a regenerable index
(`hpipe decisions index --write`), so the two can never disagree: `check`
compares the committed index to a fresh regeneration and fails on drift.

Format pinned by kanban card t_f0d0f40b (D1.3): YAML frontmatter that is
machine-readable, a `## Decision` body written so that reading it alone is
sufficient for an agent that stumbles in mid-task, and three hard rules —
the Decision section is self-sufficient, a superseded record is never edited
or deleted, and a decision the user did not actually make is `proposed`.
"""

from __future__ import annotations

import datetime as _dt
import fnmatch
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from g0 import Violation

STATUSES = ("proposed", "accepted", "rejected", "superseded")
SECTIONS = ("Decision", "Why", "Rejected because", "Revisit when")
KEY_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# A citation is a *backticked* key — the form `.github/pull_request_template.md`
# documents ("a backticked key and what it decided"). The backticks are
# load-bearing: without them every word of the block that happens to match a
# key ("scope", "record", "none") pre-cites an accepted record, so an author
# who cited nothing passes the gate that exists to catch exactly that.
CITED_KEY_RE = re.compile(r"`([a-z0-9]+(?:-[a-z0-9]+)*)`")
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

DECISIONS_DIR = "docs/decisions"
INDEX_REL = ".hermes/decisions.json"

# Ignored when walking the tree: build output, VCS metadata, and the index
# itself. Only `docs/decisions/` is scanned, so this stays deliberately small.
SKIP_DIRS = frozenset(
    {".git", ".venv", "node_modules", "__pycache__", ".hermes", "dist", "build"}
)


class DecisionError(Exception):
    """A malformed or contradictory record. Carries per-file error strings."""


@dataclass
class Decision:
    key: str
    status: str
    decided_by: str
    decided_at: str
    scope: str
    supersedes: str | None
    evidence: list[str] = field(default_factory=list)
    path: str = ""
    decision: str = ""
    why: str = ""
    rejected_because: str = ""
    revisit_when: str = ""
    superseded_by: str | None = None

    def to_json(self) -> dict:
        """The `get --json` payload. Carries every body section, not just
        frontmatter: the caller needs the Decision text, that is the point."""
        return {
            "key": self.key,
            "status": self.status,
            "decided_by": self.decided_by,
            "decided_at": self.decided_at,
            "scope": self.scope,
            "supersedes": self.supersedes,
            "superseded_by": self.superseded_by,
            "evidence": list(self.evidence),
            "path": self.path,
            "decision": self.decision,
            "why": self.why,
            "rejected_because": self.rejected_because,
            "revisit_when": self.revisit_when,
            "governs": self.status == "accepted",
        }


def _frontmatter_scalar(data: dict, name: str) -> object:
    """Read one frontmatter value, applying the `none` convention.

    The pinned format writes `supersedes: none` for "supersedes nothing", so
    the literal string `none` must resolve to null rather than being treated
    as a key that has to exist.
    """
    value = data.get(name)
    if isinstance(value, str) and value.strip().lower() in {"none", "null", "~", ""}:
        return None
    return value


def _scalar(value: str) -> str:
    """Quote a frontmatter value so any YAML reader reads back what was meant.

    A bare `*` is the YAML alias node, not the string `*`, so an unquoted
    `scope: *` parses as a broken alias and the record silently disappears
    from the index. Values that YAML would reinterpret are double-quoted with
    their inner quotes escaped.
    """
    text = str(value)
    plain_safe = bool(re.fullmatch(r"[A-Za-z0-9_][\w .\-/]*", text)) and text.strip() == text
    reserved = text in {
        "true", "false", "null", "none", "yes", "no", "on", "off", "~",
        "y", "n", "True", "False", "Null", "None",
    }
    if plain_safe and not reserved:
        return text
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _split_frontmatter(text: str, rel: str, errors: list[str]) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        raise DecisionError(f"{rel}: not a decision record (no frontmatter)")
    end = text.find("\n---\n", 3)
    if end == -1:
        raise DecisionError(f"{rel}: unterminated frontmatter")
    raw = text[4:end]
    body = text[end + len("\n---\n") :]
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as e:
        errors.append(f"{rel}: invalid frontmatter YAML ({e})")
        data = None
    if data is None:
        data = {}
    if not isinstance(data, dict):
        errors.append(f"{rel}: frontmatter must be a mapping")
        data = {}
    return data, body


def _section(body: str, name: str) -> str:
    """Text under `## <name>` up to the next `## ` heading, verbatim."""
    pattern = re.compile(
        rf"^##\s+{re.escape(name)}\s*$(.*?)(?=^##\s|\Z)", re.M | re.S
    )
    match = pattern.search(body)
    return match.group(1).strip() if match else ""


def parse_record(path: Path, repo_root: Path) -> Decision:
    """Parse one record. Raises DecisionError with a path-naming message."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise DecisionError(f"{path}: unreadable ({e})") from e
    rel = path.relative_to(repo_root).as_posix()
    errors: list[str] = []
    data, body = _split_frontmatter(text, rel, errors)
    if errors:
        raise DecisionError(errors[0])

    key = str(data.get("key") or "").strip()
    if not key:
        raise DecisionError(f"{rel}: missing required frontmatter key: 'key'")
    if not KEY_RE.fullmatch(key):
        raise DecisionError(
            f"{rel}: key '{key}' must be kebab-case ([a-z0-9] words joined by '-')"
        )

    status = str(data.get("status") or "").strip().lower()
    if status not in STATUSES:
        raise DecisionError(
            f"{rel}: status '{status or '<missing>'}' is unknown "
            f"(allowed: {', '.join(STATUSES)})"
        )

    decided_at = str(data.get("decided_at") or "").strip()
    if not ISO_DATE_RE.fullmatch(decided_at):
        raise DecisionError(
            f"{rel}: decided_at '{decided_at or '<missing>'}' is not an ISO date (YYYY-MM-DD)"
        )
    try:
        _dt.date.fromisoformat(decided_at)
    except ValueError as e:
        raise DecisionError(f"{rel}: decided_at '{decided_at}' is not a real date ({e})") from e

    decided_by = str(data.get("decided_by") or "").strip()
    if not decided_by:
        raise DecisionError(f"{rel}: missing required frontmatter key: 'decided_by'")

    scope = str(data.get("scope") or "").strip()
    if not scope:
        raise DecisionError(f"{rel}: missing required frontmatter key: 'scope'")

    supersedes = _frontmatter_scalar(data, "supersedes")
    supersedes = str(supersedes).strip() if supersedes else None
    if supersedes == key:
        raise DecisionError(f"{rel}: key '{key}' cannot supersede itself")

    evidence_raw = data.get("evidence") or []
    if isinstance(evidence_raw, str):
        evidence = [evidence_raw]
    elif isinstance(evidence_raw, list):
        evidence = [str(e).strip() for e in evidence_raw if str(e).strip()]
    else:
        raise DecisionError(f"{rel}: evidence must be a string or a list of strings")

    decision_text = _section(body, "Decision")
    if not decision_text:
        raise DecisionError(
            f"{rel}: missing a '## Decision' section (an agent must be able to act "
            "correctly from that section alone)"
        )

    return Decision(
        key=key,
        status=status,
        decided_by=decided_by,
        decided_at=decided_at,
        scope=scope,
        supersedes=supersedes,
        evidence=evidence,
        path=rel,
        decision=decision_text,
        why=_section(body, "Why"),
        rejected_because=_section(body, "Rejected because"),
        revisit_when=_section(body, "Revisit when"),
    )


def record_paths(repo_root: Path) -> list[Path]:
    """Every `**/docs/decisions/*.md`, sorted, with ignored trees skipped."""
    root = Path(repo_root)
    found: list[Path] = []
    for path in root.rglob(f"{DECISIONS_DIR}/*.md"):
        parts = set(path.relative_to(root).parts)
        if parts & SKIP_DIRS:
            continue
        found.append(path)
    return sorted(found)


def _looks_like_record(text: str) -> bool:
    """Does this markdown carry decision frontmatter at all?

    `docs/decisions/` is a convention, not a police state: a note dropped
    beside the records is ignored rather than failing `check`. A file that
    opens frontmatter but breaks the schema is a real error and is reported.
    """
    return text.startswith("---\n")


def load_decisions(repo_root: Path) -> tuple[list[Decision], list[str]]:
    """Load every record. Returns (records, errors) — never raises, so the
    caller can report all malformed files in one run."""
    root = Path(repo_root)
    records: list[Decision] = []
    errors: list[str] = []
    seen: dict[str, str] = {}
    for path in record_paths(root):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as e:
            errors.append(f"{path.relative_to(root).as_posix()}: unreadable ({e})")
            continue
        if not _looks_like_record(text):
            continue
        try:
            record = parse_record(path, root)
        except DecisionError as e:
            errors.append(str(e))
            continue
        if record.key in seen:
            errors.append(
                f"{record.path}: duplicate key '{record.key}' "
                f"(already defined in {seen[record.key]})"
            )
            continue
        seen[record.key] = record.path
        records.append(record)

    by_key = {r.key: r for r in records}
    for record in records:
        if record.supersedes and record.supersedes not in by_key:
            errors.append(
                f"{record.path}: supersedes '{record.supersedes}', which does not exist"
            )
        if record.supersedes and record.supersedes in by_key:
            by_key[record.supersedes].superseded_by = record.key

    # A record is superseded only when a SUCCESSOR actually took over: a
    # proposed or rejected successor retires nothing.
    for record in records:
        if record.superseded_by and by_key[record.superseded_by].status != "accepted":
            record.superseded_by = None

    for record in records:
        if record.superseded_by and record.status != "superseded":
            record.status = "superseded"

    return records, errors


def scope_matches(scope: str, path: str) -> bool:
    """Does `path` fall under `scope`? `*` is repo-wide; a trailing glob is
    matched per path segment; a plain prefix matches the subtree."""
    if scope == "*":
        return True
    candidate = path.replace("\\", "/").lstrip("./")
    prefix = scope.replace("\\", "/").strip()
    while prefix.startswith("./"):
        prefix = prefix[2:]
    if "*" in prefix:
        return fnmatch.fnmatch(candidate, prefix) or fnmatch.fnmatch(candidate, prefix.rstrip("/") + "/*")
    normalised = prefix.rstrip("/")
    return candidate == normalised or candidate.startswith(normalised + "/")


def filter_records(
    records: list["Decision"],
    *,
    status: str | None = None,
    scope: str | None = None,
) -> list["Decision"]:
    """The one record filter behind `hpipe decisions list` and the MCP tool.

    A second implementation in the MCP layer would be two transports with two
    behaviours, so both callers route through here.
    """
    selected = list(records)
    if status:
        selected = [r for r in selected if r.status == status]
    if scope:
        selected = [
            r for r in selected
            if scope_matches(r.scope, scope)
            or r.scope == "*"
            or scope.startswith(r.scope.rstrip("/") + "/")
        ]
    return sorted(selected, key=lambda r: r.key)


def _scope_dir(scope: str) -> str:
    """The directory a record with this scope lives in: `<scope>/docs/decisions`,
    or the repo root for a repo-wide (`*`) record.

    A glob scope has no literal directory, so the glob is dropped and the
    record sits at the longest literal prefix: scope `src/*` writes to
    `src/docs/decisions/`, never to a directory literally named `*`.
    """
    cleaned = str(scope).replace("\\", "/").strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    if cleaned in {"", "*"}:
        return ""
    parts = [p for p in cleaned.rstrip("/").split("/") if p]
    while parts and ("*" in parts[-1] or "?" in parts[-1] or "[" in parts[-1]):
        parts.pop()
    return "/".join(parts)


def record_path_for(repo_root: Path, scope: str, key: str) -> Path:
    """D1.1: the record lives NEXT TO the feature it governs. A repo-wide
    record (`*`) sits at the repo root."""
    return Path(repo_root) / _scope_dir(scope) / DECISIONS_DIR / f"{key}.md"


def build_index(repo_root: Path) -> dict:
    """The derived index: key -> {path, status, scope, decided_at, supersedes}."""
    records, errors = load_decisions(repo_root)
    entries = {
        r.key: {
            "path": r.path,
            "status": r.status,
            "scope": r.scope,
            "decided_at": r.decided_at,
            "supersedes": r.supersedes,
        }
        for r in sorted(records, key=lambda r: r.key)
    }
    return {
        "version": 1,
        "generated_by": "hpipe decisions index --write",
        "decisions": entries,
        "errors": errors,
    }


def index_text(repo_root: Path) -> str:
    """Deterministic serialization: two runs over the same files are
    byte-identical, so `check` can compare a regeneration to the commit."""
    return json.dumps(build_index(repo_root), indent=2, sort_keys=True) + "\n"


def write_record(
    repo_root: Path,
    key: str,
    *,
    status: str,
    decided_by: str,
    decided_at: str,
    scope: str,
    decision: str,
    why: str,
    rejected_because: str,
    revisit_when: str,
    supersedes: str | None = None,
    evidence: list[str] | None = None,
) -> Path:
    """Write a record beside the feature it governs. Refuses to overwrite an
    existing key: a decided fact is edited by a new record that supersedes
    it, never by rewriting the old one (D1.3 rule 2)."""
    root = Path(repo_root)
    if not KEY_RE.fullmatch(key):
        raise DecisionError(f"key '{key}' must be kebab-case ([a-z0-9] words joined by '-')")
    if status not in STATUSES:
        raise DecisionError(f"status '{status}' is unknown (allowed: {', '.join(STATUSES)})")
    if not ISO_DATE_RE.fullmatch(decided_at or ""):
        raise DecisionError(f"decided_at '{decided_at}' is not an ISO date (YYYY-MM-DD)")

    existing, _ = load_decisions(root)
    if any(r.key == key for r in existing):
        raise DecisionError(
            f"a record with key '{key}' already exists at "
            f"{next(r.path for r in existing if r.key == key)}; write a new key and "
            f"pass --supersedes {key} instead of editing a decided record"
        )
    if supersedes:
        if supersedes == key:
            raise DecisionError(f"key '{key}' cannot supersede itself")
        if not any(r.key == supersedes for r in existing):
            raise DecisionError(
                f"supersedes '{supersedes}', which does not exist; a record may only "
                "supersede a recorded decision"
            )

    target = record_path_for(root, scope, key)
    target.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "---",
        f"key: {_scalar(key)}",
        f"status: {_scalar(status)}",
        f"decided_by: {_scalar(decided_by)}",
        f"decided_at: {_scalar(decided_at)}",
        f"scope: {_scalar(scope)}",
        f"supersedes: {_scalar(supersedes) if supersedes else 'none'}",
    ]
    if evidence:
        lines.append("evidence:")
        lines.extend(f"  - {_scalar(e)}" for e in evidence)
    else:
        lines.append("evidence: []")
    lines += [
        "---",
        "",
        "## Decision",
        "",
        decision.strip(),
        "",
        "## Why",
        "",
        why.strip(),
        "",
        "## Rejected because",
        "",
        rejected_because.strip(),
        "",
        "## Revisit when",
        "",
        revisit_when.strip(),
        "",
    ]
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def citation_keys(pr_body: str | None) -> set[str]:
    """Keys cited in the PR body's `## Decisions` citation block.

    Only that block counts: a key mentioned in prose elsewhere in the body is
    not a citation, and scanning the whole body would let an unrelated mention
    satisfy the gate. Inside the block only a backticked key is a citation, and
    HTML comments are stripped: the shipped template quotes `none` in backticks
    while explaining that `none` means "no record governs this", so neither the
    template nor ordinary prose may satisfy the gate by accident.
    """
    if not pr_body:
        return set()
    match = re.search(
        r"^##\s+Decisions\b(.*?)(?=^##\s|\Z)", pr_body, re.M | re.S | re.I
    )
    if not match:
        return set()
    block = re.sub(r"<!--.*?-->", " ", match.group(1), flags=re.S)
    return set(CITED_KEY_RE.findall(block))


def violations_for(repo_root: Path, diff_files: list[str], pr_body: str | None) -> list[Violation]:
    """The gate body. `diff_files` are repo-relative changed paths."""
    if pr_body is None:
        return []
    records, _errors = load_decisions(Path(repo_root))
    governing = [r for r in records if r.status == "accepted"]
    if not governing:
        return []  # day-one: no records, nothing to cite
    cited = citation_keys(pr_body)
    violations: list[Violation] = []
    for path in diff_files:
        for record in governing:
            if record.key in cited:
                continue
            if scope_matches(record.scope, path):
                violations.append(
                    Violation(
                        "uncited-scope",
                        path,
                        0,
                        f"changed under accepted decision '{record.key}' "
                        f"(scope {record.scope}) without citing it in the PR body's "
                        f"`## Decisions` section; run `hpipe decisions get "
                        f"{record.key}` and add the key there",
                        gate="decision-citation",
                    )
                )
    return violations
