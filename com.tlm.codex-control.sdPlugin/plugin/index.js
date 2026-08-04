const { Plugins, Actions, log } = require("./utils/plugin");
const { CodexClient, PERMISSIONS } = require("./codex-client");
const { ClaudeClient } = require("./claude-client");
const {
  taskCard,
  codexTaskProvider,
  usageCard,
  modelCard,
  permissionCard,
  valueCard,
  errorCard,
  effortColor
} = require("./render");
const { collectStatusNotifications, formatStatusNotification } = require("./notifications");
const { openAgentSession } = require("./terminal-router");
const { spawn } = require("node:child_process");

const plugin = new Plugins();
let eventRefreshTimer = null;
function scheduleEventRefresh() {
  if (eventRefreshTimer) return;
  eventRefreshTimer = setTimeout(() => {
    eventRefreshTimer = null;
    refresh();
  }, 120);
}
function makeCodexClient(options = {}) {
  return new CodexClient({ ...options, onThreadEvent: scheduleEventRefresh });
}
let codex = makeCodexClient();
const claude = new ClaudeClient();
let snapshot = {
  threads: [],
  usage: {},
  models: [],
  config: {},
  claude: { threads: [], usage: {}, config: { model: "sonnet", effort: "high" } }
};
let refreshTimer = null;
let refreshInFlight = null;
let usageTimer = null;
let usageInFlight = null;
const visible = new Map();
const threadStatusCache = new Map();
const claudeStatusCache = new Map();
const CLAUDE_TYPES = new Set([
  "claudetask", "claudemodel", "claudeeffort", "claudeusage5h", "claudeusageweek"
]);

function isClaudeType(type) {
  return CLAUDE_TYPES.has(type);
}

function hasVisibleCodexAction() {
  return [...visible.values()].some(item => !isClaudeType(item.type));
}

function hasVisibleClaudeAction() {
  return [...visible.values()].some(item => isClaudeType(item.type));
}

async function ensureStarted() {
  if (!codex.ready) await codex.start();
}

async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    if (hasVisibleClaudeAction()) {
      try {
        snapshot = { ...snapshot, claude: claude.refresh() };
      } catch (error) {
        log.error("Claude refresh failed", error);
      }
    }
    try {
      if (hasVisibleCodexAction()) {
        await ensureStarted();
        snapshot = { ...snapshot, ...(await codex.refresh()) };
      }
    } catch (error) {
      log.error("refresh failed", error);
      // A busy Codex state database can make one refresh slow. Keep the last
      // valid device images instead of incorrectly reporting a disconnect.
      if (!snapshot.threads.length && !snapshot.models.length) {
        for (const [context, item] of visible.entries()) {
          if (!isClaudeType(item.type)) plugin.setImage(context, errorCard(error.message));
        }
      }
    } finally {
      notifyStatusChanges();
      renderAll();
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  clearInterval(usageTimer);
  refreshTimer = setInterval(refresh, 800);
  usageTimer = setInterval(refreshUsage, 3000);
  refresh();
  refreshUsage();
}

async function refreshUsage() {
  if (usageInFlight) return usageInFlight;
  usageInFlight = (async () => {
    if (hasVisibleClaudeAction()) {
      try {
        snapshot = {
          ...snapshot,
          claude: { ...snapshot.claude, usage: claude.refreshUsage() }
        };
        for (const [context, item] of visible.entries()) {
          if (item.type === "claudeusage5h" || item.type === "claudeusageweek") renderOne(context);
        }
      } catch (error) {
        log.error("Claude usage refresh failed", error);
      }
    }
    try {
      if (hasVisibleCodexAction()) {
        await ensureStarted();
        snapshot = { ...snapshot, usage: await codex.refreshUsage() };
        for (const [context, item] of visible.entries()) {
          if (item.type === "usage5h" || item.type === "usageweek") renderOne(context);
        }
      }
    } catch (error) {
      log.error("usage refresh failed", error);
    } finally {
      usageInFlight = null;
    }
  })();
  return usageInFlight;
}

function remember(type, context, settings = {}) {
  visible.set(context, { type, settings });
  renderOne(context);
  scheduleRefresh();
}

function forget(context) {
  visible.delete(context);
  if (!visible.size) {
    clearInterval(refreshTimer);
    clearInterval(usageTimer);
    refreshTimer = null;
    usageTimer = null;
  }
}

function renderOne(context) {
  const item = visible.get(context);
  if (!item) return;
  let image;
  if (item.type === "task") {
    const thread = snapshot.threads[item.settings.slot || 0];
    image = taskCard(thread, item.settings.slot || 0, codexTaskProvider(thread));
  }
  if (item.type === "claudetask") {
    image = taskCard(snapshot.claude.threads[item.settings.slot || 0], item.settings.slot || 0, "CLAUDE");
  }
  if (item.type === "usage5h") image = usageCard(snapshot.usage?.fiveHour, "CODEX · 5H");
  if (item.type === "usageweek") image = usageCard(snapshot.usage?.week, "CODEX · WEEK");
  if (item.type === "claudeusage5h") image = usageCard(snapshot.claude.usage?.fiveHour, "CLAUDE · 5H");
  if (item.type === "claudeusageweek") image = usageCard(snapshot.claude.usage?.week, "CLAUDE · WEEK");
  if (item.type === "model" || item.type === "currentmodel") {
    image = modelCard(codex.currentModel(), codex.currentEffort(), item.mode || "model");
  }
  if (item.type === "soleffort") {
    const effort = codex.currentSolEffort();
    image = modelCard(
      codex.solModel() || { displayName: "Sol" },
      effort,
      "effort",
      effortColor(effort)
    );
  }
  if (item.type === "permission" || item.type === "currentpermission") {
    image = permissionCard(PERMISSIONS[codex.currentPermissionIndex()]);
  }
  if (item.type === "claudemodel") {
    image = valueCard("CL", "MODEL", claude.currentModel(), "#f08c51");
  }
  if (item.type === "claudeeffort") {
    const effort = claude.currentEffort();
    image = valueCard("CL", "EFFORT", effort, effortColor(effort));
  }
  if (image) plugin.setImage(context, image);
}

function renderAll() {
  for (const context of visible.keys()) renderOne(context);
}

function commonAction(type, defaults = {}) {
  return new Actions({
    default: defaults,
    _willAppear({ context, payload }) {
      remember(type, context, { ...defaults, ...(payload.settings || {}) });
    },
    _willDisappear({ context }) { forget(context); },
    _didReceiveSettings({ context, payload }) {
      const settings = { ...defaults, ...(payload.settings || {}) };
      visible.set(context, { ...(visible.get(context) || {}), type, settings });
      if (settings.codexPath && settings.codexPath !== codex.codexPath) {
        codex.stop();
        codex = makeCodexClient({ codexPath: settings.codexPath });
        refresh();
      }
      renderOne(context);
    },
    _propertyInspectorDidAppear({ context }) {
      const claudeAction = isClaudeType(type);
      plugin.sendToPropertyInspector(`com.tlm.codex-control.${type}`, context, {
        provider: claudeAction ? "claude" : "codex",
        codexPath: codex.codexPath,
        connected: claudeAction ? true : codex.ready,
        threadCount: claudeAction ? snapshot.claude.threads.length : snapshot.threads.length,
        usageCaptureInstalled: claude.usageCaptureInstalled()
      });
    },
    sendToPlugin({ payload }) {
      if (payload?.command === "refresh") refresh();
      if (payload?.command === "installClaudeUsage") {
        try {
          const installed = claude.installUsageCapture();
          log.info(installed ? "Claude Usage capture installed" : "Claude Usage capture already installed");
          refresh();
        } catch (error) {
          log.error("Claude Usage capture install failed", error);
        }
      }
    }
  });
}

plugin.task = commonAction("task", { slot: 0, notifyDone: true, notifyInput: true });
plugin.task.keyUp = ({ context }) => {
  const actionSettings = plugin.task.data[context] || {};
  const slot = Number(actionSettings.slot || 0);
  const thread = snapshot.threads[slot];
  if (!thread) return plugin.showAlert(context);
  openCodexThread(thread, actionSettings.terminal || "auto");
  plugin.showOk(context);
};

plugin.model = commonAction("model");
plugin.model.dialDown = ({ context }) => {
  const item = visible.get(context);
  if (item) item.mode = "effort";
  renderOne(context);
};
plugin.model.dialUp = ({ context }) => {
  const item = visible.get(context);
  if (item) item.mode = "model";
  renderOne(context);
};
plugin.model.dialRotate = async ({ context, payload }) => {
  try {
    await ensureStarted();
    if (payload.pressed) {
      const item = visible.get(context);
      if (item) item.mode = "effort";
      const effort = await codex.rotateEffort(payload.ticks);
      log.info("effort changed", effort);
    } else {
      const model = await codex.rotateModel(payload.ticks);
      log.info("model changed", model?.model);
    }
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("model rotate", error);
    plugin.showAlert(context);
  }
};
plugin.model.keyUp = async ({ context }) => {
  await plugin.model.dialRotate({ context, payload: { ticks: 1, pressed: false } });
};

plugin.permission = commonAction("permission");
plugin.permission.dialRotate = async ({ context, payload }) => {
  try {
    await ensureStarted();
    const permission = await codex.rotatePermission(payload.ticks);
    log.info("permission changed", permission.sandbox, permission.approval);
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("permission rotate", error);
    plugin.showAlert(context);
  }
};
plugin.permission.keyUp = async ({ context }) => {
  await plugin.permission.dialRotate({ context, payload: { ticks: 1 } });
};

plugin.currentmodel = commonAction("currentmodel");
plugin.currentmodel.keyUp = async ({ context }) => {
  try {
    await ensureStarted();
    const model = await codex.rotateModel(1);
    log.info("model button changed", model?.model);
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("model button", error);
    plugin.showAlert(context);
  }
};

plugin.currentpermission = commonAction("currentpermission");
plugin.currentpermission.keyUp = async ({ context }) => {
  try {
    await ensureStarted();
    const permission = await codex.rotatePermission(1);
    log.info("permission button changed", permission.sandbox, permission.approval);
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("permission button", error);
    plugin.showAlert(context);
  }
};

plugin.soleffort = commonAction("soleffort");
plugin.soleffort.dialRotate = async ({ context, payload }) => {
  try {
    await ensureStarted();
    const result = await codex.rotateSolEffort(payload.ticks);
    log.info("sol effort changed", result.model.model, result.effort);
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("sol effort rotate", error);
    plugin.showAlert(context);
  }
};
plugin.soleffort.keyUp = async ({ context }) => {
  await plugin.soleffort.dialRotate({ context, payload: { ticks: 1 } });
};

plugin.usage5h = commonAction("usage5h");
plugin.usage5h.keyUp = refreshUsage;
plugin.usageweek = commonAction("usageweek");
plugin.usageweek.keyUp = refreshUsage;

plugin.claudetask = commonAction("claudetask", { slot: 0, notifyDone: true, notifyInput: true });
plugin.claudetask.keyUp = ({ context }) => {
  const actionSettings = plugin.claudetask.data[context] || {};
  const slot = Number(actionSettings.slot || 0);
  const thread = snapshot.claude.threads[slot];
  if (!thread) return plugin.showAlert(context);
  openClaudeThread(thread, actionSettings.terminal || "auto");
  plugin.showOk(context);
};

plugin.claudemodel = commonAction("claudemodel");
plugin.claudemodel.dialRotate = ({ context, payload }) => {
  try {
    const model = claude.rotateModel(payload.ticks);
    snapshot.claude = { ...snapshot.claude, config: { ...snapshot.claude.config, model } };
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("Claude model rotate", error);
    plugin.showAlert(context);
  }
};
plugin.claudemodel.keyUp = ({ context }) => {
  plugin.claudemodel.dialRotate({ context, payload: { ticks: 1 } });
};

plugin.claudeeffort = commonAction("claudeeffort");
plugin.claudeeffort.dialRotate = ({ context, payload }) => {
  try {
    const effort = claude.rotateEffort(payload.ticks);
    snapshot.claude = { ...snapshot.claude, config: { ...snapshot.claude.config, effort } };
    renderAll();
    plugin.showOk(context);
  } catch (error) {
    log.error("Claude effort rotate", error);
    plugin.showAlert(context);
  }
};
plugin.claudeeffort.keyUp = ({ context }) => {
  plugin.claudeeffort.dialRotate({ context, payload: { ticks: 1 } });
};

plugin.claudeusage5h = commonAction("claudeusage5h");
plugin.claudeusage5h.keyUp = refreshUsage;
plugin.claudeusageweek = commonAction("claudeusageweek");
plugin.claudeusageweek.keyUp = refreshUsage;

plugin.didReceiveGlobalSettings = ({ payload }) => {
  const configured = payload.settings?.codexPath;
  if (configured && configured !== codex.codexPath) {
    codex.stop();
    codex = makeCodexClient({ codexPath: configured });
    refresh();
  }
};

process.on("exit", () => {
  clearTimeout(eventRefreshTimer);
  codex.stop();
});

function openCodexThread(thread, terminal = "auto") {
  if (String(thread?.source || "").toLowerCase() === "cli") {
    openCodexCliThread(thread, terminal);
    return;
  }
  const url = `codex://threads/${encodeURIComponent(thread.id)}`;
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    plugin.openUrl(url);
  }
}

function openCodexCliThread(thread, terminal = "auto") {
  const cwd = thread.cwd || process.env.HOME || process.env.USERPROFILE || ".";
  const changeDirectory = process.platform === "win32" ? `cd /d ${shellQuote(cwd)}` : `cd ${shellQuote(cwd)}`;
  const command = `${changeDirectory} && ${shellQuote(codex.codexPath || "codex")} resume ${shellQuote(thread.id)}`;
  openAgentSession({ id: thread.id, provider: "codex", cwd, command, preference: terminal, log });
}

function openClaudeThread(thread, terminal = "auto") {
  const cwd = thread.cwd || process.env.HOME || process.env.USERPROFILE || ".";
  const command = `cd ${shellQuote(cwd)} && claude --resume ${shellQuote(thread.id)}`;
  openAgentSession({ id: thread.id, provider: "claude", cwd, command, preference: terminal, log });
}

function notifyStatusChanges() {
  const watched = new Map();
  const watchedClaude = new Map();
  for (const item of visible.values()) {
    if (item.type !== "task" && item.type !== "claudetask") continue;
    const claudeTask = item.type === "claudetask";
    const thread = (claudeTask ? snapshot.claude.threads : snapshot.threads)[Number(item.settings.slot || 0)];
    if (!thread) continue;
    const target = claudeTask ? watchedClaude : watched;
    const existing = target.get(thread.id) || { notifyDone: false, notifyInput: false };
    target.set(thread.id, {
      notifyDone: existing.notifyDone || item.settings.notifyDone !== false,
      notifyInput: existing.notifyInput || item.settings.notifyInput !== false
    });
  }
  for (const event of collectStatusNotifications(threadStatusCache, snapshot.threads, watched)) {
    showTaskNotification(event.type, event.thread);
  }
  for (const event of collectStatusNotifications(claudeStatusCache, snapshot.claude.threads, watchedClaude)) {
    showTaskNotification(event.type, event.thread);
  }
}

function showTaskNotification(type, thread) {
  if (process.platform !== "darwin") return;
  const notification = formatStatusNotification(type, thread);
  const script = `display notification "${appleScriptText(notification.message)}" with title "${appleScriptText(notification.title)}" subtitle "${appleScriptText(notification.subtitle)}"`;
  try {
    spawn("/usr/bin/osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
    playAttentionSound(notification);
  } catch (error) {
    log.error("notification", error);
  }
}

function playAttentionSound(notification) {
  const sound = String(notification.sound || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!sound) return;
  const soundPath = `/System/Library/Sounds/${sound}.aiff`;
  const repeats = Math.max(1, Math.min(3, Number(notification.soundRepeats) || 1));
  const volume = String(Math.max(0.1, Math.min(2, Number(notification.soundVolume) || 1)));
  for (let index = 0; index < repeats; index += 1) {
    const timer = setTimeout(() => {
      try {
        spawn("/usr/bin/afplay", ["-v", volume, soundPath], {
          detached: true,
          stdio: "ignore"
        }).unref();
      } catch (error) {
        log.error("notification sound", error);
      }
    }, index * 650);
    timer.unref?.();
  }
}

function appleScriptText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function shellQuote(value) {
  if (process.platform === "win32") return `"${String(value).replace(/"/g, '""')}"`;
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
