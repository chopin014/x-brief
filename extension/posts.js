(function (root) {
  function unwrap(result) {
    for (let i = 0; i < 4 && result; i++) {
      if (result.tweet) result = result.tweet;
      else if (result.result) result = result.result;
      else break;
    }
    return result;
  }
  const decode = (text) =>
    (text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  function normalize(result, depth = 0) {
    let post = unwrap(result);
    if (
      !post?.legacy ||
      !/^\d+$/.test(post.rest_id || post.legacy.id_str || "")
    )
      return null;
    let repostBy = null;
    if (post.legacy.retweeted_status_result) {
      const u = unwrap(post.core?.user_results?.result);
      repostBy = u?.core?.screen_name || u?.legacy?.screen_name || null;
      post = unwrap(post.legacy.retweeted_status_result);
    }
    if (!post?.legacy) return null;
    const user = unwrap(post.core?.user_results?.result),
      legacy = post.legacy;
    const handle = user?.core?.screen_name || user?.legacy?.screen_name;
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(handle || "")) return null;
    const note = post.note_tweet?.note_tweet_results?.result;
    let text = note?.text || legacy.full_text || "";
    if (!note && legacy.display_text_range)
      text = Array.from(text)
        .slice(...legacy.display_text_range)
        .join("");
    const entities = note?.entity_set || legacy.entities || {};
    const links = (entities.urls || [])
      .map((u) => ({ short: u.url, url: u.expanded_url, label: u.display_url }))
      .filter((u) => /^https?:\/\//i.test(u.url));
    const media = (legacy.extended_entities?.media || [])
      .map((m) => ({
        type: m.type,
        url: m.media_url_https,
        alt: m.ext_alt_text || "",
        video:
          (m.video_info?.variants || [])
            .filter(
              (v) =>
                v.content_type === "video/mp4" &&
                /^https:\/\/video\.twimg\.com\//.test(v.url || ""),
            )
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
            .find((v) => (v.bitrate || 0) <= 2176000)?.url || null,
      }))
      .filter((m) => /^https:\/\/pbs\.twimg\.com\//.test(m.url || ""));
    const bindings = Object.fromEntries(
      (post.card?.legacy?.binding_values || []).map((x) => [x.key, x.value]),
    );
    const pollOptions = Object.entries(bindings)
      .filter(([k]) => /^choice\d+_label$/.test(k))
      .map(([k, v]) => ({
        label: v.string_value,
        votes: bindings[k.replace("_label", "_count")]?.string_value || "0",
      }));
    const cardUrl = links.find(
      (l) => !/^https:\/\/(x|twitter)\.com\//i.test(l.url),
    )?.url;
    const linkCard =
      bindings.title?.string_value && cardUrl
        ? {
            title: bindings.title.string_value,
            description: bindings.description?.string_value || "",
            url: cardUrl,
            domain: (() => {
              try {
                return new URL(cardUrl).hostname;
              } catch {
                return "";
              }
            })(),
          }
        : null;
    const noteText =
      post.birdwatch_pivot?.subtitle?.text ||
      post.birdwatch_pivot?.note?.text ||
      null;
    return {
      sensitive: !!legacy.possibly_sensitive,
      id: post.rest_id || legacy.id_str,
      handle,
      name: user?.core?.name || user?.legacy?.name || handle,
      text: decode(text),
      createdAt: legacy.created_at || null,
      links,
      media,
      repostBy,
      replyTo: legacy.in_reply_to_screen_name || null,
      parentId: legacy.in_reply_to_status_id_str || null,
      quote:
        depth < 1 && post.quoted_status_result
          ? normalize(post.quoted_status_result, depth + 1)
          : null,
      linkCard,
      poll: pollOptions.length ? pollOptions : null,
      communityNote: noteText,
    };
  }
  function extract(payload, max = 20) {
    const posts = [],
      seen = new Set();
    function entry(node, context = null, groupId = null) {
      if (!node || typeof node !== "object") return;
      if (node.promotedMetadata || node.content?.promotedMetadata) return;
      const item = node.itemContent || node.item?.itemContent;
      const social =
        node.socialContext || node.content?.socialContext || context;
      if (item?.tweet_results) {
        const p = normalize(item.tweet_results.result);
        if (
          p &&
          !seen.has(p.id) &&
          posts.length < max &&
          !item.promotedMetadata
        ) {
          seen.add(p.id);
          p.socialContext = social?.text || null;
          p.groupId = groupId;
          posts.push(p);
        }
        return;
      }
      if (node.items)
        for (const child of node.items)
          entry(child, social, groupId || node.entryId || "conversation");
      if (node.content) entry(node.content, social, groupId || node.entryId);
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.entries)) for (const e of node.entries) entry(e);
      if (node.entry) entry(node.entry);
      for (const [k, v] of Object.entries(node))
        if (k !== "entries" && k !== "entry") {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === "object") walk(v);
        }
    }
    walk(payload);
    return posts;
  }
  function variables(url, body) {
    try {
      const u = new URL(url);
      const v =
        u.searchParams.get("variables") ||
        JSON.parse(body || "{}").variables ||
        {};
      return typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      return {};
    }
  }
  function operation(url, body) {
    try {
      const u = new URL(url);
      return (
        u.pathname.match(/\/graphql\/[^/]+\/([A-Za-z0-9_]+)/)?.[1] ||
        u.searchParams.get("operationName") ||
        (body ? JSON.parse(body).operationName : "") ||
        ""
      );
    } catch {
      return "";
    }
  }
  const FEED =
    /Timeline|UserTweets|UserMedia|ListLatestTweets|CommunityTweets|CommunityMedia|Bookmarks|Favoriters|Retweeters|Likes|Explore|Search|ConnectTab|ForYou|Trends|Recommendations/i;
  function classify(url, body) {
    const op = operation(url, body);
    if (/badge_count|unread_count|BadgeCount/i.test(url)) return "badge";
    if (["HomeTimeline", "HomeLatestTimeline"].includes(op)) return "home";
    if (["TweetDetail", "TweetResultByRestId"].includes(op)) return "detail";
    if (/NotificationsTimeline|Notifications/.test(op)) return "notifications";
    if (op && FEED.test(op)) return "feed";
    try {
      const path = new URL(url).pathname;
      if (/\/notifications\/(all|mentions)/.test(path)) return "notifications";
      if (
        /\/1\.1\/(statuses\/(home_timeline|user_timeline)|search\/tweets|trends\/)/.test(
          path,
        )
      )
        return "feed";
    } catch {}
    return "other";
  }
  function allowedIds(posts) {
    const out = new Set();
    for (const p of posts) {
      out.add(p.id);
      if (p.quote?.id) out.add(p.quote.id);
      if (p.parentId) out.add(p.parentId);
    }
    return out;
  }
  function prune(payload, max = 20) {
    const copy = structuredClone(payload),
      seen = new Set();
    let found = false;
    function item(node) {
      if (
        !node ||
        typeof node !== "object" ||
        node.promotedMetadata ||
        /related|discover|who-to-follow|promoted|trend/i.test(
          node.entryId || "",
        )
      )
        return null;
      const value = node.itemContent || node.item?.itemContent;
      if (value?.tweet_results) {
        const post = normalize(value.tweet_results.result);
        if (
          !post ||
          value.promotedMetadata ||
          seen.has(post.id) ||
          seen.size >= max
        )
          return null;
        seen.add(post.id);
        return node;
      }
      if (Array.isArray(node.items)) {
        node.items = node.items.map(item).filter(Boolean);
        return node.items.length ? node : null;
      }
      if (node.content) {
        node.content = item(node.content);
        return node.content ? node : null;
      }
      return null;
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.instructions)) {
        found = true;
        node.instructions = node.instructions.filter((i) => {
          if (i.type === "TimelineAddEntries") {
            i.entries = (i.entries || []).map(item).filter(Boolean);
            return true;
          }
          if (i.type === "TimelineReplaceEntry") {
            i.entry = item(i.entry);
            return !!i.entry;
          }
          if (i.type === "TimelineClearCache") return true;
          return false;
        });
        return;
      }
      for (const v of Object.values(node))
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
    }
    walk(copy);
    return {
      payload: copy,
      posts: extract(copy, max),
      recognized: found,
      ids: [...seen],
    };
  }
  function notificationIds(payload) {
    const ids = new Set();
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (node.globalObjects?.tweets)
        for (const id of Object.keys(node.globalObjects.tweets))
          if (/^\d+$/.test(id) && ids.size < 25) ids.add(id);
      if (node.tweet_results?.result) {
        const p = normalize(node.tweet_results.result);
        if (p && ids.size < 25) ids.add(p.id);
      }
      for (const v of Object.values(node))
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
    }
    walk(payload);
    return [...ids];
  }
  const api = {
    extract,
    normalize,
    operation,
    variables,
    classify,
    allowedIds,
    prune,
    notificationIds,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.BriefPosts = api;
})(globalThis);
