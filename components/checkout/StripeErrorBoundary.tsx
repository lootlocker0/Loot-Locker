"use client";

import { Component, type ReactNode } from "react";

type Props = { fallback: ReactNode; children: ReactNode };
type State = { hasError: boolean };

/**
 * Stripe Elements/PaymentElement runs third-party script that this
 * environment's placeholder key (`pk_test_placeholder` /
 * `sk_test_placeholder` — see `lib/stripe/payments.ts`'s simulated
 * PaymentIntent, docs/HANDOFF.md item 20) cannot fully initialize against: a
 * `pi_sim_...` client secret is not a real Stripe object, and Stripe.js may
 * throw rather than fail gracefully when it can't resolve one. A render-time
 * throw from that script must not blank the whole checkout page — only a
 * class component can catch a render error via `componentDidCatch`, so this
 * is the one class component in the app, scoped tightly around the Stripe
 * subtree and nothing else.
 */
export class StripeErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[stripe-elements]", error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
