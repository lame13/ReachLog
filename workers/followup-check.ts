import { env } from "../src/modules/core/env";
import { getSqlite } from "../src/modules/core/db/client";
import { withWorkerLock } from "../src/modules/core/db/locks";
import { createId } from "../src/modules/core/ids";
import { targetUrl } from "../src/modules/core/urls";
import { notifyWorkerFailure } from "../src/modules/core/worker-alerts";
import { sendTelegramMessage } from "../src/modules/telegram/notify";

type DueFollowup = {
  id: string;
  target_id: string;
  due_at: string;
  company_name: string;
  contact_email: string | null;
};

async function main() {
  if (env.DEMO_MODE) {
    console.log("followup-check skipped: DEMO_MODE=true");
    return;
  }

  if (await withWorkerLock("followup-check", 120, checkFollowups) === null) process.exitCode = 75;
}

async function checkFollowups() {
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dueFollowups = sqlite
    .prepare(
      `
      SELECT
        followup_tasks.id,
        followup_tasks.target_id,
        followup_tasks.due_at,
        targets.company_name,
        contacts.email as contact_email
      FROM followup_tasks
      INNER JOIN targets ON targets.id = followup_tasks.target_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE followup_tasks.status = 'open'
        AND followup_tasks.due_at <= ?
        AND followup_tasks.notification_sent_at IS NULL
      ORDER BY followup_tasks.due_at ASC
    `
    )
    .all(now) as DueFollowup[];

  if (!env.TELEGRAM_ENABLED) {
    console.log(
      `followup-check: ${dueFollowups.length} due, Telegram disabled; due follow-ups stay visible in the app`
    );
    return;
  }

  let failed = 0;
  for (const followup of dueFollowups) {
    const text = `Follow-up due: ${followup.company_name} (${followup.contact_email ?? "form only"})\n${targetUrl(followup.target_id)}`;
    const result = await sendTelegramMessage(text);
    if (!result.sent) failed++;

    if (result.sent) {
      sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET notification_sent_at = ?,
              notification_channel = ?,
              notification_status = ?
          WHERE id = ?
        `
        )
        .run(now, "telegram", result.reason, followup.id);
    }

    sqlite
      .prepare(
        "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'followup_due', ?, ?)"
      )
      .run(
        createId("event"),
        followup.target_id,
        JSON.stringify({ followupId: followup.id, notification: result }),
        now
      );
  }

  console.log(`followup-check: ${dueFollowups.length} due`);
  if (failed) throw new Error(`${failed} follow-up notifications failed. Check the Telegram connection.`);
}

main().catch(async (error) => {
  console.error(error);
  await notifyWorkerFailure("followup-check", error);
  process.exitCode = 1;
});
