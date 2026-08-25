/** One source of guest-mode language so the header, hero, vault, and login stay aligned. */
export const GUEST = {
  chip: "Guest",
  hero: "Paste a YouTube link. Save Full HD without an account. Sign in only if a file is blocked and you want to attach your own YouTube cookies.",
  vaultTitle: "YouTube cookies are optional",
  vaultBody:
    "Guest saves already work. Sign in and import cookies only when YouTube blocks a file — those cookies stay on your account. We do not keep a login log.",
  save: "Guest save — YouTube cookies stay off",
  saveSigned: "Signed in — cookies apply only after you import them",
  login:
    "Keep downloading as a guest. Sign in if a file was blocked, so you can attach your own YouTube cookies.",
  continueGuest: "Continue as guest — no account needed to download",
  rate: "Guest cap is about 12 files every 10 minutes. Wait for the timer — signing in does not skip a busy preview.",
  busy: "Lots of people are saving Full HD right now. Wait; signing in will not skip the line.",
  queue: "This preview is busy. One Save at a time. Recent will abort the previous transfer.",
} as const;
