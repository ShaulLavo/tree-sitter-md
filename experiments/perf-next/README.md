ASCII run batching; a line with non-ASCII or NUL uses the original scalar conversion to its end, then batching resumes.
Baseline: 680433b989ded6d633139614fd24514859200cc0
Validation: https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36274087199

Original correctness gates and comparative stress ran before branch publication. Existing baseline failures remain recorded; benchmark success is not automatic performance approval. The one-off validation workflow is deliberately not part of this branch.
