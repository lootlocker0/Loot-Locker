import { cn } from "./cn";

export type ProgressStep = {
  id: string;
  label: string;
  status: "complete" | "active" | "pending";
};

const NODE_STATUS_CLASS: Record<ProgressStep["status"], string> = {
  complete: "bg-brand text-void",
  active: "bg-gold text-void shadow-glow-legendary",
  pending: "border-2 border-white/10 bg-surface-4 text-text-faint",
};

const LABEL_STATUS_CLASS: Record<ProgressStep["status"], string> = {
  complete: "text-brand",
  active: "text-gold",
  pending: "text-text-faint",
};

const STATUS_ANNOUNCEMENT: Record<ProgressStep["status"], string> = {
  complete: "completed",
  active: "current step",
  pending: "upcoming",
};

/**
 * Horizontal step tracker, generalized from the LOADOUT / PICKUP / VICTORY
 * node row on the extraction_point (checkout) screen export. Status is
 * conveyed by both color/icon AND text - never by color alone - so it
 * survives a screen reader and a colorblind pass equally.
 */
export function ProgressTracker({
  steps,
  className,
}: {
  steps: ProgressStep[];
  className?: string;
}) {
  const completedCount = steps.filter((s) => s.status === "complete").length;
  const fraction = steps.length > 1 ? (completedCount / (steps.length - 1)) * 100 : 0;

  return (
    <div className={cn("relative w-full px-4 md:px-12", className)}>
      <div aria-hidden="true" className="absolute left-4 right-4 top-5 h-1 bg-surface-4 md:left-12 md:right-12" />
      <div
        aria-hidden="true"
        className="absolute left-4 top-5 h-1 max-w-[calc(100%-2rem)] bg-brand transition-[width] duration-500 md:left-12"
        style={{ width: `${fraction}%` }}
      />
      <ol className="relative flex items-start justify-between">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className="flex flex-1 flex-col items-center gap-2 text-center"
            aria-current={step.status === "active" ? "step" : undefined}
          >
            <span
              aria-hidden="true"
              className={cn(
                "clip-hex flex h-10 w-10 items-center justify-center font-display text-base",
                NODE_STATUS_CLASS[step.status],
              )}
            >
              {step.status === "complete" ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className={cn("font-mono text-label-sm uppercase tracking-wide", LABEL_STATUS_CLASS[step.status])}>
              {step.label}
              <span className="sr-only"> — {STATUS_ANNOUNCEMENT[step.status]}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
