import type { AdminOrdersResponse } from "./types";
import { SlotSection } from "./SlotSection";

function formatServiceDate(iso: string) {
  // serviceDate is midnight UTC standing in for a calendar day, not a real
  // instant — read with UTC getters so this never drifts a day depending on
  // the browser's local zone (same reasoning as the confirmation page).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * THE PICK LIST. Grouped by pickup window, in the order staff physically
 * work it — the API already returns slots ordered by serviceDate/startTime/
 * location and orders within a slot ordered by studentName (§6a). Nothing
 * here re-sorts or re-groups; this is a straight render of that shape so the
 * on-screen order matches the printed order matches the API's own
 * documented ordering.
 */
export function PickList({
  data,
  onOrderChanged,
  onUnauthorized,
}: {
  data: AdminOrdersResponse;
  onOrderChanged: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <section aria-labelledby="pick-list-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pick-list-heading" className="font-display text-headline-lg uppercase text-text">
          Pick list — {formatServiceDate(data.serviceDate)}
        </h2>
        <p className="admin-no-print font-mono text-xs text-text-faint">
          Showing: {data.statuses.join(", ")}
        </p>
      </div>

      {data.slots.length === 0 ? (
        <p className="border-2 border-white/10 bg-surface-2 p-6 text-center text-text-dim">
          No pickup windows for this day.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {data.slots.map((slot) => (
            <SlotSection
              key={slot.id}
              slot={slot}
              onOrderChanged={onOrderChanged}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </div>
      )}
    </section>
  );
}
