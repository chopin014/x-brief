const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
async function page(view, pathname = "/home") {
  const d = new JSDOM(
    '<!doctype html><html><body><main><div data-testid="primaryColumn"><div id="native">Native timeline</div></div></main></body></html>',
    {
      url: "https://x.com" + pathname,
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const w = d.window;
  w.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  w.scrollTo = () => {};
  w.browser = {
    runtime: { sendMessage: async (m) => (m.type === "shelf" ? [] : view) },
    storage: { onChanged: { addListener() {} } },
  };
  w.eval(fs.readFileSync("extension/content.js", "utf8"));
  await new Promise((r) => setTimeout(r, 35));
  return d;
}
test("closed state hides native feed and gives real utility links", async () => {
  const d = await page({
    session: null,
    available: false,
    nextAt: Date.now() + 3600000,
  });
  try {
    const doc = d.window.document;
    assert.ok(doc.documentElement.hasAttribute("data-brief-feed"));
    assert.match(
      doc.querySelector("#x-brief-reader").textContent,
      /Between editions/,
    );
    assert.ok(doc.querySelector('a[href="https://x.com/i/chat"]'));
  } finally {
    d.window.dispatchEvent(new d.window.Event("unload"));
    d.window.close();
  }
});
test("native edition is visible while the saved overlay is hidden", async () => {
  const d = await page({
    native: true,
    session: {
      id: "one",
      slotStart: Date.now(),
      phase: "frozen",
      ended: false,
      posts: [{ id: "123" }],
      seen: [],
      activeMs: 0,
      activeLimitMs: 600000,
    },
  });
  try {
    const doc = d.window.document;
    assert.equal(doc.documentElement.hasAttribute("data-brief-feed"), false);
    assert.ok(doc.querySelector("#x-brief-reader").hidden);
    assert.ok(doc.querySelector("#x-brief-native-end"));
    assert.doesNotMatch(
      doc.querySelector("#x-brief-status").textContent,
      /\d:\d\d/,
    );
  } finally {
    d.window.dispatchEvent(new d.window.Event("unload"));
    d.window.close();
  }
});
test("outside-edition details are explicitly blocked, cached X content stays hidden", async () => {
  const d = await page(
    {
      native: false,
      session: {
        id: "one",
        phase: "frozen",
        ended: false,
        posts: [],
        seen: [],
        activeMs: 0,
        activeLimitMs: 600000,
      },
    },
    "/someone/status/999",
  );
  try {
    assert.match(
      d.window.document.querySelector("#x-brief-reader").textContent,
      /Outside this edition/,
    );
    assert.ok(
      d.window.document.documentElement.hasAttribute("data-brief-feed"),
    );
  } finally {
    d.window.dispatchEvent(new d.window.Event("unload"));
    d.window.close();
  }
});
