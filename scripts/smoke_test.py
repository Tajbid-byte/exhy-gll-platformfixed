#!/usr/bin/env python3
"""Smoke-test a deployed ExHyGLL Review API using only Python's stdlib."""
from __future__ import annotations
import json
import sys
from urllib.request import Request, urlopen


def call(base: str, path: str, payload: dict | None = None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(base.rstrip("/") + path, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/smoke_test.py https://your-service.onrender.com")
        return 2
    base = sys.argv[1]
    health = call(base, "/health")
    assert health.get("status") == "ok", health
    assert health.get("trained_exhy_gll_model") == "unavailable", health
    info = call(base, "/api/v1/model-info")
    assert info["research_model"]["available"] is False
    source = "void copy(char *dst, const char *src) { strcpy(dst, src); }"
    result = call(base, "/api/v1/analyze", {"code": source, "language": "c", "file_name": "smoke.c"})
    assert result.get("analysis_type") == "static_rule_analysis", result
    assert any(item.get("rule_id") == "CXX002" for item in result.get("findings", [])), result
    assert result.get("model", {}).get("available") is False, result
    print("PASS: health, model-info honesty, static analysis and CXX002 evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
