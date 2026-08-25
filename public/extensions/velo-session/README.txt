Velo YouTube Session
====================

Chrome / Edge
1. Unzip this folder.
2. Open chrome://extensions (edge://extensions).
3. Turn on Developer mode.
4. Load unpacked → select the velo-session folder.
5. Sign in at youtube.com, open Velo, click the extension → Send to Velo tab.
6. Optional: play a video, then Capture live HAR to dump Cookie headers automatically.

Firefox
1. Unzip this folder so manifest.json is visible.
2. Open about:debugging#/runtime/this-firefox
3. Load Temporary Add-on → pick manifest.json.
   Firefox drops temporary add-ons when the browser restarts — load it again after a reboot.
4. Open youtube.com signed in, then Velo → Send to Velo tab.
5. If Send cannot find the Velo tab, use Copy cookies.txt or Capture live HAR and import the file in Velo.

HAR automation
The add-on watches youtube.com / googlevideo Cookie headers. Click Capture live HAR
after you play a video. It copies a HAR, downloads youtube-session.har, and tries
to send the Cookie header to an open Velo tab.

This extension needs the cookies + webRequest permissions so it can read HttpOnly
SID / SAPISID tokens. A normal webpage cannot.
