/* Scheduling and edition rules. All timestamps are local-device wall-clock time. */
(function (root) {
  const DEFAULTS = {
    times: ["09:00", "18:00"],
    windowMinutes: 60,
    maxPosts: 20,
    activeMinutes: 10,
  };
  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function validate(input) {
    if (!input || !Array.isArray(input.times))
      throw Error("Choose your session times.");
    const times = [...new Set(input.times)].sort();
    if (
      !times.length ||
      times.length > 6 ||
      times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    )
      throw Error("Choose one to six times, like 09:00, 18:00.");
    for (const [key, min, max] of [
      ["windowMinutes", 10, 180],
      ["maxPosts", 5, 20],
      ["activeMinutes", 1, 30],
    ])
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
        throw Error(`Invalid ${key}.`);
    return {
      times,
      windowMinutes: input.windowMinutes,
      maxPosts: input.maxPosts,
      activeMinutes: input.activeMinutes,
    };
  }
  const initial = () => ({
    settings: structuredClone(DEFAULTS),
    pending: null,
    used: [],
    welcomeAvailable: true,
    session: null,
  });
  function slots(settings, now) {
    const out = [];
    for (let offset = -1; offset <= 2; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      for (const time of settings.times) {
        const [h, m] = time.split(":").map(Number);
        const start = new Date(date);
        start.setHours(h, m, 0, 0);
        out.push({
          key: `${dayKey(start)}/${time}`,
          start: +start,
          end: +start + settings.windowMinutes * 60000,
        });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function settle(state, now) {
    if (state.pending && now >= state.pending.at) {
      state.settings = state.pending.settings;
      state.pending = null;
    }
    const s = state.session;
    if (s && !s.ended) {
      if (["ready", "loading"].includes(s.phase) && now >= s.captureDeadline) {
        s.phase = "error";
        s.error =
          "X did not return a For you batch. Switch to For you and try again.";
      }
      if (now >= s.endsAt || s.activeMs >= s.activeLimitMs) {
        s.ended = true;
        s.reason = "time";
      }
    }
    return state;
  }
  function availability(state, now) {
    settle(state, now);
    const last = state.session?.posts.length ? state.session.startedAt : 0;
    const all = slots(state.settings, now).filter(
      (s) => !state.used.includes(s.key) && s.start > last,
    );
    return {
      current:
        all.filter((s) => s.start <= now && now < s.end).at(-1) ||
        (state.welcomeAvailable
          ? { key: "welcome", start: now, end: null }
          : null),
      next: all.find((s) => s.start > now) || null,
    };
  }
  function begin(state, now, tabId) {
    settle(state, now);
    if (state.session && !state.session.ended)
      throw Error("An edition is already open.");
    const { current } = availability(state, now);
    if (!current) throw Error("Your next edition is not available yet.");
    state.session = {
      id: `${current.key}/${now}`,
      slotKey: current.key,
      slotStart: current.start,
      startedAt: now,
      endsAt: now + 45 * 60000,
      captureDeadline: now + 20000,
      activeLimitMs: state.settings.activeMinutes * 60000,
      maxPosts: state.settings.maxPosts,
      activeMs: 0,
      lastPulse: now,
      ended: false,
      reason: null,
      phase: "ready",
      captureTab: tabId,
      attempts: 0,
      posts: [],
      seen: [],
      details: [],
      notificationsLoaded: false,
    };
    return state.session;
  }
  function freeze(state, posts, now) {
    const s = state.session;
    if (!s || s.ended || s.phase !== "loading") return false;
    if (!posts.length) {
      s.phase = "error";
      return false;
    }
    s.posts = posts.slice(0, s.maxPosts);
    state.welcomeAvailable = false;
    s.error = null;
    s.diagnostic = null;
    s.phase = "frozen";
    s.frozenAt = now;
    s.lastPulse = now;
    state.used = [...state.used.slice(-50), s.slotKey];
    return true;
  }
  function pulse(state, now) {
    settle(state, now);
    const s = state.session;
    if (s && !s.ended && s.phase === "frozen") {
      s.activeMs += Math.max(0, Math.min(now - s.lastPulse, 2000));
      s.lastPulse = now;
      settle(state, now);
    }
  }
  function saveSettings(state, input, now) {
    const settings = validate(input);
    if (!state.used.length && !state.session?.posts.length) {
      state.settings = settings;
      return;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    state.pending = { settings, at: +tomorrow };
  }
  function view(state, now) {
    const { current, next } = availability(state, now);
    return {
      settings: state.settings,
      pending: state.pending,
      session: state.session,
      available: !!current,
      firstUse: current?.key === "welcome",
      availableUntil: current?.end || null,
      nextAt: next?.start || null,
      now,
    };
  }
  const api = {
    DEFAULTS,
    validate,
    initial,
    slots,
    settle,
    availability,
    begin,
    freeze,
    pulse,
    saveSettings,
    view,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.BriefCore = api;
})(globalThis);
