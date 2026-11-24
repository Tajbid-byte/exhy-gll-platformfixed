from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_and_model_status_are_honest():
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["trained_exhy_gll_model"] == "unavailable"
    info = client.get("/api/v1/model-info")
    assert info.status_code == 200
    assert info.json()["research_model"]["available"] is False


def test_multiple_functions_require_selection():
    code = "int alpha() { return 1; }\nint beta() { return 2; }"
    response = client.post("/api/v1/analyze", json={"code": code, "language": "cpp"})
    assert response.status_code == 200
    assert response.json()["status"] == "selection_required"
    assert len(response.json()["functions"]) == 2


def test_analysis_returns_rule_evidence_without_model_probability():
    code = "void copy(char *dst, const char *src) { strcpy(dst, src); }"
    response = client.post("/api/v1/analyze", json={"code": code, "language": "c"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["analysis_type"] == "static_rule_analysis"
    assert payload["findings"][0]["rule_id"] == "CXX002"
    assert payload["model"]["available"] is False
    assert "probability" in payload["risk_index_note"]


def test_header_declarations_without_bodies_are_not_analysed():
    response = client.post("/api/v1/analyze", json={"code": "int add(int a, int b);", "language": "c"})
    assert response.status_code == 422


def test_cors_origin_trailing_slash_is_normalised():
    from app.main import _parse_origins
    assert _parse_origins("https://a.vercel.app/, http://localhost:3000 ,*") == ["https://a.vercel.app", "http://localhost:3000"]
