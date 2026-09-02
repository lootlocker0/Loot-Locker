import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// DELTA FROM CLAUDE.md §4, forced by the installed major version:
// Prisma 7 removed `url` from schema.prisma and requires a driver adapter to
// open a direct database connection. Everything else about this module is
// unchanged — same `db` export, same dev-only global to survive HMR, same log
// levels. See docs/HANDOFF.md, "Prisma 7 deltas".

const g = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Failing here beats failing halfway through a checkout with an opaque
    // driver error.
    throw new Error("DATABASE_URL missing");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = g.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") g.prisma = db;
