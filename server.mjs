import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const allowedOperations = [
  "rename_column",
  "delete_column",
  "combine_columns",
  "split_column",
  "formula",
  "drop_missing",
  "drop_duplicates",
  "convert_type",
  "filter_equals",
  "keep_columns",
  "trim_whitespace",
];

function localPlan(instruction, columns) {
  const statements = instruction.split(/\n|;|(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);
  const plan = [];
  const findColumn = (value) => columns.find((column) => column.toLowerCase() === value.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const quoted = String.raw`["']([^"']+)["']|([A-Za-z0-9_][A-Za-z0-9 _-]*?)`;
  for (const rawStatement of statements) {
    const statement = rawStatement.replace(/[.!?]+$/, "").trim();
    let match = statement.match(new RegExp(String.raw`(?:delete|remove)\s+(?:the\s+)?(?:column\s+)?${quoted}(?:\s+column)?$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      if (column) plan.push({ type: "delete_column", column });
      continue;
    }

    match = statement.match(new RegExp(String.raw`rename\s+(?:column\s+)?${quoted}\s+to\s+["']?([^"']+?)["']?$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      const name = (match[3] || "").trim();
      if (column && name) plan.push({ type: "rename_column", column, name });
      continue;
    }

    match = statement.match(new RegExp(String.raw`(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:column\s+)?["']?([^"']+?)["']?(?:\s+column)?\s+by\s+subtract(?:ing)?\s+${quoted}\s+from\s+${quoted}$`, "i"));
    if (match) {
      const output = match[1].trim();
      const left = findColumn(match[4] || match[5]);
      const right = findColumn(match[2] || match[3]);
      if (output && left && right) plan.push({ type: "formula", name: output, left, right, operator: "subtract" });
      continue;
    }

    match = statement.match(new RegExp(String.raw`(?:create|add|combine)\s+(?:a\s+)?(?:new\s+)?(?:column\s+)?${quoted}(?:\s+column)?\s+(?:by\s+)?combining\s+${quoted}\s+(?:and|with)\s+${quoted}$`, "i"));
    if (match) {
      const name = (match[1] || match[2] || "").trim();
      const first = findColumn(match[3] || match[4]);
      const second = findColumn(match[5] || match[6]);
      if (name && first && second) plan.push({ type: "combine_columns", columns: [first, second], name, separator: " " });
      continue;
    }

    match = statement.match(new RegExp(String.raw`combine\s+${quoted}\s+and\s+${quoted}\s+into\s+["']?([^"']+?)["']?$`, "i"));
    if (match) {
      const first = findColumn(match[1] || match[2]);
      const second = findColumn(match[3] || match[4]);
      const name = (match[5] || "").trim();
      if (first && second && name) plan.push({ type: "combine_columns", columns: [first, second], name, separator: " " });
      continue;
    }

    match = statement.match(new RegExp(String.raw`split\s+${quoted}(?:\s+column)?\s+into\s+["']?([^,"']+?)["']?\s+and\s+["']?([^,"']+?)["']?$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      const outputs = [(match[3] || "").trim(), (match[4] || "").trim()];
      if (column && outputs.every(Boolean)) plan.push({ type: "split_column", column, names: outputs, separator: " " });
      continue;
    }

    match = statement.match(new RegExp(String.raw`remove\s+(?:rows|records)\s+with\s+missing\s+(?:values?\s+in\s+)?${quoted}(?:\s+addresses?)?$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      if (column) plan.push({ type: "drop_missing", column });
      continue;
    }

    match = statement.match(new RegExp(String.raw`remove\s+duplicates?(?:\s+customers?)?\s+based\s+on\s+${quoted}$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      if (column) plan.push({ type: "drop_duplicates", column });
      continue;
    }

    match = statement.match(new RegExp(String.raw`convert\s+${quoted}(?:\s+column)?\s+to\s+(?:numbers?|numeric)$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      if (column) plan.push({ type: "convert_type", column, to: "number" });
      continue;
    }

    match = statement.match(new RegExp(String.raw`keep\s+only\s+rows?\s+where\s+${quoted}\s+(?:is|equals?)\s+["']?([^"']+?)["']?$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      const value = (match[3] || "").trim();
      if (column && value) plan.push({ type: "filter_equals", column, value });
      continue;
    }

    match = statement.match(new RegExp(String.raw`trim\s+(?:whitespace|spaces)\s+(?:in\s+)?${quoted}$`, "i"));
    if (match) {
      const column = findColumn(match[1] || match[2]);
      if (column) plan.push({ type: "trim_whitespace", column });
      continue;
    }

    match = statement.match(/keep only columns?\s+(.+)$/i);
    if (match) {
      const requested = match[1].split(/,|\s+and\s+/i).map((item) => item.trim().replace(/^["']|["']$/g, ""));
      const selected = requested.map(findColumn).filter(Boolean);
      if (selected.length) plan.push({ type: "keep_columns", columns: selected });
    }
  }
  return plan;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function generatePlan(instruction, columns) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { plan: localPlan(instruction, columns), source: "local" };

  const response = await fetch(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Translate a CSV editing request into a JSON object: {"operations":[...]}. Allowed operation types: ${allowedOperations.join(", ")}. Use only exact column names from the supplied schema. Operation shapes: rename_column {column,name}; delete_column {column}; combine_columns {columns:[...],name,separator}; split_column {column,names:[...],separator}; formula {name,left,right,operator:"subtract"|"add"|"multiply"|"divide"}; drop_missing {column}; drop_duplicates {column}; convert_type {column,to:"number"|"string"}; filter_equals {column,value}; keep_columns {columns:[...]}; trim_whitespace {column}. Do not invent columns. If ambiguous or unsupported, return {"operations":[]}.`,
        },
        { role: "user", content: JSON.stringify({ instruction, columns }) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`AI provider returned ${response.status}: ${details.slice(0, 300)}`);
  }
  const result = await response.json();
  let parsed;
  try {
    parsed = JSON.parse(result.choices?.[0]?.message?.content || "");
  } catch {
    throw new Error("AI provider returned an invalid transformation plan.");
  }
  if (!Array.isArray(parsed.operations)) throw new Error("AI provider response did not include an operations list.");
  return { plan: parsed.operations.filter((operation) => allowedOperations.includes(operation?.type)), source: "ai" };
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/plan") {
    try {
      const body = await parseBody(request);
      if (typeof body.instruction !== "string" || !body.instruction.trim() || !Array.isArray(body.columns)) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Provide an instruction and a list of column names." }));
        return;
      }
      const { plan, source } = await generatePlan(body.instruction, body.columns);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ plan, source }));
    } catch (error) {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message || "Unable to create a transformation plan." }));
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }
  let requestedPath;
  try {
    requestedPath = request.url === "/" ? "/index.html" : decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid URL");
    return;
  }
  const filePath = normalize(join(root, requestedPath));
  if (filePath !== root && !filePath.startsWith(`${root}/`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`AI CSV Transformer is running at http://localhost:${port}`);
});
