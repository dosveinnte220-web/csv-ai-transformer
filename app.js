const $ = (selector) => document.querySelector(selector);
const els = {
  fileInput: $("#file-input"),
  dropzone: $("#dropzone"),
  browse: $("#browse-button"),
  emptyUpload: $("#empty-upload-button"),
  fileSummary: $("#file-summary"),
  fileName: $("#file-name"),
  fileMeta: $("#file-meta"),
  removeFile: $("#remove-file"),
  instruction: $("#instruction"),
  charCount: $("#char-count"),
  planButton: $("#plan-button"),
  planButtonLabel: $("#plan-button-label"),
  exportButton: $("#export-button"),
  undoButton: $("#undo-button"),
  redoButton: $("#redo-button"),
  resetButton: $("#reset-button"),
  dataTitle: $("#dataset-title"),
  dataSubtitle: $("#dataset-subtitle"),
  dataStats: $("#data-stats"),
  rowCount: $("#row-count"),
  columnCount: $("#column-count"),
  dataFileLabel: $("#data-file-label"),
  emptyState: $("#empty-state"),
  dataTable: $("#data-table"),
  tableHead: $("#table-head"),
  tableBody: $("#table-body"),
  tableFooter: $("#table-footer"),
  tableRange: $("#table-range"),
  planPanel: $("#plan-panel"),
  planSummary: $("#plan-summary"),
  operationList: $("#operation-list"),
  previewImpact: $("#preview-impact"),
  applyButton: $("#apply-button"),
  dismissPlan: $("#dismiss-plan"),
  cancelPlan: $("#cancel-plan"),
  toast: $("#toast"),
  privacyLabel: $("#privacy-label"),
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS_IN_PREVIEW = 50;
const SAMPLE = {
  name: "customer_revenue.csv",
  headers: ["first_name", "last_name", "email", "country", "revenue", "cost"],
  rows: [
    ["Maya", "Chen", "maya.chen@example.com", "Mexico", "1250", "720"],
    ["Luis", "Ramirez", "luis.ramirez@example.com", "Mexico", "980", "510"],
    ["Amara", "Okafor", "amara.okafor@example.com", "Canada", "1480", "830"],
    ["Noah", "Williams", "noah.williams@example.com", "United States", "820", "430"],
    ["Sofia", "Martinez", "sofia.martinez@example.com", "Mexico", "1675", "920"],
    ["Maya", "Chen", "maya.chen@example.com", "Mexico", "1250", "720"],
    ["Ethan", "Park", "", "Canada", "760", "390"],
    ["Priya", "Shah", "priya.shah@example.com", "United States", "1390", "640"],
    ["Elena", "Petrova", "elena.petrova@example.com", "Mexico", "1120", "590"],
    ["Mateo", "Santos", "mateo.santos@example.com", "Brazil", "940", "480"],
    ["Zara", "Ali", "zara.ali@example.com", "Canada", "1530", "810"],
    ["Theo", "Martin", "theo.martin@example.com", "United States", "1070", "560"],
  ],
};

let dataset = null;
let original = null;
let history = [];
let historyIndex = -1;
let pending = null;
let toastTimer;

function cloneData(data) {
  return { name: data.name, headers: [...data.headers], rows: data.rows.map((row) => ({ ...row })) };
}

function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiters = [",", ";", "\t"];
  const delimiter = delimiters.map((item) => ({
    item,
    count: firstLine.split(item).length - 1,
  })).sort((a, b) => b.count - a.count)[0].item;
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      record.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(value);
      if (record.some((cell) => cell.trim() !== "")) records.push(record);
      record = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("This CSV has an unclosed quoted field.");
  record.push(value);
  if (record.some((cell) => cell.trim() !== "")) records.push(record);
  if (records.length < 2) throw new Error("Add a header row and at least one data row to your CSV.");
  const used = new Set();
  const headers = records[0].map((cell, index) => {
    const base = cell.trim() || `Column ${index + 1}`;
    let unique = base;
    let suffix = 2;
    while (used.has(unique.toLowerCase())) unique = `${base}_${suffix++}`;
    used.add(unique.toLowerCase());
    return unique;
  });
  const rows = records.slice(1).map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
  return { headers, rows };
}

function toCsv(data) {
  const quote = (value) => {
    const cell = value == null ? "" : String(value);
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
  return [data.headers.map(quote).join(","), ...data.rows.map((row) => data.headers.map((header) => quote(row[header])).join(","))].join("\r\n");
}

function setDataset(data) {
  dataset = { name: data.name, headers: [...data.headers], rows: data.rows.map((row) => ({ ...row })) };
  original = cloneData(dataset);
  history = [cloneData(dataset)];
  historyIndex = 0;
  pending = null;
  els.fileName.textContent = dataset.name;
  els.fileMeta.textContent = `${formatNumber(dataset.rows.length)} rows · ${dataset.headers.length} columns`;
  els.fileSummary.classList.remove("hidden");
  els.dropzone.classList.add("hidden");
  els.dataTitle.textContent = dataset.name;
  els.dataFileLabel.textContent = dataset.name;
  els.privacyLabel.textContent = "Private by default";
  els.exportButton.disabled = false;
  els.resetButton.disabled = false;
  els.planButton.disabled = !els.instruction.value.trim();
  els.planPanel.classList.add("hidden");
  renderTable();
  syncHistoryButtons();
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 3100);
}

function renderTable(preview = null) {
  const current = preview || dataset;
  if (!current) {
    els.emptyState.classList.remove("hidden");
    els.dataTable.classList.add("hidden");
    els.dataStats.classList.add("hidden");
    els.tableFooter.classList.add("hidden");
    els.dataSubtitle.textContent = "Upload a CSV to get started";
    return;
  }
  els.emptyState.classList.add("hidden");
  els.dataTable.classList.remove("hidden");
  els.dataStats.classList.remove("hidden");
  els.tableFooter.classList.remove("hidden");
  els.dataSubtitle.textContent = preview ? "Preview · changes not applied" : `${formatNumber(current.rows.length)} rows · ${current.headers.length} columns`;
  els.rowCount.textContent = formatNumber(current.rows.length);
  els.columnCount.textContent = formatNumber(current.headers.length);
  els.tableRange.textContent = `Showing ${formatNumber(Math.min(current.rows.length, MAX_ROWS_IN_PREVIEW))} of ${formatNumber(current.rows.length)} rows`;
  els.tableHead.replaceChildren();
  const headRow = document.createElement("tr");
  const rowNumberHead = document.createElement("th");
  rowNumberHead.className = "row-number";
  rowNumberHead.textContent = "#";
  headRow.append(rowNumberHead);
  current.headers.forEach((header) => {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.append(cell);
  });
  els.tableHead.append(headRow);
  els.tableBody.replaceChildren();
  current.rows.slice(0, MAX_ROWS_IN_PREVIEW).forEach((row, index) => {
    const tr = document.createElement("tr");
    const number = document.createElement("td");
    number.className = "row-number";
    number.textContent = String(index + 1);
    tr.append(number);
    current.headers.forEach((header) => {
      const cell = document.createElement("td");
      cell.textContent = row[header] ?? "";
      cell.title = row[header] == null ? "" : String(row[header]);
      tr.append(cell);
    });
    els.tableBody.append(tr);
  });
}

function validName(name) {
  return typeof name === "string" && name.trim().length > 0 && name.length <= 120;
}

function requireColumn(headers, value) {
  if (typeof value !== "string" || !headers.includes(value)) throw new Error(`The plan references an unknown column: ${String(value)}`);
}

function applyOperations(source, operations) {
  const result = cloneData(source);
  for (const operation of operations) {
    if (!operation || typeof operation.type !== "string") throw new Error("The transformation plan contains an invalid operation.");
    const ensureNewName = (name) => {
      if (!validName(name)) throw new Error("A new column needs a name.");
      const normalized = name.trim();
      if (result.headers.some((header) => header.toLowerCase() === normalized.toLowerCase())) throw new Error(`A column named “${normalized}” already exists.`);
      return normalized;
    };
    switch (operation.type) {
      case "rename_column": {
        requireColumn(result.headers, operation.column);
        const name = ensureNewName(operation.name);
        result.headers[result.headers.indexOf(operation.column)] = name;
        result.rows.forEach((row) => { row[name] = row[operation.column]; delete row[operation.column]; });
        break;
      }
      case "delete_column":
        requireColumn(result.headers, operation.column);
        result.headers = result.headers.filter((header) => header !== operation.column);
        result.rows.forEach((row) => { delete row[operation.column]; });
        break;
      case "combine_columns": {
        if (!Array.isArray(operation.columns) || operation.columns.length < 2) throw new Error("Choose at least two columns to combine.");
        operation.columns.forEach((column) => requireColumn(result.headers, column));
        const name = ensureNewName(operation.name);
        const separator = typeof operation.separator === "string" ? operation.separator : " ";
        result.headers.push(name);
        result.rows.forEach((row) => { row[name] = operation.columns.map((column) => row[column] ?? "").filter((value) => String(value).length).join(separator); });
        break;
      }
      case "split_column": {
        requireColumn(result.headers, operation.column);
        if (!Array.isArray(operation.names) || operation.names.length < 2) throw new Error("Splitting needs at least two output column names.");
        const names = operation.names.map(ensureNewName);
        if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error("Split output columns need unique names.");
        const separator = typeof operation.separator === "string" && operation.separator ? operation.separator : " ";
        result.headers.push(...names);
        result.rows.forEach((row) => {
          const parts = String(row[operation.column] ?? "").split(separator);
          names.forEach((name, index) => { row[name] = (index === names.length - 1 ? parts.slice(index).join(separator) : parts[index]) ?? ""; });
        });
        break;
      }
      case "formula": {
        requireColumn(result.headers, operation.left);
        requireColumn(result.headers, operation.right);
        const name = ensureNewName(operation.name);
        const operator = operation.operator;
        if (!["subtract", "add", "multiply", "divide"].includes(operator)) throw new Error("The formula uses an unsupported calculation.");
        result.headers.push(name);
        result.rows.forEach((row) => {
          const left = Number(String(row[operation.left] ?? "").replace(/[$,\s]/g, ""));
          const right = Number(String(row[operation.right] ?? "").replace(/[$,\s]/g, ""));
          if (!Number.isFinite(left) || !Number.isFinite(right) || (operator === "divide" && right === 0)) {
            row[name] = "";
            return;
          }
          row[name] = String(({ subtract: () => left - right, add: () => left + right, multiply: () => left * right, divide: () => left / right })[operator]());
        });
        break;
      }
      case "drop_missing":
        requireColumn(result.headers, operation.column);
        result.rows = result.rows.filter((row) => String(row[operation.column] ?? "").trim() !== "");
        break;
      case "drop_duplicates": {
        requireColumn(result.headers, operation.column);
        const seen = new Set();
        result.rows = result.rows.filter((row) => {
          const key = String(row[operation.column] ?? "").trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        break;
      }
      case "convert_type":
        requireColumn(result.headers, operation.column);
        if (!["number", "string"].includes(operation.to)) throw new Error("Choose a supported column type.");
        if (operation.to === "number") {
          result.rows.forEach((row) => {
            const value = String(row[operation.column] ?? "").trim().replace(/[$,\s]/g, "");
            if (!value) { row[operation.column] = ""; return; }
            const number = Number(value);
            row[operation.column] = Number.isFinite(number) ? String(number) : "";
          });
        } else {
          result.rows.forEach((row) => { row[operation.column] = String(row[operation.column] ?? ""); });
        }
        break;
      case "filter_equals":
        requireColumn(result.headers, operation.column);
        if (typeof operation.value !== "string") throw new Error("The filter needs a text value.");
        result.rows = result.rows.filter((row) => String(row[operation.column] ?? "").trim().toLowerCase() === operation.value.trim().toLowerCase());
        break;
      case "keep_columns": {
        if (!Array.isArray(operation.columns) || !operation.columns.length) throw new Error("Choose at least one column to keep.");
        operation.columns.forEach((column) => requireColumn(result.headers, column));
        const kept = [...new Set(operation.columns)];
        result.headers = result.headers.filter((header) => kept.includes(header));
        result.rows.forEach((row) => Object.keys(row).forEach((key) => { if (!kept.includes(key)) delete row[key]; }));
        break;
      }
      case "trim_whitespace":
        requireColumn(result.headers, operation.column);
        result.rows.forEach((row) => { row[operation.column] = String(row[operation.column] ?? "").trim(); });
        break;
      default:
        throw new Error(`Unsupported transformation: ${operation.type}`);
    }
  }
  return result;
}

function describeOperation(operation) {
  switch (operation.type) {
    case "rename_column": return `Rename “${operation.column}” to “${operation.name}”`;
    case "delete_column": return `Delete the “${operation.column}” column`;
    case "combine_columns": return `Combine ${operation.columns.map((column) => `“${column}”`).join(" and ")} into “${operation.name}”`;
    case "split_column": return `Split “${operation.column}” into ${operation.names.map((name) => `“${name}”`).join(" and ")}`;
    case "formula": {
      const verbs = { subtract: "subtracting", add: "adding", multiply: "multiplying", divide: "dividing" };
      return `Create “${operation.name}” by ${verbs[operation.operator] || operation.operator} “${operation.right}” ${operation.operator === "subtract" ? "from" : "with"} “${operation.left}”`;
    }
    case "drop_missing": return `Remove rows with missing values in “${operation.column}”`;
    case "drop_duplicates": return `Remove duplicate rows based on “${operation.column}”`;
    case "convert_type": return `Convert “${operation.column}” to ${operation.to === "number" ? "numbers" : "text"}`;
    case "filter_equals": return `Keep rows where “${operation.column}” is “${operation.value}”`;
    case "keep_columns": return `Keep only ${operation.columns.map((column) => `“${column}”`).join(", ")}`;
    case "trim_whitespace": return `Trim whitespace in “${operation.column}”`;
    default: return "Update your dataset";
  }
}

function saveHistory(data) {
  history = history.slice(0, historyIndex + 1);
  history.push(cloneData(data));
  historyIndex = history.length - 1;
  syncHistoryButtons();
}

function syncHistoryButtons() {
  els.undoButton.disabled = historyIndex <= 0;
  els.redoButton.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
}

function updateHistory(direction) {
  historyIndex += direction;
  dataset = cloneData(history[historyIndex]);
  pending = null;
  els.planPanel.classList.add("hidden");
  els.dataTitle.textContent = dataset.name;
  renderTable();
  els.fileMeta.textContent = `${formatNumber(dataset.rows.length)} rows · ${dataset.headers.length} columns`;
  syncHistoryButtons();
}

async function createPlan() {
  if (!dataset) { showToast("Upload a CSV or open the sample dataset first.", true); return; }
  const instruction = els.instruction.value.trim();
  if (!instruction) return;
  if (instruction.length > 500) { showToast("Keep your instruction under 500 characters.", true); return; }
  els.planButton.disabled = true;
  els.planButtonLabel.textContent = "Thinking…";
  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, columns: dataset.headers }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not generate a transformation plan.");
    if (!result.plan?.length) {
      showToast("I couldn't map that request to a supported change. Try a more specific instruction.", true);
      return;
    }
    const preview = applyOperations(dataset, result.plan);
    pending = { operations: result.plan, preview };
    renderPlan(result.source);
    renderTable(preview);
    els.planPanel.classList.remove("hidden");
    els.planPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showToast(error.message || "Could not generate the plan.", true);
  } finally {
    els.planButton.disabled = !els.instruction.value.trim();
    els.planButtonLabel.textContent = "Generate plan";
  }
}

function renderPlan(source) {
  els.operationList.replaceChildren();
  pending.operations.forEach((operation) => {
    const item = document.createElement("div");
    item.className = "operation-item";
    const check = document.createElement("span");
    check.className = "operation-check";
    check.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = describeOperation(operation);
    item.append(check, text);
    els.operationList.append(item);
  });
  const rowDifference = pending.preview.rows.length - dataset.rows.length;
  const columnDifference = pending.preview.headers.length - dataset.headers.length;
  const effects = [];
  if (rowDifference) effects.push(`${rowDifference > 0 ? "+" : ""}${formatNumber(rowDifference)} rows`);
  if (columnDifference) effects.push(`${columnDifference > 0 ? "+" : ""}${formatNumber(columnDifference)} columns`);
  els.planSummary.textContent = `${pending.operations.length} ${pending.operations.length === 1 ? "change" : "changes"} · ${source === "ai" ? "AI-generated plan" : "local plan"} · review before applying`;
  const ready = document.createElement("span");
  ready.className = "impact-pill";
  ready.textContent = "Preview ready";
  const details = document.createElement("span");
  details.textContent = effects.length ? effects.join(" · ") : `${formatNumber(pending.preview.rows.length)} rows · ${formatNumber(pending.preview.headers.length)} columns`;
  els.previewImpact.replaceChildren(ready, details);
}

function applyPlan() {
  if (!pending) return;
  dataset = cloneData(pending.preview);
  saveHistory(dataset);
  pending = null;
  els.planPanel.classList.add("hidden");
  els.dataTitle.textContent = dataset.name;
  renderTable();
  els.fileMeta.textContent = `${formatNumber(dataset.rows.length)} rows · ${dataset.headers.length} columns`;
  showToast("Changes applied. You can undo this anytime.");
}

function cancelPlan() {
  pending = null;
  els.planPanel.classList.add("hidden");
  renderTable();
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { showToast("This file is larger than 20 MB.", true); return; }
  if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") { showToast("Please choose a CSV file.", true); return; }
  try {
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length) throw new Error("This CSV needs at least one column.");
    setDataset({ name: file.name, ...parsed });
    showToast(`${file.name} is ready to transform.`);
  } catch (error) {
    showToast(error.message || "Could not read this CSV file.", true);
  }
}

function downloadCsv() {
  if (!dataset) return;
  const blob = new Blob(["\uFEFF", toCsv(dataset)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = dataset.name.replace(/\.csv$/i, "") + "_transformed.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Your transformed CSV has been downloaded.");
}

function resetDataset() {
  if (!original || historyIndex === 0) return;
  dataset = cloneData(original);
  history = [cloneData(original)];
  historyIndex = 0;
  pending = null;
  els.planPanel.classList.add("hidden");
  els.dataTitle.textContent = dataset.name;
  els.fileMeta.textContent = `${formatNumber(dataset.rows.length)} rows · ${dataset.headers.length} columns`;
  renderTable();
  syncHistoryButtons();
  showToast("Dataset reset to the uploaded file.");
}

els.browse.addEventListener("click", (event) => { event.stopPropagation(); els.fileInput.click(); });
els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); els.fileInput.click(); }
});
els.emptyUpload.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => { loadFile(event.target.files[0]); event.target.value = ""; });
els.removeFile.addEventListener("click", () => {
  dataset = null;
  original = null;
  history = [];
  historyIndex = -1;
  pending = null;
  els.fileSummary.classList.add("hidden");
  els.dropzone.classList.remove("hidden");
  els.exportButton.disabled = true;
  els.resetButton.disabled = true;
  els.planButton.disabled = true;
  els.dataTitle.textContent = "Your dataset";
  els.dataFileLabel.textContent = "";
  els.planPanel.classList.add("hidden");
  syncHistoryButtons();
  renderTable();
});
["dragenter", "dragover"].forEach((name) => els.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropzone.classList.add("dragover");
}));
["dragleave", "drop"].forEach((name) => els.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropzone.classList.remove("dragover");
}));
els.dropzone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
els.instruction.addEventListener("input", () => {
  els.charCount.textContent = `${els.instruction.value.length}/500`;
  els.planButton.disabled = !els.instruction.value.trim() || !dataset;
  if (els.instruction.value.length > 500) els.charCount.classList.add("error");
  else els.charCount.classList.remove("error");
});
els.instruction.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") createPlan();
});
els.planButton.addEventListener("click", createPlan);
document.querySelectorAll(".example-chip").forEach((button) => button.addEventListener("click", () => {
  if (!dataset) setDataset({ name: SAMPLE.name, headers: SAMPLE.headers, rows: SAMPLE.rows.map((record) => Object.fromEntries(SAMPLE.headers.map((header, index) => [header, record[index]]))) });
  els.instruction.value = button.dataset.prompt;
  els.instruction.dispatchEvent(new Event("input"));
}));
$("#sample-button").addEventListener("click", () => {
  setDataset({ name: SAMPLE.name, headers: SAMPLE.headers, rows: SAMPLE.rows.map((record) => Object.fromEntries(SAMPLE.headers.map((header, index) => [header, record[index]]))) });
  showToast("Sample data loaded. Try one of the example instructions.");
});
els.exportButton.addEventListener("click", downloadCsv);
els.undoButton.addEventListener("click", () => updateHistory(-1));
els.redoButton.addEventListener("click", () => updateHistory(1));
els.resetButton.addEventListener("click", resetDataset);
els.applyButton.addEventListener("click", applyPlan);
els.cancelPlan.addEventListener("click", cancelPlan);
els.dismissPlan.addEventListener("click", cancelPlan);
renderTable();
