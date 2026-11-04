(() => {
  const doc = document.documentElement,
    send = (m) => browser.runtime.sendMessage(m);
  let view = null,
    root = null,
    bar = null,
    nativeEnd = null,
    nativeHead = null,
    signature = "",
    route = "",
    busy = false,
    lastInput = Date.now(),
    scheduled = false;
  let shelf = [],
    shelfOpen = location.hash === "#brief-kept",
    kept = new Set();
  const observed = new WeakSet();
  const freeRoute = () =>
    /^\/(i\/(flow|jf\/onboarding|oauth|chat|calls)|login|logout|signup|account|settings|messages|compose)(\/|$)/.test(
      location.pathname,
    );
  const active = () => !!view?.session && !view.session.ended;
  const home = () => /^\/(home)?$/.test(location.pathname);
  const detailId = () => location.pathname.match(/\/status\/(\d+)/)?.[1];
  function allowedIds() {
    const ids = new Set();
    for (const p of [...(view?.session?.posts || []), ...shelf]) {
      ids.add(p.id);
      if (p.quote?.id) ids.add(p.quote.id);
      if (p.parentId) ids.add(p.parentId);
    }
    for (const id of view?.session?.notificationIds || []) ids.add(id);
    return ids;
  }
  function profileAllowed() {
    const handle = location.pathname.match(/^\/([a-zA-Z0-9_]{1,30})\/?$/)?.[1];
    return (
      handle &&
      [...(view?.session?.posts || []), ...shelf].some(
        (p) =>
          p.handle?.toLowerCase() === handle.toLowerCase() ||
          p.quote?.handle?.toLowerCase() === handle.toLowerCase(),
      )
    );
  }
  const nativeVisible = () =>
    !shelfOpen &&
    active() &&
    ((home() && view.native) ||
      (detailId() && allowedIds().has(detailId())) ||
      profileAllowed() ||
      location.pathname.startsWith("/notifications"));
  function guard() {
    doc.toggleAttribute("data-brief-feed", !freeRoute() && !nativeVisible());
    doc.toggleAttribute("data-brief-native", home() && nativeVisible());
    doc.toggleAttribute("data-brief-profile", active() && !!profileAllowed());
    doc.setAttribute("data-brief-installed", "");
  }
  guard();
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function action(label, fn, cls = "brief-button") {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  const time = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function editionName(
    ms = view?.session?.slotStart || view?.now || Date.now(),
  ) {
    const h = new Date(ms).getHours();
    return h < 12
      ? "Morning edition"
      : h < 17
        ? "Afternoon edition"
        : "Evening edition";
  }
  function nextLabel() {
    return view?.nextAt
      ? `${editionName(view.nextAt)} · ${new Date(view.nextAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
      : "Choose a reading schedule";
  }
  function safeLink(url, label, cls = "brief-link", external = false) {
    const a = el("a", cls, label);
    try {
      const u = new URL(url, location.origin);
      if (!["https:", "http:"].includes(u.protocol))
        return el("span", cls, label);
      a.href = u.href;
    } catch {
      return el("span", cls, label);
    }
    if (external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    return a;
  }
  function openShelf() {
    shelfOpen = true;
    signature = "";
    history.replaceState(null, "", "#brief-kept");
    mount();
    window.scrollTo(0, 0);
  }
  function back() {
    shelfOpen = false;
    signature = "";
    if (home()) {
      history.replaceState(null, "", "/home");
      mount();
    } else if (sessionStorage.getItem("brief-return")) history.back();
    else location.assign("https://x.com/home");
  }
  function utilityLinks(container) {
    const links = el("div", "brief-utilities");
    links.append(
      safeLink("/compose/post", "Write a post"),
      safeLink("/i/chat", "Messages"),
      action(
        `Kept posts${kept.size ? ` (${kept.size})` : ""}`,
        openShelf,
        "brief-link",
      ),
    );
    container.append(links);
  }
  function rememberPosition() {
    if (home() && active())
      sessionStorage.setItem(
        "brief-return",
        JSON.stringify({ id: view.session.id, y: window.scrollY }),
      );
  }
  document.addEventListener(
    "click",
    (event) => {
      const a = event.target.closest("a[href]");
      if (
        a &&
        a.origin === location.origin &&
        /\/status\/|^\/[\w]+$/.test(a.pathname)
      )
        rememberPosition();
    },
    true,
  );
  function restorePosition() {
    try {
      const p = JSON.parse(sessionStorage.getItem("brief-return"));
      if (p?.id === view?.session?.id && home()) {
        requestAnimationFrame(() => window.scrollTo(0, p.y));
        sessionStorage.removeItem("brief-return");
      }
    } catch {}
  }
  async function keepPost(id, button) {
    try {
      kept = new Set(await send({ type: "keep", id }));
      shelf = await send({ type: "shelf" });
      if (button) {
        button.textContent = kept.has(id)
          ? "Kept privately ✓"
          : "Keep privately";
        button.setAttribute("aria-pressed", String(kept.has(id)));
      }
      document.querySelectorAll(`[data-brief-keep="${id}"]`).forEach((b) => {
        b.textContent = kept.has(id) ? "Kept privately ✓" : "Keep privately";
        b.setAttribute("aria-pressed", String(kept.has(id)));
      });
    } catch {
      if (button) button.textContent = "Could not save";
    }
  }
  function keepButton(id) {
    const b = action(
      kept.has(id) ? "Kept privately ✓" : "Keep privately",
      () => keepPost(id, b),
      "brief-keep",
    );
    b.dataset.briefKeep = id;
    b.setAttribute("aria-pressed", String(kept.has(id)));
    b.title =
      "Save a local copy. This does not bookmark or like the post on X.";
    return b;
  }
  function textWithLinks(post) {
    const p = el("p", "brief-text");
    const links = new Map((post.links || []).map((x) => [x.short, x]));
    for (const part of post.text.split(/(https?:\/\/[^\s]+)/g)) {
      const l = links.get(part);
      if (l)
        p.append(safeLink(l.url, l.label || l.url, "brief-inline-link", true));
      else if (/^https?:\/\//.test(part))
        p.append(safeLink(part, part, "brief-inline-link", true));
      else p.append(document.createTextNode(part));
    }
    return p;
  }
  function card(post, local = false) {
    const c = el("article", "brief-card");
    c.dataset.postId = post.id;
    if (post.socialContext)
      c.append(el("p", "brief-social", post.socialContext));
    const head = el("div", "brief-card-head"),
      author = el("div", "brief-author");
    author.append(
      active()
        ? safeLink(`/${post.handle}`, post.name, "brief-author-link")
        : el("strong", "", post.name),
      el("span", "brief-muted", `@${post.handle}`),
    );
    head.append(author);
    if (post.createdAt && !isNaN(+new Date(post.createdAt)))
      head.append(
        el(
          "time",
          "brief-date",
          new Date(post.createdAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          }),
        ),
      );
    c.append(head);
    if (post.repostBy)
      c.append(el("p", "brief-muted", `Reposted by @${post.repostBy}`));
    if (post.replyTo)
      c.append(el("p", "brief-muted", `Replying to @${post.replyTo}`));
    c.append(textWithLinks(post));
    if (post.quote) {
      const q = el("blockquote", "brief-quote");
      q.append(
        el("strong", "", `${post.quote.name} · @${post.quote.handle}`),
        el("p", "", post.quote.text),
      );
      if (active())
        q.append(
          safeLink(
            `/${post.quote.handle}/status/${post.quote.id}`,
            "Open quoted post",
          ),
        );
      c.append(q);
    }
    if (post.media?.length && !post.sensitive) {
      const media = el("div", "brief-media");
      for (const item of post.media.slice(0, 4)) {
        if (item.video) {
          const video = el("video");
          video.controls = true;
          video.preload = "none";
          video.poster = item.url;
          video.src = item.video;
          video.setAttribute("aria-label", item.alt || "Attached video");
          media.append(video);
        } else {
          const img = el("img");
          img.src = item.url;
          img.alt = item.alt || "Attached image";
          img.loading = "lazy";
          media.append(img);
          if (item.type !== "photo")
            media.append(
              el("span", "brief-muted", "Video · open the post to play"),
            );
        }
      }
      c.append(media);
    }
    if (post.sensitive && post.media?.length)
      c.append(
        el("p", "brief-muted", "Sensitive media · open the post on X to view."),
      );
    if (post.linkCard) {
      const a = safeLink(
        post.linkCard.url,
        post.linkCard.title,
        "brief-link-card",
        true,
      );
      a.append(el("small", "", post.linkCard.domain));
      c.append(a);
    }
    if (post.poll) {
      const poll = el("div", "brief-poll");
      poll.append(
        el(
          "p",
          "brief-muted",
          "Poll · saved snapshot, voting is available on X",
        ),
      );
      for (const o of post.poll) poll.append(el("p", "", o.label));
      c.append(poll);
    }
    if (post.communityNote) {
      const note = el("aside", "brief-quote");
      note.append(
        el("strong", "", "Community Note"),
        el("p", "", post.communityNote),
      );
      c.append(note);
    }
    const foot = el("div", "brief-card-foot");
    if (active())
      foot.append(
        safeLink(
          `/${post.handle}/status/${post.id}`,
          "Open on X · like, reply or bookmark",
        ),
      );
    foot.append(keepButton(post.id));
    c.append(foot);
    if (local)
      c.append(
        el("p", "brief-local-note", "Private copy saved on this device."),
      );
    return c;
  }
  async function start() {
    if (busy) return;
    busy = true;
    try {
      view = await send({ type: "start" });
      if (home()) location.reload();
      else location.assign("https://x.com/home");
    } catch (e) {
      busy = false;
      signature = "";
      render(e.message);
    }
  }
  async function finish() {
    view = await send({ type: "finish" });
    signature = "";
    guard();
    mount();
    window.scrollTo(0, 0);
  }
  function shell(title, copy) {
    const intro = el("header", "brief-intro");
    intro.append(
      el("p", "brief-eyebrow", "X BRIEF / FOR YOU"),
      el("h1", "", title),
      el("p", "brief-description", copy),
    );
    root.append(intro);
  }
  function ending() {
    const end = el("section", "brief-end");
    end.append(
      el("span", "brief-end-mark", "—"),
      el("h2", "", `That’s the ${editionName().toLowerCase()}.`),
      el("p", "", nextLabel()),
    );
    const saved = shelf.filter((p) =>
      view?.session?.posts.some((x) => x.id === p.id),
    );
    if (saved.length) {
      const summary = el("div", "brief-recap");
      summary.append(el("p", "brief-muted", "Kept from this edition"));
      for (const p of saved)
        summary.append(
          el("p", "", `@${p.handle} · ${p.text.split("\n")[0].slice(0, 95)}`),
        );
      end.append(summary);
    }
    end.append(action("Close edition", finish));
    return end;
  }
  function render(error) {
    guard();
    if (!root) return;
    if (freeRoute() || nativeVisible()) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const s = view?.session,
      key = JSON.stringify([
        route,
        s?.id,
        s?.phase,
        s?.ended,
        s?.posts.length,
        view?.available,
        view?.nextAt,
        shelfOpen,
        shelf.map((p) => p.id),
        error,
      ]);
    if (key === signature) return;
    signature = key;
    root.replaceChildren();
    if (!view) {
      shell("X Brief", "Checking your reading schedule…");
      return;
    }
    if (shelfOpen) {
      shell(
        "Kept for later.",
        "Private copies, saved on this device. No new recommendations.",
      );
      root.append(
        action(
          active() ? "Back to this edition" : "Back to schedule",
          back,
          "brief-link",
        ),
      );
      if (!shelf.length)
        root.append(
          el(
            "p",
            "brief-description",
            "Use “Keep privately” on a post to save it here.",
          ),
        );
      for (const p of shelf) root.append(card(p, true));
    } else if (
      !home() &&
      active() &&
      !detailId() &&
      !profileAllowed() &&
      !location.pathname.startsWith("/notifications")
    ) {
      shell(
        "Outside this edition.",
        "This visit contains one batch from For you. Other feeds open with your next edition.",
      );
      root.append(action("Back to the edition", back));
      utilityLinks(root);
    } else if (detailId() && active() && !allowedIds().has(detailId())) {
      shell(
        "Outside this edition.",
        "This post isn’t in your current edition or your kept posts.",
      );
      root.append(action("Back to the edition", back));
    } else if (active() && s.phase === "frozen") {
      shell(
        editionName(),
        "Saved from X’s For you recommendations, in their original order.",
      );
      root.append(
        el(
          "p",
          "brief-description",
          `${s.posts.length} posts · saved ${time(s.frozenAt)}. Refreshing keeps this edition.`,
        ),
      );
      root.append(
        el(
          "p",
          "brief-context-note",
          "Open a post to use X’s Like, Reply and Bookmark controls. “Keep privately” only saves a local copy.",
        ),
      );
      const list = el("div", "brief-posts");
      s.posts.forEach((p) => list.append(card(p)));
      root.append(list, ending());
      list.querySelectorAll("article").forEach(observe);
      restorePosition();
    } else if (active() && ["ready", "loading"].includes(s.phase)) {
      shell(
        "Opening your edition.",
        "One batch of For you recommendations. No posts will be added while you read.",
      );
      root.append(el("div", "brief-loading", "Getting your recommendations…"));
      chooseForYou();
    } else if (active() && s.phase === "error") {
      shell(
        "This edition didn’t load.",
        s.error ||
          "X didn’t return a readable For you batch. No edition has been used.",
      );
      root.append(
        action("Try again", async () => {
          await send({ type: "retry" });
          if (home()) location.reload();
          else location.assign("https://x.com/home");
        }),
        action("Close for now", finish, "brief-link"),
      );
    } else if (view.available) {
      shell(
        editionName(view.now),
        new Date(view.now).toLocaleDateString([], {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
      );
      const spec = el("div", "brief-session-spec");
      spec.append(
        el(
          "span",
          "",
          `One ranked batch · at most ${view.settings.maxPosts} posts`,
        ),
        el(
          "span",
          "",
          `${view.settings.activeMinutes} minutes of active reading`,
        ),
        el("span", "", `Available to start until ${time(view.availableUntil)}`),
      );
      root.append(spec, action("Open edition", start));
      utilityLinks(root);
    } else {
      shell(
        s?.reason === "time" ? "Reading time is up." : "Between editions.",
        "Your next batch opens at the scheduled time.",
      );
      root.append(
        el("p", "brief-next-label", "NEXT EDITION"),
        el("p", "brief-next", nextLabel()),
      );
      utilityLinks(root);
    }
    if (error) root.append(el("p", "brief-error", error));
    const footer = el("footer", "brief-footer");
    footer.append(
      el("span", "", "For you, with an end."),
      action(
        "Reading schedule",
        () => send({ type: "openSettings" }),
        "brief-link",
      ),
    );
    root.append(footer);
  }
  const readObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          const id = e.target.dataset.postId || postId(e.target);
          if (id) send({ type: "seen", id }).catch(() => {});
          readObserver.unobserve(e.target);
        }
    },
    { threshold: 0.5 },
  );
  function observe(node) {
    if (!observed.has(node)) {
      observed.add(node);
      readObserver.observe(node);
    }
  }
  function postId(article) {
    return article
      .querySelector('a[href*="/status/"] time')
      ?.closest("a")
      ?.pathname.match(/\/status\/(\d+)/)?.[1];
  }
  function chooseForYou() {
    if (
      home() &&
      active() &&
      ["ready", "loading"].includes(view.session.phase)
    ) {
      const tab = document.querySelector(
        '[data-testid="primaryColumn"] [role="tablist"] [role="tab"]',
      );
      if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
    }
  }
  function mount() {
    route = location.pathname;
    guard();
    if (!document.body) return;
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (bg && bg.length >= 3)
      doc.dataset.briefTheme =
        (Number(bg[0]) + Number(bg[1]) + Number(bg[2])) / 3 < 128
          ? "dark"
          : "light";
    const primary =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector("main");
    if (!root?.isConnected) {
      root = el("section", "");
      root.id = "x-brief-reader";
      root.setAttribute("aria-label", "X Brief");
      (primary || document.body).append(root);
      root.classList.toggle("brief-fallback", !primary);
      signature = "";
    }
    if (primary && root.parentElement === document.body) {
      primary.append(root);
      root.classList.remove("brief-fallback");
    }
    if (home() && nativeVisible()) {
      if (!nativeHead?.isConnected) {
        nativeHead = el("header", "brief-native-head");
        nativeHead.id = "x-brief-native-head";
        nativeHead.append(
          el("span", "brief-eyebrow", "X BRIEF / FOR YOU"),
          el("h1", "", editionName()),
          el(
            "p",
            "",
            `${view.session.posts.length} recommendations · one edition`,
          ),
        );
        primary?.prepend(nativeHead);
      }
      const keptKey = shelf.map((p) => p.id).join(",");
      if (!nativeEnd?.isConnected || nativeEnd.dataset.kept !== keptKey) {
        nativeEnd?.remove();
        nativeEnd = ending();
        nativeEnd.id = "x-brief-native-end";
        nativeEnd.dataset.kept = keptKey;
        primary?.append(nativeEnd);
      }
      for (const a of document.querySelectorAll(
        'article[data-testid="tweet"]',
      )) {
        const id = postId(a);
        a.toggleAttribute(
          "data-brief-overflow",
          !view.session.posts.some((p) => p.id === id),
        );
        observe(a);
        if (
          id &&
          view.session.posts.some((p) => p.id === id) &&
          !a.parentElement.querySelector("[data-brief-keep]")
        ) {
          const holder = el("div", "brief-native-actions");
          const b = keepButton(id);
          b.classList.add("brief-native-keep");
          holder.append(b);
          a.after(holder);
        }
      }
    } else {
      nativeHead?.remove();
      nativeEnd?.remove();
      nativeHead = null;
      nativeEnd = null;
    }
    if (active() && detailId() && allowedIds().has(detailId()))
      document
        .querySelectorAll('article[data-testid="tweet"]')
        .forEach((a, i) => a.toggleAttribute("data-brief-overflow", i > 10));
    for (const v of document.querySelectorAll("video")) {
      v.autoplay = false;
      v.removeAttribute("autoplay");
      if (!v.dataset.briefGuard) {
        v.dataset.briefGuard = "true";
        v.pause();
        v.addEventListener("play", () => {
          if (!v.dataset.briefManual) v.pause();
        });
      }
    }
    // A cached server response must never surface a refresh cue.
    document
      .querySelectorAll('[data-testid="pillLabel"]')
      .forEach((label) =>
        (
          label.closest('button,[role="button"]') || label.parentElement
        ).setAttribute("data-brief-overflow", ""),
      );
    document.querySelectorAll('button,[role="button"]').forEach((b) => {
      if (
        !b.closest("#x-brief-reader") &&
        /^(Show|Mostrar)\s+\d+\s+(posts|postagens)/i.test(b.textContent.trim())
      )
        b.setAttribute("data-brief-overflow", "");
    });
    chooseForYou();
    render();
    updateBar();
  }
  function updateBar() {
    if (!document.body) return;
    if (freeRoute() || !active()) {
      bar?.remove();
      bar = null;
      return;
    }
    if (!bar) {
      bar = el("aside", "");
      bar.id = "x-brief-status";
      bar.setAttribute("aria-label", "Reading edition");
      document.body.append(bar);
    }
    const s = view.session,
      minutes = Math.ceil((s.activeLimitMs - s.activeMs) / 60000),
      key = `${s.id}/${minutes <= 2 ? minutes : ""}/${home()}`;
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.replaceChildren();
    const homeLink = safeLink(
      "/home",
      home() ? editionName() : "← Back to edition",
      "brief-status-home",
    );
    if (!home())
      homeLink.addEventListener("click", (e) => {
        if (sessionStorage.getItem("brief-return")) {
          e.preventDefault();
          history.back();
        }
      });
    bar.append(homeLink);
    if (minutes <= 2)
      bar.append(
        el(
          "span",
          "brief-time-warning",
          `${minutes} minute${minutes === 1 ? "" : "s"} left`,
        ),
      );
    bar.append(
      action("Kept", openShelf, "brief-link"),
      action("Close", finish, "brief-link"),
    );
  }
  let syncing = false;
  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      view = await send({
        type:
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          !freeRoute()
            ? "pulse"
            : "state",
        recentInput: Date.now() - lastInput < 60000,
      });
      kept = new Set(view.keptIds || []);
      mount();
    } catch {
      doc.setAttribute("data-brief-feed", "");
    } finally {
      syncing = false;
    }
  }
  const observer = new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mount();
      });
    }
  });
  observer.observe(doc, { childList: true, subtree: true });
  for (const event of ["pointerdown", "keydown", "scroll", "touchstart"])
    document.addEventListener(
      event,
      (e) => {
        if (e.isTrusted) {
          lastInput = Date.now();
          if (event === "pointerdown" || event === "keydown") {
            const player = e.target.closest(
              '[data-testid="videoPlayer"],video,.brief-media',
            );
            player
              ?.querySelectorAll("video")
              .forEach((v) => (v.dataset.briefManual = "true"));
            if (e.target.tagName === "VIDEO")
              e.target.dataset.briefManual = "true";
          }
        }
      },
      { passive: true, capture: true },
    );
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("popstate", () => {
    shelfOpen = location.hash === "#brief-kept";
    signature = "";
    mount();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.kept) {
      shelf = changes.kept.newValue || [];
      kept = new Set(shelf.map((p) => p.id));
      signature = "";
      mount();
    }
  });
  send({ type: "shelf" })
    .then((posts) => {
      shelf = posts;
      return sync();
    })
    .catch(() => {});
  const timer = setInterval(sync, 2000);
  window.addEventListener("unload", () => {
    observer.disconnect();
    readObserver.disconnect();
    clearInterval(timer);
  });
  document.addEventListener("DOMContentLoaded", mount);
})();
