import type { AnalysisResult, Finding } from "./types";

function highestPriority(findings: Finding[]) {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.line_start - b.line_start)[0];
}

export function createAssistantReply(question: string, result: AnalysisResult): string {
  const q = question.toLowerCase();
  const top = highestPriority(result.findings);
  if (!result.findings.length) {
    return "This scan did not trigger any of the configured rules. That is not proof that the function is secure: this lightweight review does not perform full data-flow analysis, compilation, symbolic execution or trained ExHyGLL inference. Consider reviewing external inputs, pointer lifetimes, bounds and the calling context.";
  }
  if ((q.includes("fix") || q.includes("remediat") || q.includes("how do i") || q.includes("how to")) && top) {
    return `Start with ${top.rule_id} at line ${top.line_start}: ${top.recommendation} Then review the surrounding control paths and all callers. The current scan is a rule-based signal, so confirm the fix with tests and a compiler/static-analysis pass.`;
  }
  if ((q.includes("why") || q.includes("explain") || q.includes("mean")) && top) {
    return `${top.title} was flagged at line ${top.line_start}. ${top.description} ${top.impact} The scanner matched a ${top.signal.toLowerCase()}; this is evidence to review, not proof of exploitability. The nearest control context is shown in the relationship map when available.`;
  }
  if ((q.includes("priority") || q.includes("first") || q.includes("most important")) && top) {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const list = [...result.findings].sort((a, b) => order[a.severity] - order[b.severity] || a.line_start - b.line_start).slice(0, 3);
    return `Review these first: ${list.map((f) => `${f.rule_id} (line ${f.line_start})`).join(", ")}. Begin with the highest rule severity, then trace the input and object bounds through each path. Do not treat the rule order as a CVSS ranking.`;
  }
  return `I reviewed the findings returned for ${result.function.name}. There ${result.findings.length === 1 ? "is 1 rule match" : `are ${result.findings.length} rule matches`} across ${new Set(result.findings.map((f) => f.category)).size} categories. The highest-priority item is ${top?.rule_id} at line ${top?.line_start}. Ask about a specific rule, line or remediation to get a focused explanation. This helper uses the scan's actual findings and does not call an external LLM.`;
}

export function initialAssistantMessage(result: AnalysisResult): string {
  if (!result.findings.length) {
    return `I reviewed ${result.function.name}. No configured rule was triggered. That does not certify the function as safe. I can explain the scan scope and the checks that were not covered.`;
  }
  const top = highestPriority(result.findings);
  return `I found ${result.findings.length} rule-based signal${result.findings.length === 1 ? "" : "s"} in ${result.function.name}. Start by reviewing ${top?.rule_id} on line ${top?.line_start}. I can explain the evidence and the suggested next step.`;
}
