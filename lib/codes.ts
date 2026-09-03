import { randomInt } from "crypto";

// Human-facing identifiers. Both are generated optimistically and both rely on
// a database uniqueness constraint to settle collisions — `orders.order_number`
// globally, `@@unique([slotId, pickupCode])` per slot. Pre-checking "is this
// code taken?" and then inserting is a race with every other checkout in
// flight, so we never do it.

/// No ambiguous glyphs — this gets read aloud in a noisy hallway. Dropped:
/// B/8, I/1, O/0, S/5, Z/2, and 6 (reads as G over noise).
const ALPHABET = "ACDEFGHJKLMNPQRSTUVWXY3479";

/// `randomInt` and not `Math.random`: these are the token a student presents at
/// the locker, so they should not be guessable from another order's code.
export const pickupCode = () =>
  Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export const orderNumber = () => `LL-${randomInt(10_000, 99_999)}`;

/// Prisma's unique-constraint violation.
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "P2002"
  );
}

/// Retry a write that can lose a uniqueness race.
///
/// IMPORTANT — this must wrap a whole `db.$transaction(...)`, never a single
/// statement *inside* one. Postgres aborts a transaction the moment any
/// statement in it fails: every subsequent statement returns 25P02
/// ("current transaction is aborted") until rollback, and Prisma's interactive
/// transactions do not wrap individual queries in savepoints. Retrying the
/// insert in place would therefore fail on a different error every time.
/// Retrying the transaction is correct instead of merely tolerable: the failed
/// attempt rolled back, so the seat and the stock it claimed were released with
/// it and the retry re-claims them from a clean state.
export async function withRetryOnUnique<T>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isUniqueViolation(e) || i === attempts - 1) throw e;
    }
  }
  throw new Error("unreachable");
}
