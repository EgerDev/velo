# ⚡ Velo Chrome Extension (Manifest V3)

The official **Google Chrome Extension** for Velo — Download YouTube videos in 1080p/4K, extract transcripts, generate 1-click AI summaries (ChatGPT, Claude, Grok), and queue videos for later.

---

## 🚀 Features

- **⚡ 1-Click In-Page Buttons**: Injected natively beneath the YouTube player (1080p MP4, Transcript AI Studio, Add to Queue).
- **📱 YouTube Shorts Overlay**: Floating 1-click download button for vertical Short videos.
- **🖼️ Video Thumbnail Badges**: Hover over any video thumbnail on YouTube to quickly queue it with `+ Velo`.
- **📝 Instant In-Popup Transcript & AI Prompts**:
  - Live subtitle cue reader with real-time keyword search.
  - 1-Click prompt templates: **Executive Summary**, **Detailed Study Notes**, **Q&A / FAQ**, and **Chapter Timestamps**.
  - Export to `.SRT`, `.VTT`, Plain Text, and DaVinci Resolve / Premiere Pro NLE markers.
- **📑 Persistent Download Queue**:
  - Save videos to download later.
  - Live extension badge counter (`chrome.action.setBadgeText`).
  - 1-click **Download All in Queue** or export batch to Velo Web App.
- **🔑 1-Click Session Cookie Sync**:
  - Securely extract YouTube cookies to unlock age-gated and restricted videos in Velo with 1 click.
- **🖱️ Right-Click Context Menu**:
  - Right-click any YouTube link across the web to download or queue directly.

---

## 🛠️ How to Install in Google Chrome / Brave / Edge / Arc

1. Open your browser and navigate to the Extensions page:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
2. Toggle on **"Developer mode"** in the top right corner.
3. Click **"Load unpacked"**.
4. Select the `extension/` folder inside this repository:
   ```text
   /path/to/velo/extension
   ```
5. The **Velo** extension icon will now appear in your browser toolbar!

---

## ⚙️ Configuration & Options

Click the Settings gear inside the extension popup or right-click the extension icon and choose **"Options"**:
- **Velo Web Server URL**: Defaults to `http://127.0.0.1:8080` (or your deployed Vercel domain).
- **Default Download Preset**: Choose between *1080p Full HD*, *720p HD*, *4K HDR*, or *Audio Only*.
- **Preferred Transcript Language**: Set your default caption language (*English, Spanish, French, German, Japanese, etc.*).
