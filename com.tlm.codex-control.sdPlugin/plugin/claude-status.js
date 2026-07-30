#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const chunks = [];
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks);
  const home = os.homedir();
  const cache = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Vibe Float", "claude-status.json")
    : path.join(home, "Library", "Application Support", "Vibe Float", "claude-status.json");
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, input);
  } catch {}

  const index = process.argv.indexOf("--next-base64");
  const encoded = index >= 0 ? process.argv[index + 1] : "";
  const command = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  if (!command) return;
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/zsh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const result = spawnSync(shell, args, { input, stdio: ["pipe", "pipe", "inherit"] });
  if (result.stdout) process.stdout.write(result.stdout);
  process.exitCode = result.status ?? 0;
});
