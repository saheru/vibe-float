let socket;
let uuid;
let action;
let settings = {};

const $ = id => document.getElementById(id);
const hints = {
  task: "按键显示最近任务状态；按下后通过 codex:// 深链接切换到该任务。",
  model: "旋转直接切换模型；按住旋钮并旋转切换推理层级。按键模式下每按一次切换下一个模型。",
  permission: "旋转切换只读、工作区自动、完全访问。设置写入 Codex config.toml。",
  currentmodel: "屏幕显示当前 Codex 模型和推理层级；按一下切换到下一个模型。",
  currentpermission: "屏幕显示当前权限；按一下在只读、工作区、完全访问之间切换。",
  soleffort: "Sol 专用控制：旋转旋钮或按屏幕按钮切换 low、medium、high、xhigh、max、ultra。",
  usage5h: "显示 Codex 返回的 5 小时窗口。若当前账号只返回周窗口，将显示 N/A。",
  usageweek: "显示 Codex 周用量；进度轮颜色会随使用率变为绿、黄、红。"
};

function connectElgatoStreamDeckSocket(port, inPropertyInspectorUuid, registerEvent, info, actionInfo) {
  // Stream Dock gives the property inspector its own UUID as the second
  // argument. setSettings must use that UUID, not the action-instance context.
  uuid = inPropertyInspectorUuid;
  const parsed = JSON.parse(actionInfo || info);
  action = parsed.action;
  settings = parsed.payload?.settings || {};
  const kind = action.split(".").pop();
  $("slotRow").hidden = kind !== "task";
  $("notifyDoneRow").hidden = kind !== "task";
  $("notifyInputRow").hidden = kind !== "task";
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
      $("status").textContent = data.connected ? `Codex 已连接 · ${data.threadCount || 0} 个任务` : "Codex 尚未连接";
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
$("refresh").addEventListener("click", () => {
  save();
  socket?.send(JSON.stringify({ event: "sendToPlugin", action, context: uuid, payload: { command: "refresh" } }));
});
