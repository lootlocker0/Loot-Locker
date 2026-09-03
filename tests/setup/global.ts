/**
 * Per-file setup.
 *
 * Intentionally almost empty. Schema prep and the dev server live in the
 * globalSetup (`tests/setup/global-setup.ts`) so they happen exactly once, and
 * the Prisma client in `tests/setup/db.ts` is deliberately NOT disconnected
 * here: `setupFiles` run once per test file inside the single fork, so an
 * `afterAll(() => testDb.$disconnect())` would tear down the shared connection
 * pool after the first file and leave every later file querying a closed pool.
 *
 * The one thing worth doing globally is making an unhandled rejection loud.
 * Several routes under test fire background work (`void sendConfirmationEmail`),
 * and a rejection swallowed by the runner is exactly the kind of silent failure
 * this suite exists to catch.
 */
const FLAG = "__llQaUnhandledRejectionHook";
const g = globalThis as unknown as Record<string, boolean>;

// Registered once for the whole process, not once per test file — `setupFiles`
// run per file inside the single shared fork, and twelve identical listeners
// trip Node's MaxListenersExceededWarning.
if (!g[FLAG]) {
  g[FLAG] = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[qa] unhandled rejection in test process:", reason);
  });
}

export {};
