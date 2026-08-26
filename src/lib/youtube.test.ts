import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPresets,
  pickBestPreset,
  cleanYoutubeInput,
  codecFromMime,
  codecPlayHint,
  codecSizes,
  FORMAT_PRIORITY,
  H264_VS_AV1,
  HLS_EXPLAIN,
  matchAudioTrack,
  parseClock,
  parsePlaylistId,
  parseVideoId,
  isShortVideo,
  type VideoFormat,
} from "./youtube.ts";

describe("cleanYoutubeInput", () => {
  it("strips wrapping quotes and brackets", () => {
    assert.equal(cleanYoutubeInput('"https://youtu.be/dQw4w9WgXcQ"'), "https://youtu.be/dQw4w9WgXcQ");
    assert.equal(cleanYoutubeInput("<https://youtu.be/dQw4w9WgXcQ>"), "https://youtu.be/dQw4w9WgXcQ");
  });
});

describe("parseVideoId", () => {
  it("accepts a raw 11-character id", () => {
    assert.equal(parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("parses watch, short, embed, live, and youtu.be links", () => {
    assert.equal(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("https://m.youtube.com/shorts/3jz_K5qX52o?feature=share"), "3jz_K5qX52o");
    assert.equal(parseVideoId("shorts/3jz_K5qX52o"), "3jz_K5qX52o");
    assert.equal(parseVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("parses quoted links and protocol-less hosts", () => {
    assert.equal(parseVideoId("'https://youtu.be/dQw4w9WgXcQ'"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("youtube.com/watch?v=dQw4w9WgXcQ&t=12s"), "dQw4w9WgXcQ");
  });

  it("rejects playlists and junk", () => {
    assert.equal(parseVideoId("https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMOVkdYdXKdL3r0i"), null);
    assert.equal(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
    assert.equal(parseVideoId(""), null);
  });

  it("only takes the bare-shorts fast path for truly bare paths", () => {
    // A host in front — protocol or not — must clear the allowlist instead.
    assert.equal(parseVideoId("someothersite.com/shorts/dQw4w9WgXcQ"), null);
    assert.equal(parseVideoId("mirror.example.net/videos/shorts/dQw4w9WgXcQ"), null);
    assert.equal(parseVideoId("youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseVideoId("shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
    // 12-char tail is not an 11-char id.
    assert.equal(parseVideoId("shorts/dQw4w9WgXcQx"), null);
  });
});

describe("parsePlaylistId", () => {
  it("parses playlist URLs and raw ids", () => {
    assert.equal(
      parsePlaylistId("https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMOVkdYdXKdL3r0i"),
      "PLrAXtmRdnEQy6nuLMOVkdYdXKdL3r0i",
    );
    assert.equal(parsePlaylistId("PLrAXtmRdnEQy6nuLMOVkdYdXKdL3r0i"), "PLrAXtmRdnEQy6nuLMOVkdYdXKdL3r0i");
  });

  it("rejects watch-later and liked lists", () => {
    assert.equal(parsePlaylistId("https://www.youtube.com/playlist?list=WL"), null);
    assert.equal(parsePlaylistId("https://www.youtube.com/playlist?list=LL"), null);
  });
});

describe("parseClock", () => {
  it("parses mm:ss and hh:mm:ss", () => {
    assert.equal(parseClock("1:02"), 62);
    assert.equal(parseClock("1:02:03"), 3723);
    assert.equal(parseClock("live"), null);
  });
});

describe("codecFromMime", () => {
  it("maps common youtube codecs", () => {
    assert.equal(codecFromMime('video/mp4; codecs="avc1.640028"'), "H.264");
    assert.equal(codecFromMime("audio/webm; codecs=opus"), "Opus");
  });
});

describe("format guide", () => {
  it("compares H.264 to AV1 as same picture, different size", () => {
    assert.match(H264_VS_AV1, /same 1080p picture/i);
    assert.match(H264_VS_AV1, /30–50%/);
    assert.match(codecPlayHint("H.264", "mp4"), /larger than AV1/);
    assert.match(codecPlayHint("AV1", "mp4"), /fewer bits than H\.264/);
  });

  it("explains HLS as stitched MPEG-TS chunks", () => {
    assert.match(HLS_EXPLAIN, /itag 96/);
    assert.match(HLS_EXPLAIN, /MPEG-TS/);
    assert.match(HLS_EXPLAIN, /137/);
  });

  it("lists 1080p Save order: 137, HLS, 720, 360", () => {
    assert.deepEqual(
      FORMAT_PRIORITY.map((step) => step.id),
      ["137", "96", "22", "18"],
    );
    assert.match(FORMAT_PRIORITY[0]?.detail ?? "", /default/);
    assert.match(FORMAT_PRIORITY[1]?.label ?? "", /HLS/);
  });
});

function fmt(partial: Partial<VideoFormat> & Pick<VideoFormat, "itag" | "kind">): VideoFormat {
  return {
    qualityLabel: "360p",
    height: 360,
    fps: 30,
    ext: "mp4",
    mime: "video/mp4",
    codec: "H.264",
    bitrate: 500_000,
    size: 1_000_000,
    hasAudio: partial.kind !== "video",
    hasVideo: partial.kind !== "audio",
    language: null,
    isOriginal: true,
    isDubbed: false,
    isAutoDubbed: false,
    isDescriptive: false,
    isSecondary: false,
    ...partial,
  };
}

describe("buildPresets", () => {
  it("picks the smallest muxed file for Quick and never silent video as HD", () => {
    const presets = buildPresets([
      fmt({ itag: 22, kind: "av", qualityLabel: "720p", height: 720, bitrate: 2_000_000, size: 8_000_000 }),
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, bitrate: 400_000, size: 2_000_000 }),
      fmt({
        itag: 43,
        kind: "av",
        qualityLabel: "360p",
        height: 360,
        ext: "webm",
        bitrate: 200_000,
        size: 1_500_000,
      }),
      fmt({ itag: 140, kind: "audio", qualityLabel: "High", height: null, ext: "m4a", hasVideo: false, size: 800_000 }),
    ]);
    assert.equal(presets[0]?.id, "quick");
    assert.equal(presets[0]?.itag, 43);
    assert.equal(presets.find((p) => p.id === "hd")?.itag, 22);
    assert.equal(presets.find((p) => p.id === "audio")?.itag, 140);
  });

  it("never promotes a silent video-only stream to HD without audio", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        hasAudio: false,
        size: 20_000_000,
      }),
    ]);
    assert.ok(presets.every((p) => p.hasAudio));
    assert.ok(!presets.some((p) => p.itag === 137));
  });

  it("never promotes silent or short HLS 96 to Full HD", () => {
    const silent = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360 }),
      fmt({
        itag: 96,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        hasAudio: false,
        hasVideo: true,
      }),
    ]);
    assert.ok(!silent.some((p) => p.itag === 96));
    assert.ok(silent.every((p) => p.hasAudio));
  });

  it("builds a Full HD preset by pairing 1080p video with AAC audio", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 40_000_000,
      }),
      fmt({
        itag: 140,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "m4a",
        codec: "AAC",
        hasVideo: false,
        size: 3_000_000,
      }),
    ]);
    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.title, "Full HD");
    assert.equal(fullhd?.itag, 137);
    assert.equal(fullhd?.audioItag, 140);
    assert.equal(fullhd?.hasAudio, true);
    assert.equal(fullhd?.ext, "mp4");
    assert.equal(fullhd?.codec, "H.264");
    assert.equal(fullhd?.size, 43_000_000);
  });

  it("Full HD defaults to H.264; AV1 and VP9 stay as extras", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        bitrate: 5_000_000,
        size: 40_000_000,
      }),
      fmt({
        itag: 248,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "VP9",
        ext: "webm",
        hasAudio: false,
        bitrate: 3_000_000,
        size: 22_000_000,
      }),
      fmt({
        itag: 399,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "AV1",
        ext: "mp4",
        hasAudio: false,
        bitrate: 2_200_000,
        size: 16_000_000,
      }),
      fmt({
        itag: 140,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "m4a",
        codec: "AAC",
        hasVideo: false,
        size: 3_000_000,
      }),
      fmt({
        itag: 251,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "webm",
        codec: "Opus",
        hasVideo: false,
        size: 2_400_000,
      }),
    ]);
    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.itag, 137);
    assert.equal(fullhd?.codec, "H.264");
    assert.equal(fullhd?.audioItag, 140);
    const av1 = presets.find((p) => p.id === "av1");
    assert.equal(av1?.itag, 399);
    assert.equal(av1?.codec, "AV1");
    const vp9 = presets.find((p) => p.id === "vp9");
    assert.equal(vp9?.codec, "VP9");
    assert.equal(vp9?.itag, 248);
    assert.equal(pickBestPreset(presets)?.id, "fullhd");
  });

  it("codecSizes ranks AV1 then VP9 then H.264 at 1080p", () => {
    const sizes = codecSizes(
      [
        fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
        fmt({
          itag: 137,
          kind: "video",
          qualityLabel: "1080p",
          height: 1080,
          codec: "H.264",
          ext: "mp4",
          hasAudio: false,
          bitrate: 5_000_000,
          size: 40_000_000,
        }),
        fmt({
          itag: 248,
          kind: "video",
          qualityLabel: "1080p",
          height: 1080,
          codec: "VP9",
          ext: "webm",
          hasAudio: false,
          bitrate: 3_000_000,
          size: 22_000_000,
        }),
        fmt({
          itag: 399,
          kind: "video",
          qualityLabel: "1080p",
          height: 1080,
          codec: "AV1",
          ext: "mp4",
          hasAudio: false,
          bitrate: 2_200_000,
          size: 16_000_000,
        }),
        fmt({
          itag: 140,
          kind: "audio",
          qualityLabel: "High",
          height: null,
          ext: "m4a",
          codec: "AAC",
          hasVideo: false,
          size: 3_000_000,
        }),
        fmt({
          itag: 251,
          kind: "audio",
          qualityLabel: "High",
          height: null,
          ext: "webm",
          codec: "Opus",
          hasVideo: false,
          size: 2_400_000,
        }),
      ],
      1080,
      1439,
    );
    assert.deepEqual(
      sizes.map((row) => row.codec),
      ["AV1", "VP9", "H.264"],
    );
    assert.ok((sizes[0]?.size ?? 0) < (sizes[1]?.size ?? 0));
    assert.ok((sizes[1]?.size ?? 0) < (sizes[2]?.size ?? 0));
    assert.equal(sizes[0]?.vsH264, 56);
    assert.equal(sizes[1]?.vsH264, 43);
    assert.equal(sizes.find((row) => row.codec === "VP9")?.itag, 248);
    assert.equal(sizes.find((row) => row.codec === "VP9")?.ext, "webm");
  });

  it("Full HD stays on itag 137 even when 1080p60 exists", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 299,
        kind: "video",
        qualityLabel: "1080p60",
        height: 1080,
        fps: 60,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 50_000_000,
      }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        fps: 30,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 40_000_000,
      }),
      fmt({
        itag: 140,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "m4a",
        codec: "AAC",
        hasVideo: false,
        size: 3_000_000,
      }),
    ]);
    assert.equal(presets.find((p) => p.id === "fullhd")?.itag, 137);
  });

  it("Full HD pairs 137 with Opus when AAC is missing, never 1080p60", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 299,
        kind: "video",
        qualityLabel: "1080p60",
        height: 1080,
        fps: 60,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 50_000_000,
      }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        fps: 30,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 40_000_000,
      }),
      fmt({
        itag: 251,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "webm",
        codec: "Opus",
        hasVideo: false,
        size: 2_400_000,
      }),
    ]);
    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.itag, 137);
    assert.equal(fullhd?.audioItag, 251);
    assert.equal(pickBestPreset(presets)?.itag, 137);
  });

  it("builds 480p and 720p merged presets and pickBestPreset chooses 1080p", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 135,
        kind: "video",
        qualityLabel: "480p",
        height: 480,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 8_000_000,
      }),
      fmt({
        itag: 136,
        kind: "video",
        qualityLabel: "720p",
        height: 720,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 20_000_000,
      }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 40_000_000,
      }),
      fmt({
        itag: 140,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "m4a",
        codec: "AAC",
        hasVideo: false,
        size: 3_000_000,
      }),
    ]);
    assert.equal(presets.find((p) => p.id === "sd")?.itag, 135);
    assert.equal(presets.find((p) => p.id === "hd")?.itag, 136);
    assert.equal(presets.find((p) => p.id === "fullhd")?.itag, 137);
    assert.equal(pickBestPreset(presets)?.id, "fullhd");
  });

  it("enriches presets with availability, streamType, and recommended status", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 137,
        kind: "video",
        qualityLabel: "1080p",
        height: 1080,
        codec: "H.264",
        ext: "mp4",
        hasAudio: false,
        size: 40_000_000,
      }),
      fmt({
        itag: 140,
        kind: "audio",
        qualityLabel: "High",
        height: null,
        ext: "m4a",
        codec: "AAC",
        hasVideo: false,
        size: 3_000_000,
      }),
    ]);

    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.availability, "muxed");
    assert.equal(fullhd?.streamType, "dash-mux");
    assert.equal(fullhd?.recommended, true);

    const quick = presets.find((p) => p.id === "quick");
    assert.equal(quick?.availability, "ready");
    assert.equal(quick?.streamType, "direct");
    assert.equal(quick?.recommended, false);

    const audio = presets.find((p) => p.id === "audio");
    assert.equal(audio?.availability, "ready");
    assert.equal(audio?.streamType, "direct");
    assert.equal(audio?.recommended, false);
  });

  it("marks HLS itag 96 presets as availability 'hls' and streamType 'hls-stitch'", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({
        itag: 96,
        kind: "av",
        qualityLabel: "1080p",
        height: 1080,
        codec: "H.264",
        ext: "mp4",
        hasAudio: true,
        hasVideo: true,
        size: 40_000_000,
      }),
    ]);

    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.availability, "hls");
    assert.equal(fullhd?.streamType, "hls-stitch");
    assert.equal(fullhd?.recommended, true);
  });

  it("marks muxed 720p fallback as availability 'ready' and streamType 'direct' when 1080p is absent", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({ itag: 22, kind: "av", qualityLabel: "720p", height: 720, codec: "H.264", ext: "mp4", hasAudio: true, size: 8_000_000 }),
    ]);

    const hd = presets.find((p) => p.id === "hd");
    assert.equal(hd?.itag, 22);
    assert.equal(hd?.availability, "ready");
    assert.equal(hd?.streamType, "direct");
    assert.equal(hd?.recommended, true);
  });

  it("properly marks alternate AV1/VP9 presets as muxed dash streams", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360, size: 2_000_000 }),
      fmt({ itag: 137, kind: "video", qualityLabel: "1080p", height: 1080, codec: "H.264", ext: "mp4", hasAudio: false, size: 40_000_000 }),
      fmt({ itag: 248, kind: "video", qualityLabel: "1080p", height: 1080, codec: "VP9", ext: "webm", hasAudio: false, size: 25_000_000 }),
      fmt({ itag: 399, kind: "video", qualityLabel: "1080p", height: 1080, codec: "AV1", ext: "mp4", hasAudio: false, size: 18_000_000 }),
      fmt({ itag: 140, kind: "audio", qualityLabel: "High", height: null, ext: "m4a", codec: "AAC", hasVideo: false, size: 3_000_000 }),
      fmt({ itag: 251, kind: "audio", qualityLabel: "High", height: null, ext: "webm", codec: "Opus", hasVideo: false, size: 2_000_000 }),
    ]);

    const av1 = presets.find((p) => p.id === "av1");
    assert.equal(av1?.availability, "muxed");
    assert.equal(av1?.streamType, "dash-mux");
    assert.equal(av1?.recommended, false);

    const vp9 = presets.find((p) => p.id === "vp9");
    assert.equal(vp9?.availability, "muxed");
    assert.equal(vp9?.streamType, "dash-mux");
    assert.equal(vp9?.recommended, false);
  });
});

describe("matchAudioTrack", () => {
  it("skips auto-dubbed tracks and keeps original AAC", () => {
    const video = fmt({
      itag: 137,
      kind: "video",
      qualityLabel: "1080p",
      height: 1080,
      hasAudio: false,
    });
    const original = fmt({
      itag: 140,
      kind: "audio",
      qualityLabel: "High",
      height: null,
      ext: "m4a",
      codec: "AAC",
      hasVideo: false,
      isOriginal: true,
      isAutoDubbed: false,
      bitrate: 128_000,
    });
    const dubbed = fmt({
      itag: 140,
      kind: "audio",
      qualityLabel: "High",
      height: null,
      ext: "m4a",
      codec: "AAC",
      hasVideo: false,
      language: "bn",
      isOriginal: false,
      isAutoDubbed: true,
      bitrate: 128_000,
    });
    const picked = matchAudioTrack(video, [dubbed, original]);
    assert.equal(picked?.isAutoDubbed, false);
    assert.equal(picked?.isOriginal, true);
  });
});

describe("isShortVideo", () => {
  it("detects shorts by isShort flag, url, or vertical dimensions", () => {
    assert.equal(isShortVideo({ isShort: true }), true);
    assert.equal(isShortVideo({ url: "https://www.youtube.com/shorts/3jz_K5qX52o" }), true);
    assert.equal(
      isShortVideo({
        duration: 45,
        formats: [{ itag: 137, kind: "video", qualityLabel: "1080p", width: 1080, height: 1920, fps: 30, ext: "mp4", mime: "video/mp4", codec: "H.264", bitrate: 2000000, size: 10000000, hasAudio: false, hasVideo: true, language: null, isOriginal: true, isDubbed: false, isAutoDubbed: false, isDescriptive: false, isSecondary: false }],
      }),
      true,
    );
    assert.equal(
      isShortVideo({
        duration: 600,
        formats: [{ itag: 137, kind: "video", qualityLabel: "1080p", width: 1920, height: 1080, fps: 30, ext: "mp4", mime: "video/mp4", codec: "H.264", bitrate: 2000000, size: 10000000, hasAudio: false, hasVideo: true, language: null, isOriginal: true, isDubbed: false, isAutoDubbed: false, isDescriptive: false, isSecondary: false }],
      }),
      false,
    );
  });
});

describe("buildPresets 1080p without H.264 1080p", () => {
  const audio140 = fmt({
    itag: 140,
    kind: "audio",
    qualityLabel: "High",
    height: null,
    ext: "m4a",
    hasVideo: false,
    size: 800_000,
  });

  it("offers 1080p from VP9/AV1 when H.264 tops out at 720p (HDR-style upload)", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360 }),
      fmt({ itag: 298, kind: "video", qualityLabel: "720p60", height: 720, fps: 60, hasAudio: false, size: 50_000_000 }),
      fmt({ itag: 399, kind: "video", codec: "AV1", qualityLabel: "1080p", height: 1080, hasAudio: false, size: 40_000_000 }),
      fmt({
        itag: 248,
        kind: "video",
        codec: "VP9",
        ext: "webm",
        mime: "video/webm",
        qualityLabel: "1080p",
        height: 1080,
        hasAudio: false,
        size: 60_000_000,
      }),
      fmt({ itag: 701, kind: "video", codec: "AV1", qualityLabel: "2160p60", height: 2160, fps: 60, hasAudio: false, size: 900_000_000 }),
      audio140,
    ]);
    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.ok(fullhd, "expected a 1080p preset");
    assert.equal(fullhd?.height, 1080);
    assert.equal(fullhd?.codec, "VP9");
    assert.ok(fullhd?.hasAudio);
    const recommended = presets.find((p) => p.recommended);
    assert.equal(recommended?.id, "fullhd");
  });

  it("uses 1080p60 H.264 (itag 299) for Full HD when itag 137 is absent", () => {
    const presets = buildPresets([
      fmt({ itag: 18, kind: "av", qualityLabel: "360p", height: 360 }),
      fmt({ itag: 299, kind: "video", qualityLabel: "1080p60", height: 1080, fps: 60, hasAudio: false, size: 80_000_000 }),
      audio140,
    ]);
    const fullhd = presets.find((p) => p.id === "fullhd");
    assert.equal(fullhd?.itag, 299);
    assert.equal(fullhd?.codec, "H.264");
    assert.equal(fullhd?.title, "Full HD");
  });
});
