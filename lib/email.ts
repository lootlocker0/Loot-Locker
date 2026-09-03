import { logEvent } from "./log";

// Confirmation email — call sites live, delivery deliberately not built.
//
// backend.md §3 and §5 both call `sendConfirmationEmail(order.id)`. The call
// sites are real and are wired up here so that turning delivery on is one
// module, not an archaeology exercise across the checkout route and the webhook
// handler. What this does NOT do is send mail, and that is a decision rather
// than an omission:
//
//   · The recipients are children. CLAUDE.md §7 escalates "anything touching
//     school data policy or PII retention" to a human, and mailing a student's
//     name, pickup code, pickup location and allergen list to an address typed
//     into a public form is squarely that. Resend also retains message content;
//     who may read it is exactly the kind of question §7 says an agent does not
//     get to answer.
//   · RESEND_API_KEY is a placeholder in every environment that exists today,
//     so a "working" implementation would be untested against the real service.
//   · Nothing in the ordering flow depends on it. The pickup code is on the
//     confirmation screen; the confirmation screen is the receipt.
//
// So: this logs that a confirmation was due, and resolves. It never throws —
// no notification failure may ever break a checkout that already took money or
// already holds stock. `docs/API-CONTRACT.md` states plainly that no email is
// sent, so the UI does not tell a student to check an inbox that stays empty.
//
// See docs/HANDOFF.md, P3 item on notifications, for what implementing this
// needs (from-domain, template review, PII sign-off).

export interface NotifyResult {
  sent: boolean;
  reason: "not_implemented";
}

export async function sendConfirmationEmail(
  orderId: string,
): Promise<NotifyResult> {
  // orderId, never the email address or the student's name (CLAUDE.md §2.6).
  logEvent("confirmation_email_not_sent", { orderId, reason: "not_implemented" });
  return { sent: false, reason: "not_implemented" };
}
