import { readFileSync } from "node:fs";

/**
 * Committed media fixtures for the parser tests (TEST-05). Both files are
 * synthetic: ffmpeg's `testsrc2` pattern encoded with x264, so they carry no
 * third-party content. Regenerate from the repo root with ffmpeg 7.x:
 *
 *   ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
 *     -t 0.48 -c:v libx264 -threads 1 -preset veryfast -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 \
 *     -bf 2 -g 12 -x264-params "aud=1:scenecut=0:b-adapt=0" -c:a aac -b:a 32k -f mpegts \
 *     -mpegts_pmt_start_pid 4095 -mpegts_start_pid 256 -muxdelay 0 -bitexact \
 *     src/lib/media-test-fixtures/h264-high40-1080p-hls.mpegts
 *
 *   ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -t 0.8 -an -c:v libx264 -threads 1 -preset veryfast \
 *     -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 -bf 2 -g 5 -keyint_min 5 \
 *     -x264-params "scenecut=0:b-adapt=0" -f mp4 -brand dash -movflags +dash+global_sidx -bitexact \
 *     src/lib/media-test-fixtures/h264-high40-1080p-dash.mp4
 *
 * The tests assert structure (codec, profile, level, size, slice pattern,
 * fragment count, box arithmetic), never byte offsets, so a regenerated file
 * from another ffmpeg build still passes.
 */
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url)));

/** MPEG-TS: PAT → PMT 4095 → H.264 (PID 256, High@4.0 1920×1080, AUD on) + AAC (PID 257); 12 frames IPBB…. */
export const hlsTsFixture = (): Uint8Array => read("h264-high40-1080p-hls.mpegts");

/** Fragmented MP4, brand `dash`: ftyp, moov, one global sidx, then 4 moof+mdat fragments of 5 frames (0.8 s at 12800/s). */
export const dashCmafFixture = (): Uint8Array => read("h264-high40-1080p-dash.mp4");
