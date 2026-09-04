import type { AdminApiError } from "./types";

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: AdminApiError };

/**
 * Every `/api/admin/*` call goes through here. Per docs/API-CONTRACT.md §6a:
 * an ordinary same-origin `fetch` with the default `credentials:
 * "same-origin"` already sends the `ll_admin` cookie — never `"omit"`.
 * `cache: "no-store"` matches every admin route's own `Cache-Control`.
 */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "INTERNAL", message: "Network error. Check your connection." },
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // No body (e.g. a 204, or a proxy error page) — fall through to the
    // generic INTERNAL error below rather than throwing.
  }

  if (!res.ok) {
    const parsed = (body as { error?: AdminApiError } | null)?.error;
    const error: AdminApiError = parsed ?? {
      code: "INTERNAL",
      message: "Something broke on our end.",
    };
    return { ok: false, status: res.status, error };
  }

  return { ok: true, data: body as T };
}
