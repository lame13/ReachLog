import type BetterSqlite3 from "better-sqlite3";

type SqliteDatabase = BetterSqlite3.Database;

const schemaSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique ON contacts(email);
CREATE INDEX IF NOT EXISTS contacts_domain_idx ON contacts(domain);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id),
  company_name TEXT NOT NULL,
  website_url TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  do_not_resend INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS targets_dedupe_key_unique ON targets(dedupe_key);
CREATE INDEX IF NOT EXISTS targets_contact_idx ON targets(contact_id);
CREATE INDEX IF NOT EXISTS targets_status_idx ON targets(status);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  contact_id TEXT REFERENCES contacts(id),
  mailbox TEXT NOT NULL,
  subject TEXT NOT NULL,
  normalized_subject TEXT NOT NULL,
  first_message_id TEXT,
  last_message_id TEXT,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  next_followup_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_target_idx ON threads(target_id);
CREATE INDEX IF NOT EXISTS threads_normalized_subject_idx ON threads(normalized_subject);
CREATE INDEX IF NOT EXISTS threads_next_followup_idx ON threads(next_followup_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  direction TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  references_header TEXT,
  sent_at TEXT,
  received_at TEXT,
  raw_headers_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_message_id_unique ON messages(message_id);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_id);
CREATE INDEX IF NOT EXISTS messages_direction_idx ON messages(direction);

CREATE TABLE IF NOT EXISTS followup_tasks (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,
  suggested_subject TEXT,
  suggested_body TEXT,
  notification_sent_at TEXT,
  notification_channel TEXT,
  notification_status TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS followup_tasks_due_idx ON followup_tasks(due_at);
CREATE INDEX IF NOT EXISTS followup_tasks_status_idx ON followup_tasks(status);
CREATE INDEX IF NOT EXISTS followup_tasks_target_idx ON followup_tasks(target_id);

CREATE TABLE IF NOT EXISTS contact_form_submissions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  website_url TEXT NOT NULL,
  form_url TEXT NOT NULL,
  subject TEXT,
  message_text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_form_dedupe_key_unique ON contact_form_submissions(dedupe_key);
CREATE INDEX IF NOT EXISTS contact_form_target_idx ON contact_form_submissions(target_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS events_event_type_idx ON events(event_type);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,
  run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_run_idx ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS outbound_sends (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  thread_id TEXT REFERENCES threads(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outbound_sends_message_id_unique ON outbound_sends(message_id);
CREATE INDEX IF NOT EXISTS outbound_sends_status_idx ON outbound_sends(status);
CREATE INDEX IF NOT EXISTS outbound_sends_target_idx ON outbound_sends(target_id);

CREATE TABLE IF NOT EXISTS worker_locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_cursors (
  mailbox TEXT PRIMARY KEY,
  uid_validity INTEGER,
  last_uid INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_settings (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT,
  updated_at TEXT NOT NULL
);
`;

export function bootstrapDatabase(sqlite: SqliteDatabase) {
  sqlite.exec(schemaSql);
  recordSchemaVersion(sqlite, "0001", "bootstrap_schema");
  recordSchemaVersion(sqlite, "0002", "prod_safety_tables");

  const seeded = sqlite
    .prepare("SELECT COUNT(*) as count FROM contacts")
    .get() as { count: number };

  if (seeded.count > 0) {
    ensureModuleSettings(sqlite);
    return;
  }

  seedDatabase(sqlite);
}

function recordSchemaVersion(sqlite: SqliteDatabase, version: string, name: string) {
  sqlite
    .prepare(
      `
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
      ON CONFLICT(version) DO NOTHING
    `
    )
    .run(version, name, new Date().toISOString());
}

function seedDatabase(sqlite: SqliteDatabase) {
  const now = new Date();
  const iso = (daysOffset: number, hour = 9) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysOffset);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const insertContact = sqlite.prepare(`
    INSERT INTO contacts (id, name, email, domain, created_at, updated_at)
    VALUES (@id, @name, @email, @domain, @createdAt, @updatedAt)
  `);
  const insertTarget = sqlite.prepare(`
    INSERT INTO targets (
      id, contact_id, company_name, website_url, source_type, source_url,
      dedupe_key, status, do_not_resend, created_at, updated_at
    )
    VALUES (
      @id, @contactId, @companyName, @websiteUrl, @sourceType, @sourceUrl,
      @dedupeKey, @status, @doNotResend, @createdAt, @updatedAt
    )
  `);
  const insertThread = sqlite.prepare(`
    INSERT INTO threads (
      id, target_id, contact_id, mailbox, subject, normalized_subject,
      first_message_id, last_message_id, last_inbound_at, last_outbound_at,
      next_followup_at, status, created_at, updated_at
    )
    VALUES (
      @id, @targetId, @contactId, @mailbox, @subject, @normalizedSubject,
      @firstMessageId, @lastMessageId, @lastInboundAt, @lastOutboundAt,
      @nextFollowupAt, @status, @createdAt, @updatedAt
    )
  `);
  const insertMessage = sqlite.prepare(`
    INSERT INTO messages (
      id, thread_id, direction, from_email, to_email, cc, bcc, subject,
      body_text, body_html, message_id, in_reply_to, references_header,
      sent_at, received_at, raw_headers_json, created_at
    )
    VALUES (
      @id, @threadId, @direction, @fromEmail, @toEmail, @cc, @bcc, @subject,
      @bodyText, @bodyHtml, @messageId, @inReplyTo, @referencesHeader,
      @sentAt, @receivedAt, @rawHeadersJson, @createdAt
    )
  `);
  const insertFollowup = sqlite.prepare(`
    INSERT INTO followup_tasks (
      id, thread_id, target_id, due_at, status, suggested_subject,
      suggested_body, notification_sent_at, notification_channel,
      notification_status, completed_at, created_at
    )
    VALUES (
      @id, @threadId, @targetId, @dueAt, @status, @suggestedSubject,
      @suggestedBody, @notificationSentAt, @notificationChannel,
      @notificationStatus, @completedAt, @createdAt
    )
  `);
  const insertForm = sqlite.prepare(`
    INSERT INTO contact_form_submissions (
      id, target_id, website_url, form_url, subject, message_text,
      submitted_at, dedupe_key, notes, created_at
    )
    VALUES (
      @id, @targetId, @websiteUrl, @formUrl, @subject, @messageText,
      @submittedAt, @dedupeKey, @notes, @createdAt
    )
  `);
  const insertEvent = sqlite.prepare(`
    INSERT INTO events (
      id, entity_type, entity_id, event_type, payload_json, created_at
    )
    VALUES (@id, @entityType, @entityId, @eventType, @payloadJson, @createdAt)
  `);

  const transaction = sqlite.transaction(() => {
    [
      {
        id: "contact-acme",
        name: "Niko",
        email: "niko@acmehost.dev",
        domain: "acmehost.dev"
      },
      {
        id: "contact-blue",
        name: "Blue Apps",
        email: "hello@blueapps.io",
        domain: "blueapps.io"
      },
      {
        id: "contact-wptools",
        name: "WP Tools Ops",
        email: "ops@wptools.io",
        domain: "wptools.io"
      }
    ].forEach((contact) =>
      insertContact.run({
        ...contact,
        createdAt: iso(-7),
        updatedAt: iso(-1)
      })
    );

    [
      {
        id: "target-acme",
        contactId: "contact-acme",
        companyName: "Acme Hosting",
        websiteUrl: "https://acmehost.dev",
        sourceType: "hn",
        sourceUrl: "https://news.ycombinator.com/item?id=401",
        dedupeKey: "email:niko@acmehost.dev",
        status: "replied",
        doNotResend: 0
      },
      {
        id: "target-blue",
        contactId: "contact-blue",
        companyName: "Blue Apps",
        websiteUrl: "https://blueapps.io",
        sourceType: "contact_form",
        sourceUrl: "https://blueapps.io/contact",
        dedupeKey: "domain:blueapps.io",
        status: "sent",
        doNotResend: 0
      },
      {
        id: "target-wptools",
        contactId: "contact-wptools",
        companyName: "WP Tools Ltd",
        websiteUrl: "https://wptools.io",
        sourceType: "wporg",
        sourceUrl: "https://wordpress.org/support/topic/example",
        dedupeKey: "wporg:https://wordpress.org/support/topic/example",
        status: "follow-up due",
        doNotResend: 0
      },
      {
        id: "target-devdesk",
        contactId: null,
        companyName: "DevDesk",
        websiteUrl: "https://devdesk.example",
        sourceType: "contact_form",
        sourceUrl: "https://devdesk.example/contact",
        dedupeKey: "form:devdesk.example/contact",
        status: "follow-up due",
        doNotResend: 0
      }
    ].forEach((target) =>
      insertTarget.run({
        ...target,
        createdAt: iso(-8),
        updatedAt: iso(-1)
      })
    );

    [
      {
        id: "thread-acme",
        targetId: "target-acme",
        contactId: "contact-acme",
        mailbox: "main",
        subject: "Quick question about Acme Hosting",
        normalizedSubject: "quick question about acme hosting",
        firstMessageId: "<reachlog-acme-1@example.local>",
        lastMessageId: "<acme-reply-1@acmehost.dev>",
        lastInboundAt: iso(0, 7),
        lastOutboundAt: iso(-2, 13),
        nextFollowupAt: null,
        status: "replied"
      },
      {
        id: "thread-blue",
        targetId: "target-blue",
        contactId: "contact-blue",
        mailbox: "main",
        subject: "Quick question about Blue Apps",
        normalizedSubject: "quick question about blue apps",
        firstMessageId: "<reachlog-blue-1@example.local>",
        lastMessageId: "<reachlog-blue-1@example.local>",
        lastInboundAt: null,
        lastOutboundAt: iso(-5, 10),
        nextFollowupAt: iso(0, 14),
        status: "waiting"
      },
      {
        id: "thread-wptools",
        targetId: "target-wptools",
        contactId: "contact-wptools",
        mailbox: "main",
        subject: "Following up on WP Tools",
        normalizedSubject: "following up on wp tools",
        firstMessageId: "<reachlog-wptools-1@example.local>",
        lastMessageId: "<reachlog-wptools-1@example.local>",
        lastInboundAt: null,
        lastOutboundAt: iso(-6, 11),
        nextFollowupAt: iso(1, 10),
        status: "waiting"
      }
    ].forEach((thread) =>
      insertThread.run({
        ...thread,
        createdAt: iso(-8),
        updatedAt: iso(0, 7)
      })
    );

    [
      {
        id: "message-acme-out",
        threadId: "thread-acme",
        direction: "outbound",
        fromEmail: "me@example.com",
        toEmail: "niko@acmehost.dev",
        subject: "Quick question about Acme Hosting",
        bodyText: "Hey Niko, quick question about Acme Hosting.",
        messageId: "<reachlog-acme-1@example.local>",
        inReplyTo: null,
        referencesHeader: null,
        sentAt: iso(-2, 13),
        receivedAt: null
      },
      {
        id: "message-acme-in",
        threadId: "thread-acme",
        direction: "inbound",
        fromEmail: "niko@acmehost.dev",
        toEmail: "me@example.com",
        subject: "Re: Quick question about Acme Hosting",
        bodyText: "Sure, send details.",
        messageId: "<acme-reply-1@acmehost.dev>",
        inReplyTo: "<reachlog-acme-1@example.local>",
        referencesHeader: "<reachlog-acme-1@example.local>",
        sentAt: null,
        receivedAt: iso(0, 7)
      },
      {
        id: "message-blue-out",
        threadId: "thread-blue",
        direction: "outbound",
        fromEmail: "me@example.com",
        toEmail: "hello@blueapps.io",
        subject: "Quick question about Blue Apps",
        bodyText: "Hi, I noticed Blue Apps and wanted to ask a quick question.",
        messageId: "<reachlog-blue-1@example.local>",
        inReplyTo: null,
        referencesHeader: null,
        sentAt: iso(-5, 10),
        receivedAt: null
      },
      {
        id: "message-wptools-out",
        threadId: "thread-wptools",
        direction: "outbound",
        fromEmail: "me@example.com",
        toEmail: "ops@wptools.io",
        subject: "Following up on WP Tools",
        bodyText: "Hi, following up on the WP Tools thread.",
        messageId: "<reachlog-wptools-1@example.local>",
        inReplyTo: null,
        referencesHeader: null,
        sentAt: iso(-6, 11),
        receivedAt: null
      }
    ].forEach((message) =>
      insertMessage.run({
        ...message,
        cc: null,
        bcc: null,
        bodyHtml: null,
        rawHeadersJson: "{}",
        createdAt: message.sentAt ?? message.receivedAt
      })
    );

    [
      {
        id: "followup-blue",
        threadId: "thread-blue",
        targetId: "target-blue",
        dueAt: iso(0, 14),
        status: "open",
        suggestedSubject: "Re: Quick question about Blue Apps",
        suggestedBody: "Hi, just wanted to follow up on this.",
        notificationSentAt: null,
        notificationChannel: null,
        notificationStatus: null,
        completedAt: null
      },
      {
        id: "followup-devdesk",
        threadId: null,
        targetId: "target-devdesk",
        dueAt: iso(-2, 9),
        status: "open",
        suggestedSubject: "Following up",
        suggestedBody: "Hi, following up on the note I sent through your form.",
        notificationSentAt: iso(-1, 9),
        notificationChannel: "telegram",
        notificationStatus: "sent",
        completedAt: null
      },
      {
        id: "followup-acme",
        threadId: "thread-acme",
        targetId: "target-acme",
        dueAt: iso(-1, 9),
        status: "cancelled",
        suggestedSubject: "Re: Quick question about Acme Hosting",
        suggestedBody: "Checking in.",
        notificationSentAt: null,
        notificationChannel: null,
        notificationStatus: null,
        completedAt: iso(0, 7)
      }
    ].forEach((followup) =>
      insertFollowup.run({
        ...followup,
        createdAt: iso(-6)
      })
    );

    insertForm.run({
      id: "form-blue",
      targetId: "target-blue",
      websiteUrl: "https://blueapps.io",
      formUrl: "https://blueapps.io/contact",
      subject: "Quick question about Blue Apps",
      messageText: "Hi, I noticed Blue Apps and wanted to ask a quick question.",
      submittedAt: iso(-5, 9),
      dedupeKey: "form:blueapps.io/contact",
      notes: "Submitted before direct email.",
      createdAt: iso(-5, 9)
    });

    insertForm.run({
      id: "form-devdesk",
      targetId: "target-devdesk",
      websiteUrl: "https://devdesk.example",
      formUrl: "https://devdesk.example/contact",
      subject: "Quick question",
      messageText: "Hi, I sent a short note through the website form.",
      submittedAt: iso(-4, 15),
      dedupeKey: "form:devdesk.example/contact",
      notes: "No public email found.",
      createdAt: iso(-4, 15)
    });

    [
      ["target-acme", "target_created", iso(-8)],
      ["target-acme", "email_sent", iso(-2, 13)],
      ["target-acme", "reply_received", iso(0, 7)],
      ["target-blue", "target_created", iso(-8)],
      ["target-blue", "form_submitted", iso(-5, 9)],
      ["target-blue", "email_sent", iso(-5, 10)],
      ["target-blue", "followup_due", iso(0, 14)],
      ["target-wptools", "target_created", iso(-8)],
      ["target-wptools", "email_sent", iso(-6, 11)],
      ["target-devdesk", "target_created", iso(-4, 15)],
      ["target-devdesk", "form_submitted", iso(-4, 15)],
      ["target-devdesk", "followup_due", iso(-2, 9)]
    ].forEach(([entityId, eventType, createdAt], index) =>
      insertEvent.run({
        id: `event-${index + 1}`,
        entityType: "target",
        entityId,
        eventType,
        payloadJson: "{}",
        createdAt
      })
    );

    ensureModuleSettings(sqlite);
  });

  transaction();
}

function ensureModuleSettings(sqlite: SqliteDatabase) {
  const insertSetting = sqlite.prepare(`
    INSERT INTO module_settings (key, enabled, settings_json, updated_at)
    VALUES (@key, @enabled, @settingsJson, @updatedAt)
    ON CONFLICT(key) DO NOTHING
  `);

  const updatedAt = new Date().toISOString();

  [
    ["smtp", 0],
    ["imap", 0],
    ["telegram", 0],
    ["contactForms", 1],
    ["analytics", 1]
  ].forEach(([key, enabled]) =>
    insertSetting.run({
      key,
      enabled,
      settingsJson: "{}",
      updatedAt
    })
  );
}
