const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");

const logDir = path.resolve(__dirname, "../../log");
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, "codex-control.log");
const log = {
  info: (...args) => fs.appendFileSync(logPath, `${new Date().toISOString()} INFO ${args.map(stringify).join(" ")}\n`),
  error: (...args) => fs.appendFileSync(logPath, `${new Date().toISOString()} ERROR ${args.map(stringify).join(" ")}\n`)
};
function stringify(value) {
  if (value instanceof Error) return value.stack || value.message;
  return typeof value === "string" ? value : JSON.stringify(value);
}

process.on("uncaughtException", error => log.error("uncaughtException", error));
process.on("unhandledRejection", error => log.error("unhandledRejection", error));

class Plugins {
  static globalSettings = {};
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${process.argv[3]}`);
    this.ws.on("open", () => this.ws.send(JSON.stringify({ uuid: process.argv[5], event: process.argv[7] })));
    this.ws.on("close", () => process.exit(0));
    this.ws.on("message", raw => {
      const data = JSON.parse(raw.toString());
      const actionName = data.action?.split(".").pop();
      if (data.event === "didReceiveGlobalSettings") Plugins.globalSettings = data.payload.settings || {};
      this[actionName]?.[data.event]?.(data);
      this[data.event]?.(data);
    });
    this.ws.once("open", () => this.getGlobalSettings());
  }
  send(event, payload = {}) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event, ...payload }));
  }
  getGlobalSettings() {
    this.send("getGlobalSettings", { context: process.argv[5] });
  }
  setGlobalSettings(payload) {
    Plugins.globalSettings = payload;
    this.send("setGlobalSettings", { context: process.argv[5], payload });
  }
  setImage(context, image) {
    this.send("setImage", { context, payload: { target: 0, image } });
  }
  setSettings(context, payload) {
    this.send("setSettings", { context, payload });
  }
  showOk(context) {
    this.send("showOk", { context });
  }
  showAlert(context) {
    this.send("showAlert", { context });
  }
  openUrl(url) {
    this.send("openUrl", { payload: { url } });
  }
  sendToPropertyInspector(action, context, payload) {
    this.send("sendToPropertyInspector", { action, context, payload });
  }
}

class Actions {
  static currentAction = null;
  static currentContext = null;
  constructor(data) {
    this.data = {};
    this.default = {};
    Object.assign(this, data);
  }
  willAppear(data) {
    this.data[data.context] = { ...this.default, ...(data.payload.settings || {}) };
    this._willAppear?.(data);
  }
  willDisappear(data) {
    this._willDisappear?.(data);
    delete this.data[data.context];
  }
  didReceiveSettings(data) {
    this.data[data.context] = { ...this.default, ...(data.payload.settings || {}) };
    this._didReceiveSettings?.(data);
  }
  propertyInspectorDidAppear(data) {
    Actions.currentAction = data.action;
    Actions.currentContext = data.context;
    this._propertyInspectorDidAppear?.(data);
  }
}

module.exports = { Plugins, Actions, log };
