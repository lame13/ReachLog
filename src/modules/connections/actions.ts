"use server";

import { revalidatePath } from "next/cache";
import { env } from "../core/env";
import { sendTelegramMessage } from "../telegram/notify";
import {
  connectionGroups,
  type ConnectionGroup,
  type ConnectionResult,
} from "./fields";
import { ConnectionInputError, saveConnection } from "./store";
import { testConnection } from "./check";

export async function connectionAction(
  group: ConnectionGroup,
  operation: "save" | "test" | "notify",
  input: FormData,
): Promise<ConnectionResult> {
  if (
    !connectionGroups.includes(group) ||
    !["save", "test", "notify"].includes(operation)
  )
    return { ok: false, message: "Choose a connection and action." };
  if (env.DEMO_MODE)
    return {
      ok: false,
      message:
        "Connections are disabled in demo mode. Your ordinary settings are unchanged.",
    };
  try {
    if (operation === "notify") {
      if (group !== "telegram")
        return {
          ok: false,
          message: "Select Telegram to send a test notification.",
        };
      const result = await sendTelegramMessage(
        "ReachLog: your test notification arrived.",
      );
      return {
        ok: result.sent,
        message: result.sent
          ? "Test notification sent."
          : "Notification failed. Enable Telegram and check the connection details.",
      };
    }
    const view =
      operation === "save"
        ? saveConnection(group, input)
        : await testConnection(group);
    revalidatePath("/settings/modules");
    return {
      ok: operation === "save" || Boolean(view.check?.ok),
      message:
        operation === "save"
          ? "Connection saved. Changes take effect immediately."
          : (view.check?.message ?? "Connection tested."),
      view,
    };
  } catch (error) {
    if (error instanceof ConnectionInputError)
      return { ok: false, message: error.message, errors: error.fields };
    return {
      ok: false,
      message:
        "Could not complete the action. Check your connection settings and data folder permissions, then try again.",
    };
  }
}
