let socket;
let uuid;
let action;
let settings = {};

const $ = id => document.getElementById(id);
const hints = {
  task: "按键显示最近任务状态；自动区分 Codex CLI 与 APP，按下后在终端恢复 CLI 任务或切换到桌面任务。",
  model: "旋转直接切换模型；按住旋钮并旋转切换推理层级。按键模式下每按一次切换下一个模型。",
  permission: "旋转切换只读、工作区自动、完全访问。设置写入 Codex config.toml。",
  currentmodel: "屏幕显示当前 Codex 模型和推理层级；按一下切换到下一个模型。",
  currentpermission: "屏幕显示当前权限；按一下在只读、工作区、完全访问之间切换。",
  soleffort: "Sol 专用控制：旋转旋钮或按屏幕按钮切换 low、medium、high、xhigh、max、ultra。",
  usage5h: "显示 Codex 返回的 5 小时窗口。若当前账号只返回周窗口，将显示 N/A。",
  usageweek: "显示 Codex 周用量；进度轮颜色会随使用率变为绿、黄、红。",
  claudetask: "显示最近 Claude Code CLI 任务；按下后在终端使用 claude --resume 恢复。",
  claudemodel: "旋转旋钮或按下按键，切换新建 Claude Code CLI 会话使用的默认模型。",
  claudeeffort: "旋转旋钮或按下按键，切换新建 Claude Code CLI 会话使用的 Effort。",
  claudeusage5h: "显示 Claude Code 5 小时用量。首次使用请启用本地 Usage 采集。",
  claudeusageweek: "显示 Claude Code 周用量。首次使用请启用本地 Usage 采集。"
};

function connectElgatoStreamDeckSocket(port, inPropertyInspectorUuid, registerEvent, info, actionInfo) {
  // Stream Dock gives the property inspector its own UUID as the second
  // argument. setSettings must use that UUID, not the action-instance context.
  uuid = inPropertyInspectorUuid;
  const parsed = JSON.parse(actionInfo || info);
  action = parsed.action;
  settings = parsed.payload?.settings || {};
  const kind = action.split(".").pop();
  const taskAction = kind === "task" || kind === "claudetask";
  const claudeAction = kind.startsWith("claude");
  const claudeUsageAction = kind === "claudeusage5h" || kind === "claudeusageweek";
  $("slotRow").hidden = !taskAction;
  $("notifyDoneRow").hidden = !taskAction;
  $("notifyInputRow").hidden = !taskAction;
  $("codexPathRow").hidden = claudeAction;
  $("enableClaudeUsage").hidden = !claudeUsageAction;
  $("slot").value = String(settings.slot || 0);
  $("notifyDone").checked = settings.notifyDone !== false;
  $("notifyInput").checked = settings.notifyInput !== false;
  $("codexPath").value = settings.codexPath || "";
  $("hint").textContent = hints[kind] || "";

  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => socket.send(JSON.stringify({ event: registerEvent, uuid }));
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.event === "didReceiveSettings") {
      settings = message.payload.settings || {};
      $("slot").value = String(settings.slot || 0);
      $("notifyDone").checked = settings.notifyDone !== false;
      $("notifyInput").checked = settings.notifyInput !== false;
      $("codexPath").value = settings.codexPath || "";
    }
    if (message.event === "sendToPropertyInspector") {
      const data = message.payload || {};
      $("dot").classList.toggle("ok", !!data.connected);
      const provider = data.provider === "claude" ? "Claude" : "Codex";
      $("status").textContent = data.connected ? `${provider} 已连接 · ${data.threadCount || 0} 个任务` : `${provider} 尚未连接`;
      if (data.usageCaptureInstalled) $("enableClaudeUsage").textContent = "Claude Usage 采集已启用";
      if (!$("codexPath").value) $("codexPath").placeholder = data.codexPath || "留空自动发现 codex";
    }
  };
}

function save() {
  settings.slot = Number($("slot").value);
  settings.notifyDone = $("notifyDone").checked;
  settings.notifyInput = $("notifyInput").checked;
  settings.codexPath = $("codexPath").value.trim();
  socket?.send(JSON.stringify({ event: "setSettings", context: uuid, payload: settings }));
}

$("slot").addEventListener("change", save);
$("notifyDone").addEventListener("change", save);
$("notifyInput").addEventListener("change", save);
$("codexPath").addEventListener("change", save);
$("enableClaudeUsage").addEventListener("click", () => {
  socket?.send(JSON.stringify({
    event: "sendToPlugin",
    action,
    context: uuid,
    payload: { command: "installClaudeUsage" }
  }));
  $("enableClaudeUsage").textContent = "已启用，请重启 Claude CLI";
});
$("refresh").addEventListener("click", () => {
  save();
  socket?.send(JSON.stringify({ event: "sendToPlugin", action, context: uuid, payload: { command: "refresh" } }));
});
