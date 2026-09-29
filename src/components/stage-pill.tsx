import { cn } from "@/lib/utils";
import { getPipelineStage, type PipelineStageKey } from "@/modules/pipeline/stages";

const variants: Record<PipelineStageKey, string> = {
  new: "border-gray-200 bg-white text-gray-700",
  contacted: "border-sky-200 bg-sky-50 text-sky-800",
  replied: "border-emerald-200 bg-emerald-50 text-emerald-800",
  in_conversation: "border-violet-200 bg-violet-50 text-violet-800",
  qualified: "border-amber-200 bg-amber-50 text-amber-900",
  won: "border-emerald-300 bg-emerald-100 text-emerald-900",
  lost: "border-gray-300 bg-gray-100 text-gray-700"
};

/**
 * A stage is a fixed key, so unlike the free-text status pill this always
 * renders the same label and colour for the same column.
 */
export function StagePill({
  stage,
  className
}: {
  stage: string | null | undefined;
  className?: string;
}) {
  const resolved = getPipelineStage(stage);

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium",
        variants[resolved.key],
        className
      )}
    >
      {resolved.label}
    </span>
  );
}
