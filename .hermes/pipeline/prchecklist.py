"""pr-checklist gate: PR body must carry `## Requirements` and `## Acceptance`."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from g0 import Violation


@dataclass
class ChecklistResult:
    violations: list[Violation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)


def check_pr_body(body: str | None) -> ChecklistResult:
    """PR body must contain headings `## Requirements` and `## Acceptance` (case-insensitive)."""
    result = ChecklistResult()
    text = body or ""
    has_req = re.search(r"^#{2,3}\s+.*requirements", text, re.I | re.M) is not None
    has_acc = re.search(r"^#{2,3}\s+.*acceptance", text, re.I | re.M) is not None
    if not has_req:
        result.violations.append(
            Violation(
                "missing-heading",
                "PR_BODY",
                0,
                "PR body is missing a `## Requirements` heading",
                gate="pr-checklist",
            )
        )
    if not has_acc:
        result.violations.append(
            Violation(
                "missing-heading",
                "PR_BODY",
                0,
                "PR body is missing an `## Acceptance` heading",
                gate="pr-checklist",
            )
        )
    return result
