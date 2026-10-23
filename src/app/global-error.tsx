"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ minHeight: "100vh", margin: 0, display: "grid", placeItems: "center", background: "#070908", color: "#f5f7f5", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <main style={{ width: "min(32rem, calc(100% - 2rem))", padding: "2rem", border: "1px solid rgba(255,255,255,.1)", borderRadius: "1rem", background: "rgba(255,255,255,.03)" }}>
          <p style={{ margin: 0, color: "#41e6d1", fontSize: ".7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".16em" }}>Temporary interruption</p>
          <h1 style={{ margin: "1rem 0 0", fontSize: "2rem" }}>Something went wrong.</h1>
          <p style={{ margin: ".75rem 0 0", color: "#9da39f", lineHeight: 1.6 }}>Your lineup data remains stored. Try loading the page again.</p>
          {error.digest && <p style={{ margin: ".75rem 0 0", color: "#666", fontSize: ".75rem" }}>Reference: {error.digest}</p>}
          <button onClick={() => retry()} style={{ marginTop: "1.5rem", border: 0, borderRadius: ".75rem", padding: ".8rem 1rem", background: "#d2ff45", color: "#07100d", fontWeight: 800, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
