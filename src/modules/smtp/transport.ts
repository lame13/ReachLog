import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getRuntimeEnv } from "../core/env";

export function smtpTransportOptions(auth?: {
  user?: string;
  pass?: string;
}): SMTPTransport.Options {
  const config = getRuntimeEnv();
  const security =
    config.SMTP_SECURITY ?? (config.SMTP_SECURE ? "tls" : "auto");
  const user = auth?.user ?? config.SMTP_USER;
  const pass = auth?.pass ?? config.SMTP_PASS;
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: security === "tls",
    requireTLS: security === "starttls",
    ignoreTLS: security === "plain",
    tls: { rejectUnauthorized: config.SMTP_TLS_VERIFY },
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  };
}
