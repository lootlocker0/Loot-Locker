import { createHash } from "crypto";

export const hashPii = (v: string) =>
  createHash("sha256").update(v.toLowerCase().trim()).digest("hex").slice(0, 12);

export const maskEmail = (e: string) => {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}***@${d ?? "?"}`;
};

export function logEvent(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...data }));
}
