const STATUS = {
  active: { label: "运行中", color: "#35a7ff", glyph: "●" },
  idle: { label: "已完成", color: "#52d681", glyph: "✓" },
  needsInput: { label: "待回复", color: "#ffbd45", glyph: "?" },
  systemError: { label: "错误", color: "#ff5f6d", glyph: "!" },
  notLoaded: { label: "等待", color: "#8490a3", glyph: "○" }
};

function svgData(svg) {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

function shell(content, accent = "#4e8cff") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#172033"/><stop offset="1" stop-color="#080c14"/>
      </linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="144" height="144" rx="24" fill="url(#bg)"/>
    <path d="M20 12h104a8 8 0 0 1 8 8" fill="none" stroke="${accent}" stroke-width="3" opacity=".75"/>
    ${content}
  </svg>`;
}

function text(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function truncate(value, max = 15) {
  const chars = Array.from(String(value || "未命名任务"));
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

function projectName(thread) {
  const cwd = String(thread?.cwd || "").replace(/[\\/]+$/, "");
  if (!cwd) return "未命名项目";
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
  return Array.from(name).slice(0, 4).join("").toUpperCase();
}

function codexTaskProvider(thread) {
  return String(thread?.source || "").toLowerCase() === "cli" ? "CODEX CLI" : "CODEX APP";
}

function taskCard(thread, slot, provider = "CODEX") {
  const providerName = String(provider || "CODEX").toUpperCase();
  const providerColor = providerName === "CLAUDE" ? "#f08c51" : "#35a7ff";
  const providerWidth = Math.max(42, Math.min(64, 18 + providerName.length * 5));
  const providerCenter = 10 + providerWidth / 2;
  if (!thread) {
    return svgData(shell(`
      <text x="16" y="27" fill="${providerColor}" font-size="10" font-weight="900" font-family="Arial">${providerName}</text>
      <circle cx="72" cy="58" r="27" fill="#54627a" opacity=".16" stroke="#65748b" stroke-width="3"/>
      <text x="72" y="69" text-anchor="middle" fill="#8490a3" font-size="34" font-family="Arial">○</text>
      <text x="72" y="108" text-anchor="middle" fill="#e8edf7" font-size="22" font-weight="800" font-family="Arial">空闲</text>
      <text x="122" y="130" text-anchor="end" fill="#67758d" font-size="12" font-family="Arial">#${slot + 1}</text>
    `, "#54627a"));
  }
  const status = STATUS[thread.displayStatus?.type] || STATUS.notLoaded;
  const icon = thread.displayStatus?.type === "active" ? "▶" :
    thread.displayStatus?.type === "idle" ? "✓" :
    thread.displayStatus?.type === "needsInput" ? "?" :
    thread.displayStatus?.type === "systemError" ? "!" : "○";
  const label = thread.displayStatus?.type === "active" ? "执行中" :
    thread.displayStatus?.type === "idle" ? "完成" :
    thread.displayStatus?.type === "needsInput" ? "待回复" :
    thread.displayStatus?.type === "systemError" ? "错误" : "等待";
  const project = projectName(thread);
  return svgData(shell(`
    <rect x="10" y="10" width="${providerWidth}" height="17" rx="8.5" fill="${providerColor}"/>
    <text x="${providerCenter}" y="22" text-anchor="middle" fill="#ffffff" font-size="${providerName.length > 7 ? 7 : 8}" font-weight="900" font-family="Arial">${providerName}</text>
    <circle cx="72" cy="52" r="27" fill="${status.color}" opacity=".16" stroke="${status.color}" stroke-width="4" filter="url(#glow)"/>
    <text x="72" y="64" text-anchor="middle" fill="${status.color}" font-size="33" font-weight="800" font-family="Arial">${icon}</text>
    <text x="72" y="101" text-anchor="middle" fill="#ffffff" font-size="23" font-weight="900" font-family="Arial">${label}</text>
    <text x="72" y="128" text-anchor="middle" fill="${status.color}" font-size="21" font-weight="900" letter-spacing="1" font-family="Arial">${text(project)}</text>
    <text x="124" y="29" text-anchor="end" fill="${status.color}" font-size="11" font-weight="700" font-family="Arial">#${slot + 1}</text>
  `, status.color));
}

function valueCard(provider, kind, value, accent = "#f08c51") {
  const compact = String(value || "--").toUpperCase();
  return svgData(shell(`
    <text x="72" y="31" text-anchor="middle" fill="#8fa0b8" font-size="13" font-weight="800" font-family="Arial">${text(String(provider).toUpperCase())} · ${text(String(kind).toUpperCase())}</text>
    <rect x="17" y="49" width="110" height="59" rx="22" fill="${accent}" opacity=".17" stroke="${accent}" stroke-width="3"/>
    <text x="72" y="86" text-anchor="middle" fill="${accent}" font-size="${compact.length > 8 ? 18 : 24}" font-weight="900" font-family="Arial">${text(truncate(compact, 11))}</text>
    <text x="72" y="129" text-anchor="middle" fill="#7f8ca4" font-size="11" font-weight="700" font-family="Arial">按下切换</text>
  `, accent));
}

function usageCard(window, label) {
  const available = !!window;
  const percent = Math.max(0, Math.min(100, Number(window?.usedPercent || 0)));
  const color = percent >= 90 ? "#ff5f6d" : percent >= 70 ? "#ffbd45" : "#53d68a";
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = available ? circumference * percent / 100 : 0;
  const reset = formatReset(window?.resetsAt);
  return svgData(shell(`
    <circle cx="72" cy="72" r="${radius}" fill="none" stroke="#243149" stroke-width="11"/>
    <circle cx="72" cy="72" r="${radius}" fill="none" stroke="${available ? color : "#536077"}" stroke-width="11"
      stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90 72 72)" filter="url(#glow)"/>
    <text x="72" y="25" text-anchor="middle" fill="#d8e0ed" font-size="18" font-weight="900" font-family="Arial">${label.includes("WEEK") ? "周" : "5H"}</text>
    <text x="72" y="83" text-anchor="middle" fill="#ffffff" font-size="39" font-weight="900" font-family="Arial">${available ? `${Math.round(percent)}%` : "N/A"}</text>
    <text x="72" y="132" text-anchor="middle" fill="${available ? color : "#75849c"}" font-size="12" font-weight="700" font-family="Arial">${available ? reset : "无数据"}</text>
  `, color));
}

function effortColor(effort) {
  return {
    minimal: "#8490a3",
    low: "#53d68a",
    medium: "#35a7ff",
    high: "#ffbd45",
    xhigh: "#ff7a59",
    max: "#ff5f6d",
    ultra: "#b77cff"
  }[String(effort || "").toLowerCase()] || "#4e9cff";
}

function modelCard(model, effort, mode = "model", accentOverride) {
  const display = model?.displayName || model?.model || "Codex";
  const accent = accentOverride || (mode === "model" ? "#b77cff" : "#4e9cff");
  const compactModel = String(display)
    .replace(/^GPT-/i, "")
    .replace(/^5\.6-/i, "")
    .replace(/GPT-/ig, "")
    .toUpperCase();
  return svgData(shell(`
    <text x="72" y="31" text-anchor="middle" fill="#8fa0b8" font-size="12" font-weight="700" font-family="Arial">${mode === "effort" ? "推理层级" : "模型"}</text>
    <text x="72" y="78" text-anchor="middle" fill="#ffffff" font-size="${compactModel.length > 8 ? 20 : 27}" font-weight="900" font-family="Arial">${text(truncate(compactModel, 11))}</text>
    <rect x="25" y="94" width="94" height="32" rx="16" fill="${accent}" opacity=".18" stroke="${accent}" stroke-width="2"/>
    <text x="72" y="116" text-anchor="middle" fill="${accent}" font-size="17" font-weight="900" font-family="Arial">${text(String(effort || "medium").toUpperCase())}</text>
  `, accent));
}

function permissionCard(permission) {
  return svgData(shell(`
    <text x="72" y="29" text-anchor="middle" fill="#8fa0b8" font-size="12" font-weight="700" font-family="Arial">权限</text>
    <circle cx="72" cy="71" r="37" fill="${permission.color}" opacity=".14" stroke="${permission.color}" stroke-width="3"/>
    <path d="M72 43l23 9v18c0 18-10 29-23 35-13-6-23-17-23-35V52z" fill="none" stroke="${permission.color}" stroke-width="5"/>
    <text x="72" y="78" text-anchor="middle" fill="${permission.color}" font-size="16" font-weight="900" font-family="Arial">${permission.short}</text>
    <text x="72" y="129" text-anchor="middle" fill="#ffffff" font-size="19" font-weight="900" font-family="Arial">${permission.name}</text>
  `, permission.color));
}

function errorCard(message = "Codex 未连接") {
  return svgData(shell(`
    <text x="72" y="58" text-anchor="middle" fill="#ff6674" font-size="30" font-weight="800" font-family="Arial">!</text>
    <text x="72" y="88" text-anchor="middle" fill="#f2f5fb" font-size="13" font-weight="700" font-family="Arial">Codex 未连接</text>
    <text x="72" y="109" text-anchor="middle" fill="#8490a3" font-size="9" font-family="Arial">${text(truncate(message, 20))}</text>
  `, "#ff6674"));
}

function formatReset(epochSeconds) {
  if (!epochSeconds) return "--";
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

module.exports = {
  taskCard,
  codexTaskProvider,
  usageCard,
  modelCard,
  permissionCard,
  valueCard,
  errorCard,
  effortColor,
  truncate
};
