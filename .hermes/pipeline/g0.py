"""G0 — static anti-laziness gate (t_0b7d66f8 comment 6 section 5, binding via C6)."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

EXTENSION_LANG = {
    ".py": "python",
    ".js": "node",
    ".jsx": "node",
    ".mjs": "node",
    ".cjs": "node",
    ".ts": "node",
    ".tsx": "node",
    ".cs": "dotnet",
    ".go": "go",
    ".rs": "rust",
    ".kt": "java-kotlin",
    ".kts": "java-kotlin",
    ".java": "java",
}


@dataclass
class DiffFile:
    path: str
    added: list[tuple[int, str]]
    removed: list[tuple[int, str]]
    deleted: bool = False
    language: str | None = field(default=None, init=False)

    def __post_init__(self):
        suffix = "." + self.path.rsplit(".", 1)[-1] if "." in self.path else ""
        self.language = EXTENSION_LANG.get(suffix)


def parse_diff(diff_text: str) -> list[DiffFile]:
    """Parse a unified diff into DiffFile records with correct new-file line numbers."""
    files: list[DiffFile] = []
    current: DiffFile | None = None
    new_line = 0
    old_line = 0

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            if current is not None:
                files.append(current)
            current = DiffFile(path=line.split(" b/", 1)[-1], added=[], removed=[])
            continue
        if current is None:
            continue
        if line.startswith("deleted file"):
            current.deleted = True
            continue
        if line.startswith(("--- ", "+++ ", "index ", "new file", "similarity")):
            continue
        if line.startswith("@@"):
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)", line)
            if m:
                new_line = int(m.group(1))
                old_m = re.match(r"@@ -(\d+)", line)
                old_line = int(old_m.group(1)) if old_m else 1
            continue
        if line.startswith("+"):
            current.added.append((new_line, line[1:].rstrip("\r")))
            new_line += 1
        elif line.startswith("-"):
            current.removed.append((old_line, line[1:].rstrip("\r")))
            old_line += 1
        else:
            new_line += 1
            old_line += 1

    if current is not None:
        files.append(current)
    return files


def classify_mode(files: list[DiffFile], stacks: list[str]) -> tuple[str, str | None]:
    """Extension census: SINGLE (>=80% share or <3 live files) or MULTI.

    `stacks` is a floor, not a veto: a listed language always keeps its rules
    on its own files even below the threshold. The extension alone decides a
    file's language — the census never reassigns it.
    """
    live = [f for f in files if not f.deleted and f.language is not None]
    if not live:
        return "SINGLE", None
    counts: dict[str, int] = {}
    for f in live:
        counts[f.language] = counts.get(f.language, 0) + 1
    total = len(live)
    if total < 3:
        return "SINGLE", max(counts, key=lambda k: counts[k])
    top_lang, top_count = max(counts.items(), key=lambda kv: kv[1])
    if top_count / total >= 0.8:
        return "SINGLE", top_lang
    return "MULTI", None


# --- content rules -----------------------------------------------------------

TODO_RE = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")  # g0:allow:TODO hpipe-vendor: token regex literal, not a TODO
NOT_IMPLEMENTED = {
    "python": re.compile(r"\bNotImplementedError\b"),
    "dotnet": re.compile(r"\bNotImplementedException\b"),
    "rust": re.compile(r"\btodo!\(|\bunimplemented!\("),
    "node": re.compile(r"throw new Error\(\s*['\"]not implemented['\"]\s*\)", re.I),
}
PRAGMA_RE = re.compile(r"g0:allow:([\w-]+)\s*(.*)")


@dataclass
class Violation:
    rule: str
    path: str
    line: int
    evidence: str
    gate: str = "g0"

    def format(self) -> str:
        return f"GATE:{self.gate}:{self.rule}:{self.path}:{self.line}: {self.evidence}"


@dataclass
class G0Result:
    violations: list[Violation] = field(default_factory=list)
    warnings: list[Violation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    _test_files: int = field(default=0, repr=False)
    _test_net_removed: int = field(default=0, repr=False)
    _test_paths: list[str] = field(default_factory=list, repr=False)

    def __iter__(self):
        return iter(self.violations)

    def __len__(self) -> int:
        return len(self.violations)

    def lines(self) -> list[str]:
        return [v.format() for v in self.violations + self.warnings]


# --- V0 static UI rules (frontend-ux R3/R4/R6) --------------------------------
#
# The skill's V0 tier is a source scan inside this generic gate. Three limits
# are load-bearing, so they are stated in the code as well as the skill:
#
# 1. Severity is WARNING, never a violation. These are regex heuristics over
#    text, not measurements of a served DOM; a WARN cannot fail `hpipe check`
#    (runner: failed = any status == "FAIL"). Promotion to blocking is deferred
#    until a measured noise rate justifies it.
# 2. Evidence is the diff. g0_scan sees only ADDED lines of CHANGED files, so a
#    pre-existing long form, a native confirm, an unlabelled icon button, or a
#    list view outside the diff is invisible here. A miss is silent; it is never
#    reported as a pass over the whole repository.
# 3. Every rule routes through the existing `_maybe_allow` escape hatch:
#    `g0:allow:<rule> <reference>` on the offending line. A pragma with no
#    reference stays a `pragma-no-reference` violation, as for every other rule.

UI_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
JSX_SUFFIXES = (".tsx", ".jsx")

_CONTROL_RE = re.compile(r"<(?:input|select|textarea)\b", re.I)
_FORM_OPEN_RE = re.compile(
    r"<form\b|role\s*=\s*[\"']dialog[\"']|<\w*(?:Dialog|Modal|Sheet|Drawer)\b"
)
_JSX_CLOSE_RE = re.compile(r"<\s*/\s*(\w+)\s*>")
_NATIVE_DIALOG_RE = re.compile(r"\bwindow\.confirm\s*\(|(?<![.\w])alert\s*\(")
_BUTTON_OPEN_RE = re.compile(r"<button\b")
_BUTTON_CLOSE_RE = re.compile(r"<\s*/\s*button\s*>")
_LABEL_ATTR_RE = re.compile(r"\baria-label(?:ledby)?\s*=", re.I)
_ICON_CHILD_RE = re.compile(
    r"^\s*<\s*(?:svg\b|[\w.]*(?:Icon|Icons)\b)[^<>]*(?:/>|>.*</[\w.]*>\s*)$", re.I
)
_TAGS_ONLY_RE = re.compile(r"<[^<>]*>")
_LIST_MAP_RE = re.compile(r"\.map\s*\(")
_JSX_TAG_RE = re.compile(r"<[A-Za-z]")
_LIST_RECEIVER_RE = re.compile(r"([\w.]+)\.map\s*\(")
# `{counters ? (<dl>…</dl>) : null}` is the standard React empty-state idiom:
# the render exists and the empty case already has a path. Only the ENCLOSING
# shape counts — an opener on its own line and a `: null` closer below it. A
# complete one-line ternary such as `{on ? go() : null}` is an expression
# inside the render, not a guard around it, and must not silence the rule.
_TERNARY_OPENER_RE = re.compile(r"\{\s*[\w.]+\s*(?:\?\?\s*[\w.]+\s*)?\?\s*\(?\s*$")
_TERNARY_CLOSER_RE = re.compile(r":\s*(?:null|undefined|false|<>|''|\"\")\s*\}?\s*$")
_TERNARY_LOOKBACK = 4
_TERNARY_LOOKAHEAD = 20
# Receivers that cannot be empty: a synthetic `Array.from({ length: N })` and a
# module-level CONSTANT. Neither is a collection a person can find empty, so R6
# ("a blank area where a list should be") does not apply to them.
#
# The CONSTANT case is decided by `_CONST_RECEIVER_RE` below, not here. A blanket
# `_\w+\.map(` clause used to stand in for it and silenced every underscore-named
# receiver, which is a real R6 dead end: `const _rows = items.filter(…)` can
# return nothing. Naming must not decide whether a collection is empty.
_SYNTHETIC_RECEIVER_RE = re.compile(
    r"Array\s*\.\s*from\s*\(|Object\s*\.\s*(?:keys|values|entries)\s*\("
)
# A module-level CONSTANT. The optional leading underscore (`_ROWS`) is
# hardening, not a corpus finding: the 114-file corpus contains no
# underscore-prefixed `.map` receiver at all (grep over first-party TSX returns
# zero; the only hits are vendored node_modules), and reverting this to
# `^[A-Z][A-Z0-9_]*$` reproduces the probe output byte for byte. It is kept
# because `_`-prefixed ALL-CAPS is still a CONSTANT by any reading, and a
# leading underscore must not decide whether a collection is empty.
_CONST_RECEIVER_RE = re.compile(r"^_?[A-Z][A-Z0-9_]*$")
# A local bound to a fixed array cannot be empty either. Only the provable
# assignments qualify — a synthetic array, an object-key list, or a non-empty
# array literal. `const rows = items.filter(…)` is deliberately NOT one of them:
# a filter can return nothing, which is exactly the dead end R6 describes.
_FIXED_ARRAY_ASSIGN_RE = re.compile(
    r"\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*"
    r"(?:Array\s*\.\s*from\s*\(|Object\s*\.\s*(?:keys|values|entries)\s*\()"
)
_NON_EMPTY_LITERAL_RE = re.compile(
    r"\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*\[[^\]\s][^\]]*\]"
)
_EMPTY_GUARD_RE = re.compile(
    r"\.(?:length|size)\b|isEmpty|\bEmpty[A-Z]|\bEmpty\b|NoResults|NoItems|NoData"
    r"|\bno\s+\w+\b[^<]{0,16}\b(?:yet|found|matches)\b",
    re.I,
)


@dataclass
class _UiRegion:
    """One form-like region: where it opens, its opening line, control count."""

    line: int
    text: str
    count: int = 0
    closer: str | None = None
    any_closer: bool = False


def _is_js_family(path: str) -> bool:
    return path.lower().endswith(UI_SUFFIXES)


def _is_jsx_file(path: str) -> bool:
    return path.lower().endswith(JSX_SUFFIXES)


def _strip_comment(text: str) -> str:
    """Code before the first line/block comment marker (a mention is not a call)."""
    cut = len(text)
    for marker in ("//", "/*"):
        idx = text.find(marker)
        if idx != -1:
            cut = min(cut, idx)
    return text[:cut]


def _jsx_tag_end(text: str, start: int) -> int:
    """Index of the `>` closing the tag opened at `start`, or -1 if unterminated.

    Bracket depth is tracked so `onClick={save}` does not end the tag early. An
    arrow function inside an attribute (`onClick={() => x}`) can fool it; the
    callers treat that as an undetermined element and stay silent, which is the
    intended direction for a heuristic.
    """
    depth = 0
    quote = ""
    for i in range(start, len(text)):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "\"'`":
            quote = ch
        elif ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        elif ch == ">" and depth <= 0:
            return i
    return -1


def _scan_ui_field_count(f: DiffFile, result: G0Result) -> None:
    """R4: more than eight controls in one form-like region.

    Regions are `<form>`, `role="dialog"`, and Dialog/Modal/Sheet/Drawer
    components. Controls are counted on ADDED lines only, per the diff-only
    evidence limit stated above, and only where they sit *inside* the region:
    a control sharing a line with `</form>` but positioned after it belongs to
    whatever follows, so the opening and closing tags bound the count.

    Each added line is walked as a sequence of events — open tag, close tag —
    so a one-line `<form>…</form><input />` is counted the way it reads. The
    count of a region that never closes inside the diff is whatever accumulated
    when the stack is unwound.
    """
    stack: list[_UiRegion] = []

    def emit(region: _UiRegion) -> None:
        if region.count <= 8:
            return
        _maybe_allow(
            result,
            f,
            region.line,
            region.text,
            "ui-field-count",
            lambda: result.warnings.append(
                Violation(
                    "ui-field-count",
                    f.path,
                    region.line,
                    f"{region.count} input/select/textarea controls in one "
                    f"form-like region (R4 threshold: more than 8; advisory V0)",
                )
            ),
        )

    for line_no, text in f.added:
        pos = 0
        while pos < len(text):
            opened = _FORM_OPEN_RE.search(text, pos)
            closed = _JSX_CLOSE_RE.search(text, pos)
            if opened is not None and (closed is None or opened.start() < closed.start()):
                tag = opened.group(0)
                if stack:
                    # Controls before a nested region still belong to it.
                    stack[-1].count += len(
                        _CONTROL_RE.findall(text[pos : opened.start()])
                    )
                stack.append(
                    _UiRegion(
                        line=line_no,
                        text=text,
                        count=0,
                        closer=None if tag.lower().startswith("role") else _tag_name(opened),
                        any_closer=tag.lower().startswith("role"),
                    )
                )
                pos = opened.end()
                continue

            if stack:
                if closed is None:
                    stack[-1].count += len(_CONTROL_RE.findall(text[pos:]))
                else:
                    popped = _pop_region(stack, closed.group(1))
                    if popped is None:
                        # Someone else's closer: the region is still open, so
                        # the whole line counts.
                        stack[-1].count += len(_CONTROL_RE.findall(text[pos:]))
                    else:
                        popped.count += len(
                            _CONTROL_RE.findall(text[pos : closed.start()])
                        )
                        emit(popped)
                        if stack:
                            stack[-1].count += len(
                                _CONTROL_RE.findall(text[closed.end() :])
                            )
            pos = len(text) if closed is None else closed.end()

    while stack:
        emit(stack.pop())


def _tag_name(m: re.Match[str]) -> str:
    m2 = re.match(r"<\s*([\w.]+)", m.group(0))
    return m2.group(1) if m2 else ""


def _pop_region(stack: list[_UiRegion], closer: str) -> _UiRegion | None:
    """Pop the innermost region the closing tag belongs to, else None."""
    for depth in range(len(stack) - 1, -1, -1):
        region = stack[depth]
        if region.closer and region.closer.lower() == closer.lower():
            return stack.pop(depth)
        if depth == len(stack) - 1 and region.any_closer:
            return stack.pop()
    return None


def _scan_ui_native_confirm(f: DiffFile, result: G0Result) -> None:
    """R3: `window.confirm(` or a bare `alert(` call in added JS/TS lines.

    `window.alert(` and any project-local `confirm` helper are deliberate
    misses: the rule covers exactly the two spellings the skill lists, and
    anything else needs the served DOM to judge.
    """
    for line_no, text in f.added:
        stripped = text.strip()
        if stripped.startswith(("//", "/*", "*", "<!--")):
            continue
        if not _NATIVE_DIALOG_RE.search(_strip_comment(text)):
            continue
        _maybe_allow(
            result,
            f,
            line_no,
            text,
            "ui-native-confirm",
            lambda: result.warnings.append(
                Violation(
                    "ui-native-confirm",
                    f.path,
                    line_no,
                    f"native confirm/alert dialog: {stripped[:120]} "
                    f"(R3: window.confirm cannot be themed or name the object; "
                    f"advisory V0)",
                )
            ),
        )


def _button_children(f: DiffFile, start: int) -> tuple[list[str], list[str], int] | None:
    """Delimit the <button> element whose opening tag starts at `start`.

    Returns (opening lines, non-empty child lines, index of the closing-tag
    line) or None when the element cannot be delimited in the added lines — an
    undetermined button is silent, never reported as labelled or unlabelled.
    """
    i = start
    opening: list[str] = []
    tag_end = -1
    while i < len(f.added):
        opening.append(f.added[i][1])
        tag_end = _jsx_tag_end(f.added[i][1], 0)
        if tag_end != -1:
            break
        i += 1
    else:
        return None
    if i >= len(f.added):
        return None

    # Single-line element: `<button ...><Icon /></button>` — the children sit
    # in the remainder of the opening-tag line.
    tail = opening[-1][tag_end + 1 :]
    close = _BUTTON_CLOSE_RE.search(tail)
    if close is not None:
        inner = tail[: close.start()].strip()
        return opening, ([inner] if inner else []), i

    children: list[str] = []
    for j in range(i + 1, len(f.added)):
        line = f.added[j][1]
        if _BUTTON_CLOSE_RE.search(line):
            return opening, children, j
        if line.strip():
            children.append(line)
    return None  # no closing tag inside the diff -> undetermined


def _pragma_reference(text: str, rule: str) -> str | None:
    """Reference from an allow-pragma for `rule` on `text`, else None.

    None means "no pragma for this rule here"; "" means a pragma for this rule
    with no reference (its own `pragma-no-reference` violation). Existing
    behaviour otherwise: the one addition is that a JSX/JS comment closer —
    `*/}` — is comment punctuation, not a reference, so `{/* g0:allow:rule */}`
    stays reference-less and cannot smuggle an allow past that rule.
    """
    pm = PRAGMA_RE.search(text)
    if pm is None or pm.group(1) != rule:
        return None
    reference = pm.group(2).strip()
    if reference in ("*/", "*/}", "*/)", "*/};", "*/,"):
        return ""
    return reference


def _child_is_icon(line: str) -> bool:
    s = line.strip()
    if s.startswith("{") or s.endswith("}"):
        return False
    return bool(_ICON_CHILD_RE.match(s))


def _child_has_text(line: str) -> bool:
    s = _TAGS_ONLY_RE.sub(" ", line)
    return bool(s.strip())


def _scan_ui_icon_buttons(f: DiffFile, result: G0Result) -> None:
    """An added <button> whose only children are icon components, with no
    `aria-label`, `aria-labelledby`, and no text (including `sr-only` text).

    Conservative by construction: any child that is neither a recognisable
    icon nor recognisable text, a multi-line opening tag, an arrow function in
    an attribute, or a button whose body is not fully inside the diff all yield
    silence. A false positive here is worse than a miss.
    """
    if not _is_jsx_file(f.path):
        return
    i = 0
    while i < len(f.added):
        line = f.added[i][1]
        if not _BUTTON_OPEN_RE.search(line):
            i += 1
            continue
        found = _button_children(f, i)
        if found is None:
            i += 1
            continue
        opening, children, last = found
        line_no = f.added[i][0]
        # Label attributes may sit on any line of the (possibly multi-line)
        # opening tag; the closing tag carries none.
        head = " ".join(part.strip() for part in opening)
        if not _LABEL_ATTR_RE.search(head):
            kinds = [_child_is_icon(c) for c in children]
            if children and all(kinds) and not any(
                _child_has_text(c) for c in children
            ):
                _maybe_allow(
                    result,
                    f,
                    line_no,
                    line,
                    "ui-icon-button-no-label",
                    lambda: result.warnings.append(
                        Violation(
                            "ui-icon-button-no-label",
                            f.path,
                            line_no,
                            "icon-only <button> with no aria-label, "
                            "aria-labelledby, or text content (advisory V0)",
                        )
                    ),
                )
        i = last + 1


def _enclosing_ternary(f: DiffFile, i: int) -> bool:
    """True when the `.map(` at added[i] sits inside a `{x ? … : null}` guard.

    A guard around the render is the empty-state path. A ternary that opens and
    closes on one line elsewhere in the render is not — only the opener above
    and the empty branch below are counted, so an inline `{on ? go() : null}`
    expression cannot be mistaken for an empty state.
    """
    opener = next(
        (
            offset
            for offset, (_, t) in enumerate(f.added[max(0, i - _TERNARY_LOOKBACK) : i])
            if _TERNARY_OPENER_RE.search(t)
        ),
        None,
    )
    if opener is None:
        return False
    for _, after in f.added[i + 1 : i + 1 + _TERNARY_LOOKAHEAD]:
        if _TERNARY_CLOSER_RE.search(after):
            return True
    return False


def _render_cannot_be_empty(f: DiffFile, i: int, line: str) -> bool:
    """True when the receiver of the `.map(` on this line cannot be empty.

    `Array.from({ length: 4 }).map(…)` renders a fixed number of placeholders, a
    module-level CONSTANT array is not a collection a person searches, and a
    render already wrapped in `{x ? … : null}` has its empty path. R6 is about
    a blank area where a *person's* collection should be, so none of these is
    the dead end it describes, and warning on them is a false positive.
    """
    if _SYNTHETIC_RECEIVER_RE.search(line):
        return True
    receiver = _LIST_RECEIVER_RE.search(line)
    if receiver is not None and _CONST_RECEIVER_RE.match(receiver.group(1).split(".")[-1]):
        return True
    if receiver is not None and _fixed_binding(f, receiver.group(1).split(".")[-1]):
        return True
    return _enclosing_ternary(f, i)


def _fixed_binding(f: DiffFile, name: str) -> bool:
    """True when `name` is bound in this file to an array that cannot be empty."""
    for _, text in f.added:
        for pattern in (_FIXED_ARRAY_ASSIGN_RE, _NON_EMPTY_LITERAL_RE):
            m = pattern.search(text)
            if m is not None and m.group(1) == name:
                return True
    return False


def _list_render_line(f: DiffFile) -> tuple[int, str] | None:
    """The first added line that renders a collection, or None.

    A collection render is a `.map(` whose rendered JSX reaches the same line or
    a later one inside the element's braces — the common `items.map((x) => (` … `))}`
    shape puts `<li>` on the following line. A `*List`-named component counts
    only when it actually maps something: an animation wrapper that renders
    `{children}` (`StaggerList`) is named like a list but renders no collection,
    so it has no empty state to provide and stays silent.

    Return (line number, line text) for the first such line.
    """
    lines = f.added
    for i, (line_no, text) in enumerate(lines):
        s = text.strip()
        if s.startswith(("//", "/*", "*", "<!--")):
            continue
        mapped = _LIST_MAP_RE.search(text)
        if mapped is None:
            continue
        if _JSX_TAG_RE.search(text):
            if _render_cannot_be_empty(f, i, text):
                continue
            return line_no, text
        # JSX on the lines that follow: keep walking, but only while the map's
        # expression stays open (a `)` or `;` on the `.map(` line ends it).
        rest = text[mapped.end() :]
        for _, after in lines[i + 1 :]:
            if _JSX_TAG_RE.search(after):
                if _render_cannot_be_empty(f, i, text):
                    break
                return line_no, text
            if re.search(r"[);]\s*$", rest) and not _JSX_TAG_RE.search(after):
                break
            rest = after
    return None


def _scan_ui_list_empty_state(f: DiffFile, result: G0Result) -> None:
    """R6: a changed file renders a list and has no empty-state handling.

    A list render is a `.map(` that emits JSX, on the same added line or inside
    the lines its expression spans. Empty-state handling is a length/size guard,
    an `Empty*`/`No*` component, or the `{x ? … : null}` idiom, in the same
    file's added lines. Absence of the guard in a diff is not proof of absence
    in the file, which is why this is advisory and deliberately quiet.
    """
    if not _is_jsx_file(f.path):
        return
    found = _list_render_line(f)
    if found is None:
        return
    list_line, list_text = found
    # Comment text is not handling: `// g0:allow:ui-list-no-empty-state` would
    # otherwise satisfy this rule with the word "empty" in the pragma itself.
    if any(_EMPTY_GUARD_RE.search(_strip_comment(t)) for _, t in f.added):
        return
    _maybe_allow(
        result,
        f,
        list_line,
        list_text,
        "ui-list-no-empty-state",
        lambda: result.warnings.append(
            Violation(
                "ui-list-no-empty-state",
                f.path,
                list_line,
                "list render with no empty-state path in the added lines "
                "(R6; advisory V0 — check the whole file before acting)",
            )
        ),
    )


def _scan_ui_rules(f: DiffFile, result: G0Result) -> None:
    """V0 static UI heuristics for one changed JS/TS file (warnings only)."""
    if f.deleted or not _is_js_family(f.path):
        return
    _scan_ui_field_count(f, result)
    _scan_ui_native_confirm(f, result)
    _scan_ui_icon_buttons(f, result)
    _scan_ui_list_empty_state(f, result)


def _empty_python_body(added: list[tuple[int, str]], idx: int) -> bool:
    """def at added[idx]; True when the first body line is pass/... (regex fallback)."""
    def_indent = len(added[idx][1]) - len(added[idx][1].lstrip())
    for _, text in added[idx + 1 : idx + 4]:
        if not text.strip() or text.strip().startswith("#"):
            continue
        if len(text) - len(text.lstrip()) <= def_indent:
            break
        return text.strip() in ("pass", "...", "raise NotImplementedError")  # g0:allow:not-implemented hpipe-vendor: token literal, not a stub
    return False


def _maybe_allow(
    result: G0Result,
    f: DiffFile,
    line_no: int,
    text: str,
    rule: str,
    emit,
) -> None:
    """Emit a violation unless an allow-pragma with a reference covers the line."""
    reference = _pragma_reference(text, rule)
    if reference is not None:
        if reference:
            result.notes.append(
                f"g0: allowed {rule} at {f.path}:{line_no} (reference: {reference})"
            )
            return
        result.violations.append(
            Violation("pragma-no-reference", f.path, line_no, text.strip())
        )
        return
    emit()


def g0_scan(diff_text: str, stacks: list[str] | None = None) -> G0Result:
    """Full G0 scan over a unified diff -> G0Result(violations, warnings, notes)."""
    stacks = stacks or []
    files = parse_diff(diff_text)
    mode, single_lang = classify_mode(files, stacks)
    result = G0Result()

    for f in files:
        if mode == "SINGLE":
            # stacks is a floor (§5.4): a listed language keeps its rules on
            # its own files even when the census put the diff in SINGLE mode.
            eff_lang = f.language if f.language in stacks else single_lang
        else:
            eff_lang = f.language
        if eff_lang is None:
            continue

        in_protocol = False
        prev_line = ""
        for i, (line_no, text) in enumerate(f.added):
            stripped = text.strip()

            # python: class X(Protocol) opens an empty-body exemption scope
            if eff_lang == "python":
                if re.match(r"class\s+\w+[^:]*Protocol", text):
                    in_protocol = True
                elif re.match(r"class\s+\w+", text):
                    in_protocol = False

            # TODO tokens (all languages, comments or strings alike)  # g0:allow:TODO hpipe-vendor: comment names the rule, not a TODO
            m = TODO_RE.search(text)
            if m:
                _maybe_allow(
                    result,
                    f,
                    line_no,
                    text,
                    m.group(1),
                    lambda: result.violations.append(
                        Violation("todo-token", f.path, line_no, stripped)
                    ),
                )

            # not-implemented tokens per language
            ni = NOT_IMPLEMENTED.get(eff_lang)
            if ni and ni.search(text):
                _maybe_allow(
                    result,
                    f,
                    line_no,
                    text,
                    "not-implemented",
                    lambda: result.violations.append(
                        Violation("not-implemented", f.path, line_no, stripped)
                    ),
                )

            # empty-body (python): def with only pass/...
            if eff_lang == "python" and re.match(r"def\s+\w+", text):
                if _empty_python_body(f.added, i) and not in_protocol:
                    exempt = prev_line.strip().startswith("@") and (
                        "abstractmethod" in prev_line
                    )
                    if not exempt:
                        _maybe_allow(
                            result,
                            f,
                            line_no,
                            text,
                            "empty-body",
                            lambda: result.violations.append(
                                Violation("empty-body", f.path, line_no, stripped)
                            ),
                        )
            # empty-body (node/ts): empty arrow-function body
            if eff_lang == "node" and re.search(r"=>\s*\{\s*\}", text):
                if not f.path.endswith(".d.ts") and "abstract" not in text:
                    _maybe_allow(
                        result,
                        f,
                        line_no,
                        text,
                        "empty-body",
                        lambda: result.violations.append(
                            Violation("empty-body", f.path, line_no, stripped)
                        ),
                    )

            prev_line = text

        _scan_test_deletion(f, result, eff_lang)
        _scan_comment_out(f, result, eff_lang)
        _scan_ui_rules(f, result)
    summarize_test_deletion(files, result)
    return result


def _normalize_code_line(text: str, comment_prefix: str) -> str:
    """Strip whitespace + comment prefix; None-ish marker for empty results."""
    s = text.strip()
    if s.startswith(comment_prefix):
        s = s[len(comment_prefix) :].strip()
    return s


def _scan_comment_out(f: DiffFile, result: G0Result, eff_lang: str | None) -> None:
    prefix = "#" if (eff_lang or "python") == "python" else "//"
    removed_code: list[str] = []
    for _, text in f.removed:
        s = text.strip()
        if not s or s.startswith(prefix):
            continue  # removed line was itself a comment -> never pairs
        removed_code.append(_normalize_code_line(s, prefix))

    added_commented: list[str] = []
    for _, text in f.added:
        s = text.strip()
        if s.startswith(prefix):
            added_commented.append(_normalize_code_line(s, prefix))

    if not removed_code or not added_commented:
        return

    pairs = 0
    for removed in removed_code:
        for commented in added_commented:
            if difflib.SequenceMatcher(None, removed, commented).ratio() >= 0.9:
                pairs += 1
                break

    if not pairs:
        return

    pct = pairs / len(removed_code) if removed_code else 0
    if pairs >= 2 or pct > 0.30:
        result.violations.append(
            Violation(
                "comment-out",
                f.path,
                f.added[0][0],
                f"{pairs} removed code line(s) reappear commented "
                f"({pct:.0%} of removed code lines)",
            )
        )
    else:
        result.warnings.append(
            Violation(
                "comment-out",
                f.path,
                f.added[0][0],
                f"1 removed code line reappears commented (WARNING; "
                f">= 2 pairs or > 30% is a violation)",
            )
        )


TEST_PATH_PATTERNS = {
    "python": ("tests/", "test_", "_test.py"),
    "node": (".test.", ".spec.", "__tests__"),
    "dotnet": ("Tests.cs",),
    "go": ("_test.go",),
    "rust": ("tests/",),
}

SKIP_MARKERS = {
    "python": re.compile(r"@pytest\.mark\.skip\b"),
    "node": re.compile(r"\b(?:it|test|describe)\.skip\("),
    "dotnet": re.compile(r"\[(?:Fact|Theory)\(Skip"),
    "java": re.compile(r"@Disabled\b"),
    "java-kotlin": re.compile(r"@Disabled\b"),
}


def is_test_path(path: str) -> bool:
    parts = path.replace("\\", "/")
    for markers in TEST_PATH_PATTERNS.values():
        for m in markers:
            if m in ("tests/", "__tests__"):
                if f"/{m}" in f"/{parts}" or parts.startswith(m):
                    return True
            elif parts.startswith(m) or m in parts:
                return True
    return False


def _scan_test_deletion(f: DiffFile, result: G0Result, eff_lang: str | None) -> None:
    added_n = len(f.added)
    removed_n = len(f.removed)

    # (b) added skip markers without an allow pragma — checked per line above
    marker = SKIP_MARKERS.get(eff_lang or "") if eff_lang else None
    for line_no, text in f.added:
        if marker and marker.search(text):
            reference = _pragma_reference(text, "skip-marker")
            if reference:
                result.notes.append(
                    f"g0: allowed skip-marker at {f.path}:{line_no} "
                    f"(reference: {reference})"
                )
            else:
                result.violations.append(
                    Violation("skip-marker", f.path, line_no, text.strip())
                )

    # (a) every changed file is a test file AND net removed > net added
    if not is_test_path(f.path):
        return
    result._test_files += 1
    result._test_net_removed += removed_n - added_n
    result._test_paths.append(f.path)


def summarize_test_deletion(files: list[DiffFile], result: G0Result) -> None:
    """Rule (a) needs the whole diff: call once after all files are scanned."""
    if not result._test_paths:
        return
    test_only = all(is_test_path(f.path) for f in files)
    if test_only and result._test_net_removed > 0:
        result.violations.append(
            Violation(
                "test-deletion",
                result._test_paths[0],
                1,
                f"only test files changed, net {result._test_net_removed} lines removed",
            )
        )
    elif result._test_net_removed > 0:
        result.warnings.append(
            Violation(
                "test-deletion",
                result._test_paths[0],
                1,
                f"test lines removed alongside source changes (net {result._test_net_removed})",
            )
        )
