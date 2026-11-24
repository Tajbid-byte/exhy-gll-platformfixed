"""Transparent, rule-based C/C++ review engine.

This module intentionally does NOT claim to run the trained ExHyGLL model.
It uses a lightweight lexical scanner and explicit security rules so the app
remains usable without a model checkpoint or external API credentials.
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from functools import lru_cache
import re
from typing import Any

MAX_SOURCE_CHARS = 120_000


@dataclass
class FunctionSpan:
    id: str
    name: str
    start_line: int
    end_line: int
    start_offset: int
    end_offset: int
    signature: str
    preview: str


@dataclass
class BlockSpan:
    kind: str
    label: str
    start_line: int
    end_line: int
    start_offset: int
    end_offset: int


TOKEN_RE = re.compile(
    r"[A-Za-z_][A-Za-z_0-9]*|(?:0[xX][0-9A-Fa-f]+)|(?:\d+(?:\.\d+)?)|"
    r"::|->|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|/=|\.\.\.|[^\s]"
)

CONTROL_WORDS = {"if", "for", "while", "switch", "catch", "else", "do", "try"}
NON_FUNCTION_CALLS = CONTROL_WORDS | {
    "sizeof", "alignof", "decltype", "static_assert", "requires", "return",
    "new", "delete", "throw", "case", "default", "noexcept",
}


def mask_comments_and_literals(source: str) -> str:
    """Mask comments and quoted literals while preserving offsets/newlines."""
    out = list(source)
    i = 0
    n = len(source)
    state = "code"
    quote = ""
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "line_comment"
                continue
            if ch == "/" and nxt == "*":
                out[i] = out[i + 1] = " "
                i += 2
                state = "block_comment"
                continue
            if ch in ("'", '"'):
                quote = ch
                out[i] = " "
                state = "string"
                i += 1
                continue
        elif state == "line_comment":
            if ch == "\n":
                state = "code"
            else:
                out[i] = " "
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "code"
                continue
            if ch != "\n":
                out[i] = " "
        elif state == "string":
            if ch == "\\":
                if ch != "\n":
                    out[i] = " "
                if i + 1 < n:
                    if source[i + 1] != "\n":
                        out[i + 1] = " "
                    i += 2
                    continue
            elif ch == quote:
                out[i] = " "
                state = "code"
            elif ch != "\n":
                out[i] = " "
        i += 1
    return "".join(out)



def mask_comments_keep_literals(source: str) -> str:
    """Mask comments but retain quoted strings for format/secret checks."""
    out = list(source)
    i = 0
    n = len(source)
    state = "code"
    quote = ""
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "line_comment"
                continue
            if ch == "/" and nxt == "*":
                out[i] = out[i + 1] = " "
                i += 2
                state = "block_comment"
                continue
            if ch in ("'", '"'):
                quote = ch
                state = "string"
        elif state == "line_comment":
            if ch == "\n":
                state = "code"
            else:
                out[i] = " "
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                state = "code"
                continue
            if ch != "\n":
                out[i] = " "
        elif state == "string":
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                state = "code"
        i += 1
    return "".join(out)

@lru_cache(maxsize=8)
def _newline_offsets(source: str) -> tuple[int, ...]:
    return tuple(i for i, ch in enumerate(source) if ch == "\n")


def _line_at(source: str, offset: int) -> int:
    """1-based line number for an offset (O(log n) after a cached index)."""
    return bisect_left(_newline_offsets(source), max(0, offset)) + 1


def _matching_pairs(tokens: list[re.Match[str]]) -> tuple[dict[int, int], dict[int, int]]:
    stack: list[int] = []
    pairs: dict[int, int] = {}
    reverse: dict[int, int] = {}
    for idx, token in enumerate(tokens):
        value = token.group(0)
        if value == "(":
            stack.append(idx)
        elif value == ")" and stack:
            opening = stack.pop()
            pairs[opening] = idx
            reverse[idx] = opening
    return pairs, reverse


def _brace_pairs(masked: str) -> list[tuple[int, int]]:
    stack: list[int] = []
    pairs: list[tuple[int, int]] = []
    for i, ch in enumerate(masked):
        if ch == "{":
            stack.append(i)
        elif ch == "}" and stack:
            start = stack.pop()
            pairs.append((start, i))
    return sorted(pairs)


def _header_starts(masked: str) -> dict[int, int]:
    """Map each '{' offset to a conservative statement boundary before it (single pass)."""
    starts: dict[int, int] = {}
    boundary = 0
    for i, ch in enumerate(masked):
        if ch == "{":
            starts[i] = boundary
            boundary = i + 1
        elif ch == ";" or ch == "}":
            boundary = i + 1
    return starts


def _name_before_paren(token_values: list[str], open_idx: int) -> tuple[str, int] | None:
    if open_idx == 0:
        return None
    candidate = token_values[open_idx - 1]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*|operator", candidate):
        return None
    if candidate in NON_FUNCTION_CALLS:
        return None
    # Build a qualified name such as Namespace::Class::method.
    name_parts = [candidate]
    cursor = open_idx - 2
    while cursor >= 1 and token_values[cursor] == "::" and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", token_values[cursor - 1]):
        name_parts.insert(0, token_values[cursor - 1])
        cursor -= 2
    return "::".join(name_parts), cursor + 1


def scan_blocks(source: str) -> list[BlockSpan]:
    masked = mask_comments_and_literals(source)
    token_matches = list(TOKEN_RE.finditer(masked))
    values = [m.group(0) for m in token_matches]
    token_starts = [m.start() for m in token_matches]
    header_starts = _header_starts(masked)
    blocks: list[BlockSpan] = []
    for open_brace, close_brace in _brace_pairs(masked):
        header_start = header_starts[open_brace]
        lo = bisect_left(token_starts, header_start)
        hi = bisect_left(token_starts, open_brace)
        local_tokens = token_matches[lo:hi]
        if not local_tokens:
            continue
        local_values = [m.group(0) for m in local_tokens]
        first = local_values[0]
        if first not in {"if", "for", "while", "switch", "catch", "else", "do"}:
            continue
        # The first keyword identifies the enclosing control construct. Keep
        # the original text for display but collapse whitespace.
        kind = first
        label = re.sub(r"\s+", " ", source[header_start:open_brace]).strip()
        if len(label) > 92:
            label = label[:89] + "…"
        blocks.append(BlockSpan(
            kind=kind,
            label=label or kind,
            start_line=_line_at(source, header_start),
            end_line=_line_at(source, close_brace),
            start_offset=open_brace,
            end_offset=close_brace,
        ))
    return blocks


def extract_functions(source: str) -> list[FunctionSpan]:
    """Best-effort function-definition extraction for C/C++ source.

    This is a lightweight lexical scanner, not a standards-complete parser.
    It intentionally avoids claiming a Joern CDG or AST was constructed.
    """
    masked = mask_comments_and_literals(source)
    token_matches = list(TOKEN_RE.finditer(masked))
    values = [m.group(0) for m in token_matches]
    paren_pairs, _ = _matching_pairs(token_matches)
    token_starts = [m.start() for m in token_matches]
    header_starts = _header_starts(masked)
    functions: list[FunctionSpan] = []

    for open_brace, close_brace in _brace_pairs(masked):
        header_start = header_starts[open_brace]
        lo = bisect_left(token_starts, header_start)
        hi = bisect_left(token_starts, open_brace)
        header_tokens = list(enumerate(token_matches[lo:hi], start=lo))
        if not header_tokens:
            continue
        local_values = [m.group(0) for _, m in header_tokens]
        if local_values[0] in {"if", "for", "while", "switch", "catch", "else", "do", "try"}:
            continue
        # Select the first function-like declarator in this header. This handles
        # ordinary functions and constructors with member initialisers.
        candidates: list[tuple[str, int, int]] = []
        for local_idx, (global_idx, match) in enumerate(header_tokens):
            if match.group(0) != "(":
                continue
            close_idx = paren_pairs.get(global_idx)
            if close_idx is None or close_idx >= len(token_matches):
                continue
            name = _name_before_paren(values, global_idx)
            if not name:
                continue
            function_name, name_start_idx = name
            # Avoid treating a call in a default argument as the function name.
            if local_idx > 0 and local_values[local_idx - 1] in {"=", ".", "->", "return"}:
                continue
            # Require a plausible return/declaration prefix before the name.
            prefix = local_values[:max(0, local_idx - 1)]
            if any(v in {"=", "return"} for v in prefix[-3:]):
                continue
            candidates.append((function_name, global_idx, close_idx))
        if not candidates:
            continue
        function_name, open_paren_idx, close_paren_idx = candidates[0]
        # Exclude control-flow blocks whose first token was not the control word
        # (for example, an attribute or macro before an if statement).
        header_text = masked[header_start:open_brace].lstrip()
        if re.match(r"(?:if|for|while|switch|catch)\s*\(", header_text):
            continue
        # Do not classify an initializer/lambda as a named function.
        name_token = values[open_paren_idx - 1] if open_paren_idx else ""
        if name_token in CONTROL_WORDS:
            continue

        start_offset = header_start
        # Drop leading whitespace and preprocessor-only lines from the signature.
        while start_offset < open_brace:
            line_end = source.find("\n", start_offset, open_brace)
            if line_end < 0:
                line_end = open_brace
            current_line = source[start_offset:line_end]
            if current_line.strip().startswith("#"):
                start_offset = min(open_brace, line_end + 1)
                continue
            if not current_line.strip():
                start_offset = min(open_brace, line_end + 1)
                continue
            break
        signature = re.sub(r"\s+", " ", source[start_offset:open_brace]).strip()
        if not signature or len(signature) > 500:
            signature = signature[-500:]
        body = source[open_brace:close_brace + 1]
        start_line = _line_at(source, start_offset)
        end_line = _line_at(source, close_brace)
        function_id = f"{function_name}:{start_line}:{end_line}"
        functions.append(FunctionSpan(
            id=function_id,
            name=function_name,
            start_line=start_line,
            end_line=end_line,
            start_offset=start_offset,
            end_offset=close_brace + 1,
            signature=signature,
            preview=re.sub(r"\s+", " ", body[:150]).strip(),
        ))

    # Nested braces within a function are not separately extracted unless they
    # independently resemble a function declarator. Deduplicate by source span.
    unique: dict[tuple[int, int], FunctionSpan] = {}
    for fn in functions:
        unique[(fn.start_offset, fn.end_offset)] = fn
    return sorted(unique.values(), key=lambda fn: fn.start_offset)


RULES = [
    {"id": "CXX001", "title": "Unbounded input with gets()", "severity": "critical", "weight": 40,
     "category": "Buffer handling", "pattern": re.compile(r"\bgets\s*\("),
     "description": "gets() reads input without receiving the destination buffer capacity.",
     "impact": "Input longer than the destination array can overwrite adjacent memory.",
     "recommendation": "Replace gets() with a bounded input routine such as fgets(), then validate the returned data and buffer size."},
    {"id": "CXX002", "title": "Unbounded string copy with strcpy()", "severity": "high", "weight": 25,
     "category": "Buffer handling", "pattern": re.compile(r"\bstrcpy\s*\("),
     "description": "strcpy() does not receive the destination capacity.",
     "impact": "A source string that is larger than the destination can cause an out-of-bounds write.",
     "recommendation": "Prove the destination capacity before copying. Prefer an API that takes the destination size and check truncation/termination explicitly."},
    {"id": "CXX003", "title": "Unbounded string concatenation with strcat()", "severity": "high", "weight": 25,
     "category": "Buffer handling", "pattern": re.compile(r"\bstrcat\s*\("),
     "description": "strcat() appends without knowing the remaining destination capacity.",
     "impact": "The combined string can exceed the destination buffer.",
     "recommendation": "Calculate and validate remaining capacity before appending. Consider a bounded append routine with explicit termination checks."},
    {"id": "CXX004", "title": "Unbounded formatting with sprintf()", "severity": "high", "weight": 25,
     "category": "Format and input", "pattern": re.compile(r"\b(?:sprintf|vsprintf)\s*\("),
     "description": "sprintf()/vsprintf() write formatted output without a destination-size argument.",
     "impact": "Formatted output can exceed the destination buffer.",
     "recommendation": "Use snprintf()/vsnprintf() with the actual destination capacity and check the return value for truncation."},
    {"id": "CXX005", "title": "Unbounded %s input conversion", "severity": "high", "weight": 25,
     "category": "Format and input", "pattern": re.compile(r"\b(?:scanf|fscanf|sscanf)\s*\([^;\n]*?%(?:[-+ #0]*)s", re.IGNORECASE),
     "description": "A %s conversion appears without a visible field width in the format string.",
     "impact": "Input can exceed the receiving character array when no width limit is supplied.",
     "recommendation": "Add a width limit smaller than the destination capacity and validate the conversion count."},
    {"id": "CXX006", "title": "Possible format-string misuse", "severity": "high", "weight": 25,
     "category": "Format and input", "pattern": re.compile(r"\bprintf\s*\(\s*[A-Za-z_][A-Za-z_0-9]*\s*[,)]"),
     "description": "printf() appears to receive a variable as its format string rather than a visible string literal.",
     "impact": "If the value is attacker-controlled, format directives can cause memory disclosure or writes.",
     "recommendation": "Use a fixed format string such as printf(\"%s\", value) and validate untrusted input."},
    {"id": "CXX007", "title": "Command execution sink", "severity": "high", "weight": 25,
     "category": "Command execution", "pattern": re.compile(r"\b(?:system|popen)\s*\("),
     "description": "The function invokes a shell command or process through system()/popen().",
     "impact": "If command text includes untrusted input, shell metacharacters may alter the executed command.",
     "recommendation": "Avoid shell command construction. Use a process API with separate arguments and strict allow-list validation."},
    {"id": "CXX008", "title": "Direct assignment from realloc()", "severity": "medium", "weight": 12,
     "category": "Memory management", "pattern": re.compile(r"\b([A-Za-z_]\w*)\s*=\s*realloc\s*\(\s*\1\s*,", re.IGNORECASE),
     "description": "The original pointer appears to be overwritten directly by realloc().",
     "impact": "If realloc() fails, the original allocation address can be lost and become difficult to free.",
     "recommendation": "Store realloc() in a temporary pointer, check for failure, then update the original pointer."},
    {"id": "CXX009", "title": "Allocation result has no nearby null check", "severity": "medium", "weight": 12,
     "category": "Memory management", "pattern": re.compile(r"\b([A-Za-z_]\w*)\s*=\s*(?:\([^;]+?\)\s*)?(?:malloc|calloc)\s*\("),
     "description": "A heap allocation is assigned to a pointer but no nearby null check was found.",
     "impact": "Dereferencing a failed allocation can cause a crash or denial of service.",
     "recommendation": "Check the allocation result before dereferencing it and handle the failure path."},
    {"id": "CXX010", "title": "Potentially unsafe bounded copy", "severity": "medium", "weight": 12,
     "category": "Buffer handling", "pattern": re.compile(r"\bstrncpy\s*\("),
     "description": "strncpy() is bounded but may leave the destination without a null terminator when the source is long enough.",
     "impact": "Later string operations may read beyond the destination if termination is not guaranteed.",
     "recommendation": "Make the destination termination rule explicit and verify the destination capacity and copied length."},
    {"id": "CXX011", "title": "Memory copy requires bounds review", "severity": "medium", "weight": 12,
     "category": "Buffer handling", "pattern": re.compile(r"\b(?:memcpy|memmove)\s*\("),
     "description": "A raw memory copy is present. The call is not inherently unsafe, but the byte count and both object bounds need to agree.",
     "impact": "An incorrect length or overlapping/invalid region can cause out-of-bounds access or undefined behaviour.",
     "recommendation": "Verify source and destination object sizes, validate the byte count, and use memmove() when overlap is possible."},
    {"id": "CXX012", "title": "Allocation size uses multiplication", "severity": "medium", "weight": 12,
     "category": "Integer and allocation bounds", "pattern": re.compile(r"\b(?:malloc|calloc)\s*\([^;\n]*\*[^;\n]*\)"),
     "description": "An allocation expression includes multiplication; integer overflow should be ruled out before allocation.",
     "impact": "A wrapped size can allocate less memory than the subsequent operation expects.",
     "recommendation": "Check multiplication before allocation, for example by verifying count <= SIZE_MAX / element_size."},
    {"id": "CXX013", "title": "Potential use after free", "severity": "high", "weight": 25,
     "category": "Memory management", "pattern": re.compile(r"\bfree\s*\(\s*([A-Za-z_]\w*)\s*\)"),
     "description": "A pointer is freed and appears to be referenced later in the same function.",
     "impact": "Using a freed object can cause use-after-free behaviour, memory corruption or crashes.",
     "recommendation": "Review all later uses and ownership paths. Set the pointer to NULL after release where appropriate and avoid alias use."},
    {"id": "CXX014", "title": "Possible hard-coded secret", "severity": "high", "weight": 25,
     "category": "Secrets handling", "pattern": re.compile(r"\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\b\s*[:=]\s*[\"'][^\"']{4,}[\"']", re.IGNORECASE),
     "description": "A credential-like variable appears to be assigned a string literal.",
     "impact": "Credentials committed to source can be copied, leaked or reused outside the intended environment.",
     "recommendation": "Move secrets to a secret manager or protected environment variable, rotate exposed credentials and avoid committing them."},
    {"id": "CXX015", "title": "Dynamic array index has no visible guard", "severity": "medium", "weight": 12,
     "category": "Bounds checking", "pattern": re.compile(r"\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]"),
     "description": "An array access uses a variable index. The scanner did not find an obvious nearby bounds guard.",
     "impact": "An index outside the valid range can read or write memory beyond the array.",
     "recommendation": "Validate the index against the actual array length on every path before this access."},
    {"id": "CXX016", "title": "Multiple free() calls for the same pointer", "severity": "high", "weight": 25,
     "category": "Memory management", "pattern": re.compile(r"\bfree\s*\(\s*([A-Za-z_]\w*)\s*\)"),
     "description": "The same pointer name appears in more than one free() call in this function.",
     "impact": "If both calls can execute on the same allocation, the program may double-free memory.",
     "recommendation": "Trace the control paths and ownership state. Ensure each allocation is released at most once."},
]


def _nearby_null_check(lines: list[str], variable: str, line_index: int) -> bool:
    window = "\n".join(lines[line_index:min(len(lines), line_index + 9)])
    patterns = [
        rf"if\s*\(\s*!\s*{re.escape(variable)}\s*\)",
        rf"if\s*\(\s*{re.escape(variable)}\s*==\s*NULL\s*\)",
        rf"if\s*\(\s*NULL\s*==\s*{re.escape(variable)}\s*\)",
        rf"if\s*\(\s*{re.escape(variable)}\s*\)\s*\{{",
    ]
    return any(re.search(p, window) for p in patterns)


def _visible_index_guard(lines: list[str], variable: str, line_index: int) -> bool:
    # A deliberately conservative nearby textual check; it is not path analysis.
    window = "\n".join(lines[max(0, line_index - 8):line_index + 1])
    var = re.escape(variable)
    return bool(re.search(rf"(?:if|while)\s*\([^)]*\b{var}\b[^)]*(?:<|<=|>=|>)", window))


def _control_for_line(blocks: list[BlockSpan], line: int) -> BlockSpan | None:
    matches = [b for b in blocks if b.start_line <= line <= b.end_line]
    return min(matches, key=lambda b: b.end_line - b.start_line) if matches else None


def analyze_function(function_code: str, function_name: str, start_line: int = 1) -> dict[str, Any]:
    if len(function_code) > MAX_SOURCE_CHARS:
        raise ValueError(f"Function exceeds the {MAX_SOURCE_CHARS:,}-character analysis limit.")
    lines = function_code.splitlines() or [""]
    rule_code = mask_comments_and_literals(function_code)
    literal_code = mask_comments_keep_literals(function_code)
    rule_lines = rule_code.splitlines() or [""]
    blocks = scan_blocks(function_code)
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()

    def add(rule_id: str, title: str, severity: str, weight: int, category: str,
            local_line: int, description: str, impact: str, recommendation: str,
            evidence: str, signal: str = "Direct pattern") -> None:
        key = (rule_id, local_line)
        if key in seen:
            return
        seen.add(key)
        absolute_line = start_line + local_line - 1
        control = _control_for_line(blocks, local_line)
        findings.append({
            "id": f"{rule_id}-{absolute_line}-{len(findings)+1}",
            "rule_id": rule_id,
            "title": title,
            "severity": severity,
            "weight": weight,
            "category": category,
            "line_start": absolute_line,
            "line_end": absolute_line,
            "description": description,
            "impact": impact,
            "recommendation": recommendation,
            "evidence": evidence.strip()[:240],
            "signal": signal,
            "control_context": ({
                "kind": control.kind,
                "label": control.label,
                "line": start_line + control.start_line - 1,
            } if control else None),
        })

    # Direct rule patterns.
    for rule in RULES:
        search_source = literal_code if rule["id"] in {"CXX005", "CXX014"} else rule_code
        for match in rule["pattern"].finditer(search_source):
            local_line = _line_at(function_code, match.start())
            if rule["id"] == "CXX009":
                variable = match.group(1)
                if _nearby_null_check(rule_lines, variable, local_line - 1):
                    continue
                signal = "Contextual heuristic"
            elif rule["id"] == "CXX013":
                variable = match.group(1)
                after = rule_code[match.end():]
                use_pattern = re.compile(rf"(?:\*\s*{re.escape(variable)}\b|\b{re.escape(variable)}\s*->|\b{re.escape(variable)}\s*\[)")
                if not use_pattern.search(after):
                    continue
                signal = "Contextual heuristic"
            elif rule["id"] == "CXX015":
                variable = match.group(2)
                if _visible_index_guard(rule_lines, variable, local_line - 1):
                    continue
                signal = "Contextual heuristic"
            elif rule["id"] == "CXX016":
                variable = match.group(1)
                occurrences = list(re.finditer(rf"\bfree\s*\(\s*{re.escape(variable)}\s*\)", rule_code))
                if len(occurrences) < 2:
                    continue
                # Only report the second and later calls; do not infer whether paths are exclusive.
                if match.start() == occurrences[0].start():
                    continue
                signal = "Contextual heuristic"
            else:
                signal = "Direct pattern"
            evidence_line = lines[local_line - 1] if 0 <= local_line - 1 < len(lines) else match.group(0)
            add(rule["id"], rule["title"], rule["severity"], rule["weight"], rule["category"],
                local_line, rule["description"], rule["impact"], rule["recommendation"], evidence_line, signal)

    # Narrowly inspect whether strncpy() is followed by explicit termination.
    for match in re.finditer(r"\bstrncpy\s*\([^;]+\)", literal_code, re.DOTALL):
        local_line = _line_at(function_code, match.start())
        next_lines = "\n".join(literal_code.splitlines()[local_line:min(len(lines), local_line + 3)])
        if re.search(r"\[[^\]]+\]\s*=\s*['\"]?\\0", next_lines):
            findings = [f for f in findings if not (f["rule_id"] == "CXX010" and f["line_start"] == start_line + local_line - 1)]
            seen.discard(("CXX010", local_line))

    findings.sort(key=lambda f: ({"critical": 0, "high": 1, "medium": 2, "low": 3}.get(f["severity"], 4), f["line_start"]))
    unique_weights: dict[str, int] = {}
    for finding in findings:
        unique_weights[finding["rule_id"]] = max(unique_weights.get(finding["rule_id"], 0), finding["weight"])
    risk_index = min(100, sum(unique_weights.values()))
    if risk_index == 0:
        risk_band = "No rule triggered"
    elif any(f["severity"] == "critical" for f in findings) or risk_index >= 70:
        risk_band = "High indicator"
    elif any(f["severity"] == "high" for f in findings) or risk_index >= 45:
        risk_band = "Elevated"
    elif risk_index >= 20:
        risk_band = "Guarded"
    else:
        risk_band = "Low indicator"

    # Lexical context graph: function -> control blocks -> rule findings.
    graph_nodes: list[dict[str, Any]] = [{
        "id": "function-root", "kind": "function", "label": function_name,
        "line": start_line, "detail": "Selected function boundary",
    }]
    graph_edges: list[dict[str, str]] = []
    control_ids: dict[tuple[str, int], str] = {}
    for finding in findings:
        context = finding.get("control_context")
        if context:
            key = (context["kind"], context["line"])
            control_id = control_ids.get(key)
            if not control_id:
                control_id = f"control-{len(control_ids)+1}"
                control_ids[key] = control_id
                graph_nodes.append({
                    "id": control_id, "kind": "control", "label": context["label"],
                    "line": context["line"], "detail": "Lexically enclosing control block; not a verified protective guard",
                })
                graph_edges.append({"from": "function-root", "to": control_id, "label": "contains"})
            finding_parent = control_id
            relation = "inside this block"
        else:
            finding_parent = "function-root"
            relation = "found in function"
        node_id = f"finding-{len([n for n in graph_nodes if n['kind'] == 'finding'])+1}"
        graph_nodes.append({
            "id": node_id, "kind": "finding", "label": finding["title"],
            "line": finding["line_start"], "detail": finding["rule_id"], "finding_id": finding["id"],
        })
        graph_edges.append({"from": finding_parent, "to": node_id, "label": relation})

    token_count = len(TOKEN_RE.findall(mask_comments_and_literals(function_code)))
    return {
        "status": "completed",
        "analysis_type": "static_rule_analysis",
        "engine": "ExHyGLL Review Engine · lexical rules + context scanner",
        "function": {"name": function_name, "start_line": start_line, "end_line": start_line + len(lines) - 1},
        "risk_index": risk_index,
        "risk_index_label": risk_band,
        "risk_index_note": "A transparent rule-weighted indicator; not a probability, CVSS score or ExHyGLL model output. Severity labels are application triage metadata.",
        "summary": {
            "finding_count": len(findings),
            "critical": sum(1 for f in findings if f["severity"] == "critical"),
            "high": sum(1 for f in findings if f["severity"] == "high"),
            "medium": sum(1 for f in findings if f["severity"] == "medium"),
            "low": sum(1 for f in findings if f["severity"] == "low"),
            "lines_analyzed": len(lines),
            "lexical_tokens": token_count,
        },
        "findings": findings,
        "graph": {"nodes": graph_nodes, "edges": graph_edges,
                  "note": "Relationships are lexical containment/context hints, not a Joern CDG or data-flow proof."},
        "coverage": {
            "rules_available": len(RULES),
            "rules_triggered": len({f["rule_id"] for f in findings}),
            "parser": "Lightweight lexical scanner",
            "scope": "Selected function only",
        },
        "limitations": [
            "This scan is heuristic and can produce false positives or miss vulnerabilities.",
            "It does not compile or execute the program and does not prove exploitability.",
            "It does not model interprocedural state, aliases, build flags, macros or cross-file data flow.",
            "The risk index is not a calibrated probability or a CVSS rating.",
        ],
        "model": {"available": False, "name": "ExHyGLL trained inference", "reason": "No trained checkpoint or research inference artifacts are included in this package."},
    }
