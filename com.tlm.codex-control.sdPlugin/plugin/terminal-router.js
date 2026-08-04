const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TERMINALS = ["auto", "otty", "terminal", "iterm2", "ghostty", "kitty", "wezterm"];

function openAgentSession({ id, provider, cwd, command, preference = "auto", log }) {
  if (process.platform === "darwin") {
    if (focusOttySession(id, provider)) return true;
    const terminal = preference === "auto" ? detectMacTerminal() : preference;
    return launchMac(command, cwd, terminal, log) || launchMac(command, cwd, "terminal", log);
  }
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/d", "/s", "/c", "start", provider === "claude" ? "Claude" : "Codex CLI", "cmd.exe", "/k", command], {
      detached: true, stdio: "ignore", windowsHide: true
    }).unref();
    return true;
  }
  spawn("x-terminal-emulator", ["-e", command], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function focusOttySession(id, provider = "codex") {
  if (process.platform !== "darwin" || !/^[A-Za-z0-9_-]+$/.test(String(id || ""))) return false;
  const database = path.join(os.homedir(), "Library", "Application Support", "io.appmakes.otty", "state.db");
  const cli = findExecutable([
    "/Applications/Otty.app/Contents/MacOS/otty-cli",
    path.join(os.homedir(), "Applications", "Otty.app", "Contents", "MacOS", "otty-cli"),
    "/opt/homebrew/bin/otty",
    "/usr/local/bin/otty"
  ]);
  if (!fs.existsSync(database) || !cli) return false;

  // A newly started Codex TUI inherits OTTY_PANE_ID. Otty may temporarily
  // clear resume_key while the task is running, so match the UUIDv7 session
  // creation time to the interactive Codex process before consulting state.db.
  const launchedPane = provider === "codex" ? findOttyPaneByCodexLaunch(id, database) : null;
  if (launchedPane && focusOttyPane(cli, launchedPane)) return true;

  const kind = provider === "claude" ? "claude" : "codex";
  const query = `SELECT id FROM pane WHERE program_type='${kind}' AND resume_key='${id}' AND closed_at IS NULL LIMIT 1;`;
  const selected = spawnSync("/usr/bin/sqlite3", [database, query], { encoding: "utf8", timeout: 1500 });
  const pane = String(selected.stdout || "").trim();
  if (selected.status === 0 && pane && focusOttyPane(cli, pane)) return true;

  // Sessions that were explicitly resumed expose their id in the process
  // command. This is the fallback when the original process is no longer live.
  const resumedPane = findOttyPaneByResumeCommand(id, database, provider);
  return resumedPane ? focusOttyPane(cli, resumedPane) : false;
}

function findOttyPaneByCodexLaunch(id, database) {
  const startedAt = uuidV7Milliseconds(id);
  if (!startedAt) return null;
  return findOttyProcessPane(database, ({ command, processStartedAt }) => {
    if (!isInteractiveAgentCommand(command, "codex")) return null;
    const distance = Math.abs(processStartedAt - startedAt);
    return distance <= 120000 ? distance : null;
  });
}

function findOttyPaneByResumeCommand(id, database, provider) {
  return findOttyProcessPane(database, ({ command }) => {
    const matches = provider === "claude"
      ? command.includes(`claude --resume ${id}`)
      : command.includes(`codex resume ${id}`);
    return matches ? 0 : null;
  });
}

function findOttyProcessPane(database, scoreCandidate) {
  const result = spawnSync("/bin/ps", ["ax", "-o", "pid=,etime=,command="], { encoding: "utf8", timeout: 1500 });
  if (result.status !== 0) return null;
  const now = Date.now();
  const candidates = [];
  for (const line of String(result.stdout || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const elapsed = parseElapsedMilliseconds(match[2]);
    if (elapsed == null) continue;
    const candidate = { pid: match[1], command: match[3], processStartedAt: now - elapsed };
    const score = scoreCandidate(candidate);
    if (score == null) continue;
    const environment = spawnSync("/bin/ps", ["eww", "-p", candidate.pid, "-o", "command="], {
      encoding: "utf8", timeout: 1000
    });
    const pane = String(environment.stdout || "").match(/(?:^|\s)OTTY_PANE_ID=([A-Za-z0-9_-]+)/)?.[1];
    if (!pane || !isActiveOttyPane(database, pane)) continue;
    candidates.push({ pane, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.pane || null;
}

function isInteractiveAgentCommand(command, provider) {
  if (provider !== "codex") return false;
  return /(?:^|\s)(?:node\s+\S*\/codex|\S*\/codex)(?:\s|$)/.test(command)
    && !/(?:\s|\/)(?:app-server|codex-code-mode-host)(?:\s|$)/.test(command)
    && !/(?:^|\/|\s)codex\s+exec(?:\s|$)/.test(command);
}

function isActiveOttyPane(database, pane) {
  const raw = pane.startsWith("p_") ? pane.slice(2) : pane;
  const query = `SELECT COUNT(*) FROM pane WHERE id='${raw}' AND closed_at IS NULL;`;
  const result = spawnSync("/usr/bin/sqlite3", [database, query], { encoding: "utf8", timeout: 1000 });
  return result.status === 0 && String(result.stdout || "").trim() === "1";
}

function focusOttyPane(cli, pane) {
  const selector = pane.startsWith("p_") ? pane : `p_${pane}`;
  const focused = spawnSync(cli, ["pane", "focus", selector], { encoding: "utf8", timeout: 3000 });
  if (focused.status !== 0) return false;
  spawn("open", ["-a", "Otty"], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function uuidV7Milliseconds(id) {
  const compact = String(id || "").replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact) || compact[12].toLowerCase() !== "7") return null;
  const value = Number.parseInt(compact.slice(0, 12), 16);
  return Number.isSafeInteger(value) ? value : null;
}

function parseElapsedMilliseconds(value) {
  const match = String(value).match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function detectMacTerminal() {
  const candidates = [
    ["otty", "Otty"], ["iterm2", "iTerm2"], ["ghostty", "Ghostty"],
    ["kitty", "kitty"], ["wezterm", "WezTerm"], ["terminal", "Terminal"]
  ];
  for (const [value, processName] of candidates) {
    if (spawnSync("/usr/bin/pgrep", ["-x", processName], { timeout: 500 }).status === 0) return value;
  }
  return "terminal";
}

function launchMac(command, cwd, terminal, log) {
  try {
    if (terminal === "otty" || terminal === "terminal") {
      const app = terminal === "otty" ? "Otty" : "Terminal";
      runAppleScript(`tell application "${app}" to activate\ntell application "${app}" to do script "${appleScriptText(command)}"`);
      return true;
    }
    if (terminal === "iterm2") {
      runAppleScript(`tell application "iTerm2" to activate\ntell application "iTerm2" to create window with default profile command "${appleScriptText(command)}"`);
      return true;
    }
    if (terminal === "ghostty") {
      runAppleScript(`tell application "Ghostty"
activate
set cfg to new surface configuration
set initial working directory of cfg to "${appleScriptText(cwd)}"
set command of cfg to "${appleScriptText(command)}"
new window with configuration cfg
end tell`);
      return true;
    }
    if (terminal === "kitty") {
      const cli = findExecutable(["/Applications/kitty.app/Contents/MacOS/kitty", "/opt/homebrew/bin/kitty", "/usr/local/bin/kitty"]);
      if (!cli) return false;
      const result = spawnSync(cli, ["@", "launch", "--type=tab", "--cwd", cwd, "/bin/zsh", "-lc", command], { timeout: 3000 });
      if (result.status !== 0) return false;
      spawn("open", ["-a", "kitty"], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (terminal === "wezterm") {
      const cli = findExecutable(["/Applications/WezTerm.app/Contents/MacOS/wezterm", "/opt/homebrew/bin/wezterm", "/usr/local/bin/wezterm"]);
      if (!cli) return false;
      const result = spawnSync(cli, ["cli", "spawn", "--cwd", cwd, "--", "/bin/zsh", "-lc", command], { timeout: 3000 });
      if (result.status !== 0) return false;
      spawn("open", ["-a", "WezTerm"], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch (error) {
    log?.error?.("terminal launch", error);
  }
  return false;
}

function runAppleScript(script) {
  const result = spawnSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8", timeout: 5000 });
  if (result.status !== 0) throw new Error(String(result.stderr || "AppleScript failed").trim());
}

function findExecutable(candidates) {
  return candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  });
}

function appleScriptText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

module.exports = {
  TERMINALS,
  openAgentSession,
  focusOttySession,
  detectMacTerminal,
  uuidV7Milliseconds,
  parseElapsedMilliseconds
};
