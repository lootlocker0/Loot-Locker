import Stripe from "stripe";

// The raw SDK client. Two things use it directly and nothing else should:
//   · lib/stripe/payments.ts — PaymentIntent create/cancel, behind a seam
//   · app/api/webhooks/stripe/route.ts — signature verification, which is pure
//     local crypto and makes no network call
//
// Failing at import time when the key is absent beats failing halfway through a
// checkout with an opaque 401 from Stripe.
if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing");

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // DELTA FROM backend.md §4, forced by the installed SDK. stripe-node 22.6.1's
  // types only accept the version it was generated against, and
  // `"2025-08-27.basil"` (the spec's value) is a compile error here. Pinned
  // explicitly rather than left to the account default: a pinned version means
  // Stripe changing their default never changes what this code receives.
  apiVersion: "2026-08-26.dahlia",
  typescript: true,
  // Stripe's retries are idempotency-key aware, so a retried
  // paymentIntents.create returns the original intent rather than a second one.
  maxNetworkRetries: 2,
});
