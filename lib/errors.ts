export const ERROR_CODES = {
  INVALID_INPUT: { status: 400, message: "Check the highlighted fields." },
  // Returned by GET /api/orders/[orderNumber] for a genuinely unknown order
  // number AND for every failed authorisation of a real one: no cookie, an
  // expired or forged cookie, or a valid cookie belonging to a different order.
  // The cases are deliberately indistinguishable — `LL-#####` is a 90,000-value
  // space and an error that says "wrong cookie" is an oracle that confirms the
  // order exists (same reasoning as SLOT_FULL in checkout).
  ORDER_NOT_FOUND: { status: 404, message: "We couldn't find that order." },
  PAST_CUTOFF: { status: 409, message: "Ordering closed for that pickup time." },
  SLOT_FULL: { status: 409, message: "That pickup time just filled up." },
  OUT_OF_STOCK: { status: 409, message: "An item just sold out." },
  SPEND_CAP_EXCEEDED: { status: 409, message: "Daily spending limit reached." },
  PRODUCT_UNAVAILABLE: {
    status: 409,
    message: "An item is no longer available.",
  },
  PAYMENT_FAILED: { status: 402, message: "Payment was declined." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Wait a minute." },
  INTERNAL: { status: 500, message: "Something broke on our end." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: Record<string, unknown>,
  ) {
    super(ERROR_CODES[code].message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    const { status, message } = ERROR_CODES[e.code];
    return Response.json(
      { error: { code: e.code, message, ...e.detail } },
      { status },
    );
  }
  console.error("[unhandled]", e);
  return Response.json(
    { error: { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message } },
    { status: 500 },
  );
}
