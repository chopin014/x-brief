const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../extension/posts");
function raw(id, text = "Useful &amp; interesting") {
  return {
    rest_id: id,
    legacy: {
      id_str: id,
      full_text: text,
      created_at: "Wed Nov 04 09:00:00 +0000 2026",
      entities: { urls: [] },
    },
    core: {
      user_results: {
        result: { core: { screen_name: "researcher", name: "A Researcher" } },
      },
    },
  };
}
function entry(p) {
  return {
    entryId: `tweet-${p.rest_id}`,
    content: { itemContent: { tweet_results: { result: p } } },
  };
}
function timeline(entries) {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [{ type: "TimelineAddEntries", entries }],
        },
      },
    },
  };
}
test("captures posts in ranked order, decodes text, never adds quoted posts as cards", () => {
  const p = raw("123");
  p.quoted_status_result = { result: raw("321", "Quoted") };
  const posts = P.extract(timeline([entry(p), entry(raw("456")), entry(p)]));
  assert.deepEqual(
    posts.map((p) => p.id),
    ["123", "456"],
  );
  assert.equal(posts[0].text, "Useful & interesting");
  assert.equal(posts[0].quote.text, "Quoted");
});
test("module posts, visibility wrappers, promotions and cursors", () => {
  const ad = entry(raw("222"));
  ad.content.itemContent.promotedMetadata = {};
  const module = {
    content: {
      items: [
        {
          item: {
            itemContent: { tweet_results: { result: { tweet: raw("333") } } },
          },
        },
      ],
    },
  };
  const posts = P.extract(
    timeline([
      ad,
      {
        entryId: "cursor-bottom",
        content: { cursorType: "Bottom", value: "cursor" },
      },
      module,
    ]),
  );
  assert.deepEqual(
    posts.map((p) => p.id),
    ["333"],
  );
});
test("caps snapshot without reordering or picking later candidates", () => {
  const posts = P.extract(
    timeline(Array.from({ length: 40 }, (_, i) => entry(raw(String(i + 1))))),
    25,
  );
  assert.equal(posts.length, 25);
  assert.equal(posts.at(-1).id, "25");
});
test("normalizes long posts, republished posts, safe media and URLs", () => {
  const p = raw("1");
  p.note_tweet = { note_tweet_results: { result: { text: "Long post" } } };
  p.legacy.extended_entities = {
    media: [
      { type: "photo", media_url_https: "https://pbs.twimg.com/media/ok.jpg" },
      { type: "photo", media_url_https: "javascript:bad" },
    ],
  };
  assert.equal(P.normalize(p).text, "Long post");
  assert.equal(P.normalize(p).media.length, 1);
  const r = raw("2");
  r.legacy.retweeted_status_result = { result: p };
  assert.equal(P.normalize(r).id, "1");
});
test("detects feed and detail requests, keeps non-feed traffic distinct", () => {
  const url = (name) =>
    `https://x.com/i/api/graphql/abc/${name}?variables=%7B%7D`;
  assert.equal(P.classify(url("HomeTimeline")), "home");
  assert.equal(P.classify(url("HomeLatestTimeline")), "home");
  for (const n of [
    "UserTweets",
    "ListLatestTweetsTimeline",
    "SearchTimeline",
    "Bookmarks",
    "ExplorePage",
  ])
    assert.equal(P.classify(url(n)), "feed");
  assert.equal(P.classify(url("TweetDetail")), "detail");
  assert.equal(P.classify(url("CreateTweet")), "other");
  assert.equal(
    P.classify("https://x.com/i/api/1.1/statuses/home_timeline.json"),
    "feed",
  );
});
test("pruning drops refresh alerts, cursors, ads and injected modules before X sees them", () => {
  const ad = entry(raw("200"));
  ad.content.itemContent.promotedMetadata = {};
  const input = timeline([
    {
      entryId: "cursor-top",
      content: { entryType: "TimelineTimelineCursor", value: "top" },
    },
    entry(raw("1")),
    ad,
    entry(raw("2")),
    entry(raw("3")),
    {
      entryId: "cursor-bottom",
      content: { entryType: "TimelineTimelineCursor", value: "bottom" },
    },
  ]);
  input.data.home.home_timeline_urt.instructions.unshift({
    type: "TimelineShowAlert",
    text: "Show 50 posts",
  });
  const out = P.prune(input, 2);
  assert.equal(out.recognized, true);
  assert.deepEqual(out.ids, ["1", "2"]);
  assert.deepEqual(
    out.posts.map((p) => p.id),
    ["1", "2"],
  );
  assert.equal(JSON.stringify(out.payload).includes("cursor-top"), false);
  assert.equal(
    JSON.stringify(out.payload).includes("TimelineShowAlert"),
    false,
  );
  assert.equal(input.data.home.home_timeline_urt.instructions.length, 2);
});
test("pruning counts nested conversation items and preserves native wrappers", () => {
  const input = timeline([
    {
      entryId: "conversation-1",
      content: {
        entryType: "TimelineTimelineModule",
        items: [
          {
            entryId: "x",
            item: { itemContent: { tweet_results: { result: raw("1") } } },
          },
          {
            entryId: "y",
            item: { itemContent: { tweet_results: { result: raw("2") } } },
          },
        ],
      },
    },
    entry(raw("3")),
  ]);
  const out = P.prune(input, 2);
  assert.equal(out.posts.length, 2);
  assert.equal(
    out.payload.data.home.home_timeline_urt.instructions[0].entries.length,
    1,
  );
});
test("unknown schemas are explicit and requests with a cursor are detectable", () => {
  assert.equal(P.prune({ data: { unknown: [] } }).recognized, false);
  assert.equal(
    P.variables(
      "https://x.com/i/api/graphql/hash/HomeTimeline?variables=" +
        encodeURIComponent(JSON.stringify({ cursor: "next" })),
    ).cursor,
    "next",
  );
  assert.equal(
    P.variables(
      "https://x.com/i/api/graphql/hash/HomeTimeline",
      JSON.stringify({ variables: { cursor: "next" } }),
    ).cursor,
    "next",
  );
});
test("notifications grant only their finite set of referenced post IDs", () => {
  assert.deepEqual(
    P.notificationIds({
      globalObjects: { tweets: { 123: {}, 456: {}, bad: {} } },
    }),
    ["123", "456"],
  );
});
test("related-post recommendation modules never become conversation replies", () => {
  const p = timeline([
    {
      entryId: "tweetdetailrelatedtweets-1",
      content: {
        items: [
          { item: { itemContent: { tweet_results: { result: raw("8") } } } },
        ],
      },
    },
    entry(raw("1")),
  ]);
  assert.deepEqual(P.prune(p, 11).ids, ["1"]);
});
