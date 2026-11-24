"use client";

import { useEffect, useRef } from "react";
import type { Finding } from "@/lib/types";

type Props = {
  source: string;
  startLine: number;
  findings: Finding[];
  selectedFindingId?: string | null;
  onSelectFinding: (id: string) => void;
};

export default function CodeEvidence({ source, startLine, findings, selectedFindingId, onSelectFinding }: Props) {
  const selected = findings.find((finding) => finding.id === selectedFindingId);
  const selectedLineRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedFindingId]);

  const lines = source.split("\n");
  return (
    <div className="evidence-code" aria-label="Source code with rule-matched evidence lines">
      {lines.map((line, index) => {
        const absoluteLine = startLine + index;
        const matches = findings.filter((finding) => finding.line_start === absoluteLine);
        const active = matches.some((finding) => finding.id === selectedFindingId);
        const lineClass = matches.length ? `evidence-line has-finding ${active ? "is-selected" : ""}` : "evidence-line";
        return (
          <div className={lineClass} key={`${absoluteLine}-${index}`}>
            <span className="evidence-line-number">{absoluteLine}</span>
            <span className="evidence-line-code">{line || " "}</span>
            {matches.length > 0 && (
              <div className="evidence-line-actions">
                {matches.map((finding) => (
                  <button
                    key={finding.id}
                    ref={finding.id === selectedFindingId ? selectedLineRef : undefined}
                    type="button"
                    className={`line-marker severity-${finding.severity}`}
                    title={`${finding.rule_id}: ${finding.title}`}
                    onClick={() => onSelectFinding(finding.id)}
                  >
                    {finding.rule_id}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
