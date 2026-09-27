import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold">That page does not exist</h1>
      <p className="mt-3 text-sm text-muted">
        The link may be out of date, or the target you opened may have been
        removed.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-white"
          href="/dashboard"
        >
          Go to dashboard
        </Link>
        <Link
          className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-panel"
          href="/targets"
        >
          Browse targets
        </Link>
      </div>
    </main>
  );
}
