import { spawn, type ChildProcess } from "child_process";
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BASE_URL, TEST_PORT, serverEnv } from "./env";
import { resolveProjectDir } from "./project-dir";

/**
 * The routes under test are driven over real HTTP against a `next dev` server,
 * not by importing the handlers in-process.
 *
 * Why: `next dev` is what backend verified against by hand, it exercises the
 * real request pipeline (raw body for the webhook signature, `Set-Cookie`
 * parsing, `x-forwarded-for`), and — the load-bearing reason — it puts every
 * concurrent checkout on the same connection pool a deployed instance has, so
 * pool starvation and lock contention are real here rather than simulated.
 *
 * `next build && next start` was rejected on purpose: `NODE_ENV=production`
 * makes the order-session cookie `Secure` (dropped over plain http, HANDOFF
 * §28), arms the rate limiter's `fail-closed` mode, and disarms the Stripe
 * simulator. All three would make the suite test something other than the code.
 */

export const SERVER_LOG_PATH = join(tmpdir(), "lootlockers-qa-server.log");

let child: ChildProcess | null = null;

export function readServerLog(): string {
  return existsSync(SERVER_LOG_PATH) ? readFileSync(SERVER_LOG_PATH, "utf8") : "";
}

async function waitForReady(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 200) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  const log = readServerLog();
  if (log.includes("Another next dev server is already running")) {
    throw new Error(
      `The dev server could not start: another \`next dev\` already holds this ` +
        `project's lock (Next 16 allows one per project directory).\n\n` +
        `In this repo that is usually another agent's \`npm run dev\` on port 3000 ` +
        `(CLAUDE.md §1 — three agents, one checkout). Either stop it, or run this ` +
        `suite against an isolated mirror of the tree:\n\n` +
        `  QA_PROJECT_DIR=/tmp/lootlockers-qa-mirror npx vitest run\n\n` +
        `--- server log ---\n${log.slice(-2000)}`,
    );
  }
  throw new Error(
    `dev server never became ready on ${BASE_URL} (${lastErr})\n--- server log ---\n${log.slice(-4000)}`,
  );
}

/**
 * A run that is killed rather than finished (SIGPIPE from a `| head`, a
 * cancelled CI job, ^C) never reaches `stopServer`, and the detached `next dev`
 * survives holding port 3111. The next run then spawns a server that dies with
 * EADDRINUSE and waits out the full ready-timeout before saying anything
 * useful. Checking first turns three minutes of silence into one line.
 */
async function assertPortFree(): Promise<void> {
  try {
    const r = await fetch(`${BASE_URL}/api/products`, {
      signal: AbortSignal.timeout(2_000),
    });
    throw new Error(
      `Something is already listening on ${BASE_URL} (responded ${r.status}). ` +
        `A previous run's \`next dev\` was probably orphaned — a killed run never ` +
        `reaches stopServer. Kill it before re-running:\n` +
        `  pkill -f "next dev --port ${TEST_PORT}"`,
    );
  } catch (e) {
    // Anything that is NOT our own message means nothing answered, which is
    // what we want.
    if (e instanceof Error && e.message.startsWith("Something is already")) throw e;
  }
}

export async function startServer(): Promise<void> {
  await assertPortFree();
  writeFileSync(SERVER_LOG_PATH, "");

  // `detached` puts the server in its own process group. `npx` forks the real
  // `next` process, and SIGTERM to `npx` alone leaves that child running and
  // holding port 3111 — the next run then silently talks to a stale server with
  // stale environment variables.
  // "." unless QA_PROJECT_DIR is set. Next 16 admits one `next dev` per project
  // directory (`<distDir>/lock`), so another agent's `npm run dev` on port 3000
  // kills this suite before a single test runs, with "Another next dev server
  // is already running." — an error that has nothing to do with the code under
  // test. See tests/setup/project-dir.ts.
  const projectDir = resolveProjectDir();

  child = spawn("npx", ["next", "dev", projectDir, "--port", String(TEST_PORT)], {
    cwd: process.cwd(),
    env: serverEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const sink = (buf: Buffer) => {
    try {
      appendFileSync(SERVER_LOG_PATH, buf.toString());
    } catch {
      /* the log is diagnostics; never fail a run over it */
    }
  };
  child.stdout?.on("data", sink);
  child.stderr?.on("data", sink);

  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
      appendFileSync(SERVER_LOG_PATH, `\n[qa] dev server exited code=${code}\n`);
    }
  });

  await waitForReady();
}

export async function stopServer(): Promise<void> {
  if (!child) return;
  const proc = child;
  child = null;

  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, sig);
    } catch {
      /* already gone */
    }
  };

  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    killGroup("SIGTERM");
    const hard = setTimeout(() => {
      killGroup("SIGKILL");
      resolve();
    }, 8_000);
    hard.unref?.();
  });
}
