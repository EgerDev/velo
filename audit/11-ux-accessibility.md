# 11 — UX and accessibility (prefix UX-)

## Scope and method

Target: the production build (`npm run build`) served by `npm run preview` at 127.0.0.1:8081, plus a loopback dev instance on :8093 used to get unminified React errors.

**Browsers and viewports.** Playwright 1.63 with Chromium (HeadlessChrome 153), Firefox and WebKit, each at 390×844 (mobile/touch), 768×1024, 1366×768 and 1920×1080. That is 12 combinations. Each ran across the four guest tabs (Single video, Bulk & playlists, Transcript, Channels), measuring horizontal overflow, interactive-element sizes and console/page errors, with a full-page screenshot per view.

**Automated checks.**
- axe-core 4.x, injected. Tags: wcag2a/aa, wcag21a/aa, wcag22aa and best-practice. Run on the 4 tabs, the three header panels (No session, History, Guide), `/login` and a 404 page, at 390 and 1366 px.
- Lighthouse, run against Playwright's Chromium: accessibility score 100 on mobile and desktop. That is automated only, and **it does not mean the site is compliant**.

**Manual keyboard pass (Chromium, 1366).**
- Tab order.
- Visible focus (computed outline/box-shadow, plus screenshots).
- Header panels: Enter to open, Tab through, Esc to close.
- Command palette (Ctrl+K / Esc).
- Tablist arrow keys.
- Headings and landmarks.
- `prefers-reduced-motion`.

**Forms.** Login with empty, invalid and wrong-credential input, plus a double-click on submit.

**States.** Offline/failed-request behaviour: server functions aborted via `page.route`, so no YouTube traffic.

**Mocked flows.**
- A mocked 3-hour transcript: seroval-encoded responses for `resolveVideo`/`fetchTranscript`, with YouTube requests blocked.
- A pathological bulk paste of 500 to 5,000 URLs, with server functions aborted.

Screenshots are in the auditor scratchpad (`…/scratchpad/web/shots/`), not the repo. No real YouTube lookups were made from the UI.

Signed-in views (Tools tab, vault, proxy console) were not reachable: sign-in fails on a local origin (see WEB-12).

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| UX-01 | P2 | History and Guide header panels render partly off-screen on phones (left edge at −100 px at 390 px width) | Website launch |
| UX-02 | P2 | WebKit/Safari hydration mismatch on every mobile load (CookieImport skeleton); React throws away the server HTML and re-renders the whole tree | Website launch |
| UX-03 | P2 | Main URL/search input has no adequately visible focus indicator | Both |
| UX-04 | P2 | Guide panel heading is 1.17:1 contrast (axe serious; unreadable) | Both |
| UX-05 | P2 | UI copy advertises circumvention ("BotGuard PO token rotation … prevent 429 rate-limiting") and an "AI" chip on Transcript (TECHNICAL + REQUIRES LEGAL REVIEW) | Website launch |
| UX-06 | P2 | No footer / legal surface: no privacy policy, terms, contact, copyright/DMCA or cookie notice anywhere in the UI | Website launch |
| UX-07 | P3 | Raw exception text shown to users ("Failed to fetch", "Cannot read properties of undefined (reading 'captions')") | Both |
| UX-08 | P3 | Most touch targets are below 44×44 px on mobile (14 of 17 on the home view) | Website launch |
| UX-09 | P3 | Command palette does not return focus to the page on Esc (focus lands on `<body>`) | Both |
| UX-10 | P3 | Tab and mode state are not in the URL: Back/Refresh lose the chosen tab; `?tab=` is only read once | Both |
| UX-11 | P3 | Header panels stay open after keyboard focus leaves them; no `aria-haspopup`/dialog semantics | Both |
| UX-12 | P3 | Bulk queue accepts an unbounded number of items (4,863 queued from one paste) with no warning | Both |
| UX-13 | P3 | Accessible name does not match the visible label ("Transcript AI" tab) and the login page reuses the title "Velo" | Neither |

Passes observed (automated plus manual, **not a compliance claim**):
- No horizontal overflow in any browser, viewport or tab (`scrollWidth - innerWidth = 0` in all 48 measurements).
- Skip link is present and is the first tab stop.
- `header`, labelled `nav` and `main` landmarks; one `h1`.
- Every interactive element tested showed a visible focus style except the one in UX-03.
- The tablist supports ArrowLeft/Right.
- `prefers-reduced-motion: reduce` leaves 0 elements with animations or transitions longer than 0.2 s (`src/styles.css:274`, `:423`).
- Login uses native `required` / `type=email` validation ("Please fill out this field.").
- Double-clicking "Sign in with email" sent exactly one `POST /api/auth/sign-in/email`.
- 404 shows a styled page with a way home, served with an HTTP 404 status.
- A 3-hour transcript (3,600 cues) is virtualized: 16 cue rows in the DOM, 0 long tasks while rendering, scrolling or searching.
- No console errors in Chromium. In Firefox the only error comes from the grok.com script (cookie rejected).

---

### UX-01 — History and Guide header panels render partly off-screen on phones
- **Severity:** P2
- **Category:** Responsive layout
- **Blocks:** Website launch
- **Affected files:** `src/components/app-header.tsx:94` (`absolute top-full … w-[min(92vw,26rem)] … right-0`)
- **Description:** Each panel is right-aligned to its own trigger button. On phones the History and Guide buttons sit mid-header, so a panel up to 92vw wide extends past the left edge of the viewport. The page does not scroll horizontally, so the clipped content cannot be reached.
- **Evidence:** Playwright, `isMobile`, panel `getBoundingClientRect()`:
  ```
  320 History {"left":-95,"right":199,"w":320}
  320 Guide   {"left":-57,"right":237,"w":320}
  390 History {"left":-100,"right":259,"w":390}
  390 Guide   {"left":-62,"right":297,"w":390}
  ```
  Screenshot `shots/pop-390-Guide.png`: the tab labels "1-Click (All)", "Safari" and the step text are cut off at the left.
- **Real-world consequence:** On phones, the History list and the setup Guide are partly unreadable and some controls cannot be tapped.
- **Recommended fix:** On small screens, anchor the panel to the viewport or header instead of the trigger (e.g. `fixed inset-x-4 top-16`), or use a sheet/dialog.
- **Verification procedure:** Rerun the measurement at 320 and 390: expect `left >= 0` and `right <= innerWidth`.
- **Status:** CONFIRMED

### UX-02 — WebKit/Safari hydration mismatch on every mobile load
- **Severity:** P2
- **Category:** Rendering correctness / performance
- **Blocks:** Website launch
- **Affected files:** `src/components/cookie-import.tsx:49` and `:294-295` (`if (isPending) return <div className="panel mt-8 h-14 animate-pulse" />`), `src/lib/auth/use-current-user.ts`
- **Description:** The server renders the pending skeleton. In WebKit, the session state has already resolved by the first client render, so the client renders the full panel. React reports error #418 and regenerates the whole root on the client.
- **Evidence:**
  - Production: `hydration errors in 10/10 WebKit loads` at 390×844.
  - Dev: 9/10 loads. The unminified diff:
    ```
    <CookieImport revealSignal={0}>
      <div
    +   id="session-cookies"
    -   id={null}
    +   className="panel mt-8 px-5 py-5 scroll-mt-20"
    -   className="panel mt-8 h-14 animate-pulse"
    ```
  - The matrix also showed `PAGEERROR Minified React error #418 … args[]=HTML` at every WebKit viewport on the first run. Chromium and Firefox: 0.
- **Real-world consequence:** Every iPhone/Safari visitor pays a full client re-render after load. That means wasted work, possible flicker and lost input state. It also produces error noise in monitoring.
- **Recommended fix:** Gate the first client render on a hydration flag (render the skeleton until mounted), so the first client render always matches the server skeleton.
- **Verification procedure:** Run `node hyd3.mjs http://<host>/` (scratchpad script) and expect `0/10`.
- **Status:** CONFIRMED

### UX-03 — Main URL/search input has no adequately visible focus indicator
- **Severity:** P2
- **Category:** Accessibility (WCAG 2.4.7 Focus Visible; 1.4.11 Non-text Contrast)
- **Blocks:** Both
- **Affected files:** `src/components/home-single.tsx:226` (`focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20`)
- **Description:** Keyboard focus on the page's primary control changes only a 20%-alpha accent ring and a 40%-alpha border on a near-black surface. By my estimate that is about 1.5:1 against `#0a0a0b` (not measured exactly). Every other control in the tab order had a clear focus style.
- **Evidence:** Tab stop 8 reported `INPUT "YouTube link or search" focusVisible=false` (computed outline and box-shadow on the element). Screenshot `shots/focus-input.png` is visually the same as the unfocused state.
- **Real-world consequence:** Keyboard and low-vision users cannot see where focus is on the core control.
- **Recommended fix:** Use a solid `ring-accent` (≥3:1) on `focus-within`, matching `src/components/ui/input.tsx:9`.
- **Verification procedure:** Tab to the input and check the indicator has ≥3:1 contrast against adjacent colours (use `src/lib/contrast.ts`).
- **Status:** CONFIRMED (visual); exact ratio NOT VERIFIED (estimated)

### UX-04 — Guide panel heading is 1.17:1 contrast
- **Severity:** P2
- **Category:** Accessibility (WCAG 1.4.3)
- **Blocks:** Both
- **Affected files:** `src/components/session-guide.tsx:128` (`.bg-accent/10 > .font-semibold.text-accent-fg`)
- **Description / Evidence:** axe at 1366: `color-contrast serious 1 | .bg-accent\/10 > .font-semibold.text-accent-fg :: Element has insufficient color contrast of 1.17 (foreground color: #191006, background color: #272118, font size: 9.8pt (13px)…`. The heading "Universal 1-Click Bookmarklet (Works on Any Browser)" is effectively invisible in `shots/dlg-1366-Guide.png`. axe listed the same element as "incomplete" at 390.
- **Real-world consequence:** Nobody can read the heading, sighted users included.
- **Recommended fix:** Use `text-accent` or `text-fg` on the tinted background. `text-accent-fg` is meant for solid accent fills.
- **Verification procedure:** Rerun axe on the open Guide panel: 0 color-contrast violations.
- **Status:** CONFIRMED

### UX-05 — UI copy advertises circumvention and an "AI" feature
- **Severity:** P2
- **Category:** Product copy (TECHNICAL FINDING + REQUIRES LEGAL REVIEW)
- **Blocks:** Website launch
- **Affected files:**
  - `src/components/bulk-view.tsx:81`: "Velo uses staggered bursts, BotGuard PO token rotation, and zero-loss copy-muxing to prevent 429 rate-limiting."
  - The "ANTI-THROTTLE QUEUE" chip in the same view.
  - `src/components/mode-tabs.tsx` (`chip: "AI"` on Transcript).
- **Description:** The anonymous public UI tells users the product defeats YouTube's bot detection and rate limiting. The Transcript tab carries an "AI" badge. I found no AI processing in the transcript path: it fetches YouTube caption tracks (`src/lib/youtube-captions.server.ts`). I did not audit this exhaustively.
- **Evidence:** Screenshots `shots/webkit-390-bulk.png` and `shots/chromium-1366-transcript.png`.
- **Real-world consequence:** The copy may be read as intent to circumvent technical protection measures, and the badge may be misleading advertising. Both are for counsel to assess.
- **Recommended fix:** Refer to legal review. As a technical minimum, drop the "AI" chip unless an AI feature exists.
- **Verification procedure:** `grep -rn "BotGuard\|429\|ANTI-THROTTLE\|chip: \"AI\"" src/components` is clean, or counsel has signed off.
- **Status:** CONFIRMED (copy present); "no AI" is NOT VERIFIED exhaustively

### UX-06 — No footer / legal surface anywhere in the UI
- **Severity:** P2
- **Category:** Trust / compliance surface (REQUIRES LEGAL REVIEW)
- **Blocks:** Website launch
- **Affected files:** `src/components/home-layout.tsx`, `src/routes/__root.tsx` (no footer / `contentinfo`); no `/privacy`, `/terms` routes in `src/routes/`
- **Description / Evidence:** The landmark scan found `HEADER | NAV:Session and library | MAIN`, with no `footer`/`contentinfo`. The routes are only `/`, `/login` and `/api/*`. The app stores users' Google session cookies server-side and third-party scripts set cookies (WEB-03), yet it shows no privacy policy, no terms, no contact and no copyright or takedown channel.
- **Real-world consequence:** A public launch with no privacy notice or takedown path. Users cannot find out how their credentials are handled.
- **Recommended fix:** Add a footer with Privacy, Terms, Contact, and a copyright/abuse channel, with the content set by counsel.
- **Verification procedure:** Every page has a `contentinfo` landmark with working links.
- **Status:** CONFIRMED

### UX-07 — Raw exception text shown to users
- **Severity:** P3
- **Category:** Error states
- **Blocks:** Both
- **Affected files:** `src/lib/home-actions.ts` (lookup error → `setError(err.message)`), `src/components/transcript-studio.tsx` (`toast.error(err.message)` and the "Transcript Extraction Issue" card), `src/lib/error-component.tsx:7-20` (AppErrorComponent renders `error.message` verbatim)
- **Description / Evidence:**
  - With the network failing, Fetch showed "Couldn't resolve that link — **Failed to fetch**" (`shots/fetch-aborted.png`).
  - With a malformed server response, the Transcript card showed "**Cannot read properties of undefined (reading 'captions')**".
  - API errors (WEB-05) contain raw yt-dlp stderr, which reaches the UI the same way.
- **Real-world consequence:** Confusing messages with no clear next action; internal details leak into the UI.
- **Recommended fix:** Map errors to user copy (reuse `classifyDownloadError`). Show "You appear to be offline" when `navigator.onLine === false`, with a Retry button.
- **Verification procedure:** Block `/_serverFn/**` and click Fetch: expect friendly copy with Retry.
- **Status:** CONFIRMED

### UX-08 — Most touch targets are below 44×44 px on mobile
- **Severity:** P3
- **Category:** Mobile usability (WCAG 2.5.8 AA min 24 px is met; 2.5.5 AAA / platform 44 px guidance is not)
- **Blocks:** Website launch
- **Affected files:** `src/components/app-header.tsx:83` (`h-9` = 36 px triggers), `src/components/mode-tabs.tsx`, `src/components/sample-chips.tsx`
- **Description / Evidence:** At 390×844 (Chromium, touch), 14/17 interactive elements on Single, 12/15 on Bulk, 14/17 on Transcript and 9/13 on Channels are under 44 px in at least one dimension. None are under 24 px apart from the skip link, which is 1×1 while hidden.
- **Real-world consequence:** More mis-taps on phones, especially the adjacent header icons.
- **Recommended fix:** Use `min-h-11` on mobile for header buttons, tabs and chips.
- **Verification procedure:** Rerun `matrix.mjs` and expect `under44` near 0 at 390.
- **Status:** CONFIRMED

### UX-09 — Command palette does not return focus to the page on Esc
- **Severity:** P3
- **Category:** Keyboard / focus management (WCAG 2.4.3)
- **Blocks:** Both
- **Affected files:** `src/components/command-palette.tsx`
- **Description / Evidence:** Ctrl+K moves focus to `INPUT[combobox] "Search commands…" (in dialog)`. After Esc, `document.activeElement` is `BODY`. The header panels, by contrast, return focus to their trigger on Esc (verified: "after Esc: BUTTON History").
- **Real-world consequence:** Keyboard users lose their place and have to tab from the top again.
- **Recommended fix:** Store the previously focused element and restore it on close (Radix Dialog `onCloseAutoFocus`, or manually).
- **Verification procedure:** Focus Fetch, press Ctrl+K then Esc, and focus is back on Fetch.
- **Status:** CONFIRMED

### UX-10 — Tab and mode state are not in the URL
- **Severity:** P3
- **Category:** Navigation / deep links
- **Blocks:** Both
- **Affected files:** `src/routes/index.tsx:52-60` (reads `?tab=` once in `useEffect`; `setViewMode` never writes the URL)
- **Description / Evidence:** Switching to Bulk with the arrow key left the URL at `http://127.0.0.1:8081/`. `/?tab=bulk` does open Bulk, but after switching tabs, Refresh returns to whatever the URL says, and Back leaves the app entirely.
- **Real-world consequence:** Users cannot share or bookmark a tab. Refresh loses context, and Back is surprising.
- **Recommended fix:** Store the mode in the route's search params (`validateSearch` + `navigate({ search })`).
- **Verification procedure:** Click Transcript, reload: still on Transcript; Back returns to Single.
- **Status:** CONFIRMED

### UX-11 — Header panels stay open after keyboard focus leaves them
- **Severity:** P3
- **Category:** Keyboard / ARIA
- **Blocks:** Both
- **Affected files:** `src/components/app-header.tsx:36-104` (`HeaderMenu`)
- **Description / Evidence:** Open History with Enter and press Tab 14 times. Focus ends on "No session" in the header, or behind the panel, while the panel stays open over the content. The Guide run ended on a sample chip that the open panel covers. The trigger has `aria-expanded`/`aria-controls` but the panel has no role or label. That is an acceptable disclosure pattern, but it only closes on outside mouse clicks or Esc.
- **Real-world consequence:** Keyboard users tab "under" an open overlay and lose sight of their focus.
- **Recommended fix:** Close the panel on `focusout` when focus moves outside `wrapRef`, and label the panel region.
- **Verification procedure:** Open with Enter and Tab past the last item: the panel closes.
- **Status:** CONFIRMED

### UX-12 — Bulk queue accepts an unbounded number of items
- **Severity:** P3
- **Category:** Input limits / abuse (UX)
- **Blocks:** Both
- **Affected files:** `src/components/bulk-downloader.tsx:90` (`extractYoutubeLinks(inputText)` with no cap), `src/lib/bulk-process.ts`
- **Description / Evidence:** Pasting 5,000 URLs queued 4,863 items (toast: "Added 4863 video(s) to the download queue."; `shots/bulk-5000.png`), and "Start All Downloads" became available. The server batches `resolveBulkVideos` at a maximum of 50 ids (`src/lib/resolve-video.ts:102-108`), but the client imposes no queue limit. Performance cost: PERF-02.
- **Real-world consequence:** Users can start thousands of downloads that will hit quota and 429 errors in the middle of the run.
- **Recommended fix:** Cap the queue (e.g. 200) and show a clear message about plan limits before queuing.
- **Verification procedure:** Paste 5,000 URLs: expect the capped count and an explanatory message.
- **Status:** CONFIRMED

### UX-13 — Accessible name does not match visible label; page titles are not distinct
- **Severity:** P3
- **Category:** Accessibility (WCAG 2.5.3) / orientation (2.4.2)
- **Blocks:** Neither
- **Affected files:** `src/components/mode-tabs.tsx` (Transcript tab with `chip: "AI"`), `src/routes/login.tsx`, `src/lib/error-component.tsx`
- **Description / Evidence:** Lighthouse `label-content-name-mismatch` flagged `main#download > div.relative > button.relative` (the tab row). `/login` has `<title>Velo</title>`, and the 404 page uses the same title.
- **Real-world consequence:** Voice-control users saying "click Transcript AI" may miss the tab. Screen-reader users cannot tell pages apart by title.
- **Recommended fix:** Make the accessible name include the visible text. Give each route a `head()` title ("Sign in · Velo", "Page not found · Velo").
- **Verification procedure:** Lighthouse audit passes; `document.title` differs per route.
- **Status:** CONFIRMED

## Not verified / out of scope
- Signed-in views: Tools tab, cookie vault editor, proxy operations console, account chip menu. Local sign-in is blocked (WEB-12).
- Real download flows: progress, save dialog, retry after a mid-transfer failure, ffmpeg audio encoding. I did not exercise them, to keep YouTube traffic to zero and to avoid driving the circumvention pipeline.
- Screen readers (NVDA/VoiceOver) were not used. The keyboard and ARIA checks above are programmatic plus visual.
- Slow-network throttling beyond the aborted/offline case. Lighthouse's simulated slow 4G figures are in PERF-01.
- The browser extensions (`extension/`, `extensions/velo-session/`) UI.
- Automated axe/Lighthouse passes (100 score, 1 violation) **do not establish WCAG compliance**. Many colour-contrast checks came back "incomplete" (17 to 29 per view, because of gradient and backdrop-blur backgrounds) and need manual measurement.
