import type { AnalysisResult, FunctionChoice, ModelInfo } from "./types";

// Works out of the box: uses the deployed Render API in production and localhost while developing.
// Set NEXT_PUBLIC_API_BASE_URL to override (e.g. when you change the Render service).
const PRODUCTION_API = "https://exhy-gll-platform.onrender.com";
const DEFAULT_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : PRODUCTION_API);

export function getApiBase() {
  if (typeof window !== "undefined") {
    const override = window.localStorage.getItem("exhygll-api-base");
    if (override) return override.replace(/\/$/, "");
  }
  return DEFAULT_BASE.replace(/\/$/, "");
}

// Render's free tier can take ~30-60 s to wake from sleep, so allow a generous timeout.
const REQUEST_TIMEOUT_MS = 70_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : payload.error;
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The analysis server did not respond in time. If it was asleep it may need a minute to wake up — please try again.");
    }
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach the analysis API at ${getApiBase()}. Check NEXT_PUBLIC_API_BASE_URL (Vercel) and FRONTEND_ORIGINS (Render).`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkHealth(retries = 2) {
  // Retry so a sleeping (cold-start) Render instance is not reported as permanently offline.
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await request<{ status: string; version: string; static_engine: string; trained_exhy_gll_model: string }>("/health", { method: "GET" });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
  }
  throw lastError;
}

export async function fetchModelInfo() {
  return request<ModelInfo>("/api/v1/model-info", { method: "GET" });
}

export async function analyzeCode(code: string, language: "c" | "cpp", fileName: string, functionId?: string) {
  return request<AnalysisResult | { status: "selection_required"; functions: FunctionChoice[]; message: string }>("/api/v1/analyze", {
    method: "POST",
    body: JSON.stringify({ code, language, file_name: fileName, function_id: functionId || null })
  });
}
