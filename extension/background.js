/* Firefox owns the request boundary. X receives a finite, cursor-free edition. */
let state,
  kept = [];
let queue = Promise.resolve(),
  lastSaved = 0;
const nativeTabs = new Map(),
  epochs = new Map(),
  detailCache = new Map();
const ready = browser.storage.local.get(["brief", "kept"]).then((data) => {
  state = data.brief || BriefCore.initial();
  kept = data.kept || [];
  if (state.session?.phase === "loading") {
    state.session.phase = "error";
    state.session.error =
      "The browser closed before this edition finished loading.";
  }
});
async function persist() {
  await browser.storage.local.set({ brief: state });
  lastSaved = Date.now();
}
function transaction(fn, save = true) {
  const result = queue.then(async () => {
    await ready;
    const before = [
      state.session?.phase,
      state.session?.ended,
      state.pending?.at,
    ].join("|");
    BriefCore.settle(state, Date.now());
    const value = await fn();
    const changed =
      before !==
      [state.session?.phase, state.session?.ended, state.pending?.at].join("|");
    if (save || changed) await persist();
    return value;
  });
  queue = result.catch(() => {});
  return result;
}
function publicState(tabId) {
  return {
    ...BriefCore.view(state, Date.now()),
    native: !!tabId && nativeTabs.get(tabId) === state.session?.id,
    keptIds: kept.map((p) => p.id),
  };
}
const filters = {
  urls: [
    "https://x.com/*",
    "https://*.x.com/*",
    "https://twitter.com/*",
    "https://*.twitter.com/*",
  ],
  types: ["xmlhttprequest"],
};
function bodyText(d) {
  try {
    return (
      d.requestBody?.raw
        ?.map((p) => new TextDecoder().decode(p.bytes))
        .join("") || ""
    );
  } catch {
    return "";
  }
}
function allowedIds() {
  const ids = BriefPosts.allowedIds([...(state.session?.posts || []), ...kept]);
  for (const id of state.session?.notificationIds || []) ids.add(id);
  return ids;
}
function pipe(filter, transform, onFailure) {
  let chunks = [],
    length = 0,
    failed = false;
  filter.ondata = (e) => {
    length += e.data.byteLength;
    if (length > 8 * 1024 * 1024) {
      failed = true;
      chunks = [];
    } else if (!failed) chunks.push(new Uint8Array(e.data));
  };
  filter.onstop = async () => {
    try {
      if (failed) throw Error("The response was too large.");
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const result = await transform(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      filter.write(new TextEncoder().encode(JSON.stringify(result)));
      filter.close();
    } catch (error) {
      console.warn("X Brief capture:", error.message);
      try {
        filter.write(
          new TextEncoder().encode(
            '{"errors":[{"message":"X Brief could not read this response."}]}',
          ),
        );
        filter.close();
      } catch {}
      onFailure(error.message);
    }
  };
  filter.onerror = () => onFailure(filter.error);
}
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const body = bodyText(details),
      kind = BriefPosts.classify(details.url, body),
      vars = BriefPosts.variables(details.url, body);
    if (kind === "other") return {};
    if (kind === "badge") return { cancel: true };
    // Firefox requires creating the stream filter synchronously in the event callback.
    const responseFilter = ["home", "detail", "notifications"].includes(kind)
      ? browser.webRequest.filterResponseData(details.requestId)
      : null;
    return transaction(() => {
      const s = state.session;
      if (!s || s.ended) return { cancel: true };
      // Only one finite notifications page, while an edition is open. Replies to you stay useful.
      if (kind === "notifications") {
        if (
          s.phase !== "frozen" ||
          vars.cursor ||
          (s.notificationsLoaded &&
            s.notificationsRequest !== details.requestId)
        )
          return { cancel: true };
        s.notificationsLoaded = true;
        s.notificationsRequest = details.requestId;
        const id = s.id;
        pipe(
          responseFilter,
          (payload) =>
            transaction(() => {
              if (state.session?.id !== id || s.ended)
                throw Error("Edition closed");
              s.notificationIds = BriefPosts.notificationIds(payload);
              return payload;
            }),
          () => {},
        );
        return {};
      }
      if (kind === "detail") {
        const id = vars.focalTweetId || vars.tweetId;
        if (s.phase !== "frozen" || !allowedIds().has(id) || vars.cursor)
          return { cancel: true };
        const sessionId = s.id;
        pipe(
          responseFilter,
          (payload) =>
            transaction(() => {
              if (state.session?.id !== sessionId || state.session.ended)
                throw Error("Edition closed");
              if (detailCache.has(id)) return detailCache.get(id);
              const limited = BriefPosts.prune(payload, 11);
              if (!limited.recognized || !limited.posts.length)
                throw Error("Unknown conversation");
              detailCache.set(id, limited.payload);
              return limited.payload;
            }, false),
          () => {},
        );
        return {};
      }
      // Root For You only. Top refreshes, pagination, Following and other discovery routes are denied.
      const continuing =
        s.phase === "loading" && s.pendingRequest === details.requestId;
      if (
        kind !== "home" ||
        BriefPosts.operation(details.url, body) !== "HomeTimeline" ||
        vars.cursor ||
        (!continuing && s.phase !== "ready") ||
        s.captureTab !== details.tabId
      )
        return { cancel: true };
      s.phase = "loading";
      if (!continuing) s.attempts++;
      s.pendingRequest = details.requestId;
      s.captureGeneration = (s.captureGeneration || 0) + 1;
      const ticket = s.attempts,
        generation = s.captureGeneration,
        sessionId = s.id,
        epoch = epochs.get(details.tabId) || 0;
      const failed = (reason) =>
        transaction(() => {
          if (
            state.session?.id !== sessionId ||
            s.attempts !== ticket ||
            s.captureGeneration !== generation ||
            s.ended
          )
            return;
          // Firefox reroutes a controlled fetch through the service worker before the network.
          // This is not a delivered page, and must not consume the capture reservation.
          if (
            reason === "ServiceWorker fallback redirection" &&
            (s.fallbacks || 0) < 4
          ) {
            s.fallbacks = (s.fallbacks || 0) + 1;
            s.attempts--;
            s.phase = "ready";
            return;
          }
          s.phase = "error";
          s.diagnostic = String(reason || "network filter failed").slice(
            0,
            180,
          );
          s.error =
            "X didn’t return a readable For you batch. You can retry this edition.";
        }).catch(() => {});
      pipe(
        responseFilter,
        (payload) =>
          transaction(() => {
            if (
              state.session?.id !== sessionId ||
              s.attempts !== ticket ||
              s.captureGeneration !== generation ||
              s.ended
            )
              throw Error("Stale capture");
            const limited = BriefPosts.prune(payload, s.maxPosts);
            if (!limited.recognized || !limited.posts.length)
              throw Error("Unknown timeline");
            if (!BriefCore.freeze(state, limited.posts, Date.now()))
              throw Error("Capture expired");
            if ((epochs.get(details.tabId) || 0) === epoch)
              nativeTabs.set(details.tabId, s.id);
            return limited.payload;
          }),
        failed,
      );
      return {};
    })
      .then((result) => {
        if (result.cancel && responseFilter) {
          try {
            responseFilter.disconnect();
          } catch {}
        }
        return result;
      })
      .catch(() => {
        try {
          responseFilter?.disconnect();
        } catch {}
        return { cancel: true };
      });
  },
  filters,
  ["blocking", "requestBody"],
);
function trusted(sender) {
  const u = sender.url || "";
  return (
    u.startsWith(browser.runtime.getURL("")) ||
    /^https:\/\/(www\.)?(x|twitter)\.com\//.test(u)
  );
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (!trusted(sender)) return Promise.reject(Error("Unknown sender"));
  const fromOptions = (sender.url || "").startsWith(browser.runtime.getURL(""));
  const save = !["state", "pulse", "openSettings", "seen"].includes(
    message.type,
  );
  return transaction(async () => {
    const now = Date.now();
    switch (message.type) {
      case "state":
        return publicState(sender.tab?.id);
      case "openSettings":
        await browser.runtime.openOptionsPage();
        return { ok: true };
      case "shelf":
        return kept;
      case "start": {
        if (!sender.tab || fromOptions) throw Error("Start an edition from X.");
        BriefCore.begin(state, now, sender.tab.id);
        nativeTabs.clear();
        detailCache.clear();
        return publicState(sender.tab.id);
      }
      case "retry": {
        const s = state.session;
        if (
          !sender.tab ||
          !s ||
          s.ended ||
          s.phase !== "error" ||
          s.posts.length
        )
          throw Error("This edition cannot be retried.");
        s.phase = "ready";
        s.captureTab = sender.tab.id;
        s.captureDeadline = now + 20000;
        return publicState(sender.tab.id);
      }
      case "pulse": {
        if (sender.tab && message.recentInput) {
          const tab = await browser.tabs.get(sender.tab.id),
            win = await browser.windows.get(tab.windowId);
          if (tab.active && win.focused) BriefCore.pulse(state, now);
        }
        if (
          state.session &&
          !state.session.ended &&
          state.session.phase === "frozen" &&
          now - lastSaved >= 10000
        )
          await persist();
        return publicState(sender.tab?.id);
      }
      case "seen": {
        const s = state.session;
        if (
          s &&
          !s.ended &&
          s.posts.some((p) => p.id === message.id) &&
          !s.seen.includes(message.id)
        )
          s.seen.push(message.id);
        return { ok: true };
      }
      case "finish":
        if (state.session && !state.session.ended) {
          state.session.ended = true;
          state.session.reason = "finished";
          nativeTabs.clear();
        }
        return publicState(sender.tab?.id);
      case "settings":
        if (!fromOptions) throw Error("Use extension settings.");
        BriefCore.saveSettings(state, message.settings, now);
        return publicState();
      case "keep": {
        const id = String(message.id),
          existing = kept.findIndex((p) => p.id === id);
        if (existing >= 0) kept.splice(existing, 1);
        else {
          const post = state.session?.posts.find((p) => p.id === id);
          if (!post) throw Error("Post not in this edition.");
          kept.unshift({ ...post, keptAt: now });
        }
        kept = kept.slice(0, 200);
        await browser.storage.local.set({ kept });
        return kept.map((p) => p.id);
      }
      case "removeKept":
        kept = kept.filter((p) => p.id !== message.id);
        await browser.storage.local.set({ kept });
        return { ok: true };
      default:
        throw Error("Unknown action");
    }
  }, save);
});
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") {
    nativeTabs.delete(tabId);
    epochs.set(tabId, (epochs.get(tabId) || 0) + 1);
  }
});
browser.tabs.onRemoved.addListener((tabId) => {
  nativeTabs.delete(tabId);
  epochs.delete(tabId);
  transaction(() => {
    const s = state.session;
    if (
      s &&
      !s.ended &&
      s.captureTab === tabId &&
      ["ready", "loading"].includes(s.phase)
    )
      s.phase = "error";
  }).catch(() => {});
});
