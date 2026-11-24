# Thesis-to-product traceability

This table distinguishes what the application documents from what it currently executes.

| Thesis element | Thesis description | Current application status |
|---|---|---|
| CodeBERT semantic encoder | `microsoft/codebert-base`, 256 BPE tokens, 768 hidden dimensions | Documented in Model Architecture; not loaded or executed |
| Control-dependency graph | Joern 1.1.260 CDG over the full function | Not implemented in active engine; current context map is lexical containment only |
| VASF | 32 dimensions: 10 operator categories, 8 selected-call flags, 8 memory-access patterns, 6 branch-depth levels | Feature groups documented; no VASF tensor is generated |
| GATv2 | Three four-head layers; projected node states and graph readout | Documented; no graph neural network is loaded |
| Cross-modal attention | Structural query attends over CodeBERT token states | Documented; not executed |
| Gated fusion | Input-dependent gate combines pooled semantic and attended token features | Documented; not executed |
| Residual semantic path | Direct semantic bypass remains available to the classifier | Documented; not executed |
| ExplBridge | Learned token scorer; weighted token summary participates in prediction | Not executed; source markers are rule-matched lines, not token attributions |
| Binary classifier | 640-dimensional classifier input; fixed threshold 0.50 | Thesis configuration documented; no ExHyGLL probability returned |
| Research metrics | BigVul, Devign, DiverseVul and PrimeVul results | Displayed as thesis-reported results, never as live application metrics |

## Research metrics shown in the application

- BigVul project-grouped evaluation: F1 0.7939 versus LineVul 0.7892; the thesis reports that paired tests do not establish a statistically significant difference.
- Devign holdout after matched CodeLLMExp adaptation: F1 0.6778 and MCC 0.4087; the thesis reports a positive paired difference across ten matched seeds against its SV-GEN re-implementation (Holm-adjusted p = 0.0078).
- DiverseVul: F1 0.6471.
- PrimeVul-derived subset: F1 0.6605; the thesis notes the margin is small and the comparison is not directly comparable with published numbers.

These values are experiment results from the supplied thesis, not the result of analyzing a user's source file.

## Required artifacts for trained inference

1. Exact trained ExHyGLL checkpoint, including the trained CodeBERT fine-tuning and all newly trained GATv2, fusion, ExplBridge and classifier weights.
2. Exact source implementation for preprocessing and the two-stage inference path.
3. Joern 1.1.260 setup/runner and exact CDG extraction settings.
4. Exact VASF implementation and feature ordering/scaling.
5. Tokenizer/configuration, label mapping, model version and threshold metadata.
6. A reproducibility test set or archived expected outputs to validate that the deployed inference matches the thesis implementation.

The thesis PDF documents architecture and results but does not itself contain the checkpoint or complete implementation source. The deployment package therefore does not invent or reconstruct missing weights.
