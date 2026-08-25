import type { TranscriptCue } from "./transcript.ts";

export type NLEExportFormat = "davinci" | "fcpxml" | "premiere" | "audacity";

export type NLEExportOptions = {
  sequenceTitle?: string;
  fps?: number;
};

export type NLEExportResult = {
  content: string;
  filename: string;
  mimeType: string;
};

/**
 * Convert seconds into HH:MM:SS:FF standard NLE timecode string.
 */
export function secondsToTimecode(seconds: number, fps = 30): string {
  const safeSeconds = Math.max(0, seconds);
  const fpsBase = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(safeSeconds * fps);
  
  const frames = totalFrames % fpsBase;
  const totalSec = Math.floor(totalFrames / fps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);

  const pad = (n: number, z = 2) => String(Math.floor(n)).padStart(z, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/**
 * DaVinci Resolve Marker CSV format.
 * Header: Timecode In,Timecode Out,Marker Name,Marker Notes,Color
 */
export function exportMarkersDavinciCsv(cues: TranscriptCue[], fps = 30): string {
  if (!cues || cues.length === 0) return "";

  const headers = ["Timecode In", "Timecode Out", "Marker Name", "Marker Notes", "Color"];
  const rows: string[] = [headers.join(",")];

  cues.forEach((cue, index) => {
    const timeIn = secondsToTimecode(cue.start, fps);
    const timeOut = secondsToTimecode(cue.end, fps);
    const name = `Cue ${index + 1}`;
    // Escape quotes and commas in notes
    const cleanNotes = `"${cue.text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const color = "Blue";

    rows.push([timeIn, timeOut, `"${name}"`, cleanNotes, color].join(","));
  });

  return rows.join("\n");
}

/**
 * Final Cut Pro XML (FCPXML v1.9) marker format.
 */
export function exportMarkersFcpxml(cues: TranscriptCue[], videoTitle = "Velo Video", fps = 30): string {
  const safeTitle = (videoTitle || "Velo Media").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });

  const lastCue = cues[cues.length - 1];
  const totalDuration = lastCue ? Math.ceil(lastCue.end + 5) : 3600;
  const frameDuration = `100/${Math.round(fps * 100)}s`;

  let markersXml = "";
  cues.forEach((cue, index) => {
    const startSec = cue.start.toFixed(3);
    const durSec = Math.max(0.1, cue.end - cue.start).toFixed(3);
    const textEscaped = cue.text.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "&": return "&amp;";
        case "'": return "&apos;";
        case '"': return "&quot;";
        default: return c;
      }
    });

    markersXml += `                <marker start="${startSec}s" duration="${durSec}s" value="Cue ${index + 1}: ${textEscaped}" />\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p${fps}" frameDuration="${frameDuration}" width="1920" height="1080" />
  </resources>
  <library>
    <event name="Velo Ingest">
      <project name="${safeTitle}">
        <sequence format="r1" duration="${totalDuration}s">
          <spine>
            <gap name="Transcript Markers" offset="0s" duration="${totalDuration}s" start="0s">
${markersXml}            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

/**
 * Adobe Premiere Pro CMX 3600 EDL marker format.
 */
export function exportMarkersPremiereEdl(cues: TranscriptCue[], videoTitle = "Velo Video", fps = 30): string {
  const title = (videoTitle || "Velo Media").slice(0, 32).toUpperCase();
  const lines: string[] = [
    `TITLE: ${title}`,
    "FCM: NON-DROP FRAME",
    "",
  ];

  cues.forEach((cue, index) => {
    const eventNum = String(index + 1).padStart(3, "0");
    const timeIn = secondsToTimecode(cue.start, fps);
    const timeOut = secondsToTimecode(cue.end, fps);
    const text = cue.text.replace(/\r?\n/g, " ").slice(0, 120);

    lines.push(`${eventNum}  AX       V     C        ${timeIn} ${timeOut} ${timeIn} ${timeOut}`);
    lines.push(`* FROM CLIP NAME: ${title}`);
    lines.push(`* MARKER: ${timeIn} Cyan ${text}`);
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Audacity Label Track format.
 * Format: <start_seconds>\t<end_seconds>\t<label_text>
 */
export function exportMarkersAudacity(cues: TranscriptCue[]): string {
  if (!cues || cues.length === 0) return "";

  return cues
    .map((cue) => {
      const start = cue.start.toFixed(6);
      const end = cue.end.toFixed(6);
      const text = cue.text.replace(/\t|\r?\n/g, " ");
      return `${start}\t${end}\t${text}`;
    })
    .join("\n");
}

/**
 * Universal dispatcher for NLE timeline marker exports.
 */
export function exportNLETimeline(
  format: NLEExportFormat,
  cues: TranscriptCue[],
  options: NLEExportOptions = {},
): NLEExportResult {
  const title = options.sequenceTitle || "transcript";
  const safeName = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "transcript";
  const fps = options.fps ?? 30;

  switch (format) {
    case "davinci":
      return {
        content: exportMarkersDavinciCsv(cues, fps),
        filename: `${safeName}_davinci_markers.csv`,
        mimeType: "text/csv;charset=utf-8",
      };
    case "fcpxml":
      return {
        content: exportMarkersFcpxml(cues, title, fps),
        filename: `${safeName}_markers.fcpxml`,
        mimeType: "application/xml;charset=utf-8",
      };
    case "premiere":
      return {
        content: exportMarkersPremiereEdl(cues, title, fps),
        filename: `${safeName}_premiere_markers.edl`,
        mimeType: "text/plain;charset=utf-8",
      };
    case "audacity":
      return {
        content: exportMarkersAudacity(cues),
        filename: `${safeName}_audacity_labels.txt`,
        mimeType: "text/plain;charset=utf-8",
      };
  }
}
