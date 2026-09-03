"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ShardButton } from "@/components/ui/ShardButton";
import { formatCents } from "@/lib/money";

// If Stripe/Elements hasn't reported ready by this point (script blocked,
// clientSecret rejected, network failure against a fake key in this
// sandbox — docs/HANDOFF.md item 20), stop waiting and show a way out
// instead of a permanently disabled button with no explanation.
const STRIPE_READY_TIMEOUT_MS = 8_000;

/**
 * The card leg of checkout. The order already exists and already holds its
 * stock and its pickup seat (POST /api/checkout ran before this ever
 * mounts) — this component's only job is to confirm the PaymentIntent.
 *
 * `stripe.confirmPayment` resolving here is NOT confirmation that the order
 * is paid. Only the Stripe webhook writes PAID (CLAUDE.md §2.3). A resolved
 * promise with no `error` means either (a) confirmation succeeded without
 * needing an off-site redirect, in which case we navigate to the
 * confirmation page and let it poll, or (b) `redirect: "if_required"` still
 * decided a redirect was necessary, in which case the browser has already
 * left this page entirely and nothing below runs.
 */
export function PaymentStep({
  orderNumber,
  totalCents,
}: {
  orderNumber: string;
  totalCents: number;
}) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [elementFailed, setElementFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (stripe && elements) return;
    const t = setTimeout(() => setTimedOut(true), STRIPE_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [stripe, elements]);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setMsg(null);

    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/order/${orderNumber}`,
      },
    });

    if (error) {
      setMsg(error.message ?? "Payment failed. Check your card details and try again.");
      setBusy(false);
      return;
    }

    router.push(`/order/${orderNumber}`);
  }

  if (elementFailed || timedOut) {
    return (
      <div role="alert" className="clip-panel border-2 border-danger bg-surface-2 p-4 text-sm text-danger">
        <p>
          The card payment form couldn&rsquo;t load. This can happen on a slow
          connection, or if card payments are temporarily unavailable.
        </p>
        <p className="mt-2 text-text-dim">
          Your order{" "}
          <span className="font-mono text-text">{orderNumber}</span> is
          already being held. Reload this page to try card again, or contact
          staff and pay cash at pickup instead.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement onLoadError={() => setElementFailed(true)} />
      {msg && (
        <p role="alert" className="border-2 border-danger p-3 text-sm text-danger">
          {msg}
        </p>
      )}
      <ShardButton
        size="lg"
        loading={busy}
        onClick={pay}
        disabled={!stripe || !elements}
        className="w-full"
      >
        Pay {formatCents(totalCents)}
      </ShardButton>
    </div>
  );
}
