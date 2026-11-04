const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const C = require("../extension/core");
const P = require("../extension/posts");
function environment() {
  let handler, request;
  const filters = new Map(),
    writes = [];
  const state = C.initial();
  state.settings.times = [new Date().toTimeString().slice(0, 5)];
  const browser = {
    storage: {
      local: {
        get: async () => ({ brief: state, kept: [] }),
        set: async (d) => writes.push(structuredClone(d)),
      },
    },
    runtime: {
      getURL: (p) => "moz-extension://test/" + p,
      onMessage: { addListener: (f) => (handler = f) },
      openOptionsPage: async () => {},
    },
    webRequest: {
      onBeforeRequest: { addListener: (f) => (request = f) },
      filterResponseData: (id) => {
        const f = {
          write: (data) =>
            (f.output = (f.output || "") + new TextDecoder().decode(data)),
          close: () => {
            f.closed = true;
          },
        };
        filters.set(id, f);
        return f;
      },
    },
    tabs: {
      get: async () => ({ active: true, windowId: 1 }),
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
    windows: { get: async () => ({ focused: true }) },
  };
  const context = vm.createContext({
    browser,
    BriefCore: C,
    BriefPosts: P,
    TextDecoder,
    TextEncoder,
    structuredClone,
    Date,
    URL,
    console: { ...console, warn: () => {} },
    setTimeout,
  });
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  const sender = { url: "https://x.com/home", tab: { id: 1 } };
  const message = (type, extra = {}) => handler({ type, ...extra }, sender);
  const req = (name, id = "req", vars = {}, tabId = 1) =>
    request({
      url: `https://x.com/i/api/graphql/hash/${name}?variables=${encodeURIComponent(JSON.stringify(vars))}`,
      requestId: id,
      tabId,
    });
  return { message, req, filters, state, writes };
}
function payload() {
  return {
    data: {
      home: {
        instructions: [
          { type: "TimelineShowAlert" },
          {
            type: "TimelineAddEntries",
            entries: [
              {
                entryId: "tweet-123",
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: "123",
                        legacy: { full_text: "A useful update" },
                        core: {
                          user_results: {
                            result: {
                              core: {
                                name: "Research",
                                screen_name: "research",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              {
                entryId: "cursor-bottom",
                content: { entryType: "TimelineTimelineCursor", value: "next" },
              },
            ],
          },
        ],
      },
    },
  };
}
test("network gate captures one root only, trims response, blocks refresh and other tabs", async () => {
  const e = environment();
  assert.equal((await e.req("HomeTimeline")).cancel, true);
  await e.message("start");
  assert.equal(
    (await e.req("HomeTimeline", "next", { cursor: "next" })).cancel,
    true,
  );
  assert.equal((await e.req("HomeTimeline", "other", {}, 2)).cancel, true);
  assert.equal((await e.req("HomeLatestTimeline")).cancel, true);
  await e.req("HomeTimeline");
  const f = e.filters.get("req");
  f.ondata({
    data: new TextEncoder().encode(JSON.stringify(payload())).buffer,
  });
  await f.onstop();
  assert.equal(e.state.session.phase, "frozen");
  assert.equal(e.state.session.posts.length, 1);
  assert.equal(f.output.includes("cursor-bottom"), false);
  assert.equal(f.output.includes("TimelineShowAlert"), false);
  assert.equal(e.state.used.length, 1);
  assert.equal((await e.req("HomeTimeline", "root-again")).cancel, true);
  assert.equal((await e.req("SearchTimeline")).cancel, true);
  await e.message("finish");
  assert.equal(
    (await e.req("TweetDetail", "detail", { focalTweetId: "123" })).cancel,
    true,
  );
  await assert.rejects(e.message("start"));
});
test("failed capture can retry without consuming the scheduled edition", async () => {
  const e = environment();
  await e.message("start");
  await e.req("HomeTimeline");
  const f = e.filters.get("req");
  f.ondata({
    data: new TextEncoder().encode('{"data":{"unknown":[]}}').buffer,
  });
  await f.onstop();
  await e.message("state");
  assert.equal(e.state.session.phase, "error");
  assert.equal(e.state.used.length, 0);
  await e.message("retry");
  assert.equal(e.state.session.phase, "ready");
});
test("state reads do not repeatedly persist the entire saved batch", async () => {
  const e = environment();
  await e.message("state");
  await e.message("state");
  assert.equal(e.writes.length, 0);
  await e.message("start");
  assert.equal(e.writes.length, 1);
});
test("Firefox service-worker fallback redirection releases the undelivered capture", async () => {
  const e = environment();
  await e.message("start");
  await e.req("HomeTimeline", "worker");
  const first = e.filters.get("worker");
  first.error = "ServiceWorker fallback redirection";
  first.onerror();
  await e.message("state");
  assert.equal(e.state.session.phase, "ready");
  assert.equal(e.state.used.length, 0);
  await e.req("HomeTimeline", "network");
  const f = e.filters.get("network");
  f.ondata({
    data: new TextEncoder().encode(JSON.stringify(payload())).buffer,
  });
  await f.onstop();
  assert.equal(e.state.session.phase, "frozen");
  assert.equal(e.state.used.length, 1);
});
test("same request ID is admitted for Firefox service-worker fallback before the first filter errors", async () => {
  const e = environment();
  await e.message("start");
  await e.req("HomeTimeline", "same");
  const original = e.filters.get("same");
  assert.equal((await e.req("HomeTimeline", "same")).cancel, undefined);
  const network = e.filters.get("same");
  original.error = "ServiceWorker fallback redirection";
  original.onerror();
  await e.message("state");
  assert.equal(e.state.session.phase, "loading");
  network.ondata({
    data: new TextEncoder().encode(JSON.stringify(payload())).buffer,
  });
  await network.onstop();
  assert.equal(e.state.session.phase, "frozen");
  assert.equal(e.state.session.attempts, 1);
});

test("badge polling is blocked while closed and while reading", async () => {
  const e = environment();
  assert.equal((await e.req("BadgeCount")).cancel, true);
  await e.message("start");
  assert.equal((await e.req("BadgeCount")).cancel, true);
});
