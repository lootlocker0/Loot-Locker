import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class-name merge helper local to components/ui. Frontend does not own
 * lib/**, so this lives beside the primitives that need it instead of at
 * lib/cn.ts. If backend ever lands a shared lib/cn.ts with the same
 * signature, primitives can switch to that import with no API change.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
