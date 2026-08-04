const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { log } = require("./utils/plugin");

const PERMISSIONS = [
  { name: "只读", short: "READ", sandbox: "read-only", approval: "untrusted", color: "#65a7ff" },
  { name: "工作区", short: "AUTO", sandbox: "workspace-write", approval: "on-request", color: "#64d98b" },
  { name: "完全访问", short: "FULL", sandbox: "danger-full-access", approval: "never", color: "#ff6b78" }
];

class CodexClient {
  constructor(options = {}) {
    this.codexPath = options.codexPath || findCodex();
    this.authPath = options.authPath || defaultAuthPath();
    this.authFingerprint = readAuthFingerprint(this.authPath);
    this.proc = null;
    this.starting = null;
    this.accountTransition = null;
    this.accountDirty = false;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.models = [];
    this.config = {};
    this.threads = [];
    this.rateLimits = null;
  }

  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess();
    try {
      await this.starting;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      this.starting = null;
    }
  }

  async startProcess() {
    if (this.proc) return;
    const proc = spawn(this.codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsHide: true
    });
    this.proc = proc;
    proc.on("error", error => this.failAll(error));
    proc.on("exit", (code, signal) => {
      if (this.proc !== proc) return;
      const error = new Error(`codex app-server exited (${code ?? signal})`);
      this.proc = null;
      this.ready = false;
      this.failAll(error);
    });
    proc.stderr.on("data", data => log.info("codex", data.toString().trim()));
    readline.createInterface({ input: proc.stdout }).on("line", line => this.onLine(line));
    await this.request("initialize", {
      clientInfo: { name: "streamdock_vibe_control", title: "StreamDock Vibe Control", version: "0.8.3" },
      capabilities: { experimentalApi: true }
    });
    this.notify("initialized", {});
    this.ready = true;
    await this.refreshStatic();
    this.authFingerprint = readAuthFingerprint(this.authPath);
    this.accountDirty = false;
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    this.failAll(new Error("Codex app-server stopped"));
    if (proc) proc.kill();
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result);
    }
    if (message.method === "account/rateLimits/updated") {
      this.rateLimits = mergeRateLimitUpdate(this.rateLimits, message.params?.rateLimits);
    }
    if (message.method === "account/updated" || message.method === "account/login/completed") {
      // The app-server can observe an account change before the next timer
      // tick. Drop the previous account's Usage immediately and reload model
      // entitlements on the next request.
      this.rateLimits = null;
      this.accountDirty = true;
    }
  }

  send(message) {
    if (!this.proc?.stdin.writable) throw new Error("Codex app-server is not running");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMs = method === "thread/list" ? 30000 : 12000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(params === undefined ? { method, id } : { method, id, params });
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  failAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  async refreshStatic() {
    const [modelResult, configResult] = await Promise.all([
      this.request("model/list", { limit: 100, includeHidden: false }),
      this.request("config/read", { includeLayers: false })
    ]);
    this.models = (modelResult.data || []).filter(model => !model.hidden);
    this.config = configResult.config || {};
  }

  async ensureCurrentAccount() {
    if (!this.ready) await this.start();
    if (this.accountTransition) return this.accountTransition;

    const nextFingerprint = readAuthFingerprint(this.authPath);
    if (nextFingerprint !== this.authFingerprint) {
      this.accountTransition = (async () => {
        log.info("Codex account changed; restarting app-server");
        this.clearAccountCaches();
        this.stop();
        await this.start();
        return true;
      })();
      try {
        return await this.accountTransition;
      } finally {
        this.accountTransition = null;
      }
    }

    if (this.accountDirty) {
      this.clearAccountCaches();
      await this.refreshStatic();
      this.accountDirty = false;
      this.authFingerprint = nextFingerprint;
      return true;
    }
    return false;
  }

  clearAccountCaches() {
    this.models = [];
    this.config = {};
    this.threads = [];
    this.rateLimits = null;
  }

  async refresh() {
    await this.ensureCurrentAccount();
    const [threadResult, configResult] = await Promise.all([
      this.request("thread/list", {
        limit: 16,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        useStateDbOnly: true
      }),
      this.request("config/read", { includeLayers: false })
    ]);
    this.threads = (threadResult.data || []).filter(thread => !thread.parentThreadId).map(thread => ({
      ...thread,
      displayStatus: inferThreadStatus(thread)
    }));
    this.config = configResult.config || {};
    return this.snapshot();
  }

  async refreshUsage() {
    await this.ensureCurrentAccount();
    this.rateLimits = await this.request("account/rateLimits/read");
    return extractUsageWindows(this.rateLimits);
  }

  snapshot() {
    return {
      models: this.models,
      config: this.config,
      threads: this.threads,
      usage: extractUsageWindows(this.rateLimits)
    };
  }

  currentModel() {
    const id = this.config.model || this.models.find(model => model.isDefault)?.model || this.models[0]?.model;
    return this.models.find(model => model.model === id) || this.models[0] || null;
  }

  currentEffort() {
    const model = this.currentModel();
    return this.config.model_reasoning_effort || model?.defaultReasoningEffort || "medium";
  }

  solModel() {
    return this.models.find(model => model.model === "gpt-5.6-sol")
      || this.models.find(model => /(?:^|[-\s])sol(?:$|[-\s])/i.test(`${model.model} ${model.displayName || ""}`))
      || null;
  }

  currentSolEffort() {
    const model = this.solModel();
    const efforts = (model?.supportedReasoningEfforts || []).map(item => item.reasoningEffort);
    const configured = this.config.model_reasoning_effort;
    return efforts.includes(configured) ? configured : (model?.defaultReasoningEffort || "medium");
  }

  currentPermissionIndex() {
    const sandbox = this.config.sandbox_mode;
    const index = PERMISSIONS.findIndex(item => item.sandbox === sandbox);
    return index >= 0 ? index : 1;
  }

  async rotateEffort(ticks) {
    const model = this.currentModel();
    const values = (model?.supportedReasoningEfforts || []).map(item => item.reasoningEffort);
    const efforts = values.length ? values : ["low", "medium", "high", "xhigh"];
    const current = Math.max(0, efforts.indexOf(this.currentEffort()));
    const next = efforts[wrap(current + Math.sign(ticks), efforts.length)];
    await this.writeConfig([{ keyPath: "model_reasoning_effort", value: next }]);
    this.config.model_reasoning_effort = next;
    return next;
  }

  async rotateModel(ticks) {
    if (!this.models.length) await this.refreshStatic();
    const currentId = this.currentModel()?.model;
    const current = Math.max(0, this.models.findIndex(model => model.model === currentId));
    const model = this.models[wrap(current + Math.sign(ticks), this.models.length)];
    const supported = model.supportedReasoningEfforts.map(item => item.reasoningEffort);
    const effort = supported.includes(this.currentEffort()) ? this.currentEffort() : model.defaultReasoningEffort;
    await this.writeConfig([
      { keyPath: "model", value: model.model },
      { keyPath: "model_reasoning_effort", value: effort }
    ]);
    this.config.model = model.model;
    this.config.model_reasoning_effort = effort;
    return model;
  }

  async rotateSolEffort(ticks) {
    if (!this.models.length) await this.refreshStatic();
    const model = this.solModel();
    if (!model) throw new Error("当前 Codex 账号没有可用的 Sol 模型");
    const efforts = (model.supportedReasoningEfforts || []).map(item => item.reasoningEffort);
    if (!efforts.length) throw new Error("Sol 没有可用的推理层级");
    const current = Math.max(0, efforts.indexOf(this.currentSolEffort()));
    const effort = efforts[wrap(current + Math.sign(ticks), efforts.length)];
    await this.writeConfig([
      { keyPath: "model", value: model.model },
      { keyPath: "model_reasoning_effort", value: effort }
    ]);
    this.config.model = model.model;
    this.config.model_reasoning_effort = effort;
    return { model, effort };
  }

  async rotatePermission(ticks) {
    const nextIndex = wrap(this.currentPermissionIndex() + Math.sign(ticks), PERMISSIONS.length);
    const permission = PERMISSIONS[nextIndex];
    await this.writeConfig([
      { keyPath: "sandbox_mode", value: permission.sandbox },
      { keyPath: "approval_policy", value: permission.approval }
    ]);
    this.config.sandbox_mode = permission.sandbox;
    this.config.approval_policy = permission.approval;
    return permission;
  }

  async writeConfig(edits) {
    await this.request("config/batchWrite", {
      edits: edits.map(edit => ({ ...edit, mergeStrategy: "upsert" })),
      reloadUserConfig: true
    });
  }

}

function findCodex() {
  const home = os.homedir();
  const candidates = [
    process.env.CODEX_PATH,
    path.join(home, ".local/share/fnm/aliases/default/bin/codex"),
    path.join(home, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  return "codex";
}

function defaultAuthPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

function readAuthFingerprint(authPath = defaultAuthPath()) {
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const accountId = auth.tokens?.account_id
      || auth.account_id
      || auth.chatgpt_account_id
      || null;
    const apiKey = typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : null;
    return JSON.stringify({
      authMode: auth.auth_mode || null,
      accountId,
      apiKey: apiKey ? createHash("sha256").update(apiKey).digest("hex") : null
    });
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    try {
      const stat = fs.statSync(authPath);
      return `invalid:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return "missing";
    }
  }
}

function inferThreadStatus(thread) {
  if (thread.status?.type && thread.status.type !== "notLoaded") {
    const flags = thread.status.activeFlags || [];
    if (flags.some(flag => ["waitingOnApproval", "waitingOnUserInput", "needsInput"].includes(flag))) {
      return { type: "needsInput", activeFlags: flags };
    }
    return thread.status;
  }
  if (!thread.path) return { type: "idle" };
  try {
    const fd = fs.openSync(thread.path, "r");
    const stat = fs.fstatSync(fd);
    const chunkSize = 131072;
    const maxScan = Math.min(stat.size, 8 * 1024 * 1024);
    let scanned = 0;
    let turnComplete = false;
    let completionEventKey = null;
    let assistantQuestion = false;
    let assistantSeen = false;
    let sawActivity = false;
    const completedCalls = new Set();
    while (scanned < maxScan) {
      const length = Math.min(chunkSize, maxScan - scanned);
      const position = stat.size - scanned - length;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, position);
      const lines = buffer.toString("utf8").split("\n").reverse();
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          const payload = record.payload || {};
          if (["response_item", "turn_context"].includes(record.type)) sawActivity = true;
          if (record.type === "response_item") {
            if (["function_call_output", "custom_tool_call_output"].includes(payload.type) && payload.call_id) {
              completedCalls.add(payload.call_id);
            }
            if (
              ["function_call", "custom_tool_call"].includes(payload.type)
              && payload.name === "request_user_input"
              && !completedCalls.has(payload.call_id)
            ) {
              fs.closeSync(fd);
              return { type: "needsInput", reason: "question", eventKey: payload.call_id || record.timestamp };
            }
            if (turnComplete && payload.type === "message" && payload.role === "assistant" && !assistantSeen) {
              assistantSeen = true;
              assistantQuestion = messageEndsWithQuestion(payload.content);
            }
          }
          if (record.type !== "event_msg") continue;
          const event = payload.type;
          if (!["task_complete", "turn_aborted", "error"].includes(event)) sawActivity = true;
          if (event === "task_started") {
            fs.closeSync(fd);
            if (assistantQuestion) return { type: "needsInput", reason: "question", eventKey: completionEventKey };
            return turnComplete
              ? { type: "idle", eventKey: completionEventKey }
              : { type: "active", activeFlags: [] };
          }
          if (event === "task_complete") {
            turnComplete = true;
            completionEventKey = record.timestamp || line;
            continue;
          }
          if (["turn_aborted", "error"].includes(event)) {
            fs.closeSync(fd);
            return { type: "systemError" };
          }
        } catch {}
      }
      scanned += length;
    }
    fs.closeSync(fd);
    if (assistantQuestion) return { type: "needsInput", reason: "question", eventKey: completionEventKey };
    if (turnComplete) return { type: "idle", eventKey: completionEventKey };
    return sawActivity ? { type: "active", activeFlags: [] } : { type: "idle" };
  } catch {
    return { type: "notLoaded" };
  }
}

function messageEndsWithQuestion(content) {
  const text = (content || [])
    .filter(item => ["output_text", "text"].includes(item.type))
    .map(item => item.text || "")
    .join("\n")
    .trim();
  return /[?？]\s*$/.test(text);
}

function extractUsageWindows(result) {
  const snapshots = [];
  // `rateLimits` and the `codex` entry are the account's canonical Codex
  // window. Model-specific entries (for example codex_bengalfox) can have the
  // same weekly duration but legitimately report 0%, so they must not win
  // based on object insertion order.
  if (result?.rateLimits) snapshots.push(result.rateLimits);
  if (result?.rateLimitsByLimitId?.codex) snapshots.push(result.rateLimitsByLimitId.codex);
  if (result?.rateLimitsByLimitId) {
    snapshots.push(...Object.entries(result.rateLimitsByLimitId)
      .filter(([id]) => id !== "codex")
      .map(([, snapshot]) => snapshot));
  }
  const windows = [];
  for (const snapshot of snapshots) {
    for (const window of [snapshot?.primary, snapshot?.secondary]) {
      if (!window?.windowDurationMins) continue;
      if (!windows.some(item => item.windowDurationMins === window.windowDurationMins)) windows.push(window);
    }
  }
  const fiveHour = windows
    .filter(item => item.windowDurationMins <= 600)
    .sort((a, b) => Math.abs(a.windowDurationMins - 300) - Math.abs(b.windowDurationMins - 300))[0] || null;
  const week = windows
    .filter(item => item.windowDurationMins > 600)
    .sort((a, b) => Math.abs(a.windowDurationMins - 10080) - Math.abs(b.windowDurationMins - 10080))[0] || null;
  return { fiveHour, week };
}

function mergeRateLimitUpdate(current, update) {
  if (!current || !update) return current;
  return { ...current, rateLimits: { ...(current.rateLimits || {}), ...update } };
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

module.exports = {
  CodexClient,
  PERMISSIONS,
  extractUsageWindows,
  inferThreadStatus,
  findCodex,
  readAuthFingerprint
};
