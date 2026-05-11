import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    domain: text("domain").notNull(),
    emailVerificationProvider: text("email_verification_provider"),
    emailVerificationStatus: text("email_verification_status"),
    emailVerificationCheckedAt: text("email_verification_checked_at"),
    emailVerificationError: text("email_verification_error"),
    emailVerificationRaw: text("email_verification_raw"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    emailUnique: uniqueIndex("contacts_email_unique").on(table.email),
    domainIdx: index("contacts_domain_idx").on(table.domain)
  })
);

export const targets = sqliteTable(
  "targets",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").references(() => contacts.id),
    companyName: text("company_name").notNull(),
    websiteUrl: text("website_url"),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull(),
    doNotResend: integer("do_not_resend", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    dedupeKeyUnique: uniqueIndex("targets_dedupe_key_unique").on(
      table.dedupeKey
    ),
    contactIdx: index("targets_contact_idx").on(table.contactId),
    statusIdx: index("targets_status_idx").on(table.status)
  })
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    contactId: text("contact_id").references(() => contacts.id),
    mailbox: text("mailbox").notNull(),
    subject: text("subject").notNull(),
    normalizedSubject: text("normalized_subject").notNull(),
    firstMessageId: text("first_message_id"),
    lastMessageId: text("last_message_id"),
    lastInboundAt: text("last_inbound_at"),
    lastOutboundAt: text("last_outbound_at"),
    nextFollowupAt: text("next_followup_at"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    targetIdx: index("threads_target_idx").on(table.targetId),
    normalizedSubjectIdx: index("threads_normalized_subject_idx").on(
      table.normalizedSubject
    ),
    nextFollowupIdx: index("threads_next_followup_idx").on(table.nextFollowupAt)
  })
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    direction: text("direction").notNull(),
    fromEmail: text("from_email").notNull(),
    toEmail: text("to_email").notNull(),
    cc: text("cc"),
    bcc: text("bcc"),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    messageId: text("message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    sentAt: text("sent_at"),
    receivedAt: text("received_at"),
    readAt: text("read_at"),
    rawHeadersJson: text("raw_headers_json"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    messageIdUnique: uniqueIndex("messages_message_id_unique").on(
      table.messageId
    ),
    threadIdx: index("messages_thread_idx").on(table.threadId),
    directionIdx: index("messages_direction_idx").on(table.direction)
  })
);

export const followupTasks = sqliteTable(
  "followup_tasks",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").references(() => threads.id),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull(),
    suggestedSubject: text("suggested_subject"),
    suggestedBody: text("suggested_body"),
    notificationSentAt: text("notification_sent_at"),
    notificationChannel: text("notification_channel"),
    notificationStatus: text("notification_status"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    dueIdx: index("followup_tasks_due_idx").on(table.dueAt),
    statusIdx: index("followup_tasks_status_idx").on(table.status),
    targetIdx: index("followup_tasks_target_idx").on(table.targetId)
  })
);

export const contactFormSubmissions = sqliteTable(
  "contact_form_submissions",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    websiteUrl: text("website_url").notNull(),
    formUrl: text("form_url").notNull(),
    subject: text("subject"),
    messageText: text("message_text").notNull(),
    submittedAt: text("submitted_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    dedupeKeyUnique: uniqueIndex("contact_form_dedupe_key_unique").on(
      table.dedupeKey
    ),
    targetIdx: index("contact_form_target_idx").on(table.targetId)
  })
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    entityIdx: index("events_entity_idx").on(table.entityType, table.entityId),
    eventTypeIdx: index("events_event_type_idx").on(table.eventType)
  })
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: text("payload_json"),
    status: text("status").notNull(),
    runAt: text("run_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    statusRunIdx: index("jobs_status_run_idx").on(table.status, table.runAt)
  })
);

export const outboundSends = sqliteTable(
  "outbound_sends",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    threadId: text("thread_id").references(() => threads.id),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    messageId: text("message_id").notNull(),
    sendKey: text("send_key"),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    messageIdUnique: uniqueIndex("outbound_sends_message_id_unique").on(
      table.messageId
    ),
    sendKeyUnique: uniqueIndex("outbound_sends_send_key_unique").on(
      table.sendKey
    ),
    statusIdx: index("outbound_sends_status_idx").on(table.status),
    targetIdx: index("outbound_sends_target_idx").on(table.targetId)
  })
);

export const workerLocks = sqliteTable("worker_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  lockedAt: text("locked_at").notNull(),
  leaseUntil: text("lease_until").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const mailboxCursors = sqliteTable("mailbox_cursors", {
  mailbox: text("mailbox").primaryKey(),
  uidValidity: integer("uid_validity"),
  lastUid: integer("last_uid").notNull().default(0),
  updatedAt: text("updated_at").notNull()
});

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: text("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: text("applied_at").notNull()
});

export const moduleSettings = sqliteTable("module_settings", {
  key: text("key").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  settingsJson: text("settings_json"),
  updatedAt: text("updated_at").notNull()
});

export const contactsRelations = relations(contacts, ({ many }) => ({
  targets: many(targets),
  threads: many(threads)
}));

export const targetsRelations = relations(targets, ({ one, many }) => ({
  contact: one(contacts, {
    fields: [targets.contactId],
    references: [contacts.id]
  }),
  threads: many(threads),
  followups: many(followupTasks),
  contactForms: many(contactFormSubmissions)
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  target: one(targets, {
    fields: [threads.targetId],
    references: [targets.id]
  }),
  contact: one(contacts, {
    fields: [threads.contactId],
    references: [contacts.id]
  }),
  messages: many(messages),
  followups: many(followupTasks)
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id]
  })
}));

export const followupTasksRelations = relations(followupTasks, ({ one }) => ({
  thread: one(threads, {
    fields: [followupTasks.threadId],
    references: [threads.id]
  }),
  target: one(targets, {
    fields: [followupTasks.targetId],
    references: [targets.id]
  })
}));

export const contactFormSubmissionsRelations = relations(
  contactFormSubmissions,
  ({ one }) => ({
    target: one(targets, {
      fields: [contactFormSubmissions.targetId],
      references: [targets.id]
    })
  })
);
