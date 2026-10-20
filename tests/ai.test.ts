import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net, { type Socket } from "node:net";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

function mockAiFetch() {
  return async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const text = payload.messages?.map((message) => message.content).join("\n") ?? "";
      const output = text.includes("TASK: reply_triage")
        ? {
            intent: "interested",
            confidence: 0.96,
            summary: "They want a call this week.",
            evidence: ["Can we talk Tuesday?"],
            asks: ["a call"],
            commitments: [],
            objection: null,
            suggestedStage: "replied",
            stageConfidence: 0.95,
            isOptOut: false,
            nextAction: {
              type: "reply",
              dueInDays: 1,
              reason: "Answer the call request."
            },
            draft: {
              subject: "Re: Migration question",
              body: "Tuesday works. I can walk through the migration and the cutover plan. Does 10:00 work for you?"
            }
          }
        : text.includes("TASK: followup_draft")
          ? {
              subject: "Re: Migration question",
              body: "I can send the cutover checklist and a short estimate. Which part is blocking the decision?",
              rationale: "Moves the thread toward a concrete next step."
            }
          : {
              kind: "lead",
              confidence: text.includes("LOW_CONFIDENCE_LEAD") ? 0.6 : 0.93,
              isHuman: true,
              company: "Cobalt Works",
              personName: "Dana",
              email: "dana@cobalt.example",
              need: "WordPress migration",
              budget: null,
              timeline: null,
              summary: "Dana asked about a WordPress migration.",
              draft: null
            };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
  };
}

async function smtpServer() {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("220 localhost test SMTP\r\n");
    let buffer = "";
    let dataMode = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (true) {
        if (dataMode) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write("250 Message accepted\r\n");
          continue;
        }
        const index = buffer.indexOf("\r\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        commands.push(line);
        if (/^EHLO/i.test(line)) socket.write("250-localhost\r\n250 OK\r\n");
        else if (/^DATA/i.test(line)) {
          dataMode = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    commands,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

test("the OpenAI-compatible client retries without response_format", async () => {
  const { requestChatCompletion } = await import("../src/modules/ai/provider");
  let calls = 0;
  const request = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({ error: { message: "response_format is not supported" } }),
        { status: 400 }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"subject\":\"Re: Hi\",\"body\":\"OK\",\"rationale\":\"test\"}" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await requestChatCompletion({
    config: {
      baseUrl: "http://127.0.0.1:9999/v1",
      apiKey: "test",
      model: "test"
    },
    messages: [{ role: "user", content: "hello" }],
    request
  });

  assert.equal(calls, 2);
  assert.match(result.content, /Re: Hi/);
  assert.equal(result.promptTokens, 3);
});

test("AI provider errors stay readable without a key and redact configured keys", async () => {
  const { requestChatCompletion } = await import("../src/modules/ai/provider");
  for (const apiKey of [undefined, "secret-key"]) {
    await assert.rejects(requestChatCompletion({
      config: { baseUrl: "http://127.0.0.1:9999/v1", model: "test", apiKey },
      messages: [{ role: "user", content: "hello" }],
      request: async () => new Response(JSON.stringify({
        error: { message: apiKey ? `Invalid key ${apiKey}` : "Model unavailable" }
      }), { status: 401 })
    }), { message: apiKey ? "AI provider returned 401: Invalid key [redacted]" : "AI provider returned 401: Model unavailable" });
  }
});

test("AI automation triages replies, drafts follow-ups and captures unlinked leads", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "reachlog-ai-"));
  for (const key of Object.keys(process.env))
    if (/^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|AI_|REACHLOG_|DEMO_|SEED_)/.test(key))
      delete process.env[key];
  Object.assign(process.env, {
    DATABASE_PATH: path.join(directory, "app.sqlite"),
    BACKUP_DIR: path.join(directory, "backups"),
    REACHLOG_CONNECTIONS_PATH: path.join(directory, "connections.json"),
    DEMO_MODE: "false",
    SEED_DEMO_DATA: "false"
  });

  const aiFetch = mockAiFetch();
  const { getSqlite } = await import("../src/modules/core/db/client");
  const { bootstrapDatabase } = await import("../src/modules/core/db/bootstrap");
  const connections = await import("../src/modules/connections/store");
  const { triageReplyMessage } = await import("../src/modules/ai/triage");
  const { draftDueFollowups } = await import("../src/modules/ai/followup");
  const { processUnlinkedMail } = await import("../src/modules/ai/unlinked");
  const { getAiRun, runAiJson } = await import("../src/modules/ai/client");
  const { getLatestTargetAiReview, getPendingAiReviews } = await import("../src/modules/ai/review");
  const { acceptAiSuggestionAction } = await import("../src/modules/ai/actions");
  const { followupDraftSchema } = await import("../src/modules/ai/schemas");
  const sqlite = getSqlite();

  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("0009 rebuilds an old schedule table and preserves its rows", () => {
    const legacyPath = path.join(directory, "legacy-schedule.sqlite");
    const legacy = new Database(legacyPath);
    try {
      bootstrapDatabase(legacy);
      legacy.exec(`
        DROP TABLE background_schedules;
        CREATE TABLE background_schedules (
          name TEXT PRIMARY KEY CHECK(name IN ('mail-sync', 'followup-check', 'backup')),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
          interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 1 AND 10080),
          next_run_at TEXT,
          last_started_at TEXT,
          last_finished_at TEXT,
          last_success_at TEXT,
          last_status TEXT NOT NULL DEFAULT 'never' CHECK(last_status IN ('never', 'running', 'success', 'failed', 'skipped', 'interrupted')),
          last_error TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO background_schedules (name, enabled, interval_minutes, updated_at)
        VALUES ('mail-sync', 1, 5, '2026-01-01'), ('followup-check', 0, 15, '2026-01-01'), ('backup', 0, 1440, '2026-01-01');
        DELETE FROM schema_migrations WHERE version = '0009';
      `);

      bootstrapDatabase(legacy);
      assert.equal(
        (legacy.prepare("SELECT COUNT(*) FROM background_schedules").pluck().get() as number),
        4
      );
      assert.equal(
        legacy
          .prepare("SELECT enabled FROM background_schedules WHERE name = 'mail-sync'")
          .pluck()
          .get(),
        1
      );
      assert.equal(
        legacy
          .prepare("SELECT interval_minutes FROM background_schedules WHERE name = 'ai'")
          .pluck()
          .get(),
        5
      );
      assert.deepEqual(legacy.pragma("foreign_key_check"), []);
    } finally {
      legacy.close();
      rmSync(legacyPath, { force: true });
    }
  });

  connections.saveConnection(
    "ai",
    form({
      AI_ENABLED: "true",
      AI_BASE_URL: "http://127.0.0.1:9999/v1",
      AI_API_KEY: "test-key",
      AI_MODEL: "test-model",
      AI_AUTO_SEND: "false",
      AI_DAILY_SEND_LIMIT: "5"
    })
  );

  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();

  sqlite
    .prepare(
      "INSERT INTO accounts (id,name,domain,website_url,dedupe_key,created_at,updated_at) VALUES ('a1','Acme','acme.example','https://acme.example','domain:acme.example',?,?)"
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO contacts (id,account_id,name,email,domain,email_verification_status,created_at,updated_at) VALUES ('c1','a1','Alex','alex@acme.example','acme.example','ok',?,?)"
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO targets (id,contact_id,account_id,company_name,website_url,source_type,dedupe_key,status,stage,do_not_resend,created_at,updated_at) VALUES ('t1','c1','a1','Acme','https://acme.example','manual','email:alex@acme.example','waiting','contacted',0,?,?)"
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,last_outbound_at,created_at,updated_at) VALUES ('th1','t1','c1','INBOX','Migration question','migration question','waiting',?,?,?)"
    )
    .run(yesterday, yesterday, yesterday);
  sqlite
    .prepare(
      "INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,received_at,created_at) VALUES ('m1','th1','inbound','alex@acme.example','owner@example.com','Re: Migration question','Can we talk Tuesday?','<m1@acme.example>',?,?)"
    )
    .run(now, now);

  await t.test("reply triage moves the stage and saves a reply draft", async () => {
    const result = await triageReplyMessage("m1", aiFetch);
    assert.equal(result?.output.intent, "interested");
    assert.equal(result?.stageApplied, true);
    assert.equal(result?.followupCreated, false);
    assert.equal(
      sqlite.prepare("SELECT stage FROM targets WHERE id = 't1'").pluck().get(),
      "replied"
    );
    assert.match(
      String(sqlite.prepare("SELECT body FROM email_drafts WHERE target_id = 't1'").pluck().get()),
      /Tuesday works/
    );
    assert.equal(
      sqlite.prepare("SELECT ai_intent FROM threads WHERE id = 'th1'").pluck().get(),
      "interested"
    );
    assert.equal(
      (sqlite
        .prepare("SELECT COUNT(*) as n FROM ai_runs WHERE kind = 'reply_triage'")
        .get() as { n: number }).n,
      1
    );
    assert.equal(getAiRun(result!.run.id)?.entityId, "m1");
    assert.equal(getLatestTargetAiReview("t1")?.output.intent, "interested");
  });

  await t.test("successful AI results are reused without another provider request", async () => {
    const args = {
      kind: "followup_draft" as const,
      entityType: "followup",
      entityId: "cached-followup",
      input: { test: "cache" },
      schema: followupDraftSchema,
      system: "Return JSON.",
      user: "TASK: followup_draft"
    };
    const first = await runAiJson({ ...args, request: aiFetch });
    const cached = await runAiJson({
      ...args,
      request: async () => { throw new Error("Cached result must not call the provider"); }
    });
    assert.equal(cached.run.id, first.run.id);
    assert.equal(cached.run.attempts, 1);
    assert.deepEqual(cached.output, first.output);
  });

  await t.test("a due follow-up gets a thread-aware draft without sending", async () => {
    sqlite
      .prepare(
        "INSERT INTO targets (id,contact_id,account_id,company_name,source_type,dedupe_key,status,stage,do_not_resend,created_at,updated_at) VALUES ('t2','c1','a1','Acme follow-up','manual','email:alex@acme.example:followup','waiting','contacted',0,?,?)"
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,last_outbound_at,created_at,updated_at) VALUES ('th2','t2','c1','Sent','Migration question','migration question','waiting',?,?,?)"
      )
      .run(yesterday, yesterday, yesterday);
    sqlite
      .prepare(
        "INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,sent_at,created_at) VALUES ('m2','th2','outbound','owner@example.com','alex@acme.example','Migration question','I can help with the migration.','<m2@example.com>',?,?)"
      )
      .run(yesterday, yesterday);
    sqlite
      .prepare(
        "INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES ('f1','th2','t2',?,'open',?)"
      )
      .run(yesterday, now);

    const results = await draftDueFollowups(aiFetch);
    assert.ok(results.some((result) => result.followupId === "f1" && result.drafted));
    assert.equal(results.find((result) => result.followupId === "f1")?.sent, false);
    assert.match(
      String(
        sqlite
          .prepare("SELECT suggested_body FROM followup_tasks WHERE id = 'f1'")
          .pluck()
          .get()
      ),
      /cutover checklist/
    );
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) as n FROM outbound_sends").get() as { n: number }).n,
      0
    );
    const review = getPendingAiReviews().find((item) => item.run.entityId === "f1");
    assert.equal(review?.kind, "followup_draft");
    assert.equal(review?.run.targetId, "t2");
  });

  await t.test("an unlinked business email becomes a target", async () => {
    sqlite
      .prepare(
        "INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('e1','mailbox','INBOX','mail_seen_unlinked',?,?)"
      )
      .run(
        JSON.stringify({
          messageId: "<lead@cobalt.example>",
          subject: "WordPress migration",
          from: "Dana <dana@cobalt.example>",
          to: "owner@example.com",
          bodyText: "We need help migrating a WordPress site next month."
        }),
        now
      );

    const results = await processUnlinkedMail(aiFetch);
    assert.equal(results[0]?.captured, true);
    const target = sqlite
      .prepare(
        "SELECT company_name as companyName, source_type as sourceType, stage FROM targets WHERE id = ?"
      )
      .get(results[0]?.targetId) as
      | { companyName: string; sourceType: string; stage: string }
      | undefined;
    assert.equal(target?.companyName, "Cobalt Works");
    assert.equal(target?.sourceType, "inbound_email");
    assert.equal(target?.stage, "replied");
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) as n FROM contacts").get() as { n: number }).n,
      2
    );
  });

  await t.test("a medium-confidence lead waits in AI review", async () => {
    sqlite
      .prepare(
        "INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('e2','mailbox','INBOX','mail_seen_unlinked',?,?)"
      )
      .run(
        JSON.stringify({
          messageId: "<low@example.test>",
          subject: "Question",
          from: "Low Lead <low@example.test>",
          to: "owner@example.com",
          bodyText: "LOW_CONFIDENCE_LEAD: Could this be relevant sometime?"
        }),
        now
      );

    const results = await processUnlinkedMail(aiFetch);
    const result = results.find((item) => item.eventId === "e2");
    assert.equal(result?.captured, false);
    assert.equal(result?.kind, "lead");
    assert.equal(
      sqlite
        .prepare(
          "SELECT review_status FROM ai_runs WHERE kind = 'unlinked_lead' AND entity_id = 'e2'"
        )
        .pluck()
        .get(),
      "pending"
    );
    assert.equal(
      sqlite
        .prepare("SELECT 1 FROM contacts WHERE email = 'low@example.test'")
        .pluck()
        .get(),
      undefined
    );
    const review = getPendingAiReviews().find((item) => item.run.entityId === "e2");
    assert.equal(review?.kind, "unlinked_lead");
    // The mock lead points at an existing contact; accepting must still resolve
    // the pending review instead of silently doing nothing.
    assert.ok(review);
    await assert.rejects(
      acceptAiSuggestionAction(form({ runId: review.run.id })),
      /static generation store missing in revalidatePath/
    );
    assert.equal(getAiRun(review.run.id)?.reviewStatus, "applied");
  });

  await t.test("auto-send uses the existing SMTP path and daily guard", async () => {
    const smtp = await smtpServer();
    try {
      connections.saveConnection(
        "smtp",
        form({
          SMTP_ENABLED: "true",
          SMTP_HOST: "127.0.0.1",
          SMTP_PORT: String(smtp.port),
          SMTP_SECURITY: "plain",
          SMTP_TLS_VERIFY: "true",
          SMTP_FROM: "owner@example.com",
          SMTP_USER: "",
          SMTP_PASS: ""
        })
      );
      connections.saveConnection(
        "ai",
        form({
          AI_ENABLED: "true",
          AI_BASE_URL: "http://127.0.0.1:9999/v1",
          AI_MODEL: "test-model",
          AI_AUTO_SEND: "true",
          AI_DAILY_SEND_LIMIT: "5"
        })
      );

      sqlite
        .prepare(
          "INSERT INTO targets (id,contact_id,account_id,company_name,source_type,dedupe_key,status,stage,do_not_resend,created_at,updated_at) VALUES ('t3','c1','a1','Acme auto','manual','email:alex@acme.example:auto','waiting','contacted',0,?,?)"
        )
        .run(now, now);
      sqlite
        .prepare(
          "INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,last_outbound_at,created_at,updated_at) VALUES ('th3','t3','c1','Sent','Migration question','migration question','waiting',?,?,?)"
        )
        .run(yesterday, yesterday, yesterday);
      sqlite
        .prepare(
          "INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,sent_at,created_at) VALUES ('m3','th3','outbound','owner@example.com','alex@acme.example','Migration question','I can help with the migration.','<m3@example.com>',?,?)"
        )
        .run(yesterday, yesterday);
      sqlite
        .prepare(
          "INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES ('f2','th3','t3',?,'open',?)"
        )
        .run(yesterday, now);

      const results = await draftDueFollowups(aiFetch);
      const sent = results.find((result) => result.followupId === "f2");
      assert.equal(sent?.sent, true);
      assert.equal(
        sqlite.prepare("SELECT status FROM followup_tasks WHERE id = 'f2'").pluck().get(),
        "completed"
      );
      assert.equal(
        sqlite
          .prepare("SELECT status FROM outbound_sends WHERE send_key = 'ai-followup:f2'")
          .pluck()
          .get(),
        "sent"
      );
      assert.equal(
        sqlite
          .prepare(
            "SELECT COUNT(*) FROM followup_tasks WHERE target_id = 't3' AND status = 'open'"
          )
          .pluck()
          .get(),
        1
      );

      sqlite
        .prepare(
          "INSERT INTO targets (id,contact_id,account_id,company_name,source_type,dedupe_key,status,stage,do_not_resend,created_at,updated_at) VALUES ('t4','c1','a1','Acme auto reply','manual','email:alex@acme.example:auto-reply','waiting','contacted',0,?,?)"
        )
        .run(now, now);
      sqlite
        .prepare(
          "INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,last_outbound_at,created_at,updated_at) VALUES ('th4','t4','c1','Sent','Migration question','migration question','waiting',?,?,?)"
        )
        .run(yesterday, yesterday, yesterday);
      sqlite
        .prepare(
          "INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,sent_at,created_at) VALUES ('m4','th4','outbound','owner@example.com','alex@acme.example','Migration question','I can help with the migration.','<m4@example.com>',?,?)"
        )
        .run(yesterday, yesterday);
      sqlite
        .prepare(
          "INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES ('f4','th4','t4',?,'open',?)"
        )
        .run(yesterday, now);
      sqlite
        .prepare(
          "INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('e-auto','target','t4','mail_notification_received',?,?)"
        )
        .run(JSON.stringify({ reason: "auto_reply" }), now);

      sqlite
        .prepare(
          "INSERT INTO targets (id,contact_id,account_id,company_name,source_type,dedupe_key,status,stage,do_not_resend,created_at,updated_at) VALUES ('t5','c1','a1','Acme no outbound','manual','email:alex@acme.example:no-outbound','waiting','contacted',0,?,?)"
        )
        .run(now, now);
      sqlite
        .prepare(
          "INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,created_at,updated_at) VALUES ('th5','t5','c1','INBOX','Quick question','quick question','waiting',?,?)"
        )
        .run(yesterday, yesterday);
      sqlite
        .prepare(
          "INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES ('f5','th5','t5',?,'open',?)"
        )
        .run(yesterday, now);

      const guarded = await draftDueFollowups(aiFetch);
      assert.equal(
        guarded.find((result) => result.followupId === "f4")?.sent,
        false
      );
      assert.equal(
        guarded.find((result) => result.followupId === "f5")?.sent,
        false
      );
      assert.equal(
        sqlite
          .prepare(
            "SELECT COUNT(*) FROM outbound_sends WHERE send_key IN ('ai-followup:f4','ai-followup:f5')"
          )
          .pluck()
          .get(),
        0
      );

      for (const change of ["reply", "cancel", "reschedule", "won", "subject"] as const) {
        const targetId = `t-race-${change}`;
        const threadId = `th-race-${change}`;
        const followupId = `f-race-${change}`;
        sqlite.prepare("INSERT INTO targets (id,contact_id,company_name,source_type,dedupe_key,status,stage,created_at,updated_at) VALUES (?,'c1','Changed conversation','manual',?,'waiting','contacted',?,?)")
          .run(targetId, targetId, now, now);
        sqlite.prepare("INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,last_outbound_at,created_at,updated_at) VALUES (?,?,'c1','Sent','Question','question','waiting',?,?,?)")
          .run(threadId, targetId, yesterday, yesterday, yesterday);
        sqlite.prepare("INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,sent_at,created_at) VALUES (?,?,'outbound','owner@example.com','alex@acme.example','Question','Original message',?,?,?)")
          .run(`m-${change}`, threadId, `<race-${change}@example.com>`, yesterday, yesterday);
        sqlite.prepare("INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES (?,?,?,?,'open',?)")
          .run(followupId, threadId, targetId, yesterday, now);
        const results = await draftDueFollowups(async (url, init) => {
          if (change === "reply") sqlite.prepare("UPDATE threads SET last_inbound_at = ? WHERE id = ?").run(now, threadId);
          if (change === "cancel") sqlite.prepare("UPDATE followup_tasks SET status = 'cancelled' WHERE id = ?").run(followupId);
          if (change === "reschedule") sqlite.prepare("UPDATE followup_tasks SET due_at = ? WHERE id = ?").run(new Date(Date.now() + 86_400_000).toISOString(), followupId);
          if (change === "won") sqlite.prepare("UPDATE targets SET stage = 'won' WHERE id = ?").run(targetId);
          if (change === "subject") sqlite.prepare("INSERT INTO email_drafts (target_id,subject,body,from_email,updated_at) VALUES (?,'My edited subject',?,'owner@example.com',?)")
            .run(targetId, "I can send the cutover checklist and a short estimate. Which part is blocking the decision?", now);
          return aiFetch(url, init);
        });
        assert.equal(results.find((result) => result.followupId === followupId)?.sent, false, change);
        assert.equal(sqlite.prepare("SELECT COUNT(*) FROM outbound_sends WHERE send_key = ?").pluck().get(`ai-followup:${followupId}`), 0, change);
      }
    } finally {
      connections.saveConnection(
        "ai",
        form({
          AI_ENABLED: "true",
          AI_BASE_URL: "http://127.0.0.1:9999/v1",
          AI_MODEL: "test-model",
          AI_AUTO_SEND: "false",
          AI_DAILY_SEND_LIMIT: "5"
        })
      );
      await smtp.close();
    }
  });

  await t.test("the worker retries interrupted AI runs and reports provider failures", async () => {
    const { runAiAutomation } = await import("../src/modules/ai/worker");
    sqlite.prepare("UPDATE ai_runs SET status = 'running' WHERE kind = 'unlinked_lead' AND entity_id = 'e2'").run();
    await runAiAutomation(aiFetch);
    assert.equal(sqlite.prepare("SELECT status FROM ai_runs WHERE kind = 'unlinked_lead' AND entity_id = 'e2'").pluck().get(), "success");

    sqlite.prepare("UPDATE ai_runs SET status = 'failed' WHERE kind = 'unlinked_lead' AND entity_id = 'e2'").run();
    const result = spawnSync(process.execPath, ["--import", "tsx", "workers/ai.ts"], {
      env: { ...process.env, AI_BASE_URL: "http://127.0.0.1:1/v1" },
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /errors=[1-9]/);
  });
});
