const { Plugins, Actions, log } = require("./utils/plugin");
const { CodexClient, PERMISSIONS } = require("./codex-client");
const {
  taskCard,
  usageCard,
  modelCard,
  permissionCard,
  errorCard,
  effortColor
} = require("./render");
const { collectStatusNotifications, formatStatusNotification } = require("./notifications");
const { spawn } = require("node:child_process");

const plugin = new Plugins();
let codex = new CodexClient();
let snapshot = { threads: [], usage: {}, models: [], config: {} };
let refreshTimer = null;
let refreshInFlight = null;
let usageTimer = null;
let usageInFlight = null;
const visible = new Map();
const threadStatusCache = new Map();

async function ensureStarted() {
  if (!codex.ready) await codex.start();
}

async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      await ensureStarted();
      snapshot = await codex.refresh();
      notifyStatusChanges();
      renderAll();
    } catch (error) {
      log.error("refresh failed", error);
      // A busy Codex state database can make one refresh slow. Keep the last
      // valid device images instead of incorrectly reporting a disconnect.
      if (!snapshot.threads.length && !snapshot.models.length) {
        for (const context of visible.keys()) plugin.setImage(context, errorCard(error.message));
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  clearInterval(usageTimer);
  refreshTimer = setInterval(refresh, 5000);
  usageTimer = setInterval(refreshUsage, 3000);
  refresh();
  refreshUsage();
}

async function refreshUsage() {
  if (usageInFlight) return usageInFlight;
  usageInFlight = (async () => {
    try {
      await ensureStarted();
      snapshot = { ...snapshot, usage: await codex.refreshUsage() };
      for (const [context, item] of visible.entries()) {
        if (item.type === "usage5h" || item.type === "usageweek") renderOne(context);
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
  if (item.type === "task") image = taskCard(snapshot.threads[item.settings.slot || 0], item.settings.slot || 0);
  if (item.type === "usage5h") image = usageCard(snapshot.usage?.fiveHour, "CODEX · 5H");
  if (item.type === "usageweek") image = usageCard(snapshot.usage?.week, "CODEX · WEEK");
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
        codex = new CodexClient({ codexPath: settings.codexPath });
        refresh();
      }
      renderOne(context);
    },
    _propertyInspectorDidAppear({ context }) {
      plugin.sendToPropertyInspector(`com.tlm.codex-control.${type}`, context, {
        codexPath: codex.codexPath,
        connected: codex.ready,
        threadCount: snapshot.threads.length
      });
    },
    sendToPlugin({ payload }) {
      if (payload?.command === "refresh") refresh();
    }
  });
}

plugin.task = commonAction("task", { slot: 0, notifyDone: true, notifyInput: true });
plugin.task.keyUp = ({ context }) => {
  const slot = Number(plugin.task.data[context]?.slot || 0);
  const thread = snapshot.threads[slot];
  if (!thread) return plugin.showAlert(context);
  openCodexThread(thread.id);
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

plugin.didReceiveGlobalSettings = ({ payload }) => {
  const configured = payload.settings?.codexPath;
  if (configured && configured !== codex.codexPath) {
    codex.stop();
    codex = new CodexClient({ codexPath: configured });
    refresh();
  }
};

process.on("exit", () => codex.stop());

function openCodexThread(threadId) {
  const url = `codex://threads/${encodeURIComponent(threadId)}`;
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

function notifyStatusChanges() {
  const watched = new Map();
  for (const item of visible.values()) {
    if (item.type !== "task") continue;
    const thread = snapshot.threads[Number(item.settings.slot || 0)];
    if (!thread) continue;
    const existing = watched.get(thread.id) || { notifyDone: false, notifyInput: false };
    watched.set(thread.id, {
      notifyDone: existing.notifyDone || item.settings.notifyDone !== false,
      notifyInput: existing.notifyInput || item.settings.notifyInput !== false
    });
  }
  for (const event of collectStatusNotifications(threadStatusCache, snapshot.threads, watched)) {
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
