import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_CLIENTS,
  browserCookieArgs,
  extractorArgs,
  readCookieSession,
  socksClientsForItag,
  ytdlpArgv,
  ytdlpClients,
  ytdlpFormatSelector,
  isAudioItag,
  isVideoOnlyItag,
  ytdlpRunTimeoutMs,
  userAgentForClient,
  ytdlpUserAgentArgs,
  CLIENT_USER_AGENTS,
  ytdlpHeaderArgs,
  ytdlpImpersonateArgs,
  YTDLP_DEPRECATED_HEADERS,
  YTDLP_CLIENT_EXTRACT,
  parseYtdlpLog,
  ytdlpWorkingCommand,
  YTDLP_WORKING_EXAMPLE,
  YTDLP_EXTRACTOR_LAYERS,
  YTDLP_EXTRACTOR_ARGS,
  YTDLP_PLAYER_CLIENTS,
  YOUTUBE_ALT_APIS,
  GUEST_CLIENTS,
  resolvePlayerClient,
  PO_TOKEN_STEPS,
  ytdlpFamilyArgs,
  classifyYtdlpFailure,
  formatYtdlpFailure,
  mapYtdlpExit,
  looksLikeIpv6Mismatch,
  poTokenArgs,
  YTDLP_EXIT,
  pythonBin,
  classifyPythonProbe,
  isMissingInterpreterError,
} from "./ytdlp-auth.ts";

test("account cookies unlock cookie-capable clients, not android/ios", () => {
  const session = readCookieSession(
    "SID=sidtoken; SAPISID=saptoken; VISITOR_INFO1_LIVE=visitorA; LOGIN_INFO=login",
  );
  assert.equal(session?.loggedIn, true);
  assert.equal(session?.visitorData, "visitorA");
  assert.deepEqual(ytdlpClients(true), [...SESSION_CLIENTS]);
  assert.ok(!(SESSION_CLIENTS as readonly string[]).includes("android"));
  assert.ok(!(SESSION_CLIENTS as readonly string[]).includes("ios"));
  assert.equal(SESSION_CLIENTS[0], "web_embedded");
  assert.ok((SESSION_CLIENTS as readonly string[]).includes("tv_downgraded"));
});

test("anonymous downloads try visionos first (guest dash/mux); android_vr aliases to web_embedded", () => {
  assert.equal(ytdlpClients(false)[0], "visionos");
  assert.deepEqual([...GUEST_CLIENTS], ["visionos", "web_embedded", "tv_simply", "android"]);
  assert.ok(!(GUEST_CLIENTS as readonly string[]).includes("web_safari"));
  assert.ok(!(GUEST_CLIENTS as readonly string[]).includes("ios"));
  assert.equal(readCookieSession(""), null);
  assert.equal(resolvePlayerClient("android_vr"), "web_embedded");
  assert.equal(resolvePlayerClient("android_vr,web_embedded"), "web_embedded");
  assert.equal(resolvePlayerClient("android"), "android");
  const vr = YTDLP_PLAYER_CLIENTS.find((row) => row.id === "android_vr");
  assert.equal(vr?.pot, "alias");
  assert.ok(YOUTUBE_ALT_APIS.some((row) => row.id === "tv_embedded"));
  assert.ok(YOUTUBE_ALT_APIS.some((row) => row.id === "invidious" && /403/.test(row.note)));
  const argv = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 18,
    client: "android_vr",
    impersonate: true,
  });
  assert.match(argv[argv.indexOf("--extractor-args") + 1] ?? "", /player_client=web_embedded/);
  assert.equal(argv.includes("--impersonate"), true);
});

test("SOCKS hop uses web_embedded for 1080p and muxed 360", () => {
  assert.equal(socksClientsForItag(137)[0], "web_embedded");
  assert.ok(!socksClientsForItag(137).includes("mediaconnect"));
  assert.equal(socksClientsForItag(299)[0], "web_embedded");
  assert.equal(socksClientsForItag(18)[0], "web_embedded");
  assert.equal(socksClientsForItag(18)[1], "tv_simply");
  assert.ok(!socksClientsForItag(96).includes("web_safari"));
});

test("1080p Save uses the hop that works: 137+140 then Opus then HLS — not silent 360", () => {
  assert.equal(ytdlpFormatSelector(137), "137+140/137+251/96");
  assert.equal(ytdlpFormatSelector(299), "137+140/137+251/96");
  assert.equal(ytdlpFormatSelector(96), "137+140/137+251/96");
  assert.equal(ytdlpFormatSelector(18), "18");
  const argv = ytdlpArgv({ dir: "/tmp/x", id: "dQw4w9WgXcQ", itag: 137, client: "web_embedded" });
  assert.equal(argv[argv.indexOf("-f") + 1], "137+140/137+251/96");
  assert.equal(argv[argv.indexOf("--throttled-rate") + 1], "100K");
  assert.equal(argv[argv.indexOf("--http-chunk-size") + 1], "10M");
  assert.equal(argv[argv.indexOf("--concurrent-fragments") + 1], "1");
  assert.equal(argv[argv.indexOf("--merge-output-format") + 1], "mp4/mkv");
  assert.ok(argv.includes("--check-formats"));
  assert.ok(argv.includes("--no-js-runtimes"));
  assert.ok(argv.includes("--force-ipv4"));
});

test("mux/HLS get 180s; 360p direct stays 45s; audio never HLS-stitched", () => {
  assert.equal(ytdlpRunTimeoutMs({ itag: 137 }), 180_000);
  assert.equal(ytdlpRunTimeoutMs({ itag: 18 }), 45_000);
  assert.equal(ytdlpRunTimeoutMs({ itag: 18, proxy: "socks5h://127.0.0.1:9050" }), 180_000);
  assert.equal(isVideoOnlyItag(137), true);
  assert.equal(isAudioItag(140), true);
  assert.equal(isAudioItag(233), true);
  assert.equal(isAudioItag(234), true);
  assert.equal(isAudioItag(137), false);
  assert.equal(ytdlpFormatSelector(234), "234");
});

test("socks proxy is passed to yt-dlp and cookies are not required", () => {
  const argv = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 18,
    client: "android",
    proxy: "socks5://127.0.0.1:1080",
  });
  assert.equal(argv[argv.indexOf("--proxy") + 1], "socks5h://127.0.0.1:1080");
  assert.ok(!argv.includes("--cookies"));
  assert.equal(argv.includes("--force-ipv4"), false);
  assert.deepEqual(ytdlpFamilyArgs("socks5h://x"), []);
  assert.deepEqual(ytdlpFamilyArgs(), ["--force-ipv4"]);
  assert.equal(argv[argv.indexOf("--remote-components") + 1], "ejs:github");
});

test("extractor-args stamp po_token and visitor_data; never use -u/-p", () => {
  const args = extractorArgs("mweb", "POTTOKEN", "visitorA");
  assert.match(args, /player_client=mweb/);
  assert.match(args, /player_js_variant=main/);
  assert.match(args, /fetch_pot=never/);
  assert.ok(!args.includes("use_ad_playback_context"));
  assert.match(args, /visitor_data=visitorA/);
  assert.match(args, /po_token=mweb\.gvs\+POTTOKEN/);
  assert.match(args, /mweb\.player\+POTTOKEN/);
  const dual = extractorArgs("web_embedded", "GVS123", "visitorA", "PLAYER456");
  assert.match(dual, /web_embedded\.gvs\+GVS123/);
  assert.match(dual, /web_embedded\.player\+PLAYER456/);
  assert.ok(!dual.includes("use_ad_playback_context"));
  const none = extractorArgs("web_embedded");
  assert.ok(!none.includes("fetch_pot=never"), "let yt-dlp fetch POT when we have none");
  const vr = extractorArgs("android_vr", "POT");
  assert.match(vr, /player_client=web_embedded/);
  const argv = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 18,
    client: "mweb",
    cookiePath: "/tmp/x/cookies.txt",
    visitorData: "visitorA",
  });
  assert.ok(argv.includes("--cookies"));
  assert.ok(!argv.includes("-u"));
  assert.ok(!argv.includes("--username"));
  assert.ok(!argv.join(" ").includes("visitor_data"), "cookies already carry visitor id");
  assert.equal(argv[argv.indexOf("-f") + 1], "18");
  assert.ok(PO_TOKEN_STEPS.some((row) => row.step === "4 mint"));
});

test("never pass a global User-Agent; InnerTube already stamps per client", () => {
  assert.match(CLIENT_USER_AGENTS.android ?? "", /com\.google\.android\.youtube\/21\.26\.364/);
  assert.match(userAgentForClient("web_safari") ?? "", /Safari\/605\.1\.15/);
  assert.match(userAgentForClient("mweb") ?? "", /iPad/);
  assert.deepEqual(ytdlpUserAgentArgs("android"), []);
  const argv = ytdlpArgv({ dir: "/tmp/x", id: "jNQXAC9IVRw", itag: 137, client: "android" });
  assert.equal(argv.includes("--user-agent"), false);
  assert.equal(
    argv.some((flag) => /user-agent/i.test(flag)),
    false,
  );
  assert.equal(
    argv.some((flag) => /^User-Agent:/i.test(flag)),
    false,
  );
});

test("curl_cffi impersonate is chrome/safari on web clients, never android", () => {
  assert.deepEqual(ytdlpImpersonateArgs("web_embedded"), ["--impersonate", "chrome"]);
  assert.deepEqual(ytdlpImpersonateArgs("web_safari"), ["--impersonate", "safari"]);
  assert.deepEqual(ytdlpImpersonateArgs("android"), []);
  assert.deepEqual(ytdlpImpersonateArgs("ios"), []);
  const web = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 137,
    client: "web_embedded",
    impersonate: true,
  });
  assert.equal(web[web.indexOf("--impersonate") + 1], "chrome");
  const android = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 18,
    client: "android",
    impersonate: true,
  });
  assert.equal(android.includes("--impersonate"), false);
  assert.ok(YTDLP_CLIENT_EXTRACT.some((row) => row.client === "web_embedded" && row.cookies));
});

test("deprecated --user-agent/--referer/--add-header are not used; --add-headers is", () => {
  const argv = ytdlpArgv({ dir: "/tmp/x", id: "jNQXAC9IVRw", itag: 137, client: "web_safari" });
  for (const flag of YTDLP_DEPRECATED_HEADERS) {
    assert.equal(argv.includes(flag), false, flag);
  }
  assert.equal(ytdlpHeaderArgs()[0], "--add-headers");
  assert.match(ytdlpHeaderArgs()[1] ?? "", /Accept-Language:en-US/);
  assert.ok(argv.includes("--add-headers"));
});

test("parses yt-dlp extract debug: clients, jsc/node, sabr, selected format", () => {
  const web = parseYtdlpLog(`
[debug] Optional libraries: certifi-2026.07.22, curl_cffi-0.16.1, sqlite3-3.40.1
[debug] JS runtimes: node-22.23.2
[debug] [youtube] [pot] PO Token Providers: none
[youtube] jNQXAC9IVRw: Downloading web embedded player API JSON
[youtube] [jsc:node] Solving JS challenges using node
[info] jNQXAC9IVRw: Downloading 1 format(s): 18
[youtube] jNQXAC9IVRw: Downloading player e937390a-main
`);
  assert.deepEqual(web.clients, ["web_embedded"]);
  assert.equal(web.curlCffi, true);
  assert.match(web.jsRuntime ?? "", /node/);
  assert.equal(web.potProviders, "none");
  assert.equal(web.nsig, true);
  assert.equal(web.selectedFormats, "18");
  assert.equal(web.playerJs, "e937390a");
  assert.equal(web.ipv6Mismatch, false);
  const android = parseYtdlpLog(
    "[debug] WARNING: [youtube] Some android client https formats have been skipped as they are missing a URL. YouTube may have enabled the SABR-only streaming experiment for the current session.\n[youtube] x: Downloading android player API JSON",
  );
  assert.equal(android.sabr, true);
  assert.deepEqual(android.clients, ["android"]);
  assert.ok(YTDLP_EXTRACTOR_LAYERS.some((row) => row.layer === "jsc"));
  assert.ok(YTDLP_EXTRACTOR_LAYERS.some((row) => row.layer === "pot"));
});

test("working command matches argv and includes the zoo 1080 selector", () => {
  const cmd = ytdlpWorkingCommand({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 137,
    client: "web_embedded",
    proxy: "socks5h://127.0.0.1:1080",
    impersonate: true,
    pot: "GVS",
    playerPot: "PLAYER",
  });
  assert.match(cmd, /^python3 -m yt_dlp /);
  assert.match(cmd, /--impersonate chrome/);
  assert.match(cmd, /player_client=web_embedded/);
  assert.match(cmd, /137\+140\/137\+251\/96/);
  assert.match(cmd, /socks5h:\/\/127\.0\.0\.1:1080/);
  assert.equal(cmd.includes("--force-ipv4"), false);
  assert.match(cmd, /--check-formats/);
  assert.match(cmd, /jNQXAC9IVRw/);
  assert.match(YTDLP_WORKING_EXAMPLE, /player_client=web_embedded/);
  assert.match(YTDLP_WORKING_EXAMPLE, /--impersonate chrome/);
  assert.equal(YTDLP_WORKING_EXAMPLE.includes("--force-ipv4"), false);
});

test("cookies-from-browser only when YTDLP_BROWSER is a known browser", () => {
  const previous = process.env.YTDLP_BROWSER;
  process.env.YTDLP_BROWSER = "firefox";
  assert.deepEqual(browserCookieArgs(), ["--cookies-from-browser", "firefox"]);
  process.env.YTDLP_BROWSER = "not-a-browser";
  assert.deepEqual(browserCookieArgs(), []);
  if (previous === undefined) delete process.env.YTDLP_BROWSER;
  else process.env.YTDLP_BROWSER = previous;
});

test("keeps = in visitor_data and does not pin fetch_pot without a token", () => {
  const args = extractorArgs("mweb", undefined, "abc=def");
  assert.match(args, /visitor_data=abc=def/);
  assert.ok(!args.includes("fetch_pot=never"));
  const loggedIn = extractorArgs("web_embedded", "POT", null, "PLAYER", "104123||");
  assert.match(loggedIn, /data_sync_id=104123\|\|/);
  assert.equal(poTokenArgs("android", "WEBPO"), "");
  assert.match(poTokenArgs("web_embedded", "WEBPO"), /web_embedded\.gvs\+WEBPO/);
  assert.ok(YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "data_sync_id"));
  assert.ok(
    YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "fetch_pot" && /never iff/.test(row.use)),
  );
});

test("yt-dlp exit codes: SIGKILL/timeout is not a 403", () => {
  const forbidden = mapYtdlpExit(
    1,
    "ERROR: unable to download video data: HTTP Error 403: Forbidden",
  );
  assert.equal(forbidden.kind, "forbidden");
  assert.equal(forbidden.retryable, false);
  assert.equal(forbidden.next, "next-socks");

  const raced = mapYtdlpExit(1, "ERROR: unable to download video data: HTTP Error 403: Forbidden", {
    signal: "SIGKILL",
    timedOut: true,
  });
  assert.equal(raced.kind, "timeout");
  assert.notEqual(raced.kind, "forbidden");

  const sabr =
    "WARNING: Some android client https formats have been skipped as they are missing a URL. YouTube may have enabled the SABR-only streaming experiment for the current session. See  https://github.com/yt-dlp/yt-dlp/issues/12482\n[download]  12.0% of  10.00MiB at   40.00KiB/s";
  const timed = mapYtdlpExit(null, sabr, { signal: "SIGKILL", timedOut: true });
  assert.equal(timed.kind, "timeout");
  assert.equal(timed.next, "next-socks");
  const killed = mapYtdlpExit(YTDLP_EXIT.sigkill, sabr);
  assert.equal(killed.kind, "killed");
  assert.notEqual(killed.kind, "forbidden");
  assert.notEqual(killed.kind, "sabr");
});

test("SABR no-formats is next-client; nsig 2026 wording retries", () => {
  const sabr = mapYtdlpExit(
    1,
    "WARNING: YouTube may have enabled the SABR-only streaming experiment for the current session. See  https://github.com/yt-dlp/yt-dlp/issues/12482\nERROR: [youtube] jNQXAC9IVRw: No video formats found!",
  );
  assert.equal(sabr.kind, "sabr");
  assert.equal(sabr.next, "next-client");

  const nsig = mapYtdlpExit(
    1,
    "WARNING: Error solving n challenge request using \"node\" provider: n result is invalid for 'AbCd'\nERROR: [youtube] x: No video formats found!",
  );
  assert.equal(nsig.kind, "nsig");
  assert.equal(nsig.retryable, true);
});

test("geo vs errno 101 vs exit 101; ffmpeg stop; CLI is 2", () => {
  const geo = mapYtdlpExit(
    1,
    "ERROR: [youtube] x: The uploader has not made this video available in your country due to geo restriction",
  );
  assert.equal(geo.kind, "geo");
  const net = mapYtdlpExit(
    1,
    "ERROR: Unable to download webpage: <urlopen error [Errno 101] Network is unreachable>",
  );
  assert.equal(net.kind, "network");
  const cancelled = mapYtdlpExit(101, "Aborting remaining downloads");
  assert.equal(cancelled.kind, "cancelled");
  const ff = mapYtdlpExit(
    1,
    "ERROR: You have requested merging of multiple formats but ffmpeg is not installed. Aborting due to --abort-on-error",
  );
  assert.equal(ff.kind, "ffmpeg");
  assert.equal(ff.next, "stop");
  const cli = mapYtdlpExit(2, "yt-dlp: error: You must provide at least one URL.");
  assert.equal(cli.kind, "cli");
  assert.equal(classifyYtdlpFailure({ code: 0 }).kind, "ok");
});

test("ULA ip= in the log is an IPv6 mismatch", () => {
  const ula = parseYtdlpLog(
    "ERROR: unable to download video data: HTTP Error 403: Forbidden\nhttps://r1.googlevideo.com/videoplayback?ip=fda3:9b4d:1::aa&itag=18",
  );
  assert.equal(ula.ipv6Mismatch, true);
  assert.equal(looksLikeIpv6Mismatch("https://x/videoplayback?ip=203.0.113.9&itag=18"), false);
  const fail = mapYtdlpExit(
    1,
    "ERROR: unable to download video data: HTTP Error 403: Forbidden\nhttps://r1.googlevideo.com/videoplayback?ip=fda3:9b4d:1::aa",
  );
  assert.equal(fail.kind, "ipv6");
  assert.equal(fail.next, "next-socks");
});

test("proxy authority is fully redacted before it can reach a client", () => {
  // Credentialed hop: neither the user:pass nor the host:port may survive into
  // errorLine or the formatted message (which becomes the /api/ytdlp 502 body).
  const credentialed = mapYtdlpExit(
    1,
    "ERROR: Unable to connect to proxy socks5h://user:pass@10.0.0.5:1080: Connection refused",
  );
  const message = formatYtdlpFailure("web_embedded", credentialed);
  for (const leak of ["user", "pass", "10.0.0.5", "0.5", "1080"]) {
    assert.ok(!credentialed.errorLine.includes(leak), `errorLine leaks ${leak}`);
    assert.ok(!credentialed.hint.includes(leak), `hint leaks ${leak}`);
    assert.ok(!message.includes(leak), `formatted failure leaks ${leak}`);
  }
  assert.match(credentialed.errorLine, /socks5h:\/\/\*\*\*/);
  assert.equal(credentialed.kind, "network");
  assert.equal(credentialed.next, "next-socks");

  // No userinfo at all: the bare host:port is still the internal hop address.
  const bare = mapYtdlpExit(
    1,
    "[download] Got error: <urlopen error [Errno 111] Connection refused> (socks5://198.51.100.7:9050)",
  );
  for (const leak of ["198", "51", "100", "7", "9050"]) {
    assert.ok(!bare.errorLine.includes(leak), `errorLine leaks ${leak}: ${bare.errorLine}`);
    assert.ok(!bare.hint.includes(leak), `hint leaks ${leak}: ${bare.hint}`);
  }
  assert.match(bare.errorLine, /socks5:\/\/\*\*\*/);

  // A plain error line without a proxy URL passes through untouched.
  const plain = mapYtdlpExit(1, "ERROR: [youtube] jNQXAC9IVRw: No video formats found!");
  assert.equal(plain.errorLine, "[youtube] jNQXAC9IVRw: No video formats found!");
});

test("the interpreter is configurable, since `python3` is not always the name", () => {
  assert.equal(pythonBin({} as NodeJS.ProcessEnv), "python3");
  assert.equal(
    pythonBin({ VELO_PYTHON: "/venv/bin/python" } as NodeJS.ProcessEnv),
    "/venv/bin/python",
  );
  assert.equal(pythonBin({ PYTHON_BIN: "python3.12" } as NodeJS.ProcessEnv), "python3.12");
  // VELO_PYTHON wins, and blank values fall through rather than becoming "".
  assert.equal(
    pythonBin({ VELO_PYTHON: "/a/python", PYTHON_BIN: "/b/python" } as NodeJS.ProcessEnv),
    "/a/python",
  );
  assert.equal(pythonBin({ VELO_PYTHON: "   " } as NodeJS.ProcessEnv), "python3");
});

test("a missing interpreter is told apart from a missing yt-dlp", () => {
  const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });
  const missing = classifyPythonProbe({ bin: "python3", spawnError: enoent });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.reason, "no-interpreter");
  assert.match(missing.ok === false ? missing.message : "", /VELO_PYTHON/);

  const noModule = classifyPythonProbe({
    bin: "python3",
    code: 1,
    stderr: "/usr/bin/python3: No module named yt_dlp\n",
  });
  assert.equal(noModule.ok === false && noModule.reason, "no-ytdlp");
  // The message has to name the fix, and the interpreter it applies to.
  assert.match(noModule.ok === false ? noModule.message : "", /pip install -U yt-dlp/);

  const ok = classifyPythonProbe({ bin: "python3", code: 0, stdout: "2026.08.19\n" });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true && ok.version, "2026.08.19");
});

test("a python that runs but fails is 'broken', not 'missing'", () => {
  const broken = classifyPythonProbe({ bin: "python3", code: 2, stderr: "Segmentation fault" });
  assert.equal(broken.ok === false && broken.reason, "broken");
  // Exit 0 with no version is equally unusable.
  const empty = classifyPythonProbe({ bin: "python3", code: 0, stdout: "  \n" });
  assert.equal(empty.ok === false && empty.reason, "broken");
});

test("only a genuinely absent binary counts as a missing interpreter", () => {
  assert.equal(isMissingInterpreterError(Object.assign(new Error("x"), { code: "ENOENT" })), true);
  assert.equal(isMissingInterpreterError(Object.assign(new Error("x"), { code: "EACCES" })), true);
  // A process that started and was killed is a different failure entirely.
  assert.equal(
    isMissingInterpreterError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })),
    false,
  );
  assert.equal(isMissingInterpreterError(new Error("spawn failed")), false);
  assert.equal(isMissingInterpreterError(null), false);
});
