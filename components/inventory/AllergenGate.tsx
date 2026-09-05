"use client";

import { Allergen } from "@prisma/client";
import { cn } from "@/components/ui/cn";

const ALL_ALLERGENS = Object.values(Allergen);

/**
 * The safety-critical gate required by CLAUDE.md §2.8 and tightened further
 * by docs/API-CONTRACT.md §6b: every create, every allergen edit, and every
 * publish (`active: true`) must carry an explicit `allergensReviewed: true`
 * affirmed in the same request, and an empty list must be *restated*, not
 * left unset, to count as reviewed.
 *
 * This is deliberately not a free-text field and not a single "allergens OK?"
 * checkbox — it is a real checklist of the eleven `Allergen` enum values the
 * editor must look at one at a time, followed by a separate, distinctly
 * styled affirmation that only becomes meaningful once the checklist above
 * it has actually been read. Per docs/API-CONTRACT.md §6b's stated reason for
 * requiring the affirmation rather than "list non-empty": an empty list is
 * legitimate (a bottle of water) and must not be indistinguishable from a
 * form nobody filled in.
 *
 * The parent form is responsible for uncheck-on-edit: any allergen checkbox
 * toggle, or a switch to publish, should reset `reviewed` back to false so a
 * stale affirmation from earlier in the same sitting can never carry a later
 * edit across the gate unreviewed. See ProductForm.tsx.
 */
export function AllergenGate({
  idPrefix,
  value,
  onChange,
  reviewed,
  onReviewedChange,
}: {
  idPrefix: string;
  value: Allergen[];
  onChange: (next: Allergen[]) => void;
  reviewed: boolean;
  onReviewedChange: (next: boolean) => void;
}) {
  function toggle(a: Allergen) {
    onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-base uppercase text-text">
          Allergens — check every one this product actually contains
        </legend>
        <p className="text-sm text-text-dim">
          Go through all eleven, one at a time. Base this on the real
          ingredient label, never on what a similar product usually contains.
          If you are not sure, leave it unchecked and ask an adult before
          publishing rather than guessing.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-2 border-white/10 bg-surface-2 p-4 sm:grid-cols-3">
          {ALL_ALLERGENS.map((a) => (
            <label
              key={a}
              className="flex cursor-pointer items-center gap-2 text-sm text-text"
            >
              <input
                type="checkbox"
                id={`${idPrefix}-allergen-${a}`}
                checked={value.includes(a)}
                onChange={() => toggle(a)}
                className="h-4 w-4"
              />
              {a.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        {value.length === 0 && (
          <p className="font-mono text-xs text-rarity-uncommon">
            No boxes checked — this will save as &ldquo;contains none of the
            listed allergens.&rdquo; Only leave this if you actually checked
            every box above and none apply.
          </p>
        )}
      </fieldset>

      <div
        className={cn(
          "clip-panel border-2 p-4",
          reviewed ? "border-rarity-uncommon bg-surface-2" : "border-danger bg-surface-2",
        )}
      >
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            id={`${idPrefix}-allergens-reviewed`}
            checked={reviewed}
            onChange={(e) => onReviewedChange(e.target.checked)}
            required
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span className="text-text">
            <strong>
              I confirm I checked every allergen above against this
              product&rsquo;s real ingredients, including confirming none
              apply if I left every box unchecked.
            </strong>
            <span className="mt-1 block text-xs text-text-dim">
              Required to save any change to this list, and required to make
              a product visible to shoppers. It resets every time you touch a
              box above — check it again as the last step before saving.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
