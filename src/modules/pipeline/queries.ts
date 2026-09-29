import { getSqlite } from "@/modules/core/db/client";
import {
  getPipelineStage,
  pipelineStages,
  type PipelineStageKey
} from "@/modules/pipeline/stages";

export type PipelineCard = {
  id: string;
  companyName: string;
  status: string;
  stage: string;
  doNotResend: number;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  emailVerificationStatus: string | null;
  nextFollowupAt: string | null;
  activityAt: string;
};

export type PipelineColumn = {
  key: PipelineStageKey;
  label: string;
  description: string;
  kind: string;
  cards: PipelineCard[];
  count: number;
};

export type PipelineFilters = {
  q?: string;
  accountId?: string;
  contactId?: string;
};

export function getPipelineCards(filters: PipelineFilters = {}) {
  const rows = getSqlite()
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.status,
        targets.stage,
        targets.do_not_resend as doNotResend,
        targets.account_id as accountId,
        accounts.name as accountName,
        contacts.id as contactId,
        contacts.name as contactName,
        contacts.email as contactEmail,
        contacts.email_verification_status as emailVerificationStatus,
        (
          SELECT MIN(followup_tasks.due_at)
          FROM followup_tasks
          WHERE followup_tasks.target_id = targets.id
            AND followup_tasks.status = 'open'
        ) as nextFollowupAt,
        MAX(
          targets.updated_at,
          COALESCE((
            SELECT MAX(COALESCE(messages.sent_at, messages.received_at, messages.created_at))
            FROM messages
            INNER JOIN threads ON threads.id = messages.thread_id
            WHERE threads.target_id = targets.id
          ), ''),
          COALESCE((
            SELECT MAX(threads.updated_at)
            FROM threads
            WHERE threads.target_id = targets.id
          ), '')
        ) as activityAt
      FROM targets
      LEFT JOIN accounts ON accounts.id = targets.account_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      ORDER BY activityAt DESC, targets.company_name COLLATE NOCASE ASC
    `
    )
    .all() as PipelineCard[];

  const query = filters.q?.trim().toLowerCase();
  const accountId = filters.accountId?.trim();
  const contactId = filters.contactId?.trim();

  return rows.filter((card) => {
    if (accountId && card.accountId !== accountId) {
      return false;
    }

    if (contactId && card.contactId !== contactId) {
      return false;
    }

    if (
      query &&
      ![card.companyName, card.contactName, card.contactEmail, card.accountName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }

    return true;
  });
}

export function getPipelineBoard(filters: PipelineFilters = {}) {
  const cards = getPipelineCards(filters);

  return pipelineStages.map<PipelineColumn>((stage) => {
    const stageCards = cards.filter((card) => getPipelineStage(card.stage).key === stage.key);

    return {
      key: stage.key,
      label: stage.label,
      description: stage.description,
      kind: stage.kind,
      cards: stageCards,
      count: stageCards.length
    };
  });
}

export type PipelineSummary = {
  total: number;
  open: number;
  won: number;
  lost: number;
  byStage: Record<PipelineStageKey, number>;
  overdueFollowups: number;
  openFollowups: number;
  accounts: number;
  contacts: number;
};

export function getPipelineSummary(): PipelineSummary {
  const sqlite = getSqlite();
  const stageRows = sqlite
    .prepare("SELECT stage, COUNT(*) as count FROM targets GROUP BY stage")
    .all() as Array<{ stage: string; count: number }>;

  const byStage = Object.fromEntries(
    pipelineStages.map((stage) => [stage.key, 0])
  ) as Record<PipelineStageKey, number>;

  for (const row of stageRows) {
    // Anything unrecognised is shown as New by the board, so it is counted as
    // New here too rather than disappearing from the totals.
    byStage[getPipelineStage(row.stage).key] += row.count;
  }

  const total = stageRows.reduce((sum, row) => sum + row.count, 0);
  const counts = sqlite
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM accounts) as accounts,
        (SELECT COUNT(*) FROM contacts) as contacts,
        (SELECT COUNT(*) FROM followup_tasks WHERE status = 'open') as openFollowups,
        (
          SELECT COUNT(*) FROM followup_tasks
          WHERE status = 'open' AND due_at <= ?
        ) as overdueFollowups
    `
    )
    .get(new Date().toISOString()) as {
    accounts: number;
    contacts: number;
    openFollowups: number;
    overdueFollowups: number;
  };

  const won = byStage.won;
  const lost = byStage.lost;

  return {
    total,
    open: total - won - lost,
    won,
    lost,
    byStage,
    overdueFollowups: counts.overdueFollowups,
    openFollowups: counts.openFollowups,
    accounts: counts.accounts,
    contacts: counts.contacts
  };
}
