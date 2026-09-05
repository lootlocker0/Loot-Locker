import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { join, resolve } from "path";

/**
 * WHY THIS EXISTS.
 *
 * Next 16 takes an exclusive lock on `<distDir>/lock` when `next dev` starts,
 * and `distDir` for dev is `.next/dev`. One project directory therefore admits
 * exactly one dev server. That is fine in CI and on a solo machine, and it is
 * the default this harness uses.
 *
 * It is NOT fine in this repo's actual working model. CLAUDE.md §1 has three
 * agents sharing one checkout, and a frontend agent with `npm run dev` open on
 * port 3000 makes every QA suite that needs a server — this one and the vitest
 * harness both — die with:
 *
 *     ⨯ Another next dev server is already running.
 *
 * `QA_PROJECT_DIR=/some/path` (or `E2E_PROJECT_DIR`, kept as an alias) builds an
 * isolated mirror of the source tree there and runs the dev server from it, so
 * the two do not contend. Both harnesses read it: `playwright.config.ts` and
 * `tests/setup/server.ts`. The mirror
 * is a copy of the working tree, made fresh on every run — it is not a
 * snapshot that can go stale between runs — and `node_modules` is **hardlinked**
 * (`cp -al`), which is near-instant and costs no extra disk.
 *
 * A symlinked `node_modules` does NOT work here: Turbopack refuses it with
 * "Symlink [project]/node_modules is invalid, it points out of the filesystem
 * root". Hardlinks are what let the mirror run the same default bundler the
 * real server runs, rather than falling back to `--webpack` and testing a
 * different build pipeline than production uses.
 *
 * Unset (the default, and what CI does), everything runs in place.
 */

/** Everything the app needs at runtime. Deliberately not `tests/`. */
const SOURCE_DIRS = ["app", "components", "lib", "stores", "prisma", "public"];
const SOURCE_FILES = [
  "next.config.ts",
  "tsconfig.json",
  "package.json",
  "postcss.config.mjs",
  "prisma.config.ts",
  "next-env.d.ts",
];

/**
 * Playwright evaluates `playwright.config.ts` in the runner AND again in every
 * worker process; vitest re-imports setup modules per file. Re-copying the tree
 * from a worker rewrites `next.config.ts` mid-run, the dev server sees "Found a
 * change in next.config.ts", restarts, and whichever test is navigating at that
 * moment fails with `ERR_CONNECTION_REFUSED` — a flake with no relationship to
 * the product.
 *
 * Workers inherit the runner's `process.env`, so a marker set here is visible
 * there. `preserveTimestamps` is the second line of defence: even if the copy
 * does run twice, an identical mtime is not a change.
 */
const SYNC_MARKER = "__QA_MIRROR_SYNCED";

export function resolveProjectDir(): string {
  const target = process.env.QA_PROJECT_DIR ?? process.env.E2E_PROJECT_DIR;
  if (!target) return ".";

  const root = process.cwd();
  const dir = resolve(target);
  if (dir === root) return ".";

  if (process.env[SYNC_MARKER] === dir) return dir;

  mkdirSync(dir, { recursive: true });

  for (const d of SOURCE_DIRS) {
    const from = join(root, d);
    if (!existsSync(from)) continue;
    rmSync(join(dir, d), { recursive: true, force: true });
    cpSync(from, join(dir, d), { recursive: true, preserveTimestamps: true });
  }
  for (const f of SOURCE_FILES) {
    const from = join(root, f);
    if (!existsSync(from)) continue;
    cpSync(from, join(dir, f), { preserveTimestamps: true });
  }

  process.env[SYNC_MARKER] = dir;

  // `.env` is deliberately NOT copied. Every variable the server under test
  // needs is passed explicitly by `serverEnv()`; copying the developer's real
  // `.env` in would let a value nobody chose (a real DATABASE_URL, a real
  // Stripe key) reach a suite that places orders and issues refunds.

  if (!existsSync(join(dir, "node_modules"))) {
    hardlinkNodeModules(join(root, "node_modules"), join(dir, "node_modules"));
  }

  return dir;
}

function hardlinkNodeModules(from: string, to: string): void {
  try {
    // `cpSync` has no hardlink mode; `cp -al` does, and it is the whole point.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require("child_process") as typeof import("child_process");
    execFileSync("cp", ["-al", from, to], { stdio: "pipe" });
  } catch {
    // Different filesystem, or no `cp`. A symlink at least lets `--webpack`
    // work, and the Turbopack error message is explicit about what happened.
    symlinkSync(from, to, "dir");
  }
}
