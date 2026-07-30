const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLAUDE_MODELS = ["sonnet", "opus", "fable", "haiku"];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

class ClaudeClient {
  constructor(options = {}) {
    this.home = options.home || os.homedir();
    this.settingsPath = options.settingsPath || path.join(this.home, ".claude", "settings.json");
    this.projectsPath = options.projectsPath || path.join(this.home, ".claude", "projects");
    this.usagePath = options.usagePath || defaultUsagePath(this.home);
    this.helperPath = options.helperPath || path.join(__dirname, "claude-status.js");
    this.threads = [];
    this.config = { model: "sonnet", effort: "high" };
    this.usage = { fiveHour: null, week: null };
  }

  refresh(limit = 16) {
    this.threads = scanSessions(this.projectsPath, limit);
    this.config = readConfiguration(this.settingsPath);
    this.usage = readUsage(this.usagePath);
    return this.snapshot();
  }

  refreshUsage() {
    this.usage = readUsage(this.usagePath);
    return this.usage;
  }

  snapshot() {
    return {
      threads: this.threads,
      config: this.config,
      usage: this.usage
    };
  }

  currentModel() {
    return this.config.model || "sonnet";
  }

  currentEffort() {
    return this.config.effort || "high";
  }

  rotateModel(ticks) {
    const choices = [...new Set([this.currentModel(), ...CLAUDE_MODELS])];
    const current = Math.max(0, choices.indexOf(this.currentModel()));
    const model = choices[wrap(current + Math.sign(ticks), choices.length)];
    writeSetting(this.settingsPath, "model", model);
    this.config.model = model;
    return model;
  }

  rotateEffort(ticks) {
    const current = Math.max(0, CLAUDE_EFFORTS.indexOf(this.currentEffort()));
    const effort = CLAUDE_EFFORTS[wrap(current + Math.sign(ticks), CLAUDE_EFFORTS.length)];
    writeSetting(this.settingsPath, "effortLevel", effort);
    this.config.effort = effort;
    return effort;
  }

  installUsageCapture() {
    const settings = readJSON(this.settingsPath);
    const status = settings.statusLine && typeof settings.statusLine === "object"
      ? { ...settings.statusLine }
      : {};
    const current = typeof status.command === "string" ? status.command : "";
    if (current.includes("claude-status.js")) return false;
    const encoded = Buffer.from(current, "utf8").toString("base64");
    status.type = "command";
    status.command = [
      quoteCommandArg(process.execPath),
      quoteCommandArg(this.helperPath),
      "--next-base64",
      quoteCommandArg(encoded)
    ].join(" ");
    if (status.padding == null) status.padding = 0;
    settings.statusLine = status;
    writeJSON(this.settingsPath, settings);
    return true;
  }

  usageCaptureInstalled() {
    return String(readJSON(this.settingsPath).statusLine?.command || "").includes("claude-status.js");
  }
}

function scanSessions(root, limit = 16) {
  if (!existsDirectory(root)) return [];
  return listJSONL(root)
    .map(file => ({ file, modified: safeStat(file)?.mtimeMs || 0 }))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, Math.max(limit * 2, 24))
    .map(parseSession)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

function parseSession({ file, modified }) {
  let content;
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 1024 * 1024);
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    fs.closeSync(fd);
    content = buffer.toString("utf8");
    if (stat.size > size) content = content.slice(content.indexOf("\n") + 1);
  } catch {
    return null;
  }

  let cwd = "";
  let title = "";
  let fallback = "";
  let state = "idle";
  let assistantText = "";
  for (const line of content.split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.cwd) cwd = record.cwd;
    if (record.type === "ai-title" && record.aiTitle) title = record.aiTitle;
    if (record.type === "agent-name" && !title && record.agentName) title = record.agentName;
    if (record.type === "last-prompt" && record.lastPrompt) fallback = record.lastPrompt;
    if (record.type === "user" && !record.isMeta) state = "active";
    if (record.type !== "assistant") continue;
    if (record.isApiErrorMessage || record.error) {
      state = "systemError";
      continue;
    }
    const message = record.message || {};
    const items = Array.isArray(message.content) ? message.content : [];
    const toolUses = items.filter(item => item.type === "tool_use");
    const asksUser = toolUses.some(item => ["AskUserQuestion", "ask_user_question"].includes(item.name));
    const text = items.filter(item => item.type === "text").map(item => item.text || "").join("\n").trim();
    if (text) assistantText = text;
    if (asksUser) state = "needsInput";
    else if (toolUses.length) state = "active";
    else if (message.stop_reason) state = /[?？]\s*$/.test(assistantText) ? "needsInput" : "idle";
    else state = "active";
  }
  if (state === "active" && Date.now() - modified > 5 * 60 * 1000) state = "idle";
  return {
    id: path.basename(file, ".jsonl"),
    name: title || fallback || "Claude 任务",
    cwd,
    updatedAt: modified,
    provider: "claude",
    displayStatus: { type: state }
  };
}

function readConfiguration(settingsPath) {
  const settings = readJSON(settingsPath);
  return {
    model: typeof settings.model === "string" && settings.model ? settings.model : "sonnet",
    effort: typeof settings.effortLevel === "string" && settings.effortLevel ? settings.effortLevel : "high"
  };
}

function writeSetting(settingsPath, key, value) {
  const settings = readJSON(settingsPath);
  settings[key] = value;
  writeJSON(settingsPath, settings);
}

function readUsage(usagePath) {
  const limits = readJSON(usagePath).rate_limits || {};
  return {
    fiveHour: usageWindow(limits.five_hour, 300),
    week: usageWindow(limits.seven_day, 10080)
  };
}

function usageWindow(value, duration) {
  const percent = Number(value?.used_percentage);
  if (!Number.isFinite(percent)) return null;
  const resetsAt = Number(value?.resets_at);
  return {
    usedPercent: percent,
    windowDurationMins: duration,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null
  };
}

function defaultUsagePath(home) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Vibe Float", "claude-status.json");
  }
  return path.join(home, "Library", "Application Support", "Vibe Float", "claude-status.json");
}

function listJSONL(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
    }
  }
  return files;
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.vibe-float-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function existsDirectory(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function safeStat(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function quoteCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

module.exports = {
  ClaudeClient,
  CLAUDE_MODELS,
  CLAUDE_EFFORTS,
  scanSessions,
  parseSession,
  readConfiguration,
  readUsage
};
