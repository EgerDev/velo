declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        url?: string;
        referrer?: string;
        userAgent?: string;
        pretendToBeVisual?: boolean;
      },
    );
    window: Window & typeof globalThis & { yt?: { config_: unknown } };
  }
}