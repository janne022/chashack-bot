"""supply-chain gate: JS lockfile present -> cooldown config present and >= minimum."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from g0 import Violation

LOCKFILES = ("pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb")

# Lockfiles this gate can SEE but not police. The cooldown config for these
# ecosystems is a recorded follow-up (card t_c5a1ec08); until it exists the
# gate must say so rather than pass silently over the repo. Extend this mapping
# when a new ecosystem's lockfile becomes common — one entry per lockfile.
UNCOVERED_LOCKFILES = {
    "packages.lock.json": "NuGet",
    "uv.lock": "uv/PyPI",
}

# The cooldown lives wherever the package manager does: skafferi's pnpm
# workspace (and so its lockfile and `minimumReleaseAge`) is in `web/`, not the
# repo root (card t_6493ed91). Config is read from any depth, and an installed
# copy of a dependency is never the repo's own declaration.
_PRUNED_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__"}
_CONFIG_FILES = ("package.json", ".npmrc", "pnpm-workspace.yaml")
_WANTED_FILES = frozenset(LOCKFILES) | frozenset(UNCOVERED_LOCKFILES) | frozenset(
    _CONFIG_FILES
)


@dataclass
class SupplyChainResult:
    violations: list[Violation] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    skipped: bool = False

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)


def _discover(root: Path) -> dict[str, list[Path]]:
    """{basename: [paths]} for every file this gate reads, at any depth.

    ONE walk, pruned and sorted, so the answer is stable across runs. Paths are
    repo-relative in the reports, so a nested hit is named where it was found
    rather than as an anonymous root file.
    """
    found: dict[str, list[Path]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in _PRUNED_DIRS)
        for name in sorted(filenames):
            if name in _WANTED_FILES:
                found.setdefault(name, []).append(Path(dirpath) / name)
    return found


def _rel(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _config_values(root: Path, found: dict[str, list[Path]]) -> list[tuple[str, int]]:
    """All (source, value) cooldown declarations found, at any depth."""
    out: list[tuple[str, int]] = []
    for pkg in found.get("package.json", []):
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        v = (data.get("pnpm") or {}).get("minimumReleaseAge")
        if isinstance(v, int) and not isinstance(v, bool):
            out.append((f"{_rel(root, pkg)} pnpm.minimumReleaseAge", v))
    for npmrc in found.get(".npmrc", []):
        try:
            text = npmrc.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            m = re.match(r"^\s*minimum-release-age\s*=\s*(\d+)\s*$", line)
            if m:
                out.append(
                    (f"{_rel(root, npmrc)} minimum-release-age", int(m.group(1)))
                )
    for workspace in found.get("pnpm-workspace.yaml", []):
        try:
            data = yaml.safe_load(workspace.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError):
            continue
        v = (data or {}).get("minimumReleaseAge") if isinstance(data, dict) else None
        if isinstance(v, int) and not isinstance(v, bool):
            out.append((f"{_rel(root, workspace)} minimumReleaseAge", v))
    return out


def check_supply_chain(root: Path, pnpm_minimum_release_age: int = 4320) -> SupplyChainResult:
    """Lockfile present -> cooldown config must exist and be >= the minimum.

    The cooldown rule is implemented for the JS ecosystems only. A repo whose
    only lockfile is NuGet or uv gets no coverage, so this gate WARNS (advisory,
    exit 0) naming the lockfile it saw and the ecosystem it could not check —
    reporting as "run" over a repo it never covered is the defect this closes.

    Lockfiles and cooldown config are discovered at ANY depth (card
    t_6493ed91): a root-only scan reported SKIP over skafferi, whose
    `pnpm-lock.yaml` and `minimumReleaseAge` both live in `web/` — a green
    result over a repo with a committed cooldown that verified nothing.
    """
    result = SupplyChainResult()
    root = Path(root)
    found = _discover(root)
    uncovered = [
        (lf, ecosystem)
        for lf, ecosystem in sorted(UNCOVERED_LOCKFILES.items())
        if found.get(lf)
    ]
    js_locks = [
        path for lf in LOCKFILES for path in found.get(lf, [])
    ]
    has_lock = bool(js_locks)

    for lf, ecosystem in uncovered:
        result.warnings.append(
            f"{lf} present — this gate enforces the JS cooldown only; no "
            f"{ecosystem} cooldown config is checked"
        )

    if not has_lock:
        if not uncovered:
            result.skipped = True
            result.notes.append(
                "supply-chain: no JS lockfile at any depth — gate skipped"
            )
        return result

    configs = _config_values(root, found)
    if not configs:
        result.violations.append(
            Violation(
                "cooldown-missing",
                _rel(root, js_locks[0]),
                0,
                "JS lockfile present but no pnpm minimumReleaseAge / "
                ".npmrc minimum-release-age / pnpm-workspace.yaml "
                "minimumReleaseAge config found at any depth",
                gate="supply-chain",
            )
        )
        return result

    best = max(v for _, v in configs)
    source = next(s for s, v in configs if v == best)
    if best < pnpm_minimum_release_age:
        result.violations.append(
            Violation(
                "cooldown-below-minimum",
                source,
                0,
                f"cooldown {best} < required {pnpm_minimum_release_age} minutes",
                gate="supply-chain",
            )
        )
    else:
        result.notes.append(
            f"supply-chain: cooldown config {best} ({source}) "
            f">= {pnpm_minimum_release_age}"
        )
    return result
