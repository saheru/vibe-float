function collectStatusNotifications(cache, threads, watched) {
  const events = [];
  for (const thread of threads || []) {
    const preferences = watched.get(thread.id);
    if (!preferences) continue;
    const current = {
      type: thread.displayStatus?.type || "notLoaded",
      eventKey: thread.displayStatus?.eventKey || null
    };
    const previous = cache.get(thread.id);
    cache.set(thread.id, current);
    if (!previous) continue;
    const previousType = typeof previous === "string" ? previous : previous.type;
    const previousEventKey = typeof previous === "string" ? null : previous.eventKey;
    if (previousType === current.type && previousEventKey === current.eventKey) continue;
    if (
      current.type === "idle"
      && (
        ["active", "needsInput"].includes(previousType)
        || Boolean(current.eventKey && current.eventKey !== previousEventKey)
      )
      && preferences.notifyDone
    ) {
      events.push({ type: "done", thread });
    }
    if (current.type === "needsInput" && preferences.notifyInput) {
      events.push({ type: "input", thread });
    }
  }
  return events;
}

function formatStatusNotification(type, thread) {
  const needsInput = type === "input";
  const provider = String(thread?.provider || "codex").toLowerCase() === "claude" ? "Claude" : "Codex";
  return {
    title: `${provider} 任务通知`,
    subtitle: needsInput ? "状态：待回复" : "状态：已完成",
    message: `任务：${String(thread?.name || thread?.preview || "未命名任务").slice(0, 100)}`,
    sound: needsInput ? "Sosumi" : "Hero",
    soundVolume: 2,
    soundRepeats: 2
  };
}

module.exports = { collectStatusNotifications, formatStatusNotification };
