"""conventions: manifest-level declared toolchain defaults (card t_ef540eb0).

D-V2 schema: three keys, each `auto`-capable. D-V1: validated at load,
returned on `Manifest.conventions` — nothing enters GATE_KEYS /
CANONICAL_GENERIC / LADDER_ORDER / GENERIC_ORDER, and nothing here can change
an exit code of the gate ladder.

This module is deliberately manifest-schema-only: `manifest.py` imports it
(the vendored flat-module layout copies both side by side, so
`init._flat`'s `from conventions import ...` rewrite keeps working), and it
must NOT import the report machinery back — that is why the schema lives
apart from the `hpipe conventions` report in `conventions.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

JS_PACKAGE_MANAGERS = ("pnpm", "npm", "yarn", "bun", "auto")
PYTHON_ENVS = ("uv", "pip", "poetry", "conda", "auto")
MULTI_PROJECT_ORCHESTRATORS = ("aspire", "none", "auto")

CONVENTIONS_DEFAULTS: dict[str, str] = {
    "js_package_manager": "pnpm",
    "python_env": "uv",
    # g0:allow:secrets t_ef540eb0 — one marker per flagged line: each literal
    # below is a manifest key name (D-V2), not a secret.
    "multi_project_orchestrator": "aspire",  # g0:allow:secrets t_ef540eb0
}

_CONVENTIONS_ALLOWED: dict[str, tuple[str, ...]] = {
    "js_package_manager": JS_PACKAGE_MANAGERS,
    "python_env": PYTHON_ENVS,
    # g0:allow:secrets t_ef540eb0 (manifest key names, not secrets; D-V2)
    "multi_project_orchestrator": MULTI_PROJECT_ORCHESTRATORS,  # g0:allow:secrets t_ef540eb0
}


@dataclass
class Conventions:
    """The repo's declared toolchain defaults (D-V2). `auto` defers to artifacts.

    `declared` records whether the repo expressed an opinion at all: an
    absent `conventions:` block means every key is UNDECLARED (D-V9) — the
    defaults are then proposals for `init` to *state*, not facts about the
    repo, and the report must be able to say "not declared" honestly. This
    is why `Conventions` is not a plain dict of defaults.

    `declared_keys` records WHICH keys carry an opinion (qa-judge round-2
    blocker): a partial block (`multi_project_orchestrator: none` only)
    declares that one key, and nothing else. The D-V2 defaults for the other
    keys remain proposals — `is_declared(key)` gates every place the report
    turns a value into a claim ("declares X"), not the block-level flag.
    """

    js_package_manager: str = CONVENTIONS_DEFAULTS["js_package_manager"]
    python_env: str = CONVENTIONS_DEFAULTS["python_env"]
    # g0:allow:secrets t_ef540eb0 — the key name below is the manifest
    # vocabulary (D-V2), not a secret; the sweep fires on its length alone.
    multi_project_orchestrator: str = CONVENTIONS_DEFAULTS["multi_project_orchestrator"]  # g0:allow:secrets t_ef540eb0
    declared: bool = field(default=False)
    declared_keys: frozenset[str] = field(default_factory=frozenset)

    def is_declared(self, key: str) -> bool:
        """This key is a fact the repo stated, not a D-V2 default."""
        return key in self.declared_keys  # g0:allow:secrets t_ef540eb0

    def to_dict(self) -> dict[str, str]:
        # g0:allow:secrets t_ef540eb0 — manifest key names below (D-V2), not
        # secrets; the entropy sweep fires on the pipeline's own vocabulary.
        return {
            "js_package_manager": self.js_package_manager,  # g0:allow:secrets t_ef540eb0
            "python_env": self.python_env,
            "multi_project_orchestrator": self.multi_project_orchestrator,  # g0:allow:secrets t_ef540eb0
        }


def validate_conventions(  # g0:allow:secrets t_ef540eb0
    conventions_raw: object, errors: list[str], warnings: list[str]
) -> Conventions:
    """Validate the `conventions:` block. Absent -> D-V2 defaults, UNDECLARED.

    Errors carry the key and the full allowed-value list (acceptance: an
    invalid value exits 2 with a message naming the allowed values).
    """
    del warnings  # reserved: unknown keys may become warnings later
    if conventions_raw is None:
        return Conventions(declared=False)
    if not isinstance(conventions_raw, dict):
        errors.append("conventions: must be a mapping")
        return Conventions(declared=False)
    stated = set()
    for key in conventions_raw:
        if key not in _CONVENTIONS_ALLOWED:
            errors.append(
                f"conventions.{key}: unknown conventions key "
                f"(allowed: {', '.join(_CONVENTIONS_ALLOWED)})"
            )
        else:
            stated.add(key)
    conv = Conventions(declared=True, declared_keys=frozenset(stated))
    for key, allowed in _CONVENTIONS_ALLOWED.items():
        value = conventions_raw.get(key)
        if value is None:
            continue  # absent key -> that key's default (still UNDECLARED)
        if not isinstance(value, str) or value not in allowed:
            errors.append(
                f"conventions.{key}: unknown value {value!r} "
                f"(allowed: {', '.join(allowed)})"
            )
        else:
            setattr(conv, key, value)
    return conv
