"use client";

import type { AnalysisResult, GraphNode } from "@/lib/types";

function truncate(value: string, length = 25) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

type Props = {
  result: AnalysisResult;
  selectedFindingId?: string | null;
  onSelectFinding: (id: string) => void;
};

export default function FindingGraph({ result, selectedFindingId, onSelectFinding }: Props) {
  const nodes = result.graph.nodes;
  const root = nodes.find((node) => node.kind === "function");
  const controls = nodes.filter((node) => node.kind === "control");
  const findings = nodes.filter((node) => node.kind === "finding");
  const width = 860;
  const rowGap = 84;
  const height = Math.max(230, Math.max(controls.length, findings.length, 1) * rowGap + 70);
  const rootY = height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  if (root) positions.set(root.id, { x: 26, y: rootY - 31 });
  controls.forEach((node, index) => positions.set(node.id, { x: 300, y: 28 + index * rowGap }));
  findings.forEach((node, index) => positions.set(node.id, { x: 594, y: 28 + index * rowGap }));

  return (
    <div className="graph-scroll" aria-label="Finding relationship map">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lexical function, control-context and finding relationships">
        <defs>
          <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#b58b97" />
          </marker>
        </defs>
        {result.graph.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const startX = from.x + (edge.from === "function-root" ? 172 : 230);
          const endX = to.x;
          const startY = from.y + 31;
          const endY = to.y + 31;
          const mid = (startX + endX) / 2;
          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <path d={`M ${startX} ${startY} C ${mid} ${startY}, ${mid} ${endY}, ${endX - 8} ${endY}`} fill="none" stroke="#b58b97" strokeWidth="1.6" markerEnd="url(#graph-arrow)" />
              <text x={mid} y={(startY + endY) / 2 - 7} textAnchor="middle" className="graph-edge-label">{edge.label}</text>
            </g>
          );
        })}
        {nodes.map((node: GraphNode) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const isFinding = node.kind === "finding";
          const finding = isFinding ? result.findings.find((item) => item.id === node.finding_id) : undefined;
          const active = finding?.id === selectedFindingId;
          const boxWidth = node.kind === "function" ? 172 : node.kind === "control" ? 230 : 238;
          const boxHeight = 62;
          const fill = node.kind === "function" ? "#430107" : node.kind === "control" ? "#fffaf7" : active ? "#ffca05" : "#fff3e9";
          const stroke = node.kind === "function" ? "#430107" : node.kind === "control" ? "#d9c4c8" : active ? "#a77900" : "#e8c7b9";
          return (
            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`} onClick={() => finding && onSelectFinding(finding.id)} role={isFinding ? "button" : undefined} tabIndex={isFinding ? 0 : undefined} onKeyDown={(event) => { if (isFinding && (event.key === "Enter" || event.key === " ") && finding) onSelectFinding(finding.id); }} className={isFinding ? "graph-node-clickable" : undefined}>
              <rect width={boxWidth} height={boxHeight} rx="12" fill={fill} stroke={stroke} strokeWidth="1.2" />
              <text x="13" y="22" className={node.kind === "function" ? "graph-node-kicker graph-node-light" : "graph-node-kicker"}>{node.kind === "function" ? "FUNCTION" : node.kind === "control" ? `CONTROL · LINE ${node.line}` : `${finding?.rule_id || "RULE"} · LINE ${node.line}`}</text>
              <text x="13" y="43" className={node.kind === "function" ? "graph-node-label graph-node-light" : "graph-node-label"}>{truncate(node.label, node.kind === "function" ? 19 : 27)}</text>
            </g>
          );
        })}
        {!findings.length && <text x="430" y={height / 2 + 5} textAnchor="middle" className="graph-empty-label">No rule matches to map</text>}
      </svg>
    </div>
  );
}
