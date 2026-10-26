# AI CSV Transformer

A small, dependency-free web app for previewing and applying natural-language transformations to CSV files. CSV parsing, previews, editing history, and exports run locally in your browser. Without an AI key, the app uses a built-in instruction planner for common column and row operations.

## Run locally

Requires Node.js 18 or newer.

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173). No package installation is required.

## Optional AI planning

To use an OpenAI-compatible chat completions API for generating transformation plans, set the key and optionally a model before starting the server:

```sh
OPENAI_API_KEY=your_key OPENAI_MODEL=gpt-4o-mini npm start
```

For an OpenAI-compatible endpoint, set `OPENAI_BASE_URL` to its chat completions URL and keep the key in the server environment. The server sends the instruction and column names to the provider; CSV row data is not sent. Without `OPENAI_API_KEY`, the app uses its local planner and does not make an AI-provider request.

## Included transformations

- Rename, remove, or keep columns
- Combine columns and split a column into new columns
- Create numeric formulas (add, subtract, multiply, divide)
- Remove rows with missing values or duplicate keys
- Convert values to numbers or text
- Filter rows by an exact column value
- Trim whitespace

Review the generated plan and table preview before applying. Use undo, redo, or reset to change course, then export the current dataset as CSV.
