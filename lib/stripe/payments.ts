import { createHash } from "crypto";
import { stripe } from "./client";
import { logEvent } from "@/lib/log";

// The one seam between the checkout transaction and Stripe's network.
//
// Why it exists: `paymentIntents.create` is the only part of P3 that cannot run
// without a funded Stripe account. Signature verification is local crypto, the
// webhook is an inbound HTTP POST anyone can forge with the signing secret, and
// everything else is Postgres. So a single module isolates the one real network
// call, and the checkout transaction — the code that actually needs adversarial
// testing — can be driven end to end in a sandbox and in CI.
//
// How it stays honest in production. The simulator arms only when BOTH:
//
//   1. `NODE_ENV !== "production"`, and
//   2. the secret key is a self-declared placeholder (contains "placeholder"),
//      or `STRIPE_SIMULATE=1` is set.
//
// Condition 1 alone makes it inert in a production build no matter what the
// other environment variables say. Condition 2 means that even in dev, the
// moment a real `sk_test_…` key is present the real API is used — you do not
// have to remember to turn the fake off, and nobody accidentally develops
// against a simulator while believing they are talking to Stripe.
//
// P5, "swap in the live key": set a real `STRIPE_SECRET_KEY` and deploy with
// `NODE_ENV=production`. Nothing below changes and no flag needs clearing;
// `stripeMode` will read "live". Verify it by asserting that in the deployed
// logs. There is no code path in which a simulated intent can charge, refund,
// or fail to charge a real card, because a simulated intent never leaves this
// process — its client secret is not a Stripe client secret and Stripe.js
// rejects it.

const KEY = process.env.STRIPE_SECRET_KEY ?? "";

const SIMULATED =
  process.env.NODE_ENV !== "production" &&
  (/placeholder/i.test(KEY) || process.env.STRIPE_SIMULATE === "1");

export const stripeMode: "live" | "simulated" = SIMULATED
  ? "simulated"
  : "live";

logEvent("stripe_mode", { mode: stripeMode });

/// Prefix chosen so a simulated id is unmistakable in the database, in a log
/// line, and to a human reading a support ticket. Real ids are `pi_3…`/`pi_1…`.
const SIM_PREFIX = "pi_sim_";

/// Deterministic in the order id, which reproduces the property the real call
/// gets from `idempotencyKey: pi_<orderId>`: calling twice for one order yields
/// one intent, not two. A retried checkout cannot leave two intents behind.
function simulatedIntent(orderId: string): { id: string; clientSecret: string } {
  const digest = createHash("sha256").update(orderId).digest("hex");
  const id = `${SIM_PREFIX}${digest.slice(0, 24)}`;
  return { id, clientSecret: `${id}_secret_${digest.slice(24, 48)}` };
}

export const isSimulatedIntentId = (id: string) => id.startsWith(SIM_PREFIX);

export interface OrderPaymentIntent {
  id: string;
  clientSecret: string;
}

/// Opens a PaymentIntent for an order that already exists and already holds its
/// stock and its seat. Throws on failure; the caller releases the order.
export async function createOrderPaymentIntent(args: {
  orderId: string;
  orderNumber: string;
  amountCents: number;
}): Promise<OrderPaymentIntent> {
  if (SIMULATED) {
    logEvent("stripe_simulated_intent_created", {
      orderId: args.orderId,
      amountCents: args.amountCents,
    });
    return simulatedIntent(args.orderId);
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: args.amountCents,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      statement_descriptor_suffix: "LOOTLOCKERS",
      // The recovery path if the webhook and the database ever disagree: an
      // intent can always be traced back to an order from the Stripe dashboard.
      metadata: { orderId: args.orderId, orderNumber: args.orderNumber },
    },
    // Keyed on the order, so a client retry or one of stripe-node's own network
    // retries returns the same intent instead of opening a second charge for
    // the same snacks.
    { idempotencyKey: `pi_${args.orderId}` },
  );

  if (!intent.client_secret) {
    // Cannot happen for a freshly created intent, but a missing client secret
    // would mean handing the browser `undefined` and a payment form that never
    // works. Fail here where the caller can release the order.
    throw new Error(`PaymentIntent ${intent.id} has no client_secret`);
  }

  return { id: intent.id, clientSecret: intent.client_secret };
}

/// Best-effort cancel, used by the expiry sweep before it releases an order.
/// Never throws: "already succeeded", "already cancelled" and "no such intent"
/// are all normal races here, and none of them should stop the sweep from
/// releasing the stock the order was holding.
export async function cancelOrderPaymentIntent(
  intentId: string,
): Promise<void> {
  // A simulated id in live mode means dev data reached a live database. Sending
  // it to Stripe would only earn a 404; skip it and say so.
  if (SIMULATED || isSimulatedIntentId(intentId)) {
    logEvent("stripe_simulated_intent_cancelled", { simulated: SIMULATED });
    return;
  }
  try {
    await stripe.paymentIntents.cancel(intentId);
  } catch {
    // Deliberately swallowed. See above.
  }
}
