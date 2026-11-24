from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .analyzer import MAX_SOURCE_CHARS, analyze_function, extract_functions

APP_VERSION = "1.0.0"

app = FastAPI(
    title="ExHyGLL Review API",
    version=APP_VERSION,
    description="A transparent C/C++ static review service. Trained ExHyGLL inference is disabled until research model artifacts are supplied.",
    docs_url="/docs",
    redoc_url=None,
)

def _parse_origins(raw: str) -> list[str]:
    """Normalise origins: trim spaces, quotes, trailing slashes (a trailing slash silently breaks CORS)."""
    cleaned = []
    for item in raw.split(","):
        item = item.strip().strip("\"'").rstrip("/")
        if item and item != "*":  # wildcard is intentionally not allowed
            cleaned.append(item)
    return cleaned


# Always allow local development and the deployed Vercel site, so no extra setup is needed.
# FRONTEND_ORIGINS (comma-separated) can add more origins, e.g. a custom domain.
DEFAULT_ORIGINS = ["http://localhost:3000", "https://exhy-gll-platform-web.vercel.app"]
origins = list(dict.fromkeys(DEFAULT_ORIGINS + _parse_origins(os.getenv("FRONTEND_ORIGINS", ""))))
# Optional: also allow Vercel preview deployments (https://<anything>.vercel.app).
# Set ALLOW_VERCEL_PREVIEWS=true on Render if you want preview URLs to work too.
origin_regex = r"https://[a-z0-9-]+\.vercel\.app" if os.getenv("ALLOW_VERCEL_PREVIEWS", "false").lower() == "true" else None
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-ID"],
    max_age=600,
)

# Simple per-process throttle. For multi-instance deployments, put a shared
# gateway/rate limiter in front of the service.
_request_buckets: dict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))


@app.middleware("http")
async def request_guard(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method == "POST":
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > 1_000_000:
            return JSONResponse(status_code=413, content={"error": "Request body is too large. Reduce the source file and try again."})
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        bucket = _request_buckets[client_ip]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT:
            return JSONResponse(status_code=429, content={"error": "Rate limit reached. Wait a minute and try again."})
        bucket.append(now)
        # Prevent unbounded memory growth: drop buckets of clients that have gone quiet.
        if len(_request_buckets) > 5000:
            for key in [k for k, b in _request_buckets.items() if not b or now - b[-1] > 60]:
                _request_buckets.pop(key, None)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


class AnalyzeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_SOURCE_CHARS)
    language: Literal["c", "cpp"] = "cpp"
    function_id: str | None = Field(default=None, max_length=300)
    file_name: str | None = Field(default=None, max_length=180)

    @field_validator("code")
    @classmethod
    def reject_empty_code(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Paste or upload C/C++ source code before analysis.")
        return value


class FunctionsRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_SOURCE_CHARS)
    language: Literal["c", "cpp"] = "cpp"


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Omit Pydantic's `input` field so submitted source text is not echoed back.
    issues = [{"location": ".".join(str(part) for part in item.get("loc", ())),
               "message": item.get("msg", "Invalid request field.")} for item in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "Request validation failed.", "issues": issues})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    # Do not log source text or request bodies. The generic message avoids
    # reflecting potentially sensitive source code in an error response.
    return JSONResponse(status_code=500, content={"error": "The analysis service encountered an unexpected error."})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "exhy-gll-review-api",
        "version": APP_VERSION,
        "static_engine": "available",
        "trained_exhy_gll_model": "unavailable",
        "source_retention": "none",
    }


@app.get("/api/v1/model-info")
async def model_info():
    return {
        "product": "ExHyGLL",
        "research_model": {
            "name": "ExHyGLL",
            "available": False,
            "inference_enabled": False,
            "status": "research architecture documented; trained inference artifacts not supplied",
            "missing_artifacts": [
                "Trained ExHyGLL checkpoint containing CodeBERT fine-tuning and newly trained graph/fusion/ExplBridge weights",
                "Exact training and inference source code for preprocessing, Joern CDG extraction and VASF construction",
                "Tokenizer/configuration and model-version metadata used for the reported experiments",
            ],
            "threshold": 0.50,
            "threshold_note": "The thesis uses a fixed 0.50 threshold for its trained binary classifier. This package does not generate an ExHyGLL probability.",
            "training_protocol": "Stage 1: eight epochs on project-grouped BigVul folds (three seeds, five folds). Stage 2: two epochs of adaptation on CodeLLMExp. Reported experiments used Python 3.10, PyTorch 2.0.1, PyTorch Geometric 2.3, fp16 and one NVIDIA Tesla T4 with 16 GB VRAM.",
            "architecture": [
                {"name": "CodeBERT", "role": "Semantic encoder; microsoft/codebert-base (12 layers, 12 heads, about 124.6M parameters); 256 BPE-token input window; 768-dimensional hidden states."},
                {"name": "CDG + VASF", "role": "Control-dependency graph with 32 features per statement node: 10 operator categories, 8 selected-call flags, 8 memory-access patterns and 6 branch-depth levels."},
                {"name": "GATv2", "role": "Three four-head GATv2 layers; 128-dimensional projected node states; 256-dimensional graph readout."},
                {"name": "Cross-modal attention", "role": "The 256-dimensional graph readout and mean-VASF projection form a structural query; eight-head attention reads CodeBERT token states."},
                {"name": "Gated residual fusion", "role": "An input-dependent gate mixes pooled CodeBERT and attended token features. Its initial bias is +1 (about 0.73 sigmoid gate near zero input), and a direct semantic residual remains available."},
                {"name": "ExplBridge", "role": "A learned two-layer token scorer with a 256-unit hidden layer; its weighted token summary is projected to 128 dimensions and is part of the classifier path, not a post-hoc explainer."},
                {"name": "Binary classifier", "role": "The 512-dimensional fused/residual representation is joined with the 128-dimensional ExplBridge summary (640 total), then mapped through 256- and 64-unit hidden layers to two classes; fixed threshold 0.50."},
            ],
            "reported_results": [
                {"dataset": "BigVul project-grouped evaluation", "metric": "F1", "value": "0.7939", "context": "LineVul 0.7892; paired tests did not establish a statistically significant difference."},
                {"dataset": "Devign holdout after matched CodeLLMExp adaptation", "metric": "F1 / MCC", "value": "0.6778 / 0.4087", "context": "Positive paired result across ten matched seeds versus the thesis re-implementation of SV-GEN; Holm-adjusted p = 0.0078."},
                {"dataset": "DiverseVul", "metric": "F1", "value": "0.6471", "context": "Thesis-reported external evaluation; not a live scan metric."},
                {"dataset": "PrimeVul-derived subset", "metric": "F1", "value": "0.6605", "context": "Small margin; the thesis notes that the comparison is thin and not directly comparable with published numbers."},
            ],
            "limitations": [
                "The research model classifies one function at a time.",
                "The thesis CDG does not contain data-flow edges and does not model caller-callee state, aliasing, build configuration or cross-file value flow.",
                "The semantic and ExplBridge token window is 256 BPE tokens.",
                "ExplBridge attribution is not proof of causality or exploitability.",
                "The thesis reports 7.1M additional parameters and 3.5x CodeBERT end-to-end latency.",
            ],
            "source": "User-supplied ExHyGLL thesis, Chapters 1, 3, 4 and 6.",
        },
        "active_engine": {
            "name": "ExHyGLL Review Engine",
            "available": True,
            "type": "Transparent lexical static rules with approximate control-context mapping",
            "does_not_claim": ["CodeBERT inference", "GATv2 inference", "Joern CDG", "VASF tensor construction", "ExplBridge token attribution", "calibrated vulnerability probability"],
        },
    }


@app.post("/api/v1/functions")
async def list_functions(payload: FunctionsRequest):
    functions = extract_functions(payload.code)
    return {
        "functions": [
            {"id": fn.id, "name": fn.name, "start_line": fn.start_line, "end_line": fn.end_line,
             "signature": fn.signature, "preview": fn.preview}
            for fn in functions
        ],
        "count": len(functions),
        "parser": "lightweight lexical scanner",
    }


@app.post("/api/v1/analyze")
async def analyze(payload: AnalyzeRequest):
    functions = extract_functions(payload.code)
    if not functions:
        raise HTTPException(
            status_code=422,
            detail="No function definition was detected. Paste a complete C/C++ function body. Header declarations without bodies cannot be analyzed by this function-level scanner.",
        )
    if payload.function_id:
        selected = next((fn for fn in functions if fn.id == payload.function_id), None)
        if selected is None:
            raise HTTPException(status_code=404, detail="The selected function was not found in the submitted source. Re-select the function and try again.")
    elif len(functions) > 1:
        return {
            "status": "selection_required",
            "functions": [
                {"id": fn.id, "name": fn.name, "start_line": fn.start_line, "end_line": fn.end_line,
                 "signature": fn.signature, "preview": fn.preview}
                for fn in functions
            ],
            "message": "Multiple function definitions were found. Select one function for function-level analysis.",
        }
    else:
        selected = functions[0]

    function_code = payload.code[selected.start_offset:selected.end_offset]
    result = analyze_function(function_code, selected.name, selected.start_line)
    result["file_name"] = payload.file_name or "Untitled source"
    result["language"] = payload.language
    result["function"]["signature"] = selected.signature
    result["source_range"] = {"start_line": selected.start_line, "end_line": selected.end_line}
    return result


@app.get("/")
async def root():
    return {"service": "ExHyGLL Review API", "docs": "/docs", "health": "/health"}
