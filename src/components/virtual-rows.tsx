import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * A scroll box that renders only the rows near its viewport. A long transcript
 * is ~3.7k cues ≈ 37k DOM nodes rendered in full — a phone needed ~5s to apply
 * a search to it. Windowed it is a few dozen rows. Rows may wrap to any height:
 * each is measured after it renders, `estimateSize` only seeds the scrollbar.
 *
 * It owns the scroll element on purpose: React attaches a parent's ref only
 * after its children's layout effects run, so a scroller passed in from a
 * parent that mounts in the same commit is still null when the virtualizer
 * first looks — and it then never renders a row.
 */
export function VirtualRows<T>(props: {
  items: readonly T[];
  className: string;
  getKey: (item: T) => string | number;
  estimateSize: number;
  gap: number;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => props.estimateSize,
    getItemKey: (index) => props.getKey(props.items[index]!),
    gap: props.gap,
    overscan: 8,
  });
  return (
    <div ref={scrollRef} className={props.className}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {props.renderRow(props.items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
