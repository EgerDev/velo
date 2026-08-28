import { TranscriptForm } from "@/components/transcript-form";
import { TranscriptSidebar } from "@/components/transcript-sidebar";
import { TranscriptReader } from "@/components/transcript-reader";
import type { TranscriptViewProps } from "@/components/transcript-props";

export function TranscriptView(props: TranscriptViewProps) {
  return (
    <div className="w-full space-y-6">
      <TranscriptForm {...props} />
      {props.video ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <TranscriptSidebar {...props} />
          <TranscriptReader {...props} />
        </div>
      ) : null}
    </div>
  );
}
