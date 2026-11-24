"use client";

import CodeMirror from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
};

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "#1d0a12", color: "#f8eef1", fontSize: "13px" },
  ".cm-gutters": { backgroundColor: "#1d0a12", color: "#8c6c78", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.035)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.035)" },
  ".cm-cursor": { borderLeftColor: "#ffca05" },
  ".cm-selectionBackground": { backgroundColor: "rgba(255,202,5,0.18) !important" },
  ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.7" }
});

export default function CodeEditor({ value, onChange, placeholder = "Paste a complete C or C++ function here…", readOnly = false, minHeight = "360px" }: Props) {
  return (
    <div className="code-editor-shell" style={{ minHeight }}>
      <CodeMirror
        value={value}
        height={minHeight}
        theme={oneDark}
        extensions={[cpp(), editorTheme]}
        onChange={onChange}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true
        }}
        placeholder={placeholder}
        aria-label="C or C++ source code editor"
      />
    </div>
  );
}
