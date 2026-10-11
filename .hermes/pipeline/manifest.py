"""pipeline.yaml manifest: load/validate per t_0b7d66f8 comment 7 (binding).

Exit code 2 = config error throughout: caller maps ManifestError -> 2.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from docclaims import DEFAULT_ID_PATTERN as DOC_CLAIMS_ID_PATTERN
from docclaims import DEFAULT_MARKDOWN as DOC_CLAIMS_MARKDOWN

from conventions_schema import Conventions, validate_conventions


class ManifestError(Exception):
    """Config error — carries the list of human-readable error strings."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def _err(errors: list[str], msg: str) -> None:
    errors.append(msg)


def _require_str(errors: list[str], where: str, v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        _err(errors, f"{where}: must be a non-empty string")
        return ""
    return v


def _reject_multiline_cmd(errors: list[str], where: str, v: Any) -> None:
    """A command the workflow template emits as `run: <cmd>` must be one line.

    The template writes the value verbatim on the `run:` line, so a YAML block
    scalar leaves its continuation lines at column 0 and the emitted
    pipeline.yml no longer parses (P6a pilot defect, t_17e366ac). Refuse at
    validation time (exit-2 semantics) and name the offending lines.
    """
    if isinstance(v, str) and "\n" in v:
        extra = [ln.strip() for ln in v.splitlines() if ln.strip()][1:]
        _err(
            errors,
            f"{where}: cmd must be a single line — multi-line cmd corrupts the "
            "generated `run:` block (offending lines: " + "; ".join(extra) + ")",
        )


@dataclass
class GateSpec:
    cmd: str
    workdir: str = "."
    timeout_minutes: int = 15
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class ContractDriftSpec:
    spec: str
    gen_cmd: str
    check_cmd: str
    fail_hint: str | None = None


@dataclass
class ContractOrphansSpec:
    """The `gates.contract_orphans:` marker (t_721843ff).

    Deliberately EMPTY: the gate takes no options. Its source (the graph
    projection) and its scope (the actionable unmatched rows the diff
    touches) are the toolkit's answer, not per-repo configuration — an
    option here would be a knob nobody can defend a second value for. The
    block's PRESENCE is the declaration: building a graph is not free, so
    a repo that does not name the block gets no gate, no graph build, and
    no FAIL.
    """


@dataclass
class E2ESpec:
    cmd: str = ""
    workdir: str = "."
    services: list[str] = field(default_factory=list)
    compose_file: str = "docker-compose.yml"
    artifacts_dir: str = ".hermes/artifacts/e2e"
    journeys_precheck: bool = True


@dataclass
class DocClaimsSpec:
    """The `doc_claims:` block — the DECLARED doc-claims gate (t_d52ecb42).

    A citation/table check needs a per-repo answer to "which file is the
    decision register", so unlike the five generic gates it cannot run with
    zero manifest: a repo that declares nothing gets no gate and no FAIL.

    The three fields are independent. `citation_registers` names one register
    per identifier namespace; `markdown` is the file set BOTH checks scan;
    `id_pattern` is the citation grammar (unbounded quantifier — a two-digit
    ceiling stops matching once the register reaches three digits).
    """

    citation_registers: list[str] = field(default_factory=list)
    markdown: list[str] = field(default_factory=lambda: list(DOC_CLAIMS_MARKDOWN))
    id_pattern: str = DOC_CLAIMS_ID_PATTERN


@dataclass
class Manifest:
    version: int = 1
    owner: str | None = None
    name: str | None = None
    default_branch: str | None = None
    base: str | None = None
    stacks: list[str] = field(default_factory=list)
    gates: dict[str, Any] = field(default_factory=dict)
    ci_provider: str = "github-actions"
    ci_required_checks: list[str] = field(default_factory=list)
    ci_contract: str | None = None
    db_guard_pattern: str = r"(?:^|[_\-.])(?:test|ci)(?:$|[_\-.])"
    pnpm_minimum_release_age: int = 4320
    deps_popularity: dict[str, int] = field(default_factory=dict)
    deps_max_age_days: int = 90
    journeys_dir: str = ".hermes/journeys"
    axe: bool | None = None
    doc_claims: DocClaimsSpec | None = None
    conventions: Conventions = field(default_factory=Conventions)
    raw: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def load_validate(path: Path) -> Manifest:
    """Parse + validate the manifest at `path`.

    Missing file is valid: implicit version 1, empty manifest (defaults apply).
    Raises ManifestError (exit-2 semantics) on any validation failure.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not Path(path).exists():
        return Manifest()

    try:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ManifestError([f"manifest: invalid YAML ({e})"]) from e

    if raw is None:
        return Manifest()
    if not isinstance(raw, dict):
        raise ManifestError(["manifest: top level must be a mapping"])

    version = raw.get("version", 1)
    if not isinstance(version, int) or isinstance(version, bool):
        _err(errors, "version: must be an integer")
    elif version != 1:
        _err(errors, f"version: unsupported version {version} (only 1)")

    if "repo" in raw and not isinstance(raw["repo"], dict):
        _err(errors, "repo: must be a mapping")

    if "base" in raw and raw["base"] is not None:
        if not isinstance(raw["base"], str) or not raw["base"].strip():
            _err(errors, "base: must be a non-empty string (the diff base ref)")

    gates: dict[str, Any] = {}
    if "gates" in raw and raw["gates"] is not None:
        gates_raw = raw["gates"]
        if not isinstance(gates_raw, dict):
            _err(errors, "gates: must be a mapping")
        else:
            for key, val in gates_raw.items():
                if key not in GATE_KEYS:
                    _err(
                        errors,
                        f"gates.{key}: unknown gate key (allowed: {', '.join(GATE_KEYS)})",
                    )
                    continue
                if not isinstance(val, dict):
                    _err(errors, f"gates.{key}: must be a mapping")
                    continue
                gates[key] = _validate_gate(key, val, errors, Path(path))

    if "stacks" in raw and raw["stacks"] is not None:
        stacks = raw["stacks"]
        if not isinstance(stacks, list):
            _err(errors, "stacks: must be a list")
        else:
            for s in stacks:
                if not isinstance(s, str):
                    _err(errors, f"stacks: entries must be strings, got {s!r}")
                elif s not in KNOWN_STACKS:
                    warnings.append(f"stacks: unknown value {s!r} ignored (extensible)")

    if errors:
        raise ManifestError(errors)

    ci = raw.get("ci") or {}
    contract = ci.get("contract")
    if contract is not None and not re.fullmatch(r"[\w.-]+/[\w.-]+", str(contract)):
        _err(errors, f"ci.contract: '{contract}' does not match OWNER/REPO")
    provider = ci.get("provider", "github-actions")
    if provider != "github-actions":
        _err(errors, f"ci.provider: unknown provider {provider!r} (v1: github-actions)")
    required_checks = ci.get("required_checks") or _default_required_checks(raw, gates)
    canonical = set(CANONICAL_GENERIC) | {"doc-claims"} | {
        k.replace("_", "-") for k in GATE_KEYS
    }
    for rc in required_checks:
        if rc not in canonical:
            _err(errors, f"ci.required_checks: unknown check name {rc!r}")

    db_guard = raw.get("db_guard") or {}
    db_pattern = db_guard.get("pattern", r"(?:^|[_\-.])(?:test|ci)(?:$|[_\-.])")
    try:
        re.compile(db_pattern)
    except re.error as e:
        _err(errors, f"db_guard.pattern: invalid regex ({e})")

    supply = raw.get("supply_chain") or {}
    min_age = supply.get("pnpm_minimumReleaseAge", 4320)
    if not isinstance(min_age, int) or isinstance(min_age, bool):
        _err(errors, "supply_chain.pnpm_minimumReleaseAge: must be an integer")

    # deps: block (t_57cd00ba D-E1, D-E5). A top-level configuration block for
    # the `hpipe deps scan` subcommand — NOT a gate: it must never appear in
    # GATE_KEYS, LADDER_ORDER, CANONICAL_GENERIC or ci.required_checks (D-E7).
    # Unknown subkeys are ignored (open like the top level); the values that
    # WOULD be silently misread are validated here.
    deps = raw.get("deps") or {}
    if not isinstance(deps, dict):
        _err(errors, "deps: must be a mapping")
        deps = {}
    deps_popularity = {
        **{eco: threshold for eco, threshold in DEPS_DEFAULT_POPULARITY.items()},
        **(deps.get("popularity") or {}),
    }
    if isinstance(deps.get("popularity"), dict):
        for eco, threshold in deps["popularity"].items():
            if eco not in DEPS_DEFAULT_POPULARITY:
                _err(errors, f"deps.popularity.{eco}: unknown ecosystem "
                             f"(allowed: {', '.join(DEPS_DEFAULT_POPULARITY)})")
            elif not isinstance(threshold, int) or isinstance(threshold, bool) or threshold < 0:
                _err(errors, f"deps.popularity.{eco}: must be a non-negative integer")
    deps_max_age_days = deps.get("max_age_days", 90)
    if not isinstance(deps_max_age_days, int) or isinstance(deps_max_age_days, bool) \
            or deps_max_age_days <= 0:
        _err(errors, "deps.max_age_days: must be a positive integer")

    frontend = raw.get("frontend") or {}
    journeys_dir = frontend.get("journeys_dir", ".hermes/journeys")
    axe = frontend.get("axe")
    if axe is None:
        axe = "node" in [s for s in (raw.get("stacks") or []) if isinstance(s, str)]

    # doc_claims: block (t_d52ecb42). The declared doc-claims gate. A repo that
    # omits the block gets no gate at all; a repo that names the block but no
    # register is a config error, because an empty register list would run the
    # citation check against nothing and report clean.
    doc_claims: DocClaimsSpec | None = None
    if raw.get("doc_claims") is not None:
        block = raw["doc_claims"]
        if not isinstance(block, dict):
            _err(errors, "doc_claims: must be a mapping")
        else:
            doc_claims = _validate_doc_claims(block, errors)

    if errors:
        raise ManifestError(errors)

    conventions = validate_conventions(raw.get("conventions"), errors, warnings)

    if errors:
        raise ManifestError(errors)

    return Manifest(
        version=version,
        owner=(raw.get("repo") or {}).get("owner"),
        name=(raw.get("repo") or {}).get("name"),
        default_branch=(raw.get("repo") or {}).get("default_branch"),
        base=(raw.get("base") if isinstance(raw.get("base"), str) else None),
        stacks=[s for s in (raw.get("stacks") or []) if isinstance(s, str)],
        gates=gates,
        ci_provider=provider,
        ci_required_checks=list(required_checks),
        ci_contract=contract,
        db_guard_pattern=db_pattern,
        pnpm_minimum_release_age=min_age,
        deps_popularity=deps_popularity,
        deps_max_age_days=deps_max_age_days,
        journeys_dir=journeys_dir,
        axe=axe,
        doc_claims=doc_claims,
        conventions=conventions,
        raw=raw,
        warnings=warnings,
    )


KNOWN_STACKS = ("python", "node", "dotnet", "go", "rust", "java-kotlin")
GATE_KEYS = (
    "lint",
    "typecheck",
    "unit",
    "build",
    "contract_drift",
    "contract_orphans",
    "e2e",
)
CANONICAL_GENERIC = (
    "g0-laziness",
    "secrets",
    "db-guard",
    "pr-checklist",
    "supply-chain",
    "decision-citation",
)

# Popularity thresholds, per ecosystem, for `hpipe deps scan` (t_57cd00ba D-E5).
# Stated POLICY, not measurement: npm weekly downloads, pypi monthly downloads,
# nuget total downloads. Deliberately conservative — every package named in the
# card clears these with headroom. Overridable per repo in the manifest:
#
#   deps:
#     popularity: { npm: 1000000, pypi: 100000, nuget: 1000000 }
#
DEPS_DEFAULT_POPULARITY = {"npm": 1_000_000, "pypi": 100_000, "nuget": 1_000_000}
DEPS_ECOSYSTEMS = tuple(DEPS_DEFAULT_POPULARITY)


def _default_required_checks(raw: dict[str, Any], gates: dict[str, Any]) -> list[str]:
    """ALL declared gate names present (hyphenated) union the canonical generics."""
    declared = [k.replace("_", "-") for k in GATE_KEYS if k in gates]
    if isinstance(raw.get("doc_claims"), dict):
        declared.append("doc-claims")
    return list(CANONICAL_GENERIC) + declared


LADDER_ORDER = (
    ("g0-laziness", "generic"),
    ("secrets", "generic"),
    ("db-guard", "generic"),
    ("pr-checklist", "generic"),
    ("supply-chain", "generic"),
    ("doc-claims", "declared"),
    ("decision-citation", "generic"),
    ("lint", "declared"),
    ("typecheck", "declared"),
    ("unit", "declared"),
    ("build", "declared"),
    ("contract-drift", "declared"),
    ("contract-orphans", "declared"),
    ("e2e", "declared"),
)


def plan_gates(manifest: Manifest) -> list[dict[str, Any]]:
    """Ordered gate plan per the C3 ladder (t_3b27eacf synthesis).

    Returns [{name, kind, cmd, workdir, env, timeout_minutes, required}].
    Generic gates always present (cmd=None; the engine implements them).
    Declared gates appear only when the manifest declares them.
    """
    plan: list[dict[str, Any]] = []
    for name, kind in LADDER_ORDER:
        if name == "doc-claims":
            # Declared AND toolkit-implemented: present only when the manifest
            # carries the block, unlike a manifest-less repo which gets five
            # generic checks and no doc-claims at all.
            spec = manifest.doc_claims
            if spec is None:
                continue
            plan.append(
                {
                    "name": name,
                    "kind": "declared",
                    "cmd": None,
                    "workdir": ".",
                    "env": {},
                    "timeout_minutes": 15,
                    "required": True,
                    "spec": spec,
                }
            )
            continue
        if kind == "generic":
            plan.append(
                {
                    "name": name,
                    "kind": "generic",
                    "cmd": None,
                    "workdir": ".",
                    "env": {},
                    "timeout_minutes": 15,
                    "required": True,
                }
            )
            continue
        key = name.replace("-", "_")
        spec = manifest.gates.get(key)
        if spec is None:
            continue
        entry: dict[str, Any] = {
            "name": name,
            "kind": "declared",
            # contract_orphans is toolkit-implemented with no command and no
            # per-gate fields (t_721843ff): the engine reads the projection.
            "cmd": getattr(spec, "gen_cmd", None)
            if key == "contract_drift"
            else getattr(spec, "cmd", None),
            "workdir": getattr(spec, "workdir", "."),
            "env": dict(getattr(spec, "env", {}) or {}),
            "timeout_minutes": getattr(spec, "timeout_minutes", 15),
            "required": True,
        }
        if key == "contract_drift":
            entry["spec"] = spec.spec
            entry["check_cmd"] = spec.check_cmd
            entry["fail_hint"] = spec.fail_hint
        if key == "contract_orphans":
            # Toolkit-implemented like doc-claims: the engine reads the
            # graph projection itself, so there is no user command and the
            # CI job runs the vendored runner.
            entry["cmd"] = None
            entry["spec"] = spec
        if key == "e2e":
            entry["services"] = spec.services
            entry["compose_file"] = spec.compose_file
            entry["artifacts_dir"] = spec.artifacts_dir
            entry["journeys_precheck"] = spec.journeys_precheck
        plan.append(entry)
    return plan


def resolve_defaults(manifest: Manifest, repo_root: Path) -> Manifest:
    """Fill owner/name/default_branch from git where the manifest omits them.

    owner/name: parsed from `git remote get-url origin` (https or ssh, .git
    stripped, github.com only in v1). default_branch: `git symbolic-ref --short
    refs/remotes/origin/HEAD`, fallback "main". Unparsable remote leaves None.
    """
    repo_root = Path(repo_root)
    import subprocess

    if not manifest.owner or not manifest.name:
        try:
            url = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=repo_root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            m = re.match(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?$", url)
            if m:
                if not manifest.owner:
                    manifest.owner = m.group(1)
                if not manifest.name:
                    manifest.name = m.group(2)
        except (subprocess.CalledProcessError, OSError):
            pass

    if not manifest.default_branch:
        try:
            ref = subprocess.run(
                ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
                cwd=repo_root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            manifest.default_branch = ref.split("/")[-1] if ref else "main"
        except (subprocess.CalledProcessError, OSError):
            manifest.default_branch = "main"

    return manifest


def _validate_gate(
    key: str, val: dict[str, Any], errors: list[str], manifest_path: Path
) -> Any:
    if key == "contract_drift":
        spec = _require_str(errors, f"gates.contract_drift.spec", val.get("spec"))
        gen_cmd = _require_str(
            errors, "gates.contract_drift.gen_cmd", val.get("gen_cmd")
        )
        _reject_multiline_cmd(errors, "gates.contract_drift.gen_cmd", val.get("gen_cmd"))
        check_cmd = _require_str(
            errors, "gates.contract_drift.check_cmd", val.get("check_cmd")
        )
        fail_hint = val.get("fail_hint")
        if fail_hint is not None and not isinstance(fail_hint, str):
            _err(errors, "gates.contract_drift.fail_hint: must be a string")
        return ContractDriftSpec(spec, gen_cmd, check_cmd, fail_hint)

    if key == "contract_orphans":
        # The block takes no fields (t_721843ff D-G1.1): its presence is the
        # declaration. Naming any field is a config error, because a field
        # the gate would silently ignore reads as configured when it is not.
        if val:
            _err(
                errors,
                f"gates.contract_orphans: takes no fields (got "
                f"{', '.join(sorted(val))}) — the block's presence is the "
                "whole declaration",
            )
        return ContractOrphansSpec()

    if key == "e2e":
        cmd = _require_str(errors, "gates.e2e.cmd", val.get("cmd"))
        _reject_multiline_cmd(errors, "gates.e2e.cmd", val.get("cmd"))
        workdir = val.get("workdir", ".")
        services = val.get("services") or []
        if not isinstance(services, list) or not all(
            isinstance(s, str) for s in services
        ):
            _err(errors, "gates.e2e.services: must be a list of strings")
            services = []
        compose_file = val.get("compose_file", "docker-compose.yml")
        artifacts_dir = val.get("artifacts_dir", ".hermes/artifacts/e2e")
        journeys_precheck = val.get("journeys_precheck", True)
        if services and not isinstance(compose_file, str):
            _err(errors, "gates.e2e.compose_file: must be a string")
        if services and isinstance(compose_file, str):
            repo_root = manifest_path.parent.parent
            if not (repo_root / compose_file).exists():
                _err(
                    errors,
                    f"gates.e2e: services configured but compose file "
                    f"'{compose_file}' not found at repo root",
                )
        if not isinstance(journeys_precheck, bool):
            _err(errors, "gates.e2e.journeys_precheck: must be a boolean")
        return E2ESpec(
            cmd, workdir, services, compose_file, artifacts_dir, journeys_precheck
        )

    cmd = _require_str(errors, f"gates.{key}.cmd", val.get("cmd"))
    _reject_multiline_cmd(errors, f"gates.{key}.cmd", val.get("cmd"))
    workdir = val.get("workdir", ".")
    timeout_minutes = val.get("timeout_minutes", 15)
    env = val.get("env") or {}
    if not isinstance(workdir, str):
        _err(errors, f"gates.{key}.workdir: must be a string")
    if not isinstance(timeout_minutes, int) or isinstance(timeout_minutes, bool):
        _err(errors, f"gates.{key}.timeout_minutes: must be an integer")
    if not isinstance(env, dict) or not all(
        isinstance(k, str) and isinstance(v2, str) for k, v2 in env.items()
    ):
        _err(errors, f"gates.{key}.env: must be a mapping of strings")
    return GateSpec(cmd, workdir, timeout_minutes, env)


def _validate_doc_claims(val: dict[str, Any], errors: list[str]) -> DocClaimsSpec:
    """Validate the `doc_claims:` block, defaulting the fields it omits.

    An EXPLICITLY empty `citation_registers` (or `markdown`) is a config error:
    the key is present, so the author meant to run that check, and an empty set
    would make it scan nothing and report clean. Omitting the key is how you
    say "do not run this half".
    """
    registers = val.get("citation_registers")
    if registers is None:
        registers = []
    elif not isinstance(registers, list) or not all(
        isinstance(r, str) and r.strip() for r in registers
    ):
        _err(errors, "doc_claims.citation_registers: must be a list of non-empty strings")
        registers = []
    elif not registers:
        _err(
            errors,
            "doc_claims.citation_registers: must name at least one register when the "
            "key is present (an empty list would run the citation check against "
            "nothing); omit the key to run the table check alone",
        )

    markdown = val.get("markdown")
    if markdown is None:
        markdown = list(DOC_CLAIMS_MARKDOWN)
    elif not isinstance(markdown, list) or not all(
        isinstance(m, str) and m.strip() for m in markdown
    ):
        _err(errors, "doc_claims.markdown: must be a list of non-empty strings")
        markdown = list(DOC_CLAIMS_MARKDOWN)
    elif not markdown:
        _err(
            errors,
            "doc_claims.markdown: must name at least one glob when the key is "
            "present; omit the key to scan **/*.md",
        )

    id_pattern = val.get("id_pattern", DOC_CLAIMS_ID_PATTERN)
    if not isinstance(id_pattern, str) or not id_pattern.strip():
        _err(errors, "doc_claims.id_pattern: must be a non-empty string")
        id_pattern = DOC_CLAIMS_ID_PATTERN
    else:
        try:
            re.compile(id_pattern)
        except re.error as e:
            _err(errors, f"doc_claims.id_pattern: invalid regex ({e})")

    return DocClaimsSpec(list(registers), list(markdown), id_pattern)
