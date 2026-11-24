"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Bot, Send, Sparkles } from "lucide-react";
import { createAssistantReply, initialAssistantMessage } from "@/lib/assistant";
import type { AnalysisResult } from "@/lib/types";

type Message = { role: "assistant" | "user"; text: string };

export default function ReviewAssistant({ result }: { result: AnalysisResult }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const initial = useMemo(() => initialAssistantMessage(result), [result]);
  const send = () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const reply = createAssistantReply(trimmed, result);
    setMessages((current) => [...current, { role: "user", text: trimmed }, { role: "assistant", text: reply }]);
    setQuestion("");
  };
  return (
    <section className="assistant-panel">
      <div className="assistant-heading">
        <div className="assistant-icon"><Bot size={18} /></div>
        <div>
          <h3>Review assistant</h3>
          <p>Grounded in this scan · no external LLM</p>
        </div>
        <span className="assistant-live"><span /> LOCAL</span>
      </div>
      <div className="assistant-messages" aria-live="polite">
        <div className="assistant-message assistant-response"><Sparkles size={14} /> <span>{initial}</span></div>
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`assistant-message ${message.role === "user" ? "user-message" : "assistant-response"}`}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="assistant-prompts">
        <button type="button" onClick={() => setQuestion("Explain the highest-priority finding")}>Explain top finding</button>
        <button type="button" onClick={() => setQuestion("How should I fix it?")}>Suggest a fix</button>
        <button type="button" onClick={() => setQuestion("What should I review first?")}>Prioritise</button>
      </div>
      <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a rule or line…" aria-label="Ask the review assistant" />
        <button type="submit" aria-label="Send question" disabled={!question.trim()}><Send size={16} /></button>
      </form>
      <div className="assistant-footnote"><ArrowUpRight size={12} /> Explanations are rule-based guidance, not a generated security verdict.</div>
    </section>
  );
}
