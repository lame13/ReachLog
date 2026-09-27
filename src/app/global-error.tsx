"use client";

export default function GlobalError({
  error
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "48px 24px",
          background: "#f3f4f6",
          color: "#121417",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        }}
      >
        <main style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>
            ReachLog could not start this page
          </h1>
          <p style={{ color: "#667085", fontSize: 14, lineHeight: 1.6 }}>
            Try loading the page again. If it keeps failing, restart ReachLog
            from the terminal and open the address it prints. Check the terminal
            for more details. If you were saving or sending something, check its
            status before repeating the action.
          </p>
          <pre
            style={{
              background: "#f7f8fa",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              overflowX: "auto",
              whiteSpace: "pre-wrap"
            }}
          >
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#121417",
              border: 0,
              borderRadius: 6,
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
              height: 40,
              padding: "0 16px"
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
