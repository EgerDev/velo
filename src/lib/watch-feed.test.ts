import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  feedUrlForChannelId,
  newSince,
  parseChannelFeed,
  parseChannelInput,
  type FeedVideo,
} from "./watch-feed.ts";

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";

describe("parseChannelInput", () => {
  it("accepts a bare channel id", () => {
    assert.deepEqual(parseChannelInput(CHANNEL_ID), { channelId: CHANNEL_ID });
  });

  it("accepts a bare @handle and strips the @", () => {
    assert.deepEqual(parseChannelInput("@veritasium"), { handle: "veritasium" });
  });

  it("accepts /channel/UC… URLs", () => {
    assert.deepEqual(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL_ID}`), {
      channelId: CHANNEL_ID,
    });
    assert.deepEqual(parseChannelInput(`m.youtube.com/channel/${CHANNEL_ID}?si=abc`), {
      channelId: CHANNEL_ID,
    });
  });

  it("accepts /@handle URLs", () => {
    assert.deepEqual(parseChannelInput("https://www.youtube.com/@veritasium"), {
      handle: "veritasium",
    });
    assert.deepEqual(parseChannelInput("https://youtube.com/@veritasium/videos"), {
      handle: "veritasium",
    });
  });

  it("maps /user/ to a legacy user ref and /c/ to a distinct vanity ref", () => {
    // /user/ and /c/ are different YouTube namespaces — resolving a /c/ name
    // through /user/ 404s for most channels, so they must not collapse together.
    assert.deepEqual(parseChannelInput("https://www.youtube.com/user/scishow"), {
      user: "scishow",
    });
    assert.deepEqual(parseChannelInput("https://www.youtube.com/c/veritasium"), {
      vanity: "veritasium",
    });
  });

  it("strips wrapping quotes and brackets", () => {
    assert.deepEqual(parseChannelInput(`"${CHANNEL_ID}"`), { channelId: CHANNEL_ID });
    assert.deepEqual(parseChannelInput("<https://www.youtube.com/@veritasium>"), {
      handle: "veritasium",
    });
    assert.deepEqual(parseChannelInput("  '@veritasium'  "), { handle: "veritasium" });
  });

  it("rejects junk, non-youtube hosts, and empty input", () => {
    assert.equal(parseChannelInput("not a channel"), null);
    assert.equal(parseChannelInput("https://example.com/channel/" + CHANNEL_ID), null);
    assert.equal(parseChannelInput("https://vimeo.com/@veritasium"), null);
    assert.equal(parseChannelInput("https://music.youtube.com/channel/" + CHANNEL_ID), null);
    assert.equal(parseChannelInput("UCtooshort"), null);
    assert.equal(parseChannelInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
    assert.equal(parseChannelInput(""), null);
    assert.equal(parseChannelInput("   "), null);
  });
});

describe("feedUrlForChannelId", () => {
  it("builds the videos.xml URL", () => {
    assert.equal(
      feedUrlForChannelId(CHANNEL_ID),
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
    );
  });

  it("throws a TypeError on a bad id", () => {
    assert.throws(() => feedUrlForChannelId("dQw4w9WgXcQ"), TypeError);
    assert.throws(() => feedUrlForChannelId("UC has spaces and is bad!"), TypeError);
    assert.throws(() => feedUrlForChannelId(""), TypeError);
  });
});

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}"/>
  <id>yt:channel:${CHANNEL_ID}</id>
  <yt:channelId>${CHANNEL_ID}</yt:channelId>
  <title>Tools &amp; Toys</title>
  <author>
    <name>Tools &amp; Toys</name>
    <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
  </author>
  <published>2020-01-01T00:00:00+00:00</published>
  <entry>
    <id>yt:video:aaaaaaaaaaa</id>
    <yt:videoId>aaaaaaaaaaa</yt:videoId>
    <yt:channelId>${CHANNEL_ID}</yt:channelId>
    <title>Middle video &amp; friends</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
    <author>
      <name>Tools &amp; Toys</name>
      <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
    </author>
    <published>2026-08-10T12:00:00+00:00</published>
    <updated>2026-08-10T13:00:00+00:00</updated>
    <media:group>
      <media:title>Middle video &amp; friends</media:title>
      <media:content url="https://www.youtube.com/v/aaaaaaaaaaa?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i2.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" width="480" height="360"/>
      <media:description>First line.
Second line &amp; more.</media:description>
      <media:community>
        <media:starRating count="10" average="5.00" min="1" max="5"/>
        <media:statistics views="12345"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:bbbbbbbbbbb</id>
    <yt:videoId>bbbbbbbbbbb</yt:videoId>
    <yt:channelId>${CHANNEL_ID}</yt:channelId>
    <title>Newest &#39;quoted&#39; video</title>
    <author>
      <name>Tools &amp; Toys</name>
    </author>
    <published>2026-08-20T09:30:00+00:00</published>
    <media:group>
      <media:description>No stats on this one.</media:description>
      <media:community>
        <media:starRating count="0" average="0" min="1" max="5"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:ccccccccccc</id>
    <yt:videoId>ccccccccccc</yt:videoId>
    <yt:channelId>${CHANNEL_ID}</yt:channelId>
    <title>Oldest video</title>
    <author>
      <name>Tools &amp; Toys</name>
    </author>
    <published>2026-08-01T00:00:00+00:00</published>
    <media:group>
      <media:description>Old.</media:description>
      <media:community>
        <media:statistics views="7"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

describe("parseChannelFeed", () => {
  it("parses a realistic feed", () => {
    const feed = parseChannelFeed(SAMPLE_FEED);
    assert.equal(feed.channelId, CHANNEL_ID);
    assert.equal(feed.channelTitle, "Tools & Toys");
    assert.equal(feed.videos.length, 3);

    // Newest first, regardless of document order.
    assert.deepEqual(
      feed.videos.map((v) => v.id),
      ["bbbbbbbbbbb", "aaaaaaaaaaa", "ccccccccccc"],
    );

    const [newest, middle, oldest] = feed.videos;
    assert.equal(newest.title, "Newest 'quoted' video");
    assert.equal(middle.title, "Middle video & friends");
    assert.equal(oldest.title, "Oldest video");

    assert.equal(middle.views, 12345);
    assert.equal(newest.views, null);
    assert.equal(oldest.views, 7);

    assert.equal(middle.author, "Tools & Toys");
    assert.equal(middle.description, "First line.\nSecond line & more.");
    assert.equal(middle.thumbnail, "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg");
    assert.equal(middle.publishedAt, "2026-08-10T12:00:00+00:00");

    for (const v of feed.videos) {
      assert.ok(v.publishedMs > 0);
      assert.equal(v.publishedMs, Date.parse(v.publishedAt));
    }
  });

  it("skips entries missing a videoId", () => {
    const feed = parseChannelFeed(
      `<feed><yt:channelId>${CHANNEL_ID}</yt:channelId><title>T</title>` +
        `<entry><title>no id</title><published>2026-01-01T00:00:00Z</published></entry>` +
        `<entry><yt:videoId>ddddddddddd</yt:videoId><title>ok</title><published>2026-01-01T00:00:00Z</published></entry>` +
        `</feed>`,
    );
    assert.equal(feed.videos.length, 1);
    assert.equal(feed.videos[0].id, "ddddddddddd");
  });

  it("returns the empty shape on garbage", () => {
    const empty = { channelId: null, channelTitle: null, videos: [] };
    assert.deepEqual(parseChannelFeed("not xml at all"), empty);
    assert.deepEqual(parseChannelFeed(""), empty);
    assert.deepEqual(parseChannelFeed("{\"json\": true}"), empty);
  });
});

describe("newSince", () => {
  const mk = (id: string, publishedMs: number): FeedVideo => ({
    id,
    title: id,
    publishedAt: new Date(publishedMs).toISOString(),
    publishedMs,
    author: "a",
    description: "",
    views: null,
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  });

  it("keeps only strictly newer videos, newest first", () => {
    const videos = [mk("old", 1000), mk("boundary", 2000), mk("new", 3000), mk("newest", 4000)];
    const result = newSince(videos, 2000);
    assert.deepEqual(
      result.map((v) => v.id),
      ["newest", "new"],
    );
  });

  it("returns everything for sinceMs 0 and nothing for the future", () => {
    const videos = [mk("a", 1000), mk("b", 2000)];
    assert.equal(newSince(videos, 0).length, 2);
    assert.equal(newSince(videos, 999999).length, 0);
  });
});

describe("parseChannelFeed UC-prefix normalization", () => {
  it("restores a UC prefix the feed header dropped", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <yt:channelId>BJycsmduvYEL83R_U4JriQ</yt:channelId>
  <title>Marques Brownlee</title>
  <entry><yt:videoId>ngPkbaZliaU</yt:videoId><title>A video</title><published>2026-08-24T20:27:50+00:00</published></entry>
</feed>`;
    const feed = parseChannelFeed(xml);
    assert.equal(feed.channelId, "UCBJycsmduvYEL83R_U4JriQ");
    assert.equal(feed.videos.length, 1);
  });

  it("leaves an already-prefixed id untouched", () => {
    const xml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>UCBJycsmduvYEL83R_U4JriQ</yt:channelId><title>X</title><entry><yt:videoId>ngPkbaZliaU</yt:videoId><published>2026-08-24T20:27:50+00:00</published></entry></feed>`;
    assert.equal(parseChannelFeed(xml).channelId, "UCBJycsmduvYEL83R_U4JriQ");
  });
});
