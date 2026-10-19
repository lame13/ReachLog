"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { saveEmailDraft } from "./drafts";
import {
  createTargetEvent,
  getSendableTarget,
  persistSentEmail,
  sendOutboundEmail
} from "./send";
import { selectSmtpIdentity } from "./from-identities";
import {
  getUnsavedAcceptedSend,
  markSendRecordRecovered,
  messageRecordExists,
  recoverSenderAddress
} from "./recover-send";

export async function saveDraftAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");

  if (!targetId || !subject || !body) {
    return;
  }

  if (!getSendableTarget(targetId)) return;
  const fromEmail = selectSmtpIdentity(String(formData.get("fromEmail") ?? "")).value;
  saveEmailDraft(targetId, { subject, body, fromEmail });
  createTargetEvent(targetId, "draft_saved", { subject, bodyLength: body.length });
  revalidatePath(`/targets/${targetId}`);
  redirectWithSendFeedback(
    getSafeReturnTo(String(formData.get("returnTo") ?? "")),
    targetId,
    "success",
    "Draft saved. Nothing was sent."
  );
}

export async function sendNowAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");
  const sendKey =
    String(formData.get("sendKey") ?? "").trim() || createId("sendkey");
  const returnTo = getSafeReturnTo(String(formData.get("returnTo") ?? ""));
  const createFollowup = formData.get("createFollowup") === "on";
  const followupDays = Math.max(1, Number(formData.get("followupDays") ?? 5));

  if (!targetId || !subject || !body) {
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      "Subject and body are required before sending."
    );
  }

  const outcome = await sendOutboundEmail({
    targetId,
    subject,
    body,
    fromEmail: String(formData.get("fromEmail") ?? ""),
    sendKey,
    createFollowup,
    followupDays
  });

  if (!outcome.ok) {
    if (outcome.reason === "invalid_message") {
      const target = getSendableTarget(targetId);
      if (target) {
        saveEmailDraft(targetId, {
          subject,
          body,
          fromEmail: selectSmtpIdentity(String(formData.get("fromEmail") ?? "")).value
        });
      }
      redirectWithSendFeedback(
        returnTo,
        targetId,
        "error",
        `${outcome.message} Your draft was saved.`
      );
    }

    if (outcome.reason === "blocked") {
      const target = getSendableTarget(targetId);
      createTargetEvent(targetId, "send_blocked", {
        reason: "send_guard",
        status: target?.status,
        emailVerificationStatus: target?.emailVerificationStatus,
        subject
      });
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(returnTo, targetId, "error", outcome.message);
    }

    if (
      outcome.reason === "unsaved_accepted_send" ||
      outcome.reason === "smtp_disabled"
    ) {
      createTargetEvent(targetId, "send_blocked", {
        reason: outcome.reason,
        subject
      });
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(returnTo, targetId, "error", outcome.message);
    }

    if (outcome.reason === "duplicate") {
      createTargetEvent(targetId, "send_duplicate_blocked", { sendKey, subject });
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(returnTo, targetId, "info", outcome.message);
    }

    if (outcome.reason === "send_failed") {
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(
        returnTo,
        targetId,
        "error",
        `SMTP send failed: ${outcome.message}`
      );
    }

    if (outcome.reason === "persist_failed") {
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(
        returnTo,
        targetId,
        "error",
        `SMTP accepted the email, but ReachLog failed to save it. Do not resend until checked. ${outcome.message}`
      );
    }

    redirectWithSendFeedback(returnTo, targetId, "error", outcome.message);
  }

  if (outcome.demo) {
    createTargetEvent(targetId, "demo_email_simulated", {
      from: outcome.fromEmail,
      messageId: outcome.messageId,
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "success",
      "Demo mode: email send was simulated. Nothing was sent."
    );
  }

  revalidateAfterSend(targetId);
  redirect(returnTo || `/targets/${targetId}`);
}

export async function completeAcceptedSendAction(formData: FormData) {
  const outboundSendId = String(formData.get("outboundSendId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const send =
    outboundSendId && targetId
      ? getUnsavedAcceptedSend(outboundSendId, targetId)
      : undefined;

  if (!send) {
    redirectWithDashboardFeedback(
      "info",
      "That send is already resolved or no longer waiting for a saved record."
    );
  }

  if (messageRecordExists(send.messageId)) {
    markSendRecordRecovered({
      outboundSendId: send.id,
      targetId: send.targetId,
      messageId: send.messageId,
      subject: send.subject,
      resolution: "message_already_saved",
      sentAt: send.sentAt
    });
    revalidateAfterSend(send.targetId);
    redirectWithDashboardFeedback(
      "success",
      "That email was already in your history. Nothing was sent again."
    );
  }

  const target = getSendableTarget(send.targetId, send.threadId);

  if (!target) {
    redirectWithDashboardFeedback(
      "error",
      "ReachLog could not find the contact for this send."
    );
  }

  const fromEmail = recoverSenderAddress(send.targetId, send.id);
  if (!fromEmail) {
    redirectWithDashboardFeedback(
      "error",
      "The original sender is missing from the send history. Check the email in your mailbox before marking it checked."
    );
  }
  const sentAt = send.sentAt ?? send.createdAt;
  const previousMessage = getSqlite()
    .prepare(
      `
      SELECT message_id AS messageId FROM messages
      WHERE thread_id = ? AND COALESCE(sent_at, received_at, created_at) <= ?
      ORDER BY COALESCE(sent_at, received_at, created_at) DESC LIMIT 1
    `
    )
    .get(target.threadId, sentAt) as { messageId: string } | undefined;

  try {
    persistSentEmail({
      target: { ...target, contactEmail: send.toEmail },
      subject: send.subject,
      body: send.bodyText,
      fromEmail,
      messageId: send.messageId,
      replyToMessageId: previousMessage?.messageId,
      outboundSendId: send.id,
      rawResult: {
        accepted: [send.toEmail],
        rejected: [],
        response: "recovered_after_persist_failure"
      },
      createFollowup: false,
      followupDays: 0,
      sentAt,
      recovering: true
    });
  } catch (error) {
    createTargetEvent(send.targetId, "send_record_recovery_failed", {
      messageId: send.messageId,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    revalidateAfterSend(send.targetId);
    redirectWithDashboardFeedback(
      "error",
      `ReachLog could not save the record: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  revalidateAfterSend(send.targetId);
  redirectWithDashboardFeedback(
    "success",
    "Saved the accepted email to the contact history. Nothing was sent again. Add a follow-up if you still need one."
  );
}

function revalidateAfterSend(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/followups");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}

function getSafeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "";
  }

  return value;
}

function redirectWithSendFeedback(
  returnTo: string,
  targetId: string,
  status: "error" | "info" | "success",
  message: string
): never {
  const fallback = targetId ? `/targets/${targetId}` : "/dashboard";
  const url = new URL(returnTo || fallback, "https://reachlog.local");

  if (targetId) {
    url.searchParams.set("sendTargetId", targetId);
  }

  url.searchParams.set("sendStatus", status);
  url.searchParams.set("sendMessage", message.slice(0, 700));

  redirect(`${url.pathname}${url.search}`);
}

function redirectWithDashboardFeedback(
  status: "error" | "info" | "success",
  message: string
): never {
  const url = new URL("/dashboard", "https://reachlog.local");
  url.searchParams.set("sendStatus", status);
  url.searchParams.set("sendMessage", message.slice(0, 700));
  redirect(`${url.pathname}${url.search}`);
}
