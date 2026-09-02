import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const shard = cva(
  "clip-shard inline-flex items-center justify-center font-display uppercase " +
    "tracking-wide transition-transform active:scale-[.97] " +
    "disabled:opacity-40 disabled:pointer-events-none",
  {
    variants: {
      intent: {
        // text-void, not text-text: white-on-epic-purple measures ~3.1:1,
        // which only clears WCAG AA at large-text sizes. Button labels at
        // sm/md aren't reliably "large text", so epic uses void text like
        // gold does. See docs/DESIGN.md contrast audit.
        gold:  "bg-gold text-void hover:brightness-110",
        epic:  "bg-rarity-epic text-void hover:brightness-110",
        ghost: "bg-transparent text-text border-2 border-brand hover:bg-brand/15",
      },
      size: {
        sm: "px-5 py-2 text-sm",
        md: "px-8 py-3 text-base",
        lg: "px-12 py-4 text-lg w-full sm:w-auto",
      },
    },
    defaultVariants: { intent: "gold", size: "md" },
  },
);

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof shard> & { loading?: boolean };

export function ShardButton({
  intent, size, loading, children, className, disabled, ...rest
}: Props) {
  return (
    <button
      className={cn(shard({ intent, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
