import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { getImapFlowOptions } from "../mailbox/imap-client";
import { smtpTransportOptions } from "../smtp/transport";
import { selectSmtpIdentity } from "../smtp/from-identities";
import { env } from "../core/env";
import {
  connectionFingerprint,
  effectiveConnectionValues,
  getConnectionView,
  recordConnectionCheck,
  validateConnection,
} from "./store";
import type { ConnectionCheck, ConnectionGroup } from "./fields";

export async function checkTelegramConnection(
  token: string,
  chatId: string,
  request: typeof fetch = fetch,
) {
  for (const method of ["getMe", "getChat"] as const) {
    const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
    if (method === "getChat") url.searchParams.set("chat_id", chatId);
    const response = await request(url, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Telegram rejected the connection.");
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("ok" in result) ||
      result.ok !== true
    )
      throw new Error("Telegram rejected the connection.");
  }
}

export async function testConnection(group: ConnectionGroup) {
  if (env.DEMO_MODE)
    throw new Error("Connection tests are unavailable in demo mode.");
  validateConnection(group, effectiveConnectionValues());
  const check: ConnectionCheck = {
    fingerprint: connectionFingerprint(group),
    checkedAt: new Date().toISOString(),
    ok: false,
    message: "",
  };
  try {
    if (group === "smtp") {
      const identity = selectSmtpIdentity(null);
      const transport = nodemailer.createTransport(
        smtpTransportOptions({
          user: identity.smtpUser,
          pass: identity.smtpPass,
        }),
      );
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
      check.message =
        "SMTP connection and login succeeded. No email was sent; sender acceptance is checked when you send.";
    } else if (group === "imap") {
      const client = new ImapFlow({
        ...getImapFlowOptions(),
        socketTimeout: 10_000,
        disableAutoIdle: true,
      });
      client.on("error", () => {
        /* The awaited operation reports a safe error below. */
      });
      try {
        await client.connect();
        const mailboxes = await client.list();
        check.mailboxes = mailboxes
          .filter(
            (mailbox) =>
              !mailbox.flags.has("\\Noselect") &&
              !mailbox.flags.has("\\NonExistent"),
          )
          .map((mailbox) => mailbox.path);
        const chosen = env.IMAP_MAILBOXES.split(",")
          .map((mailbox) => mailbox.trim())
          .filter(Boolean);
        const missing = chosen.filter(
          (mailbox) => !check.mailboxes?.includes(mailbox),
        );
        check.ok = !missing.length;
        check.message = missing.length
          ? "Connected, but some selected mailboxes were not found. Choose from the available mailboxes below and test again."
          : "Connected. Selected mailboxes are available for sync.";
      } finally {
        client.close();
      }
    } else {
      await checkTelegramConnection(
        env.TELEGRAM_BOT_TOKEN ?? "",
        env.TELEGRAM_CHAT_ID ?? "",
      );
      check.message = "Bot and chat are reachable. No notification was sent.";
    }
    if (group !== "imap") check.ok = true;
  } catch {
    // Provider errors can include credentials, URLs containing tokens, and protocol payloads.
    check.message =
      group === "telegram"
        ? "Could not connect. Check the bot token and chat ID, and start a conversation with your bot."
        : "Could not connect. Check the host, port, encryption, and login details. If using Proton Bridge, make sure it is running.";
  }
  if (!recordConnectionCheck(group, check))
    throw new Error(
      "Settings changed during the test. Test the saved connection again.",
    );
  return getConnectionView(group);
}
