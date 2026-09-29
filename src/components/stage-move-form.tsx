"use client";

import { useRef } from "react";
import { moveTargetStageAction } from "@/modules/pipeline/actions";
import { pipelineStages } from "@/modules/pipeline/stages";

/**
 * The control on every pipeline card and on the target page. Choosing a stage
 * submits the form; the button stays for a browser without JavaScript, and the
 * server action re-reads the stage so a stale tab cannot skip validation.
 */
export function StageMoveForm({
  targetId,
  stage,
  submitLabel = "Move"
}: {
  targetId: string;
  stage: string;
  submitLabel?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={moveTargetStageAction} className="relative flex items-center gap-2" ref={formRef}>
      <input name="targetId" type="hidden" value={targetId} />
      <label className="sr-only" htmlFor={`stage-${targetId}`}>
        Move to stage
      </label>
      <select
        className="h-8 w-full rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-accent"
        defaultValue={stage}
        id={`stage-${targetId}`}
        name="stage"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {pipelineStages.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="h-8 shrink-0 rounded-md border border-line px-2 text-xs font-medium hover:bg-panel">
        {submitLabel}
      </button>
    </form>
  );
}
