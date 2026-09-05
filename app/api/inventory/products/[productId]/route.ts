import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { requireInventorySession } from "@/lib/inventory-session";
import { INVENTORY_PRODUCT_SELECT, findInventoryProduct } from "@/lib/db/inventory";
import { inventoryProductUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET one product, and PATCH its editable fields.
//
// What PATCH cannot do, structurally rather than by convention:
//
//   · write `stockQty` — an absolute set is a read-then-write (CLAUDE.md §2.4).
//     `.strict()` on the schema turns the attempt into a 400, so a client can
//     never believe it adjusted stock here. Use the /stock route.
//   · write `slug` — the stable key seeds upsert on. Write-once, at creation.
//   · write anything outside Product. There is no order, student, payment or
//     setting field to name in the body, and an unknown key is a 400.
//
// The Prisma `data` object below is assembled key by key from parsed values.
// Nothing spreads the request into it.

const productIdSchema = z.cuid();

async function loadOr409(rawId: string) {
  const parsed = productIdSchema.safeParse(rawId);
  // A malformed id and a missing product answer identically. There is no oracle
  // to protect here — the list endpoint returns every id — it is simply one
  // fewer branch for a client to handle.
  if (!parsed.success) throw new AppError("PRODUCT_UNAVAILABLE");
  const product = await findInventoryProduct(parsed.data);
  if (!product) throw new AppError("PRODUCT_UNAVAILABLE");
  return product;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ productId: string }> },
) {
  try {
    requireInventorySession(req);
    const { productId } = await ctx.params;
    const product = await loadOr409(productId);
    return Response.json(
      { product },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ productId: string }> },
) {
  try {
    const { sessionId } = requireInventorySession(req);
    const { productId: rawId } = await ctx.params;
    const existing = await loadOr409(rawId);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("INVALID_INPUT", {
        fields: { _body: ["Request body must be JSON."] },
      });
    }

    const parsed = inventoryProductUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      if (fields.allergens || fields.allergensReviewed) {
        throw new AppError("ALLERGENS_NOT_REVIEWED", { fields });
      }
      throw new AppError("INVALID_INPUT", { fields });
    }
    const input = parsed.data;

    // ── The publish gate that needs the stored row ───────────────────────────
    //
    // The schema already refuses `active: true` without `allergensReviewed:
    // true`, and refuses an allergen edit without it. This is the case a schema
    // cannot see: putting a product on sale whose stored allergen list is EMPTY,
    // without restating that list in this request.
    //
    // An empty list is ambiguous data — "checked, contains none" and "nobody
    // ever filled this in" are the same eleven-element-shorter array, and the
    // seeded catalog already contains 8 rows of the second kind
    // (docs/HANDOFF.md §16). There is no `allergensReviewedAt` column to
    // disambiguate them (a schema decision flagged in docs/HANDOFF.md, not one
    // to make quietly here), so the API demands the affirmation be made against
    // an explicitly transmitted list rather than against whatever happens to be
    // in the row.
    //
    // Concretely: to publish a bottle of water, send `"allergens": []` and
    // `"allergensReviewed": true` together. Ticking a box next to a blank list
    // is not enough, and that is deliberate — this is the exact request where a
    // product goes in front of a child.
    const nextAllergens = input.allergens ?? existing.allergens;
    const willBeActive = input.active ?? existing.active;
    if (
      willBeActive &&
      nextAllergens.length === 0 &&
      input.allergens === undefined
    ) {
      throw new AppError("ALLERGENS_NOT_REVIEWED", {
        fields: {
          allergens: [
            "This product lists no allergens. Send the list explicitly to confirm it was checked.",
          ],
        },
      });
    }

    // Assembled key by key. `undefined` is Prisma's "leave alone", and every
    // value below came out of the parsed schema.
    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.rarity !== undefined && { rarity: input.rarity }),
      ...(input.allergens !== undefined && { allergens: input.allergens }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    };

    // `allergensReviewed` is intentionally NOT in `data`: it is an affirmation
    // carried by the request, and there is no column for it. It is logged
    // instead, which is the only durable trace this system currently keeps.

    if (Object.keys(data).length === 0) {
      // Reachable only when the body was `{"allergensReviewed": true}` alone.
      throw new AppError("INVALID_INPUT", {
        fields: { _body: ["Nothing to change."] },
      });
    }

    const product = await db.product.update({
      where: { id: existing.id },
      data,
      select: INVENTORY_PRODUCT_SELECT,
    });

    // Money and safety fields are logged with their before/after values,
    // because those two are the changes somebody may later need to reconstruct
    // and this log is the only record of them. Non-PII by construction.
    logEvent("inventory_product_updated", {
      productId: product.id,
      slug: product.slug,
      changed: Object.keys(data).sort(),
      ...(input.priceCents !== undefined && {
        priceCentsFrom: existing.priceCents,
        priceCentsTo: product.priceCents,
      }),
      ...(input.allergens !== undefined && {
        allergensFrom: existing.allergens,
        allergensTo: product.allergens,
      }),
      ...(input.active !== undefined && {
        activeFrom: existing.active,
        activeTo: product.active,
      }),
      allergensReviewed: input.allergensReviewed === true,
      sessionId,
    });

    return Response.json(
      { product },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
