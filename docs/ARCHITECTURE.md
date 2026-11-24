# Architecture notes

## Product services

```text
Browser
  └── Next.js UI (Vercel)
       ├── CodeMirror source editor
       ├── Findings + evidence view
       ├── Lexical relationship map
       ├── Rule-grounded Review Assistant
       └── Explicit browser-local history
             │ HTTPS JSON REST
             ▼
       FastAPI service (Render)
         ├── request validation and rate limit
         ├── lightweight C/C++ function scanner
         ├── transparent static rule engine
         ├── lexical control-context mapping
         └── model-info endpoint (research metadata only)
```

## Active engine vs research model

The active engine is intentionally checkpoint-free. It uses regular expressions and a lexical brace/token scanner to identify ordinary function definitions, apply documented rules and map each finding to its nearest enclosing `if`, `for`, `while` or `switch` block when that block can be identified. The graph is a user-facing relationship hint only. It is not a Joern-generated control-dependency graph, and it does not establish a data-flow edge.

The actual research model is described separately:

1. CodeBERT (`microsoft/codebert-base`) encodes up to 256 BPE tokens into 768-dimensional token states and a pooled semantic representation.
2. Joern 1.1.260 builds a control-dependency graph over the full function.
3. Each statement node receives 32-dimensional VASF features: 10 operator categories, 8 selected-call indicators, 8 memory-access patterns and 6 branch-depth levels.
4. A projection maps nodes to 128 dimensions; three four-head GATv2 layers create node states and a 256-dimensional graph readout.
5. The graph readout and mean VASF vector form a structural query over CodeBERT token states using eight-head attention.
6. An input-dependent gate mixes the pooled CodeBERT vector and attended token result. A direct semantic residual remains available to the classifier.
7. ExplBridge assigns token scores with a learned two-layer scorer and forms a 128-dimensional weighted token summary that is part of the prediction path.
8. The classifier receives a 640-dimensional vector and uses a fixed 0.50 threshold for binary classification.

The thesis reports 7.1M additional parameters and 3.5× CodeBERT end-to-end latency. The active static engine does not reproduce any of these learned computations.

## Risk index semantics

For the static review engine, each unique triggered rule contributes its declared weight. The sum is capped at 100. The severity and weight values are application-level triage metadata. They are not the thesis classifier's probability, CVSS, or an empirically calibrated likelihood of exploitation.

## Source retention

The backend keeps no persistent source store. Browser-local history is opt-in. Source code is excluded from a saved record unless the user checks the explicit inclusion control. Browser storage is not encrypted application storage; users should not save confidential source code on shared devices.
