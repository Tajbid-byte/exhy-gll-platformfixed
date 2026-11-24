"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2,
  ChevronDown, CircleHelp, Clock3, Code2, Copy, FileCode2, FileUp, GitBranch, History,
  Info, LayoutDashboard, Menu, Moon, Network, Play, Search, Settings2, ShieldAlert,
  ShieldCheck, Sun, Trash2, Upload, X, Zap
} from "lucide-react";
import CodeEditor from "./CodeEditor";
import FindingGraph from "./FindingGraph";
import CodeEvidence from "./CodeEvidence";
import ReviewAssistant from "./ReviewAssistant";
import { analyzeCode, checkHealth, fetchModelInfo, getApiBase } from "@/lib/api";
import type { AnalysisResult, FunctionChoice, HistoryEntry, ModelInfo } from "@/lib/types";

const HISTORY_KEY = "exhygll-analysis-history-v1";
const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "analyze", label: "Analyze code", icon: Code2 },
  { id: "history", label: "History", icon: History },
  { id: "model", label: "Model architecture", icon: Network },
  { id: "settings", label: "Settings", icon: Settings2 }
] as const;
type View = typeof NAV_ITEMS[number]["id"];
type ApiState = "checking" | "online" | "offline";

function severityLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSavedHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function StatusPill({ state }: { state: ApiState }) {
  const label = state === "online" ? "API connected" : state === "checking" ? "Connecting (server may be waking up)" : "API offline";
  return <span className={`status-pill status-${state}`}><span className="status-dot" />{label}</span>;
}

function RiskGauge({ value, label }: { value: number; label: string }) {
  return (
    <div className="risk-gauge-wrap">
      <div className="risk-gauge" style={{ "--risk-angle": `${Math.max(0, Math.min(100, value)) * 3.6}deg` } as CSSProperties}>
        <div className="risk-gauge-inner"><strong>{value}</strong><span>/ 100</span></div>
      </div>
      <div className="risk-gauge-label"><span>Rule-weighted risk index</span><strong>{label}</strong></div>
    </div>
  );
}

function EmptyAnalysisState({ onStart }: { onStart: () => void }) {
  return (
    <div className="empty-analysis">
      <div className="empty-mark"><ShieldCheck size={23} /></div>
      <p className="eyebrow">READY FOR REVIEW</p>
      <h3>Make the code<br /><em>tell its story.</em></h3>
      <p>Run a transparent C/C++ review to surface risky patterns, inspect the surrounding control context and understand what to verify next.</p>
      <button className="button button-dark button-wide" onClick={onStart} type="button">Start with your code <ArrowRight size={16} /></button>
      <div className="empty-foot"><span /> No source code is stored by the API.</div>
    </div>
  );
}

function AnalysisResults({
  result, code, selectedFindingId, onSelectFinding, onSave, onAnalyzeAgain, savedSource, includeSource, onIncludeSourceChange, saveMessage
}: {
  result: AnalysisResult;
  code: string;
  selectedFindingId: string | null;
  onSelectFinding: (id: string) => void;
  onSave: () => void;
  onAnalyzeAgain: () => void;
  savedSource: boolean;
  includeSource: boolean;
  onIncludeSourceChange: (checked: boolean) => void;
  saveMessage: string;
}) {
  const selected = result.findings.find((finding) => finding.id === selectedFindingId) || result.findings[0];
  const functionSource = code ? code.split("\n").slice(result.function.start_line - 1, result.function.end_line).join("\n") : "";
  return (
    <div className="results-stack">
      <div className="result-topline">
        <div><p className="eyebrow">ANALYSIS COMPLETE</p><h2>{result.function.name}<span className="result-signature"> · {result.language.toUpperCase()}</span></h2><p className="muted-copy">{result.file_name} · lines {result.function.start_line}–{result.function.end_line}</p></div>
        <div className="result-actions"><button className="button button-light" onClick={onSave} type="button"><Check size={15} /> Save result</button><button className="button button-outline" onClick={onAnalyzeAgain} type="button">New scan</button></div>
      </div>
      <div className="save-source-option"><label><input type="checkbox" checked={includeSource} onChange={(event) => onIncludeSourceChange(event.target.checked)} /> Include source code when I save this result</label><span>{saveMessage || "Off by default · stored only in this browser"}</span></div>
      <div className="result-summary-grid">
        <div className="risk-card"><RiskGauge value={result.risk_index} label={result.risk_index_label} /><p className="risk-note">{result.risk_index_note}</p></div>
        <div className="metric-card"><span className="metric-label">Rule matches</span><strong>{result.summary.finding_count}</strong><span className="metric-caption">Across {result.coverage.rules_triggered} triggered rules</span><div className="metric-rule" /></div>
        <div className="metric-card"><span className="metric-label">Lines reviewed</span><strong>{result.summary.lines_analyzed}</strong><span className="metric-caption">{result.summary.lexical_tokens} lexical tokens</span><div className="metric-rule amber" /></div>
        <div className="metric-card"><span className="metric-label">Engine</span><strong className="metric-engine">Static</strong><span className="metric-caption">Rule-based engine</span><div className="metric-rule wine" /></div>
      </div>
      <div className="severity-strip" aria-label="Finding severity counts">
        <span className="severity-item"><i className="severity-dot critical" />Critical <b>{result.summary.critical}</b></span>
        <span className="severity-item"><i className="severity-dot high" />High <b>{result.summary.high}</b></span>
        <span className="severity-item"><i className="severity-dot medium" />Medium <b>{result.summary.medium}</b></span>
        <span className="severity-item"><i className="severity-dot low" />Low <b>{result.summary.low}</b></span>
      </div>
      <div className="honesty-note"><Info size={16} /><span><strong>Interpretation:</strong> this is a rule-weighted review indicator, not a percentage probability of vulnerability, a CVSS score or an ExHyGLL model prediction. A clean scan is not proof of safety.</span></div>

      <div className="section-heading-row"><div><p className="eyebrow">01 / RELATIONSHIPS</p><h3>Code context map</h3><p className="muted-copy">A per-function map of rule matches and their nearest lexical control context.</p></div><span className="mini-tag"><GitBranch size={13} /> DYNAMIC VIEW</span></div>
      <div className="surface-card graph-card"><FindingGraph result={result} selectedFindingId={selectedFindingId} onSelectFinding={onSelectFinding} /><p className="graph-caption">{result.graph.note}</p></div>

      <div className="section-heading-row"><div><p className="eyebrow">02 / EVIDENCE</p><h3>Findings & source context</h3><p className="muted-copy">Select a finding to focus its matched source line and explanation.</p></div><span className="mini-tag">{result.findings.length} FINDINGS</span></div>
      <div className="findings-layout">
        <div className="surface-card findings-list">
          {result.findings.length ? result.findings.map((finding) => (
            <button key={finding.id} type="button" className={`finding-row ${selected?.id === finding.id ? "is-active" : ""}`} onClick={() => onSelectFinding(finding.id)}>
              <span className={`finding-severity severity-${finding.severity}`} />
              <span className="finding-main"><span className="finding-rule">{finding.rule_id} · LINE {finding.line_start}</span><strong>{finding.title}</strong><small>{finding.category}</small></span>
              <span className={`severity-label severity-text-${finding.severity}`}>{severityLabel(finding.severity)}</span>
            </button>
          )) : <div className="no-findings"><CheckCircle2 size={23} /><strong>No configured rule was triggered.</strong><span>This does not certify the function as secure. Review the scan limitations before relying on this result.</span></div>}
        </div>
        <div className="surface-card finding-detail">
          {selected ? <>
            <div className="detail-kicker"><span className={`severity-chip severity-${selected.severity}`}>{severityLabel(selected.severity)} rule</span><span>{selected.rule_id}</span></div>
            <h4>{selected.title}</h4>
            <p>{selected.description}</p>
            <div className="detail-block"><span>WHY IT MATTERS</span><p>{selected.impact}</p></div>
            <div className="detail-block recommendation-block"><span>WHAT TO REVIEW</span><p>{selected.recommendation}</p></div>
            <div className="evidence-quote"><span>Matched evidence · line {selected.line_start}</span><code>{selected.evidence}</code></div>
            <p className="signal-note"><Info size={13} /> {selected.signal}.</p>
          </> : <div className="no-findings-detail"><CircleHelp size={22} /><span>Select a finding to inspect its evidence.</span></div>}
        </div>
      </div>

      {functionSource && <>
        <div className="section-heading-row"><div><p className="eyebrow">03 / SOURCE REVIEW</p><h3>Highlighted source</h3><p className="muted-copy">Amber markers identify lines matched by static rules.</p></div><span className="mini-tag">{savedSource ? "SOURCE RESTORED" : "IN MEMORY ONLY"}</span></div>
        <div className="surface-card source-card"><CodeEvidence source={functionSource} startLine={result.function.start_line} findings={result.findings} selectedFindingId={selectedFindingId} onSelectFinding={onSelectFinding} /></div>
      </>}
      {!functionSource && <div className="honesty-note"><Info size={16} /><span>The source text was not saved with this history record. Only the finding summary and evidence metadata were retained.</span></div>}
      <div className="section-heading-row"><div><p className="eyebrow">04 / NEXT STEPS</p><h3>Review assistant</h3><p className="muted-copy">Ask focused questions about this result.</p></div></div>
      <ReviewAssistant result={result} />
      <div className="limitations-card"><div><ShieldAlert size={17} /><strong>Scope & limitations</strong></div><ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
    </div>
  );
}

export default function AppShell() {
  const [view, setView] = useState<View>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [code, setCode] = useState("");
  const [fileName, setFileName] = useState("Untitled source");
  const [language, setLanguage] = useState<"c" | "cpp">("cpp");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [functions, setFunctions] = useState<FunctionChoice[]>([]);
  const [selectedFunctionId, setSelectedFunctionId] = useState("");
  const [needsSelection, setNeedsSelection] = useState(false);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [includeSource, setIncludeSource] = useState(false);
  const [apiBaseDraft, setApiBaseDraft] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshConnection = useCallback(async () => {
    setApiState("checking");
    try {
      await checkHealth();
      setApiState("online");
      const info = await fetchModelInfo();
      setModelInfo(info);
    } catch {
      setApiState("offline");
    }
  }, []);

  useEffect(() => {
    setHistory(getSavedHistory());
    setApiBaseDraft(getApiBase());
    const storedTheme = window.localStorage.getItem("exhygll-theme");
    setDarkMode(storedTheme === "dark");
    refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    window.localStorage.setItem("exhygll-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const navigate = (next: View) => {
    setView(next);
    setMobileMenuOpen(false);
    setError("");
  };

  const clearResult = () => {
    setResult(null);
    setSelectedFindingId(null);
    setFunctions([]);
    setSelectedFunctionId("");
    setNeedsSelection(false);
    setError("");
    setSaveMessage("");
    setIncludeSource(false);
  };

  const handleAnalyze = async (functionId?: string) => {
    if (!code.trim()) {
      setError("Paste C/C++ source code or upload a file before starting the review.");
      return;
    }
    if (code.length > 120_000) {
      setError("This source file is larger than the 120,000-character request limit.");
      return;
    }
    setLoading(true);
    setError("");
    setSaveMessage("");
    setIncludeSource(false);
    try {
      const response = await analyzeCode(code, language, fileName, functionId || undefined);
      if (response.status === "selection_required") {
        setFunctions(response.functions);
        setNeedsSelection(true);
        setSelectedFunctionId(response.functions[0]?.id || "");
        setResult(null);
      } else {
        setResult(response);
        setSelectedFindingId(response.findings[0]?.id || null);
        setNeedsSelection(false);
        setFunctions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    const allowed = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file.name);
    if (!allowed) {
      setError("Unsupported file type. Choose a .c, .cpp, .cc, .cxx, .h or .hpp file.");
      return;
    }
    if (file.size > 120 * 1024) {
      setError("The selected file exceeds the 120 KB upload limit.");
      return;
    }
    try {
      const text = await file.text();
      setCode(text);
      setFileName(file.name);
      setLanguage(/\.(c|h)$/i.test(file.name) ? "c" : "cpp");
      clearResult();
      setError("");
    } catch {
      setError("The selected file could not be read as text.");
    }
  };

  const saveHistory = () => {
    if (!result) return;
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      saved_at: new Date().toISOString(),
      file_name: fileName,
      language,
      function_name: result.function.name,
      result,
      ...(includeSource ? { source_code: code } : {})
    };
    const updated = [entry, ...history].slice(0, 20);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setHistory(updated);
      setSaveMessage(includeSource ? "Saved with source code on this device." : "Saved without source code on this device.");
    } catch {
      setSaveMessage("Browser storage is full. Delete older records or save without source code.");
    }
    setIncludeSource(false);
  };

  const openHistory = (entry: HistoryEntry) => {
    setResult(entry.result);
    setSaveMessage("");
    setIncludeSource(false);
    setCode(entry.source_code || "");
    setFileName(entry.file_name);
    setLanguage(entry.language);
    setSelectedFindingId(entry.result.findings[0]?.id || null);
    setView("analyze");
    setError("");
  };

  const deleteHistory = (id: string) => {
    const updated = history.filter((entry) => entry.id !== id);
    setHistory(updated);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const saveApiBase = () => {
    const clean = apiBaseDraft.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(clean)) {
      setSettingsMessage("Enter a complete API URL beginning with https:// or http://.");
      return;
    }
    window.localStorage.setItem("exhygll-api-base", clean);
    setSettingsMessage("API endpoint saved on this device. Checking connection…");
    refreshConnection();
  };

  const filteredHistory = useMemo(() => history.filter((entry) => `${entry.file_name} ${entry.function_name} ${entry.result.risk_index_label}`.toLowerCase().includes(historySearch.toLowerCase())), [history, historySearch]);
  const researchResults = modelInfo?.research_model.reported_results || [
    { dataset: "BigVul project-grouped evaluation", metric: "F1", value: "0.7939", context: "LineVul 0.7892; paired tests did not establish a statistically significant difference." },
    { dataset: "Devign holdout after matched CodeLLMExp adaptation", metric: "F1 / MCC", value: "0.6778 / 0.4087", context: "Positive paired result across ten matched seeds versus the thesis re-implementation of SV-GEN; Holm-adjusted p = 0.0078." },
    { dataset: "DiverseVul", metric: "F1", value: "0.6471", context: "Thesis-reported external evaluation; not a live scan metric." },
    { dataset: "PrimeVul-derived subset", metric: "F1", value: "0.6605", context: "Small margin; the thesis notes that the comparison is thin and not directly comparable with published numbers." }
  ];

  const viewTitle = NAV_ITEMS.find((item) => item.id === view)?.label || "Overview";

  return (
    <div className={`app-root ${darkMode ? "theme-dark" : ""}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol"><span /><span /><span /><span /></div>
          <div className="brand-wordmark">ExHyGLL<span> / SECURITY INTELLIGENCE</span></div>
        </div>
        <div className="topbar-right">
          <span className="topbar-edition">RESEARCH EDITION</span>
          <StatusPill state={apiState} />
          <button className="icon-button theme-toggle" type="button" onClick={() => setDarkMode((current) => !current)} aria-label="Toggle theme">{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button mobile-menu-button" type="button" onClick={() => setMobileMenuOpen((current) => !current)} aria-label="Toggle navigation">{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>

      <div className="app-layout">
        <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-label">WORKSPACE</div>
          <nav aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`nav-item ${view === item.id ? "nav-active" : ""}`}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "analyze" && result && <i className="nav-indicator" />}</button>;
            })}
          </nav>
          <div className="sidebar-spacer" />
          <div className="sidebar-footer"><span>EXHYGLL · 1.0.0</span><span>BUILT FOR CODE REVIEW</span></div>
        </aside>

        <main className="main-content">
          <div className="mobile-pagebar"><span>{viewTitle}</span><ChevronDown size={14} /></div>
          {view === "overview" && (
            <div className="page-wrap overview-page">
              <div className="overview-hero">
                <div className="hero-grid-lines" />
                <div className="hero-copy">
                  <p className="eyebrow eyebrow-light">A MORE THOUGHTFUL WAY TO REVIEW CODE</p>
                  <h1>See the risk.<br /><em>Understand the why.</em></h1>
                  <p>Function-level C/C++ security review with transparent rule evidence and a research-grounded explainability workspace.</p>
                  <button className="button button-amber" type="button" onClick={() => navigate("analyze")}>Analyze a function <ArrowRight size={16} /></button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="hero-art-top"><span>01 / SOURCE</span><span>02 / SIGNAL</span></div>
                  <div className="hero-code-lines"><i /><i /><i /><i /><i /><i /><i /><i /></div>
                  <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
                  <div className="hero-art-core"><ShieldCheck size={38} strokeWidth={1.2} /></div>
                  <div className="hero-art-bottom"><span>CONTROL CONTEXT</span><span>EXPLAINABLE REVIEW</span></div>
                </div>
                <div className="hero-index">EXH / 001</div>
              </div>

              <div className="overview-intro-row">
                <div><p className="eyebrow">THE WORKSPACE</p><h2>From source to signal.</h2><p className="muted-copy">A focused workflow: inspect the function, trace each rule match and decide what to verify next.</p></div>
                <div className="overview-state"><StatusPill state={apiState} /><span>Static review engine {apiState === "online" ? "available" : "requires API connection"}</span></div>
              </div>
              <div className="overview-feature-grid">
                <button className="feature-tile feature-primary" type="button" onClick={() => navigate("analyze")}><span className="feature-number">01</span><Code2 size={21} /><h3>Analyze code</h3><p>Paste or upload a C/C++ function and run the local rule engine.</p><span className="feature-link">Open workspace <ArrowRight size={14} /></span></button>
                <button className="feature-tile" type="button" onClick={() => navigate("history")}><span className="feature-number">02</span><History size={21} /><h3>Review history</h3><p>Reopen results you explicitly saved on this device.</p><span className="feature-link">View saved results <ArrowRight size={14} /></span></button>
                <button className="feature-tile" type="button" onClick={() => navigate("model")}><span className="feature-number">03</span><Network size={21} /><h3>Research model</h3><p>Explore the thesis architecture and see what is needed for real inference.</p><span className="feature-link">Explore architecture <ArrowRight size={14} /></span></button>
              </div>
            </div>
          )}

          {view === "analyze" && (
            <div className="page-wrap analysis-page">
              <div className="page-heading-row">
                <div><p className="eyebrow">SOURCE ANALYSIS / 01</p><h1>Review a function<span>.</span></h1><p className="muted-copy">A focused security pass for C and C++ source code.</p></div>
                <div className="engine-label"><span className="engine-mark"><Activity size={16} /></span><span><strong>Review engine</strong><small>Static rules</small></span></div>
              </div>
              <div className="analysis-workspace-grid">
                <section className="editor-column">
                  <div className="editor-toolbar">
                    <div className="file-label"><FileCode2 size={16} /><span>{fileName}</span><span className="file-language">{language.toUpperCase()}</span></div>
                    <div className="editor-tools">
                      <select value={language} onChange={(event) => { setLanguage(event.target.value as "c" | "cpp"); clearResult(); }} aria-label="Select source language"><option value="c">C</option><option value="cpp">C++</option></select>
                      <button type="button" className="tool-button" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Upload</button>
                      <input ref={fileInputRef} type="file" accept=".c,.cpp,.cc,.cxx,.h,.hh,.hpp,.hxx,text/plain" hidden onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
                      <button type="button" className="tool-button tool-clear" onClick={() => { setCode(""); setFileName("Untitled source"); clearResult(); }}><Trash2 size={14} /><span>Clear</span></button>
                    </div>
                  </div>
                  <CodeEditor value={code} onChange={(value) => { setCode(value); clearResult(); }} minHeight="410px" placeholder="// Paste a complete C or C++ function here\n// or upload a .c, .cpp or .h file…" />
                  <div className="editor-bottomline"><span><span className="editor-dot" /> {code.length.toLocaleString()} / 120,000 characters</span><span>Max upload 120 KB · source is not retained by the API</span></div>
                  {needsSelection && <div className="function-select-panel"><div><strong>Multiple functions detected</strong><p>Choose one function for function-level review.</p></div><select value={selectedFunctionId} onChange={(event) => setSelectedFunctionId(event.target.value)} aria-label="Choose function">{functions.map((fn) => <option value={fn.id} key={fn.id}>{fn.name} · L{fn.start_line}–{fn.end_line}</option>)}</select><button className="button button-dark" type="button" disabled={!selectedFunctionId || loading} onClick={() => handleAnalyze(selectedFunctionId)}><Play size={14} /> Analyze selected</button></div>}
                  {error && <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
                  <div className="analyze-action-row">
                    <div className="analysis-privacy"><ShieldCheck size={15} /><span>Runs against the API you configure. No code retention.</span></div>
                    <button className="button button-amber analyze-button" type="button" disabled={loading || !code.trim()} onClick={() => handleAnalyze()}>{loading ? <><span className="button-spinner" /> Reviewing…</> : <>Analyze function <ArrowRight size={16} /></>}</button>
                  </div>
                  <div className="editor-disclaimer">Function boundaries are detected with a best-effort lexical scanner; macro-heavy or advanced C++ may need a complete function pasted directly. The review does not compile code or prove exploitability.</div>
                </section>
                <aside className="output-column">
                  <div className="output-heading"><div><p className="eyebrow">LIVE OUTPUT</p><h2>Analysis result</h2></div><span className={`output-status ${result ? "output-complete" : ""}`}>{result ? "COMPLETE" : loading ? "RUNNING" : "WAITING"}</span></div>
                  {result ? <div className="output-mini-summary"><RiskGauge value={result.risk_index} label={result.risk_index_label} /><div className="mini-output-stats"><span><strong>{result.summary.finding_count}</strong> findings</span><span><strong>{result.summary.lines_analyzed}</strong> lines</span></div><button className="button button-dark button-wide" type="button" onClick={() => document.getElementById("full-results")?.scrollIntoView({ behavior: "smooth" })}>View full report <ArrowDownRight size={15} /></button><p className="output-mini-note">Rule severity and the risk index are not CVSS or a probability of vulnerability.</p></div> : <EmptyAnalysisState onStart={() => document.querySelector<HTMLTextAreaElement>(".cm-content")?.focus()} />}
                  <div className="output-architecture"><span className="eyebrow">RESEARCH PATH</span><div className="architecture-mini"><span>CodeBERT</span><i /><span>GATv2</span><i /><span>ExplBridge</span></div></div>
                </aside>
              </div>
              {result && <div id="full-results" className="full-results"><AnalysisResults result={result} code={code} selectedFindingId={selectedFindingId} onSelectFinding={setSelectedFindingId} onSave={saveHistory} onAnalyzeAgain={clearResult} savedSource={Boolean(code)} includeSource={includeSource} onIncludeSourceChange={setIncludeSource} saveMessage={saveMessage} /></div>}
            </div>
          )}

          {view === "history" && (
            <div className="page-wrap history-page">
              <div className="page-heading-row"><div><p className="eyebrow">LOCAL RECORDS / 02</p><h1>Analysis history<span>.</span></h1><p className="muted-copy">Only results you explicitly save appear here. Records stay in this browser.</p></div><div className="history-count"><strong>{history.length}</strong><span>SAVED RESULTS</span></div></div>
              <div className="history-toolbar"><div className="history-search"><Search size={16} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search file or function…" aria-label="Search history" /></div><button className="button button-outline" type="button" onClick={() => { if (window.confirm("Delete all locally saved analysis records?")) { setHistory([]); window.localStorage.removeItem(HISTORY_KEY); } }} disabled={!history.length}><Trash2 size={14} /> Clear all</button></div>
              {filteredHistory.length ? <div className="history-list">{filteredHistory.map((entry) => <div className="history-row" key={entry.id}><div className="history-file-icon"><FileCode2 size={19} /></div><div className="history-main"><strong>{entry.function_name}</strong><span>{entry.file_name} · {entry.language.toUpperCase()} · {new Date(entry.saved_at).toLocaleString()}</span></div><div className="history-result"><strong>{entry.result.risk_index}</strong><span>risk index</span></div><span className="history-findings">{entry.result.summary.finding_count} findings</span><button type="button" className="button button-light history-open" onClick={() => openHistory(entry)}>Open <ArrowUpRight size={14} /></button><button type="button" className="icon-button history-delete" aria-label={`Delete ${entry.function_name}`} onClick={() => deleteHistory(entry.id)}><Trash2 size={15} /></button></div>)}</div> : <div className="history-empty"><div className="empty-mark"><History size={22} /></div><h3>{history.length ? "No matching records" : "Your history is yours to create."}</h3><p>{history.length ? "Try a different search term." : "Run an analysis and choose Save result. Nothing is stored automatically."}</p><button type="button" className="button button-dark" onClick={() => navigate("analyze")}>Go to analysis <ArrowRight size={15} /></button></div>}
            </div>
          )}

          {view === "model" && (
            <div className="page-wrap model-page">
              <div className="page-heading-row"><div><p className="eyebrow">RESEARCH NOTES / 03</p><h1>The ExHyGLL model<span>.</span></h1><p className="muted-copy">The research architecture, preserved as described in the supplied thesis.</p></div></div>
              <div className="model-flow-card"><div className="model-flow-heading"><div><p className="eyebrow">RESEARCH ARCHITECTURE</p><h2>Two views. One prediction path.</h2></div><span className="mini-tag">THESIS · FIG. 3.2</span></div><div className="model-flow-grid">
                <div className="flow-node semantic"><span className="flow-node-index">01 / SEMANTIC</span><Code2 size={20} /><strong>CodeBERT</strong><p>256 BPE tokens · 768 hidden dimensions</p></div>
                <div className="flow-node structural"><span className="flow-node-index">02 / STRUCTURAL</span><GitBranch size={20} /><strong>CDG + VASF</strong><p>Full-function control dependencies · 32 features per statement</p></div>
                <div className="flow-node graph"><span className="flow-node-index">03 / GRAPH ENCODER</span><Network size={20} /><strong>GATv2</strong><p>3 layers · 4 attention heads · 256-d graph readout</p></div>
                <div className="flow-node fusion"><span className="flow-node-index">04 / FUSION</span><Activity size={20} /><strong>Gated attention</strong><p>Structural query attends to token states; semantic residual stays open</p></div>
                <div className="flow-node explain"><span className="flow-node-index">05 / ATTRIBUTION</span><Search size={20} /><strong>ExplBridge</strong><p>Learned token scorer · weighted summary in classifier path</p></div>
                <div className="flow-node classifier"><span className="flow-node-index">06 / OUTPUT</span><ShieldCheck size={20} /><strong>Binary classifier</strong><p>640-d input · threshold 0.50</p></div>
              </div><div className="model-flow-foot"><span>SEMANTIC PATH</span><span>STRUCTURAL PATH</span><span>GATED RESIDUAL FUSION</span><span>CLASSIFICATION</span></div><div className="model-flow-note"><Info size={14} /><span>CodeBERT token states feed both cross-modal attention and ExplBridge. The CDG/VASF branch supplies a structural query through GATv2. The gated fused representation and ExplBridge summary are joined before the classifier.</span></div></div>
              <div className="model-details-grid"><section className="surface-card model-detail-card"><p className="eyebrow">VASF / 32 DIMENSIONS</p><h3>What the graph sees</h3><div className="vasf-groups"><div><strong>10</strong><span>Operator categories</span><small>Arithmetic, logical and control-flow operations</small></div><div><strong>8</strong><span>Selected-call flags</span><small>strcpy, strncpy, memcpy, memset, scanf/fscanf, printf/sprintf, malloc/calloc, free</small></div><div><strong>8</strong><span>Memory-access patterns</span><small>Array reads/writes, pointer arithmetic, dereference, size expressions, offsets and local aliases</small></div><div><strong>6</strong><span>Branch-depth levels</span><small>Hand-designed control-depth indicators</small></div></div></section><section className="surface-card model-detail-card"><p className="eyebrow">EXPLBRIDGE</p><h3>Attribution, not causality.</h3><p>ExplBridge scores CodeBERT token states with a learned two-layer network and builds a masked weighted summary. That summary is part of the prediction path rather than a post-hoc explainer.</p><p className="model-caveat">The thesis tests perturbation sensitivity and localisation. It explicitly does not claim that highlighted tokens prove a vulnerability's root cause or exploitability.</p></section><section className="surface-card model-detail-card training-card"><p className="eyebrow">TRAINING PROTOCOL</p><h3>Two-stage research schedule</h3><div className="training-stages"><div><strong>08</strong><span>Epochs · BigVul</span><small>Stage 1 · 3 seeds × 5 project-grouped folds</small></div><div><strong>02</strong><span>Epochs · CodeLLMExp</span><small>Stage 2 · matched adaptation</small></div><div><strong>16 GB</strong><span>Tesla T4 GPU</span><small>fp16 mixed precision</small></div></div></section></div>
              <div className="section-heading-row"><div><p className="eyebrow">REPORTED EXPERIMENTS</p><h3>Results from the thesis</h3><p className="muted-copy">These are published research results, not predictions from this deployed application.</p></div></div>
              <div className="research-results-table"><div className="research-table-head"><span>DATASET / PROTOCOL</span><span>METRIC</span><span>REPORTED VALUE</span><span>CONTEXT</span></div>{researchResults.map((row) => <div className="research-table-row" key={row.dataset}><strong>{row.dataset}</strong><span>{row.metric}</span><b>{row.value}</b><p>{row.context}</p></div>)}</div>
              <div className="model-footnote">Source: user-supplied FYDP Thesis ExHyGLL, Abstract; Sections 1.3–1.5; 3.2.2–3.2.3; 4.2–4.3; and 6.2.</div>
            </div>
          )}

          {view === "settings" && (
            <div className="page-wrap settings-page">
              <div className="page-heading-row"><div><p className="eyebrow">PREFERENCES / 04</p><h1>Settings<span>.</span></h1><p className="muted-copy">Configure the API connection and local data preferences.</p></div></div>
              <section className="surface-card settings-card"><div className="settings-section-heading"><div className="settings-icon"><Activity size={18} /></div><div><h3>Backend connection</h3><p>Set the public Render API URL used by this browser.</p></div></div><label className="field-label" htmlFor="api-base">API base URL</label><input id="api-base" className="settings-input" value={apiBaseDraft} onChange={(event) => setApiBaseDraft(event.target.value)} placeholder="https://your-service.onrender.com" /><div className="settings-actions"><button className="button button-dark" type="button" onClick={saveApiBase}>Save endpoint <ArrowRight size={14} /></button><button className="button button-outline" type="button" onClick={refreshConnection}>Test connection</button><span className={`connection-caption ${apiState}`}>{apiState === "online" ? "Connected" : apiState === "checking" ? "Checking…" : "Not connected"}</span></div><p className="settings-help">For deployment, also set FRONTEND_ORIGINS on Render to your exact Vercel domain. The API URL is stored in this browser only.</p></section>
              <section className="surface-card settings-card"><div className="settings-section-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h3>Privacy & retention</h3><p>Source code is processed for the request and not written to server-side history.</p></div></div><div className="privacy-list"><div><CheckCircle2 size={16} /><span>API does not save submitted source code or request bodies.</span></div><div><CheckCircle2 size={16} /><span>Analysis history is opt-in and stored in this browser's local storage.</span></div><div><CheckCircle2 size={16} /><span>Saved source code is excluded unless you check the explicit save option.</span></div><div><CheckCircle2 size={16} /><span>No external LLM or third-party AI API is called by the review assistant.</span></div></div></section>
              {settingsMessage && <div className="settings-message" role="status">{settingsMessage}</div>}
              <div className="settings-version">ExHyGLL Review · version 1.0.0 · Built for research demonstration and developer review.</div>
            </div>
          )}
        </main>
      </div>
      {mobileMenuOpen && <button className="mobile-menu-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}
    </div>
  );
}
