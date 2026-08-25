import { parseVideoId } from "@/lib/youtube";
import { cn } from "@/lib/utils";

export type SampleChip = {
  label: string;
  /** Mono capability hint shown under the label, e.g. "2160p60 · HDR" */
  tag: string;
  query: string;
};

type SampleChipRowProps = {
  samples: readonly SampleChip[];
  onPick: (sample: SampleChip) => void;
  className?: string;
};

/**
 * A shelf of real sample videos: thumbnail, label, and a mono tag naming the
 * capability each one demonstrates. Hover slides in the gold splice mark.
 */
export function SampleChipRow({ samples, onPick, className }: SampleChipRowProps) {
  return (
    <div
      className={cn(
        "stagger mt-4 flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar flex-nowrap",
        className,
      )}
    >
      <span className="mr-1 flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-subtle/80">
        <span aria-hidden className="inline-block h-3 w-[3px] -skew-x-12 rounded-[1px] bg-accent" />
        Try
      </span>
      {samples.map((sample) => {
        const id = parseVideoId(sample.query);
        return (
          <button
            key={sample.label}
            type="button"
            onClick={() => onPick(sample)}
            className="group flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-elevated/60 p-1 pr-3 text-left shadow-xs transition-all hover:border-accent/40 hover:bg-elevated active:scale-95"
          >
            {id ? (
              <span className="relative shrink-0">
                <img
                  src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="h-7 w-12 rounded-lg object-cover opacity-80 transition-opacity duration-[var(--motion-quick)] group-hover:opacity-100"
                />
                <span
                  aria-hidden
                  className="absolute -left-0.5 bottom-1 h-3 w-[3px] -skew-x-12 translate-y-1 rounded-[1px] bg-accent opacity-0 transition-all duration-[var(--motion-quick)] group-hover:translate-y-0 group-hover:opacity-100"
                />
              </span>
            ) : (
              <span
                aria-hidden
                className="h-3 w-[3px] shrink-0 -skew-x-12 translate-y-1 rounded-[1px] bg-accent opacity-0 transition-all duration-[var(--motion-quick)] group-hover:translate-y-0 group-hover:opacity-100"
              />
            )}
            <span className="flex flex-col">
              <span className="whitespace-nowrap text-[11px] font-medium leading-4 text-muted transition-colors duration-[var(--motion-quick)] group-hover:text-fg">
                {sample.label}
              </span>
              <span className="whitespace-nowrap font-mono text-[10px] leading-4 text-subtle">{sample.tag}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
