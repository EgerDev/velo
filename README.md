# Velo

> High-performance YouTube media downloader, stream diagnostic engine, and interactive transcript suite.

Velo is a modern web application built to inspect, stream, download, and extract transcripts from YouTube videos at full quality (up to 4K UHD). It combines client-side streaming intelligence with backend fallback ladders to bypass rate limits, resolve throttled streams, and mux multi-track audio/video with zero quality loss.

---

## Highlights & Features

### 1. Zero-Loss Video & Audio Muxing
- **Full Resolution Support**: Fetch 1080p Full HD, 1440p QHD, 4K UHD (2160p), 720p HD, and audio-only streams.
- **Direct Copy-Muxing**: YouTube separates 1080p+ video streams from audio tracks. Velo pairs the highest-bitrate video stream with original AAC/Opus audio and muxes them into a single MP4/WebM container on the fly without lossy re-encoding.
- **Real-Time Telemetry & Pre-Flight**: Inspects video containers, available itags, detected codecs (H.264, AV1, VP9, AAC, Opus), and optimal download pipelines before starting.

### 2. Interactive YouTube-to-Transcript Suite
- **Time-Synced Cues**: Scrollable transcript with click-to-seek timestamp buttons that instantly jump and play the video.
- **In-Transcript Search**: Instant keyword filtering with live match count and highlighted search terms.
- **Multi-Format Subtitle Downloads**:
  - `TXT` — Plain text or timestamped notes.
  - `SRT` — Standard SubRip subtitle format with sequence numbers and millisecond timestamps.
  - `VTT` — WebVTT caption file format.
  - `JSON` — Structured array of timed cue objects (`{ id, start, end, text }`).
- **1-Click AI Prompt Library**:
  - 📝 **Executive Summary** (Quick overview & key takeaways)
  - 📚 **Detailed Study Notes** (Hierarchical concepts & definitions)
  - ❓ **Q&A & FAQ Generator** (Top questions & answers from video content)
  - ⏱️ **Timestamps & Chapters** (Ready-to-paste YouTube chapter markers)
  - ✅ **Action Items & Checklist** (Extracts tools, guides, and practical steps)
  - 🧵 **Social Media Thread** (Engaging Twitter/X or LinkedIn summary thread)

### 3. Resilient Multi-Tier Fallback Ladder
- **InnerTube Multi-Client Routing**: Dynamic switching between `WEB_EMBEDDED`, `VISIONOS`, `TV_SIMPLY`, `WEB`, and `ANDROID` clients.
- **Proof-of-Origin (PO Token)**: Automated WebPO token minting and validation to prevent bot-detection blocks.
- **Throttling Bypass & nsig Deciphering**: Live transformation of YouTube's `n` parameter to prevent 40 KB/s stream choking.
- **SOCKS Proxy Pool & Same-Hop Routing**: Failover to IPv4 proxies when server IPs encounter 403 blocks.

### 4. Session Credential Vault & Browser Exporter
- **Universal Cookie Importer**: Supports Netscape HTTP cookie format, JSON arrays, and HTTP Archive (`.har`) files.
- **Step-by-Step Guides for Every Browser**: Detailed instructions for Chrome, Firefox, Safari (macOS), Edge, and Mobile Safari (iOS Bookmarklet).
- **Session Health Diagnostics**: Validates authentication tokens (`SID`, `SAPISID`, `LOGIN_INFO`) and checks live YouTube session status.
- **Encrypted Local & Server Vault**: Stores cookies safely with strict per-user database isolation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [TanStack Start](https://tanstack.com/start) + [React 19](https://react.dev/) |
| **Routing & RPC** | [TanStack Router](https://tanstack.com/router) with type-safe server functions (`createServerFn`) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + [Lucide Icons](https://lucide.dev/) |
| **Media & InnerTube** | [youtubei.js](https://github.com/LuanRT/YouTube.js), `yt-dlp`, `ffmpeg` copy-transmux |
| **Database & Auth** | PGLite / PostgreSQL + [Better Auth](https://www.better-auth.com/) |
| **Testing** | Node.js native test runner (`node --test`), Playwright smoke tests |

---

## Project Structure

```
.
├── src/
│   ├── components/
│   │   ├── transcript-viewer.tsx    # Interactive transcript reader & AI prompt generator
│   │   ├── video-panel.tsx          # Video details, pre-flight telemetry, preset selector
│   │   ├── cookie-import.tsx        # Multi-format cookie import dialog & health checker
│   │   ├── session-guide.tsx        # Browser cookie extraction guides (Desktop & Mobile)
│   │   ├── history-list.tsx         # Recent downloads list with isolated user shelves
│   │   ├── save-stage.tsx           # File download / storage manager
│   │   └── ui/                      # Button, Input, Skeleton, Badge, Dialog components
│   ├── lib/
│   │   ├── youtube.ts               # Video presets, codecs, duration/view formatters
│   │   ├── youtube.server.ts        # InnerTube client, format resolution, caption fetcher
│   │   ├── transcript.ts            # WebVTT parser, SRT/TXT/JSON formatters, AI templates
│   │   ├── ytdlp.server.ts          # Process management, fallback ladder, slot throttler
│   │   ├── stream-unlock.ts         # Stream cipher / signature / nsig deciphering
│   │   ├── cookies.ts               # Netscape/JSON/HAR cookie parser and validator
│   │   ├── vault.ts                 # Server-side encrypted cookie credential vault
│   │   └── guest-limit.server.ts    # Rate limiting & quota enforcement for guest IPs
│   └── routes/
│       ├── __root.tsx               # Root application layout
│       ├── index.tsx                # Main video search, analyzer, and download page
│       ├── login.tsx                # Authentication page
│       └── api/                     # Backend streaming and RPC routes
├── scripts/
│   ├── browser-smoke.mjs            # Automated Playwright desktop & mobile render test
│   └── migrate.mjs                  # Database schema migration runner
└── package.json
```

---

## Getting Started

### Prerequisites
- **Node.js**: v22.0.0 or later
- **npm**: v10 or later
- **Python / yt-dlp / ffmpeg** *(optional for local development, pre-configured in sandbox)*

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/EgerDev/velo.git
   cd velo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:8080` in your browser.

---

## Verification & Testing

Run all unit tests across the media engine, transcript parser, cookie validator, and quota system:

```bash
npm test
```

Run TypeScript checks and ESLint:

```bash
npm run typecheck
npm run lint
```

Build for production and verify with browser smoke tests:

```bash
npm run build
node scripts/browser-smoke.mjs
```

---

## License

MIT License. Designed and built with modern web standards.
