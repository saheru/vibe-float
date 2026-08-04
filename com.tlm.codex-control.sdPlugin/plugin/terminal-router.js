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
  const kind = provider === "claude" ? "claude" : "codex";
  const query = `SELECT id FROM pane WHERE program_type='${kind}' AND resume_key='${id}' AND closed_at IS NULL LIMIT 1;`;
  const selected = spawnSync("/usr/bin/sqlite3", [database, query], { encoding: "utf8", timeout: 1500 });
  const pane = String(selected.stdout || "").trim();
  if (selected.status !== 0 || !pane) return false;
  const selector = pane.startsWith("p_") ? pane : `p_${pane}`;
  const focused = spawnSync(cli, ["pane", "focus", selector], { encoding: "utf8", timeout: 3000 });
  if (focused.status !== 0) return false;
  spawn("open", ["-a", "Otty"], { detached: true, stdio: "ignore" }).unref();
  return true;
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

module.exports = { TERMINALS, openAgentSession, focusOttySession, detectMacTerminal };
