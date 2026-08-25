/**
 * YouTube Artwork, Thumbnail & Channel Asset Resolver for Velo
 */

export type ThumbnailItem = {
  label: string;
  resolution: string;
  url: string;
  ext: "jpg" | "webp";
  width?: number;
  height?: number;
};

export type ThumbnailBundle = {
  videoId: string;
  items: ThumbnailItem[];
  maxResUrl: string;
  defaultJpgUrl: string;
};

/**
 * Generates the waterfall bundle of high-res YouTube thumbnails.
 */
export function resolveThumbnailBundle(videoId: string): ThumbnailBundle {
  const cleanId = (videoId || "").trim();

  const maxResUrl = `https://i.ytimg.com/vi/${cleanId}/maxresdefault.jpg`;
  const maxResWebpUrl = `https://i.ytimg.com/vi_webp/${cleanId}/maxresdefault.webp`;
  const sdUrl = `https://i.ytimg.com/vi/${cleanId}/sddefault.jpg`;
  const hqUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
  const mqUrl = `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg`;

  const items: ThumbnailItem[] = [
    {
      label: "1080p MaxRes (Master)",
      resolution: "1920x1080",
      url: maxResUrl,
      ext: "jpg",
      width: 1920,
      height: 1080,
    },
    {
      label: "1080p WebP (High Efficiency)",
      resolution: "1920x1080",
      url: maxResWebpUrl,
      ext: "webp",
      width: 1920,
      height: 1080,
    },
    {
      label: "Standard HD (SD)",
      resolution: "640x480",
      url: sdUrl,
      ext: "jpg",
      width: 640,
      height: 480,
    },
    {
      label: "High Quality (HQ)",
      resolution: "480x360",
      url: hqUrl,
      ext: "jpg",
      width: 480,
      height: 360,
    },
    {
      label: "Medium Quality (MQ)",
      resolution: "320x180",
      url: mqUrl,
      ext: "jpg",
      width: 320,
      height: 180,
    },
  ];

  return {
    videoId: cleanId,
    items,
    maxResUrl,
    defaultJpgUrl: maxResUrl,
  };
}
