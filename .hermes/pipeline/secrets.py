"""secrets gate — gitleaks-style scan on ADDED lines only (t_0b7d66f8 c7 section 4).

v1 = fixed pattern set, no external dependency. Allowlist pragma: g0:allow:secrets.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from g0 import DiffFile, Violation, parse_diff, PRAGMA_RE


@dataclass
class SecretsResult:
    violations: list[Violation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)


# (rule, pattern) — ordered; first match wins per line
PATTERNS = [
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("aws-key", re.compile(r"AKIA[0-9A-Z]{16}")),
    (
        "api-key",
        re.compile(
            r"(?:api[_-]?key|apikey|secret|token|password)"
            r"\s*[=:]\s*['\"]([^'\"]{8,})['\"]",
            re.I,
        ),
    ),
]

# values that are obviously not secrets
PLACEHOLDERS = re.compile(
    r"^(?:x+|\.+|\*+|<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+|%[a-z]+%|your[_-]?api[_-]?key.*|"
    r"your[_-]?secret.*|your[_-]?token.*|changeme|placeholder|example|dummy|"
    r"test|sample|none|null|true|false|0+|xx|xxx)+$",
    re.I,
)

ENTROPY_MIN = 20
ENTROPY_THRESHOLD = 3.5  # bits/char for base64-ish charset variety

# --- identifier-shaped values are names, not opaque secret material ---------
# (card t_72f14378; separator widened to `_` by card t_67c7f1a4)
#
# The candidate charset below is `[A-Za-z0-9+/=_-]`, so `-` and `_` count as
# charset variety: an ordinary 20+ char separated NAME cleared the threshold on
# breadth alone. Measured against PR #16's real diff, 32 of 32 rows were two
# decision keys — `typescript-migration` (20 chars, 3.646 bits/char) and
# `architecture-style-v2` (21 chars, 3.849) — with no secret material in any of
# them. Then PR #56 measured the same trap on the `_` separator: the new
# `hpipe impact` field `unreadable_client_lines` (23 chars, 3.501) failed the
# gate, and the impacted work was shipped under a 19-char key to clear it.
# Changing the data or raising the threshold hides the trap and leaves it armed
# for the next ≥20-char name; the precision belongs here.
#
# Both load-bearing conditions survive the widening:
#   * at least one separator segment — a bare run of charset characters is not
#     a name and a UUID with the separators removed is not one either, so both
#     are still measured;
#   * at least one non-hex letter. A UUID-shaped token
#     (`a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c`) matches the identifier regex
#     exactly, and is kept inside the rule only because every one of its letters
#     is a hex digit. A common real secret shape is the last thing to drop.
#
# ponytail: the ceiling is charset-level discrimination, and widening the
# separator widens the ceiling with it — an all-lowercase value that IS opaque
# and happens to use `_` is now exempt exactly like its kebab twin
# (`my_lowercase_token_9f3a2b`, 25 chars, 4.103 bits/char, pinned as such in
# tests/test_secrets.py). It is a declared ceiling, not a silent drop: a
# credential of that shape assigned to a token/api-key/secret/password name is
# still caught by PATTERNS before the entropy sweep ever runs. Add a
# segment-length or dictionary discriminator when such a credential is missed,
# and calibrate it against this file's two directions.
_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$")
_HEX_CHARS = frozenset("0123456789abcdef")


def _is_identifier_shaped(value: str) -> bool:
    if not _IDENTIFIER_RE.match(value):
        return False
    return any(c not in _HEX_CHARS for c in value if c.isalpha())

# --- enumerated git-ref literals (card t_3b542ea9, D-ENT.1 / D-ENT.2) -------
#
# A git ref NAME is not a secret, but it is a high-entropy string by every
# measure this rule uses: `refs/remotes/origin/HEAD` is 24 chars at 3.741
# bits/char, over the 3.5 threshold, so writing one anywhere in a diff failed
# a gate that had nothing to report. That is a false positive reachable by
# anyone, on any line, in any file — and it held up a real PR for the class of
# finding it was supposed to be able to see.
#
# The exemption is EXACT FULL-STRING EQUALITY against this set, and it is
# deliberately not a prefix, a pattern, or a shape:
#
#   "refs/heads/" + <token>   4.991 entropy   a prefix allowlist exempts it
#   "refs/tags/"  + <digest>  4.176 entropy   a prefix allowlist exempts it
#
# A prefix over git ref names would silence the two credential shapes most
# likely to be pasted into a ref argument. A shape ("40 hex is a commit SHA")
# is worse: it also matches a GitHub token body, an AWS secret and a base64
# blob. Two enumerated literals cannot collide with a credential. A shape can,
# which is why the withdrawn t_9c0890a2 was the opposite of this fix.
#
# Every entry states WHY it is here, and a new entry must arrive with a reason
# beside it — a set that grows by pattern is the defect this replaced.
# `EXEMPT_REASONS` is the authority; the frozenset is derived from it so the
# two can never disagree.
EXEMPT_REASONS: dict[str, str] = {
    "refs/remotes/origin/HEAD": (
        "the default-branch symref git creates on clone; 24 chars, 3.741 "
        "entropy. Hand-written across the source AND its vendored copies "
        "(diffsource.py, init.py, the vendored runner and manifest), so a "
        "diff touching any of them used to fail the gate on its own contents."
    ),
    "HEAD": (
        "the pseudoref git resolves in every repository, distinct from the "
        "symref above (which points at refs/remotes/origin/<branch>, not at "
        "HEAD). 4 chars, below ENTROPY_MIN today, so it fires on nothing; it "
        "is listed because D-ENT.2 admits the refs git itself defines and "
        "because a set that claims to enumerate should not omit one."
    ),
}

# Membership is tested with `in` on a frozenset. `startswith`, `re`, a
# substring test and case folding are all available in this file's imports and
# all are wrong here; the type is the guard that makes reaching for one a
# visible change rather than an invisible one.
EXEMPT_LITERALS: frozenset[str] = frozenset(EXEMPT_REASONS)


def _shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    return -sum((n / len(s)) * math.log2(n / len(s)) for c, n in freq.items())


def _is_placeholder(value: str) -> bool:
    if PLACEHOLDERS.match(value):
        return True
    # value referencing config/env (not a literal)
    if re.match(r"^(?:os\.environ|env|config|settings|process\.env)", value):
        return True
    return False


def scan_secrets(diff_text: str) -> SecretsResult:
    """Scan ADDED lines only for secret-shaped literals.

    Allowlist pragma (t_0b7d66f8 c7 §4): `g0:allow:secrets` plus a reference
    (kanban task id or issue #) allows the hit WITH a note; a pragma without
    a reference is itself a violation (pragma-no-reference).

    The enumerated git-ref exemption (card t_3b542ea9, D-ENT.3) also reports a
    note, naming the value and the rule it was exempt from. A silent exemption
    is indistinguishable from the rule not having fired, which is the specific
    confusion this card exists to remove.
    """
    result = SecretsResult()
    files = parse_diff(diff_text)
    for f in files:
        for line_no, text in f.added:
            pm = PRAGMA_RE.search(text)
            if pm and pm.group(1) == "secrets":
                reference = pm.group(2).strip()
                if reference:
                    result.notes.append(
                        f"secrets: allowed hit at {f.path}:{line_no} "
                        f"(reference: {reference})"
                    )
                    continue
                result.violations.append(
                    Violation(
                        "pragma-no-reference", f.path, line_no, text.strip(),
                        gate="secrets",
                    )
                )
                continue
            rule, value = _match_line(text)
            if rule is None:
                continue
            if _is_placeholder(value or ""):
                continue
            if value in EXEMPT_LITERALS:
                result.notes.append(
                    f"secrets: exempted {rule} literal at {f.path}:{line_no}: "
                    f"{value!r} (rule: {rule}; enumerated git ref, "
                    f"card t_3b542ea9 D-ENT.2 — {EXEMPT_REASONS[value]})"
                )
                continue
            result.violations.append(
                Violation(rule, f.path, line_no, _redact(text.strip()), gate="secrets")
            )
    return result


def _match_line(text: str) -> tuple[str | None, str | None]:
    for rule, pattern in PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        if rule == "api-key":
            value = m.group(1)
            if PLACEHOLDERS.match(value):
                return None, None
            return "api-key", value
        return rule, m.group(0)
    # high-entropy string literal >= 20 chars
    for m in re.finditer(r"['\"]([A-Za-z0-9+/=_-]{20,})['\"]", text):
        value = m.group(1)
        if _is_placeholder(value):
            continue
        if _is_identifier_shaped(value):
            continue
        if _shannon_entropy(value) >= ENTROPY_THRESHOLD:
            return "high-entropy", value
    return None, None


def _redact(text: str) -> str:
    """Keep the line recognizable without printing a full secret."""
    if len(text) > 24:
        return text[:16] + "..." + text[-4:]
    return text
