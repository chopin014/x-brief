(async () => {
  const ids = ["windowMinutes", "maxPosts", "activeMinutes"];
  const view = await browser.runtime.sendMessage({ type: "state" });
  const settings = view.pending?.settings || view.settings;
  document.querySelector("#times").value = settings.times.join(", ");
  ids.forEach((id) => (document.getElementById(id).value = settings[id]));
  const status = document.querySelector("#status");
  if (view.pending)
    status.textContent = `Saved changes take effect ${new Date(view.pending.at).toLocaleString()}.`;
  document.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const settings = {
        times: document
          .querySelector("#times")
          .value.split(",")
          .map((t) => t.trim()),
      };
      ids.forEach(
        (id) => (settings[id] = Number(document.getElementById(id).value)),
      );
      const result = await browser.runtime.sendMessage({
        type: "settings",
        settings,
      });
      status.textContent = result.pending
        ? `Saved. Takes effect ${new Date(result.pending.at).toLocaleString()}.`
        : "Saved. Your reading schedule is ready.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  async function render() {
    const { kept = [] } = await browser.storage.local.get("kept");
    const list = document.querySelector("#kept");
    list.replaceChildren();
    for (const post of kept) {
      const article = document.createElement("article");
      const author = document.createElement("strong");
      author.textContent = `${post.name} · @${post.handle}`;
      const p = document.createElement("p");
      p.textContent = post.text;
      const footer = document.createElement("footer");
      const a = document.createElement("a");
      a.textContent = "Original post ↗";
      a.href = `https://x.com/${post.handle}/status/${post.id}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "quiet";
      remove.textContent = "Remove from shelf";
      remove.addEventListener("click", async () => {
        await browser.runtime.sendMessage({ type: "removeKept", id: post.id });
        render();
      });
      footer.append(a, remove);
      article.append(author, p, footer);
      list.append(article);
    }
  }
  await render();
})();
