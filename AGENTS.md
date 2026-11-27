# Readability and review

Write new and modified code for a maintainer learning TypeScript.

- Use descriptive names and small, focused functions. Give intermediate values names when they help the reader follow a decision or state change.
- Show the sequence of fetching, parsing, checking errors, and updating state. Expand nested expressions and conditionals inside calls when they obscure that sequence.
- Use ordinary features such as map, spread, and optional chaining when they express intent directly. Create DOM elements and set their properties explicitly.
- Explain non-obvious choices in comments, especially state lifetime, ordering, and how a boundary supports the current slice.
- For a refactor, preserve behavior, run the relevant checks, and explain the before and after in plain English.
- Keep unrelated cleanup in separate, small PRs. Prioritize code that hides decisions, mutations, or error handling. Split work when needed to meet the 200-line review budget.

## Anthropic submissions

Use Anthropic Message Batches for evaluation runs. Before submitting, show Gabriel the model, inputs, request count, and estimated cost, then wait for his approval. Obtain approval again before resubmitting a failed batch.
