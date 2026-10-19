import { z } from "zod";

export const triageIntents = [
  "interested",
  "question",
  "needs_information",
  "not_now",
  "not_interested",
  "wrong_person",
  "referral",
  "out_of_office",
  "vendor_pitch",
  "automated",
  "unclear"
] as const;

export const replyTriageSchema = z.object({
  intent: z.enum(triageIntents),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  evidence: z.array(z.string().min(1).max(500)).max(6).default([]),
  asks: z.array(z.string().min(1).max(240)).max(6).default([]),
  commitments: z
    .array(
      z.object({
        what: z.string().min(1).max(300),
        dueAt: z.string().max(40).nullable()
      })
    )
    .max(6)
    .default([]),
  objection: z.string().max(500).nullable(),
  suggestedStage: z
    .enum(["new", "contacted", "replied", "in_conversation", "qualified", "won", "lost"])
    .nullable(),
  stageConfidence: z.number().min(0).max(1),
  isOptOut: z.boolean(),
  nextAction: z.object({
    type: z.enum(["reply", "follow_up", "wait", "none"]),
    dueInDays: z.number().int().min(0).max(365).nullable(),
    reason: z.string().min(1).max(400)
  }),
  draft: z
    .object({
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(8000)
    })
    .nullable()
});

export type ReplyTriageOutput = z.infer<typeof replyTriageSchema>;

export const followupDraftSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(8000),
  rationale: z.string().max(400).default("")
});

export type FollowupDraftOutput = z.infer<typeof followupDraftSchema>;

export const unlinkedLeadKinds = [
  "lead",
  "referral",
  "vendor",
  "notification",
  "spam",
  "personal",
  "unclear"
] as const;

export const unlinkedLeadSchema = z.object({
  kind: z.enum(unlinkedLeadKinds),
  confidence: z.number().min(0).max(1),
  isHuman: z.boolean(),
  company: z.string().max(200).nullable(),
  personName: z.string().max(200).nullable(),
  email: z.string().max(320).nullable(),
  need: z.string().max(600).nullable(),
  budget: z.string().max(200).nullable(),
  timeline: z.string().max(200).nullable(),
  summary: z.string().min(1).max(600),
  draft: z
    .object({
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(8000)
    })
    .nullable()
});

export type UnlinkedLeadOutput = z.infer<typeof unlinkedLeadSchema>;
