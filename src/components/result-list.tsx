import { formatDuration } from "@/lib/youtube";
import type { SearchHit } from "@/lib/youtube";

type ResultListProps = {
  title: string;
  subtitle?: string;
  items: SearchHit[];
  onPick: (item: SearchHit) => void;
};

export function ResultList({ title, subtitle, items, onPick }: ResultListProps) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-[var(--tracking-display)] text-fg">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No videos to show.</p>
      ) : (
        <ul className="stagger mt-5 grid grid-cols-1 gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="lift glass flex w-full gap-3 rounded-xl p-2 text-left"
              >
                <span className="relative size-20 shrink-0 overflow-hidden rounded-md bg-elevated sm:aspect-video sm:h-24 sm:w-auto sm:min-w-40">
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="size-full object-cover"
                  />
                  {item.duration != null ? (
                    <span className="absolute bottom-1.5 right-1.5 rounded-xs bg-bg/85 px-1.5 py-0.5 text-xs tabular-nums text-fg">
                      {formatDuration(item.duration)}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 py-1">
                  <span className="block text-sm font-medium leading-snug text-fg text-balance">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-muted">{item.author}</span>
                  <span className="mt-1 block truncate text-xs text-subtle">
                    {[item.views, item.published].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
