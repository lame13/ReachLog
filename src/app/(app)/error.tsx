"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

const ISSUES_URL = "https://github.com/lame13/ReachLog/issues/new";

export default function AppError({
  error
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error("ReachLog page error:", error);
  }, [error]);

  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-amber-800">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-ink">
          This page could not finish loading
        </h1>
      </div>
      <p className="mt-3 text-sm text-muted">
        Try loading the page again. If you were saving or sending something,
        check its status before repeating the action. If the page keeps failing,
        check the terminal for more details.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white"
          onClick={() => window.location.reload()}
          type="button"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </button>
        <Link
          className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-panel"
          href="/dashboard"
        >
          Back to dashboard
        </Link>
      </div>
      <details className="mt-5 text-sm text-muted">
        <summary className="cursor-pointer font-medium">
          Technical details
        </summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-panel p-3 font-mono text-xs leading-relaxed">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <p className="mt-3 text-xs">
          Include these details when you{" "}
          <a className="text-accent underline" href={ISSUES_URL}>
            open an issue
          </a>
          .
        </p>
      </details>
    </section>
  );
}
