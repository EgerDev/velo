import type { BulkItem, BulkQualityPreset, BulkQueueOptions } from "@/lib/bulk-download";

export function BulkSettings(props: {
  globalPreset: BulkQualityPreset;
  setGlobalPreset: (v: BulkQualityPreset) => void;
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
  queueOptions: BulkQueueOptions;
  setQueueOptions: (v: BulkQueueOptions | ((p: BulkQueueOptions) => BulkQueueOptions)) => void;
  expandPlaylists: boolean;
  setExpandPlaylists: (v: boolean) => void;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
      <div>
        <label className="text-subtle font-medium block mb-1">Quality Preset</label>
        <select
          aria-label="Quality preset"
          value={props.globalPreset}
          onChange={(e) => {
            const p = e.target.value as BulkQualityPreset;
            props.setGlobalPreset(p);
            props.mutate((prev) => prev.map((i) => ({ ...i, preset: p })));
          }}
          className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="1080p">1080p Full HD</option>
          <option value="720p">720p HD</option>
          <option value="audio">Audio Only</option>
          <option value="transcript">Subtitles Only (export script)</option>
        </select>
      </div>
      <div>
        <label className="text-subtle font-medium block mb-1">Max Concurrency</label>
        <select
          aria-label="Max concurrency"
          value={props.queueOptions.maxConcurrency}
          onChange={(e) => props.setQueueOptions((prev) => ({ ...prev, maxConcurrency: Number(e.target.value) }))}
          className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value={1}>1 (Safest — Single Stream)</option>
          <option value={2}>2 (Recommended — Fast & Safe)</option>
          <option value={3}>3 (High Throughput)</option>
        </select>
      </div>
      <div>
        <label className="text-subtle font-medium block mb-1">Stagger Delay (Anti-Burst)</label>
        <select
          aria-label="Stagger delay"
          value={props.queueOptions.staggerDelayMs}
          onChange={(e) => props.setQueueOptions((prev) => ({ ...prev, staggerDelayMs: Number(e.target.value) }))}
          className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value={1000}>1.0s (Fast)</option>
          <option value={1800}>1.8s (Recommended)</option>
          <option value={3000}>3.0s (Strict Rate Limit Protection)</option>
        </select>
      </div>
      <div>
        <label className="text-subtle font-medium block mb-1">Playlist Auto-Expand</label>
        <label className="flex items-center gap-2 mt-2 cursor-pointer text-fg">
          <input
            type="checkbox"
            checked={props.expandPlaylists}
            onChange={(e) => props.setExpandPlaylists(e.target.checked)}
            className="rounded border-border text-accent focus:ring-accent size-4"
          />
          Expand playlist items
        </label>
      </div>
    </div>
  );
}
