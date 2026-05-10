import type { ImapFlowOptions } from "imapflow";
import { env } from "@/modules/core/env";

export type ImapSecurityMode = "plain" | "starttls" | "tls" | "auto";

export function getImapSecurityMode(): ImapSecurityMode {
  return env.IMAP_SECURITY ?? (env.IMAP_SECURE ? "tls" : "auto");
}

export function getImapFlowOptions(): ImapFlowOptions {
  const securityMode = getImapSecurityMode();

  return {
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: securityMode === "tls",
    doSTARTTLS:
      securityMode === "starttls"
        ? true
        : securityMode === "plain"
          ? false
          : undefined,
    tls: {
      rejectUnauthorized: env.IMAP_TLS_VERIFY
    },
    auth: {
      user: env.IMAP_USER ?? "",
      pass: env.IMAP_PASS ?? ""
    }
  };
}
