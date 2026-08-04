const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const {
  CodexClient,
  extractUsageWindows,
  inferThreadStatus,
  findCodex,
  readAuthFingerprint
} = require("../com.tlm.codex-control.sdPlugin/plugin/codex-client");
const {
  ClaudeClient,
  scanSessions,
  readUsage
} = require("../com.tlm.codex-control.sdPlugin/plugin/claude-client");
const {
  taskCard,
  codexTaskProvider,
  usageCard,
  modelCard,
  permissionCard,
  valueCard,
  effortColor
} = require("../com.tlm.codex-control.sdPlugin/plugin/render");
const { collectStatusNotifications, formatStatusNotification } = require("../com.tlm.codex-control.sdPlugin/plugin/notifications");
const {
  TERMINALS,
  uuidV7Milliseconds,
  parseElapsedMilliseconds
} = require("../com.tlm.codex-control.sdPlugin/plugin/terminal-router");

test("manifest defines task, knobs, current-state buttons and usage actions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../com.tlm.codex-control.sdPlugin/manifest.json")));
  const ids = manifest.Actions.map(action => action.UUID);
  assert.deepEqual(ids, [
    "com.tlm.codex-control.task",
    "com.tlm.codex-control.model",
    "com.tlm.codex-control.permission",
    "com.tlm.codex-control.currentmodel",
    "com.tlm.codex-control.currentpermission",
    "com.tlm.codex-control.soleffort",
    "com.tlm.codex-control.usage5h",
    "com.tlm.codex-control.usageweek",
    "com.tlm.codex-control.claudetask",
    "com.tlm.codex-control.claudemodel",
    "com.tlm.codex-control.claudeeffort",
    "com.tlm.codex-control.claudeusage5h",
    "com.tlm.codex-control.claudeusageweek"
  ]);
  assert.ok(manifest.Actions.find(action => action.UUID.endsWith(".model")).Controllers.includes("Knob"));
  assert.ok(manifest.Actions.find(action => action.UUID.endsWith(".permission")).Controllers.includes("Knob"));
  assert.deepEqual(manifest.Actions.find(action => action.UUID.endsWith(".currentmodel")).Controllers, ["Keypad"]);
  assert.deepEqual(manifest.Actions.find(action => action.UUID.endsWith(".currentpermission")).Controllers, ["Keypad"]);
  assert.deepEqual(manifest.Actions.find(action => action.UUID.endsWith(".soleffort")).Controllers, ["Knob", "Keypad"]);
});

test("Sol control selects Sol and advances only its supported effort", async () => {
  const client = new CodexClient({ codexPath: process.execPath });
  client.models = [{
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6-Sol",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
      { reasoningEffort: "high" },
      { reasoningEffort: "xhigh" }
    ]
  }];
  client.config = { model: "gpt-5.4", model_reasoning_effort: "medium" };
  let edits;
  client.writeConfig = async next => { edits = next; };
  const result = await client.rotateSolEffort(1);
  assert.equal(result.model.model, "gpt-5.6-sol");
  assert.equal(result.effort, "high");
  assert.equal(client.config.model, "gpt-5.6-sol");
  assert.equal(client.config.model_reasoning_effort, "high");
  assert.deepEqual(edits.map(edit => edit.value), ["gpt-5.6-sol", "high"]);
});

test("Sol effort levels use distinct colors", () => {
  const levels = ["low", "medium", "high", "xhigh", "max", "ultra"];
  const colors = levels.map(effortColor);
  assert.equal(new Set(colors).size, levels.length);
  assert.equal(effortColor("low"), "#53d68a");
  assert.equal(effortColor("ultra"), "#b77cff");
  for (const [index, level] of levels.entries()) {
    const svg = decodeURIComponent(modelCard(
      { displayName: "GPT-5.6-Sol" },
      level,
      "effort",
      colors[index]
    ).split(",")[1]);
    assert.match(svg, new RegExp(colors[index]));
  }
});

test("usage windows select 5h and week without inventing missing data", () => {
  const result = extractUsageWindows({
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 21, windowDurationMins: 300, resetsAt: 100 },
        secondary: { usedPercent: 67, windowDurationMins: 10080, resetsAt: 200 }
      }
    }
  });
  assert.equal(result.fiveHour.usedPercent, 21);
  assert.equal(result.week.usedPercent, 67);

  const weekOnly = extractUsageWindows({
    rateLimits: { primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 300 } }
  });
  assert.equal(weekOnly.fiveHour, null);
  assert.equal(weekOnly.week.usedPercent, 9);

  const modelSpecificFirst = extractUsageWindows({
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 400 }
    },
    rateLimitsByLimitId: {
      codex_bengalfox: {
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 500 }
      },
      codex: {
        primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 400 }
      }
    }
  });
  assert.equal(modelSpecificFirst.week.usedPercent, 9);
  assert.equal(modelSpecificFirst.week.resetsAt, 400);
});

test("Codex account fingerprint changes only when the active identity changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-codex-auth-"));
  const authPath = path.join(dir, "auth.json");
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { account_id: "account-a", access_token: "token-1" },
    last_refresh: "one"
  }));
  const first = readAuthFingerprint(authPath);

  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { account_id: "account-a", access_token: "token-2" },
    last_refresh: "two"
  }));
  assert.equal(readAuthFingerprint(authPath), first);

  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { account_id: "account-b", access_token: "token-3" }
  }));
  assert.notEqual(readAuthFingerprint(authPath), first);
  fs.rmSync(authPath);
  assert.equal(readAuthFingerprint(authPath), "missing");
});

test("Codex client restarts and clears cached account data after account switch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-codex-switch-"));
  const authPath = path.join(dir, "auth.json");
  const writeAccount = id => fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { account_id: id }
  }));
  writeAccount("account-a");
  const client = new CodexClient({ codexPath: process.execPath, authPath });
  client.ready = true;
  client.models = [{ model: "old-model" }];
  client.config = { model: "old-model" };
  client.threads = [{ id: "old-thread" }];
  client.rateLimits = { rateLimits: { primary: { usedPercent: 99 } } };
  let stops = 0;
  let starts = 0;
  client.stop = () => { stops += 1; client.ready = false; };
  client.start = async () => {
    starts += 1;
    client.ready = true;
    client.authFingerprint = readAuthFingerprint(authPath);
  };

  writeAccount("account-b");
  assert.equal(await client.ensureCurrentAccount(), true);
  assert.equal(stops, 1);
  assert.equal(starts, 1);
  assert.deepEqual(client.models, []);
  assert.deepEqual(client.config, {});
  assert.deepEqual(client.threads, []);
  assert.equal(client.rateLimits, null);
  assert.equal(await client.ensureCurrentAccount(), false);
});

test("Codex thread events trigger the near-real-time refresh callback", () => {
  let events = 0;
  const client = new CodexClient({ codexPath: process.execPath, onThreadEvent: () => { events += 1; } });
  client.onLine(JSON.stringify({ method: "thread/status/changed", params: { threadId: "thread-1" } }));
  client.onLine(JSON.stringify({ method: "account/rateLimits/updated", params: {} }));
  assert.equal(events, 1);
});

test("thread status is inferred from persisted task events", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-control-"));
  const rollout = path.join(dir, "rollout.jsonl");
  fs.writeFileSync(rollout, [
    JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count" } })
  ].join("\n"));
  assert.equal(inferThreadStatus({ path: rollout, status: { type: "notLoaded" } }).type, "active");
  fs.appendFileSync(rollout, `\n${JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })}\n`);
  assert.equal(inferThreadStatus({ path: rollout, status: { type: "notLoaded" } }).type, "idle");
});

test("thread status detects approval flags and unanswered questions", () => {
  assert.equal(inferThreadStatus({
    status: { type: "active", activeFlags: ["waitingOnApproval"] }
  }).type, "needsInput");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-needs-input-"));
  const pendingTool = path.join(dir, "pending-tool.jsonl");
  fs.writeFileSync(pendingTool, [
    JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "request_user_input",
        call_id: "call_question"
      }
    })
  ].join("\n"));
  assert.equal(inferThreadStatus({
    path: pendingTool,
    status: { type: "notLoaded" }
  }).type, "needsInput");

  const directQuestion = path.join(dir, "direct-question.jsonl");
  fs.writeFileSync(directQuestion, [
    JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "请选择下一步？" }]
      }
    }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })
  ].join("\n"));
  assert.equal(inferThreadStatus({
    path: directQuestion,
    status: { type: "notLoaded" }
  }).type, "needsInput");
});

test("long running turns stay active when large outputs push task_started beyond the scan window", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-large-turn-"));
  const rollout = path.join(dir, "large-running.jsonl");
  fs.writeFileSync(rollout, `${JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started" }
  })}\n`);
  fs.appendFileSync(rollout, `${JSON.stringify({
    type: "response_item",
    payload: { type: "function_call_output", output: "x".repeat(9 * 1024 * 1024) }
  })}\n`);
  fs.appendFileSync(rollout, `${JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count" }
  })}\n`);
  assert.equal(inferThreadStatus({
    path: rollout,
    status: { type: "notLoaded" }
  }).type, "active");
});

test("all visual cards are valid encoded SVG data URLs", () => {
  const cards = [
    taskCard({ name: "测试任务", cwd: "/tmp/test", displayStatus: { type: "active" } }, 0),
    usageCard({ usedPercent: 88, windowDurationMins: 300, resetsAt: 2000000000 }, "CODEX · 5H"),
    modelCard({ displayName: "GPT-Test" }, "high"),
    valueCard("CL", "MODEL", "sonnet", "#f08c51"),
    permissionCard({ name: "工作区", short: "AUTO", color: "#52d681" })
  ];
  for (const card of cards) {
    assert.match(card, /^data:image\/svg\+xml;charset=utf8,/);
    assert.match(decodeURIComponent(card.split(",")[1]), /<svg/);
  }
});

test("task cards distinguish Codex CLI and desktop origins", () => {
  const thread = {
    cwd: "/tmp/project",
    displayStatus: { type: "active" }
  };
  assert.equal(codexTaskProvider({ source: "cli" }), "CODEX CLI");
  assert.equal(codexTaskProvider({ source: "vscode" }), "CODEX APP");
  const cliSvg = decodeURIComponent(taskCard({ ...thread, source: "cli" }, 0, codexTaskProvider({ source: "cli" })).split(",")[1]);
  const appSvg = decodeURIComponent(taskCard({ ...thread, source: "vscode" }, 0, codexTaskProvider({ source: "vscode" })).split(",")[1]);
  assert.match(cliSvg, /CODEX CLI/);
  assert.match(appSvg, /CODEX APP/);
});

test("terminal routing exposes automatic and common terminal choices", () => {
  assert.deepEqual(TERMINALS, ["auto", "otty", "terminal", "iterm2", "ghostty", "kitty", "wezterm"]);
});

test("Otty fallback derives Codex launch time and parses process elapsed time", () => {
  assert.equal(uuidV7Milliseconds("019fca8c-2c13-7a52-ab5b-aa3ce231f997"), 1785809611795);
  assert.equal(uuidV7Milliseconds("not-a-session"), null);
  assert.equal(parseElapsedMilliseconds("01:02:03"), 3723000);
  assert.equal(parseElapsedMilliseconds("2-01:02:03"), 176523000);
});

test("Claude client scans CLI sessions and persists model and effort", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-claude-"));
  const projects = path.join(home, ".claude", "projects", "demo");
  const settingsPath = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, "session-1.jsonl"), [
    JSON.stringify({ type: "last-prompt", lastPrompt: "修复登录页面", cwd: "/tmp/demo" }),
    JSON.stringify({ type: "user", message: "开始" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "请选择方案？" }], stop_reason: "end_turn" }
    })
  ].join("\n"));
  const sessions = scanSessions(path.join(home, ".claude", "projects"), 8);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "session-1");
  assert.equal(sessions[0].displayStatus.type, "needsInput");

  const client = new ClaudeClient({ home, settingsPath, projectsPath: path.join(home, ".claude", "projects") });
  client.refresh();
  assert.equal(client.rotateModel(1), "opus");
  assert.equal(client.rotateEffort(1), "xhigh");
  const stored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(stored.model, "opus");
  assert.equal(stored.effortLevel, "xhigh");
});

test("Claude usage maps five-hour and weekly Status Line windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-claude-usage-"));
  const file = path.join(dir, "claude-status.json");
  fs.writeFileSync(file, JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 25, resets_at: 100 },
      seven_day: { used_percentage: 61, resets_at: 200 }
    }
  }));
  const usage = readUsage(file);
  assert.equal(usage.fiveHour.usedPercent, 25);
  assert.equal(usage.week.usedPercent, 61);
});

test("Claude Usage capture preserves an existing Status Line command", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-claude-capture-"));
  const settingsPath = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: "command", command: "existing-status --compact", padding: 2 },
    theme: "dark"
  }));
  const client = new ClaudeClient({ home, settingsPath });
  assert.equal(client.installUsageCapture(), true);
  assert.equal(client.usageCaptureInstalled(), true);
  assert.equal(client.installUsageCapture(), false);
  const stored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(stored.theme, "dark");
  assert.equal(stored.statusLine.padding, 2);
  assert.match(stored.statusLine.command, /claude-status\.js/);
  const encoded = stored.statusLine.command.match(/--next-base64 "([^"]*)"/)[1];
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "existing-status --compact");
});

test("Claude Status Line helper stores the supplied Usage snapshot", () => {
  if (process.platform === "win32") return;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-claude-helper-"));
  const helper = path.join(
    __dirname,
    "../com.tlm.codex-control.sdPlugin/plugin/claude-status.js"
  );
  const input = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 33 } } });
  const result = spawnSync(process.execPath, [helper], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: home }
  });
  assert.equal(result.status, 0);
  const cache = path.join(home, "Library", "Application Support", "Vibe Float", "claude-status.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(cache, "utf8")), JSON.parse(input));
});

test("task card shows status and project name without the task title", () => {
  const svg = decodeURIComponent(taskCard({
    name: "不应显示的任务标题",
    cwd: "/Users/demo/Chronoroll",
    displayStatus: { type: "active" }
  }, 0).split(",")[1]);
  assert.match(svg, /执行中/);
  assert.match(svg, /CHRO/);
  assert.doesNotMatch(svg, /Chronoroll/);
  assert.doesNotMatch(svg, /不应显示的任务标题/);
});

test("task card renders needs-input state in amber", () => {
  const svg = decodeURIComponent(taskCard({
    displayStatus: { type: "needsInput" }
  }, 0).split(",")[1]);
  assert.match(svg, /待回复/);
  assert.match(svg, /#ffbd45/);
  assert.match(svg, />\\?</);
});

test("watched task transitions emit one completion or needs-input notification", () => {
  const cache = new Map();
  const watched = new Map([["thread-1", { notifyDone: true, notifyInput: true }]]);
  const thread = status => [{
    id: "thread-1",
    name: "测试任务",
    displayStatus: { type: status }
  }];
  assert.deepEqual(collectStatusNotifications(cache, thread("active"), watched), []);
  assert.equal(collectStatusNotifications(cache, thread("needsInput"), watched)[0].type, "input");
  assert.deepEqual(collectStatusNotifications(cache, thread("needsInput"), watched), []);
  assert.deepEqual(collectStatusNotifications(cache, thread("active"), watched), []);
  assert.equal(collectStatusNotifications(cache, thread("idle"), watched)[0].type, "done");

  const quick = statusKey => [{
    id: "thread-1",
    name: "快速任务",
    displayStatus: { type: "idle", eventKey: statusKey }
  }];
  collectStatusNotifications(cache, quick("turn-1"), watched);
  assert.equal(collectStatusNotifications(cache, quick("turn-2"), watched)[0].type, "done");
});

test("system notification includes task title and explicit status", () => {
  const input = formatStatusNotification("input", { name: "修复支付流程" });
  assert.equal(input.title, "Codex 任务通知");
  assert.equal(input.subtitle, "状态：待回复");
  assert.equal(input.message, "任务：修复支付流程");
  assert.equal(input.sound, "Sosumi");
  assert.equal(input.soundVolume, 2);
  assert.equal(input.soundRepeats, 2);

  const done = formatStatusNotification("done", { preview: "运行测试" });
  assert.equal(done.subtitle, "状态：已完成");
  assert.equal(done.message, "任务：运行测试");
  assert.equal(done.sound, "Hero");
  assert.equal(done.soundVolume, 2);
  assert.equal(done.soundRepeats, 2);

  const claude = formatStatusNotification("done", { name: "Claude 任务", provider: "claude" });
  assert.equal(claude.title, "Claude 任务通知");
});

test("property inspector persists each task slot with its own inspector UUID", () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    "../com.tlm.codex-control.sdPlugin/propertyInspector/index.js"
  ), "utf8");
  const elements = {};
  for (const id of [
    "slotRow", "slot", "notifyDoneRow", "notifyDone", "notifyInputRow",
    "notifyInput", "terminalRow", "terminal", "codexPath", "hint", "dot", "status", "refresh"
    , "codexPathRow", "enableClaudeUsage"
  ]) {
    elements[id] = {
      value: "",
      checked: false,
      hidden: false,
      placeholder: "",
      textContent: "",
      handlers: {},
      classList: { toggle() {} },
      addEventListener(event, handler) { this.handlers[event] = handler; }
    };
  }
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(message) { this.sent.push(JSON.parse(message)); }
  }
  const sandbox = {
    document: { getElementById: id => elements[id] },
    WebSocket: FakeWebSocket
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  vm.runInContext(`connectElgatoStreamDeckSocket(
    "18618",
    "property-inspector-uuid",
    "registerPropertyInspector",
    ${JSON.stringify(JSON.stringify({ application: { version: "3.10" } }))},
    ${JSON.stringify(JSON.stringify({
      action: "com.tlm.codex-control.task",
      context: "action-instance-uuid",
      payload: { settings: { slot: 0 } }
    }))}
  )`, sandbox);
  sockets[0].onopen();
  elements.slot.value = "1";
  elements.slot.handlers.change();
  const saved = sockets[0].sent.find(message => message.event === "setSettings");
  assert.equal(saved.context, "property-inspector-uuid");
  assert.equal(saved.payload.slot, 1);
  assert.equal(saved.payload.notifyDone, true);
  assert.equal(saved.payload.notifyInput, true);
});

test("Codex executable is discoverable", () => {
  assert.ok(findCodex());
});
