import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { demoReadOnly } from "../src/proxy";

// Every visitor to a published demo reads the same seeded database, so a single
// write is visible to all of them; and a public demo must never be able to send
// mail. The guard is the thing that makes publishing one safe, so it is pinned
// per method rather than by one sample.
test("a running demo refuses every method that could change something", () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "true";
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const refused = demoReadOnly(new NextRequest("https://demo.example.com/targets", { method }));
      assert.equal(refused?.status, 403, `${method} was not refused`);
      assert.match(refused?.headers.get("cache-control") ?? "", /no-store/);
    }
    // A server action is a POST to the page it was rendered on, so the same
    // rule covers the buttons and the code behind them.
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      assert.equal(
        demoReadOnly(new NextRequest("https://demo.example.com/targets", { method })),
        null,
        `${method} was refused`
      );
    }
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});

test("an ordinary installation is untouched by the demo guard", () => {
  const previous = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  try {
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.equal(
        demoReadOnly(new NextRequest("https://reachlog.example.com/targets", { method })),
        null,
        `${method} was refused outside the demo`
      );
    }
  } finally {
    if (previous !== undefined) process.env.DEMO_MODE = previous;
  }
});
