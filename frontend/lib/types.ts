export type FunctionChoice = {
  id: string;
  name: string;
  start_line: number;
  end_line: number;
  signature: string;
  preview: string;
};

export type Finding = {
  id: string;
  rule_id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  weight: number;
  category: string;
  line_start: number;
  line_end: number;
  description: string;
  impact: string;
  recommendation: string;
  evidence: string;
  signal: string;
  control_context: { kind: string; label: string; line: number } | null;
};

export type GraphNode = {
  id: string;
  kind: "function" | "control" | "finding";
  label: string;
  line: number;
  detail: string;
  finding_id?: string;
};

export type AnalysisResult = {
  status: "completed";
  analysis_type: string;
  engine: string;
  function: { name: string; start_line: number; end_line: number; signature?: string };
  risk_index: number;
  risk_index_label: string;
  risk_index_note: string;
  summary: {
    finding_count: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    lines_analyzed: number;
    lexical_tokens: number;
  };
  findings: Finding[];
  graph: { nodes: GraphNode[]; edges: { from: string; to: string; label: string }[]; note: string };
  coverage: { rules_available: number; rules_triggered: number; parser: string; scope: string };
  limitations: string[];
  model: { available: boolean; name: string; reason: string };
  file_name: string;
  language: "c" | "cpp";
  source_range: { start_line: number; end_line: number };
};

export type HistoryEntry = {
  id: string;
  saved_at: string;
  file_name: string;
  language: "c" | "cpp";
  function_name: string;
  result: AnalysisResult;
  source_code?: string;
};

export type ModelInfo = {
  product: string;
  research_model: {
    name: string;
    available: boolean;
    inference_enabled: boolean;
    status: string;
    missing_artifacts: string[];
    threshold: number;
    threshold_note: string;
    architecture: { name: string; role: string }[];
    reported_results: { dataset: string; metric: string; value: string; context: string }[];
    limitations: string[];
    source: string;
  };
  active_engine: {
    name: string;
    available: boolean;
    type: string;
    does_not_claim: string[];
  };
};
