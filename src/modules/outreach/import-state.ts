export type ImportPreviewResult =
  | "new target"
  | "duplicate target"
  | "duplicate contact"
  | "duplicate domain warning"
  | "duplicate in file"
  | "invalid";

export type ImportPreviewRow = {
  rowNumber: number;
  companyName: string;
  name: string;
  email: string;
  domain: string;
  websiteUrl: string;
  sourceType: string;
  sourceUrl: string;
  formUrl: string;
  subject: string;
  messageText: string;
  notes: string;
  dedupeKey: string;
  status: string;
  nextAction: string;
  followUpDate: string;
  sourceTimestamp: string;
  doNotResend: boolean;
  dedupeOnlyDoNotResend: boolean;
  result: ImportPreviewResult;
  reason: string;
};

export type ImportActionState = {
  csvText: string;
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    importable: number;
    skipped: number;
    warnings: number;
    inserted: number;
  };
  message: string | null;
  error: string | null;
};

export const initialImportState: ImportActionState = {
  csvText: "",
  rows: [],
  summary: {
    total: 0,
    importable: 0,
    skipped: 0,
    warnings: 0,
    inserted: 0
  },
  message: null,
  error: null
};
