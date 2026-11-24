from app.analyzer import analyze_function, extract_functions


def test_extract_single_function():
    code = """
    #include <string.h>
    void copy_name(char *dst, const char *src) {
        strcpy(dst, src);
    }
    """
    functions = extract_functions(code)
    assert len(functions) == 1
    assert functions[0].name == "copy_name"


def test_detects_unbounded_copy_and_builds_graph():
    code = """void copy_name(char *dst, const char *src) {
    if (src != 0) {
        strcpy(dst, src);
    }
}"""
    result = analyze_function(code, "copy_name", 1)
    assert result["risk_index"] > 0
    assert any(f["rule_id"] == "CXX002" for f in result["findings"])
    assert any(n["kind"] == "finding" for n in result["graph"]["nodes"])


def test_no_findings_is_not_claimed_safe():
    code = "int add(int a, int b) { return a + b; }"
    result = analyze_function(code, "add", 1)
    assert result["risk_index"] == 0
    assert result["risk_index_label"] == "No rule triggered"
    assert "not a probability" in result["risk_index_note"]


def test_multiple_functions_are_detected():
    code = "int first() { return 1; }\nint second() { return 2; }"
    functions = extract_functions(code)
    assert [fn.name for fn in functions] == ["first", "second"]


def test_deeply_nested_input_is_fast():
    """Regression: nested braces used to take ~25 s (quadratic scan)."""
    import time
    from app.analyzer import extract_functions
    source = "void f(){" + "if(a){" * 8000 + "}" * 8000 + "}"
    started = time.perf_counter()
    extract_functions(source[:120_000])
    assert time.perf_counter() - started < 3
