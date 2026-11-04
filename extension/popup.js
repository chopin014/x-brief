(async () => {
  const view = await browser.runtime.sendMessage({ type: "state" });
  const d = document.querySelector("#details");
  d.replaceChildren();
  const s = view.session;
  const p = document.createElement("p");
  if (s && !s.ended)
    p.textContent = `Session open · ${s.posts.length} posts · ${Math.ceil((s.activeLimitMs - s.activeMs) / 60000)} min left`;
  else if (view.available)
    p.textContent = "Your next briefing is available. Start when you’re ready.";
  else
    p.textContent = `Next briefing: ${view.nextAt ? new Date(view.nextAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "check your schedule"}`;
  d.append(p);
  document.querySelector("#schedule").onclick = () =>
    browser.runtime.openOptionsPage();
  document.querySelector("#shelf").onclick = () =>
    browser.tabs.create({ url: browser.runtime.getURL("options.html#shelf") });
})();
