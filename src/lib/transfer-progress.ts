/**
 * One transfer, three channels that never store each other's numbers:
 *   stage — a marker percent (the hop "18"), no bytes
 *   file  — real byte loaded/total, including concurrent video and audio legs
 *   hls   — playlist segment done/total, never treated as bytes
 *
 * `presentedTransfer` is the only reading the save UI shows. It never reports
 * 100 while the transfer is still running. `settleTransfer` is the only path
 * to a completed 100. Failure and abort are not complete and are not 100.
 */

export type TransferPhase = "running" | "complete" | "failed" | "aborted";

export type PresentMode = "preparing" | "bytes" | "segments" | "complete" | "failed" | "aborted";

export type PresentedTransfer = {
  phase: TransferPhase;
  mode: PresentMode;
  /** 100 only when phase is "complete". */
  percent: number;
  /** Set only when mode is "bytes". Never segment counts. */
  loaded?: number;
  total?: number;
};

export type TransferLegUpdate = {
  id: string;
  loaded?: number;
  total?: number;
  /** 0–100 when this leg has no byte total. */
  percent?: number;
  /** Playlist indexes. Never written onto a file-byte leg. */
  segments?: boolean;
};

/** A same-hop tick: a stage marker, file bytes, or HLS segment counts. */
export type SameHopReport = {
  loaded?: number;
  total?: number;
  percent?: number;
  /** When set, loaded/total are playlist segments and must not be shown as bytes. */
  segments?: boolean;
};

export type TransferSnapshot = {
  phase: TransferPhase;
  stage: Readonly<Record<string, number>>;
  /** Last stage percent that was safe to show. Several stage legs never walk it backward. */
  stageShown: number;
  fileAbandoned: boolean;
  file: Readonly<Record<string, { loaded: number; total: number }>>;
  /** Last file percent once two byte legs exist, so a new empty leg cannot walk the bar backward. */
  fileShown: number;
  /** Per mux leg. Segment counts never share a file leg's loaded/total. */
  muxSegments: Readonly<Record<string, { done: number; total: number }>>;
  /** Last mux-segment percent once two segment legs exist. */
  segmentShown: number;
  hls: { done: number; total: number } | null;
};

export function emptyTransfer(): TransferSnapshot {
  return {
    phase: "running",
    stage: {},
    stageShown: 0,
    fileAbandoned: false,
    file: {},
    fileShown: 0,
    muxSegments: {},
    segmentShown: 0,
    hls: null,
  };
}

/** A progressive body reading. Callers fold this onto the file channel. */
export function fileByteReport(loaded: number, total: number): SameHopReport {
  return { loaded, total };
}

/** HLS segment counts. They never use the file id and never set replace. */
export function hlsSegmentReport(done: number, total: number): SameHopReport {
  return { loaded: done, total, segments: true };
}

/** Rounded `loaded / total` percent, or null when the total is not usable. */
export function byteTransferPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0 || loaded < 0) return null;
  return Math.round((loaded / total) * 100);
}

function holdRunning(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  const rounded = Math.round(percent);
  if (rounded >= 100) return 99;
  if (rounded < 0) return 0;
  return rounded;
}

function sumFile(file: TransferSnapshot["file"]): { loaded: number; total: number; legs: number } | null {
  const legs = Object.values(file).filter((leg) => leg.total > 0);
  if (!legs.length) return null;
  return {
    loaded: legs.reduce((sum, leg) => sum + leg.loaded, 0),
    total: legs.reduce((sum, leg) => sum + leg.total, 0),
    legs: legs.length,
  };
}

export function noteStage(snapshot: TransferSnapshot, id: string, percent: number): TransferSnapshot {
  if (snapshot.phase !== "running" || !Number.isFinite(percent)) return snapshot;
  const stage = { ...snapshot.stage, [id]: Math.max(snapshot.stage[id] ?? 0, Math.round(percent)) };
  const values = Object.values(stage);
  const combined = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const stageShown = values.length > 1 ? Math.max(snapshot.stageShown, combined) : combined;
  return { ...snapshot, stage, stageShown };
}

export function noteFileBytes(
  snapshot: TransferSnapshot,
  id: string,
  loaded: number,
  total: number,
): TransferSnapshot {
  if (snapshot.phase !== "running") return snapshot;
  const reading = byteTransferPercent(loaded, total);
  if (reading == null) return snapshot;
  const prior = snapshot.file[id];
  const file = {
    ...snapshot.file,
    [id]: { loaded: prior ? Math.max(prior.loaded, loaded) : loaded, total },
  };
  const sum = sumFile(file);
  const fraction = sum ? (byteTransferPercent(sum.loaded, sum.total) ?? 0) : 0;
  const fileShown = sum && sum.legs > 1 ? Math.max(snapshot.fileShown, fraction) : fraction;
  return { ...snapshot, file, fileShown, fileAbandoned: false };
}

export function noteHlsSegments(snapshot: TransferSnapshot, done: number, total: number): TransferSnapshot {
  if (snapshot.phase !== "running") return snapshot;
  if (byteTransferPercent(done, total) == null) return snapshot;
  const prior = snapshot.hls;
  const nextDone = prior && prior.total === total ? Math.max(prior.done, done) : done;
  return { ...snapshot, hls: { done: nextDone, total } };
}

/** The progressive body is dead. Later HLS counts may own the bar. Live server bytes are a different snapshot. */
export function abandonFile(snapshot: TransferSnapshot): TransferSnapshot {
  return { ...snapshot, fileAbandoned: true, file: {}, fileShown: 0 };
}

/**
 * The reading the save UI shows.
 *
 * A live file reports its byte fraction, even when that is below the stage
 * percent. Two file legs report the summed fraction once it has caught the
 * earlier leg; until then they report the leading leg, so a new empty leg
 * cannot walk the bar backward and the percent still matches the bytes shown.
 * An HLS tick does not remove the file channel. Segment counts are a percent
 * only — they are not returned as loaded/total.
 */
export function presentedTransfer(snapshot: TransferSnapshot): PresentedTransfer {
  if (snapshot.phase === "complete") {
    return { phase: "complete", mode: "complete", percent: 100 };
  }
  const running = presentRunning(snapshot);
  if (snapshot.phase === "failed" || snapshot.phase === "aborted") {
    return {
      phase: snapshot.phase,
      mode: snapshot.phase,
      percent: running.percent >= 100 ? 0 : running.percent,
    };
  }
  return running;
}

function leadingFile(file: TransferSnapshot["file"]): { loaded: number; total: number; percent: number } | null {
  let best: { loaded: number; total: number; percent: number } | null = null;
  for (const leg of Object.values(file)) {
    const percent = byteTransferPercent(leg.loaded, leg.total);
    if (percent == null) continue;
    if (!best || percent > best.percent) best = { loaded: leg.loaded, total: leg.total, percent };
  }
  return best;
}

function sumSegments(
  legs: TransferSnapshot["muxSegments"],
): { done: number; total: number; count: number } | null {
  const values = Object.values(legs).filter((leg) => leg.total > 0);
  if (!values.length) return null;
  return {
    done: values.reduce((sum, leg) => sum + leg.done, 0),
    total: values.reduce((sum, leg) => sum + leg.total, 0),
    count: values.length,
  };
}

function leadingSegmentPercent(legs: TransferSnapshot["muxSegments"]): number | null {
  let best: number | null = null;
  for (const leg of Object.values(legs)) {
    const percent = byteTransferPercent(leg.done, leg.total);
    if (percent == null) continue;
    if (best == null || percent > best) best = percent;
  }
  return best;
}

function presentRunning(snapshot: TransferSnapshot): PresentedTransfer {
  const sum = snapshot.fileAbandoned ? null : sumFile(snapshot.file);
  if (sum && sum.total > 0) {
    const fraction = byteTransferPercent(sum.loaded, sum.total) ?? 0;
    if (sum.legs > 1 && fraction < snapshot.fileShown) {
      const leader = leadingFile(snapshot.file);
      if (leader) {
        return {
          phase: "running",
          mode: "bytes",
          percent: holdRunning(leader.percent),
          loaded: leader.loaded,
          total: leader.total,
        };
      }
    }
    return { phase: "running", mode: "bytes", percent: holdRunning(fraction), loaded: sum.loaded, total: sum.total };
  }
  const segments = sumSegments(snapshot.muxSegments);
  if (segments && segments.total > 0) {
    const fraction = byteTransferPercent(segments.done, segments.total) ?? 0;
    const leading = leadingSegmentPercent(snapshot.muxSegments);
    const percent =
      segments.count > 1 && fraction < snapshot.segmentShown && leading != null ? leading : fraction;
    return { phase: "running", mode: "segments", percent: holdRunning(percent) };
  }
  if (snapshot.hls && snapshot.hls.total > 0) {
    const fraction = byteTransferPercent(snapshot.hls.done, snapshot.hls.total) ?? 0;
    return { phase: "running", mode: "segments", percent: holdRunning(fraction) };
  }
  return { phase: "running", mode: "preparing", percent: holdRunning(snapshot.stageShown) };
}

function withoutFileLeg(snapshot: TransferSnapshot, id: string): TransferSnapshot {
  if (!(id in snapshot.file)) return snapshot;
  const file = { ...snapshot.file };
  delete file[id];
  const sum = sumFile(file);
  const fraction = sum ? (byteTransferPercent(sum.loaded, sum.total) ?? 0) : 0;
  const fileShown = !sum ? 0 : sum.legs > 1 ? Math.max(snapshot.fileShown, fraction) : fraction;
  return { ...snapshot, file, fileShown };
}

function withoutMuxSegment(snapshot: TransferSnapshot, id: string): TransferSnapshot {
  if (!(id in snapshot.muxSegments)) return snapshot;
  const muxSegments = { ...snapshot.muxSegments };
  delete muxSegments[id];
  const sum = sumSegments(muxSegments);
  const fraction = sum ? (byteTransferPercent(sum.done, sum.total) ?? 0) : 0;
  const segmentShown = !sum ? 0 : sum.count > 1 ? Math.max(snapshot.segmentShown, fraction) : fraction;
  return { ...snapshot, muxSegments, segmentShown };
}

function noteMuxSegments(snapshot: TransferSnapshot, id: string, done: number, total: number): TransferSnapshot {
  if (snapshot.phase !== "running" || byteTransferPercent(done, total) == null) return snapshot;
  const prior = snapshot.muxSegments[id];
  const nextDone = prior && prior.total === total ? Math.max(prior.done, done) : done;
  const muxSegments = { ...snapshot.muxSegments, [id]: { done: nextDone, total } };
  const sum = sumSegments(muxSegments);
  const fraction = sum ? (byteTransferPercent(sum.done, sum.total) ?? 0) : 0;
  const segmentShown = sum && sum.count > 1 ? Math.max(snapshot.segmentShown, fraction) : fraction;
  return { ...snapshot, muxSegments, segmentShown };
}

/**
 * One mux leg's presentation, folded the way the save panel reads it.
 * Byte legs keep loaded/total. Segment legs stay off the file channel.
 * A preparing reading means this leg currently has neither.
 */
export function foldMuxView(snapshot: TransferSnapshot, id: string, view: PresentedTransfer): TransferSnapshot {
  if (snapshot.phase !== "running") return snapshot;
  if (view.mode === "bytes" && view.loaded != null && view.total != null) {
    return noteFileBytes(withoutMuxSegment(snapshot, id), id, view.loaded, view.total);
  }
  if (view.mode === "segments") {
    return noteMuxSegments(withoutFileLeg(snapshot, id), id, view.percent, 100);
  }
  if (view.mode === "preparing") {
    return noteStage(withoutMuxSegment(withoutFileLeg(snapshot, id), id), id, view.percent);
  }
  return snapshot;
}

const HOP_FILE_ID = "hop";

/** Drop only the same-hop file leg. Server bytes on another id stay. */
function withoutHopFile(snapshot: TransferSnapshot): TransferSnapshot {
  return withoutFileLeg(snapshot, HOP_FILE_ID);
}

/**
 * Merge a same-hop presentation onto a snapshot that may also hold server
 * bytes. Never abandons the whole file channel — a segments reading drops only
 * the hop leg, which the same-hop attempt already abandoned locally.
 */
export function applyPresentedHop(parent: TransferSnapshot, view: PresentedTransfer): TransferSnapshot {
  if (parent.phase !== "running") return parent;
  if (view.mode === "bytes" && view.loaded != null && view.total != null) {
    return noteFileBytes(parent, HOP_FILE_ID, view.loaded, view.total);
  }
  if (view.mode === "segments") {
    return noteHlsSegments(withoutHopFile(parent), view.percent, 100);
  }
  // A preparing view is the whole hop attempt, and it has no file. Drop the
  // hop leg the parent copied earlier; server bytes are a different id.
  if (view.mode === "preparing") return noteStage(withoutHopFile(parent), "hop", view.percent);
  return parent;
}

/** Fold one same-hop report. Segment counts never land on the file channel. */
export function applySameHopReport(previous: TransferSnapshot, report: SameHopReport): TransferSnapshot {
  if (report.segments && report.loaded != null && report.total != null) {
    return noteHlsSegments(previous, report.loaded, report.total);
  }
  if (report.loaded != null && report.total != null) {
    return noteFileBytes(previous, "file", report.loaded, report.total);
  }
  if (report.percent != null) return noteStage(previous, "hop", report.percent);
  return previous;
}

/** What the hybrid save applies to each same-hop report after the hop marker. */
export function foldHybridBypassReport(previous: TransferSnapshot, report: SameHopReport): TransferSnapshot {
  return applySameHopReport(previous, report);
}

export function foldTransferProgress(previous: TransferSnapshot, update: TransferLegUpdate): TransferSnapshot {
  if (previous.phase !== "running") return previous;
  if (update.segments && update.loaded != null && update.total != null) {
    return noteHlsSegments(previous, update.loaded, update.total);
  }
  if (update.loaded != null && update.total != null) {
    return noteFileBytes(previous, update.id, update.loaded, update.total);
  }
  if (update.percent != null) return noteStage(previous, update.id, update.percent);
  return previous;
}

export function settleTransfer(
  previous: TransferSnapshot,
  outcome: "complete" | "failed" | "aborted",
): TransferSnapshot {
  if (outcome === "complete") return { ...previous, phase: "complete" };
  return { ...previous, phase: outcome };
}
