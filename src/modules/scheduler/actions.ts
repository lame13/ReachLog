"use server";

import { revalidatePath } from "next/cache";
import { scheduleNames, type ScheduleName } from "./definitions";
import {
  requestScheduleRun,
  updateSchedule,
  ScheduleInputError,
} from "./store";

export async function scheduleAction(
  name: ScheduleName,
  operation: "save" | "run",
  form: FormData,
) {
  if (!scheduleNames.includes(name) || !["save", "run"].includes(operation))
    return { ok: false, message: "Choose a background task." };
  try {
    if (operation === "save")
      updateSchedule(
        name,
        form.get("enabled") === "on",
        Number(form.get("intervalMinutes")),
      );
    else requestScheduleRun(name);
    revalidatePath("/settings/modules");
    return {
      ok: true,
      message:
        operation === "save"
          ? "Schedule saved."
          : "Task queued. It will start within a few seconds.",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ScheduleInputError
          ? error.message
          : "Could not update the schedule. Try again.",
    };
  }
}
