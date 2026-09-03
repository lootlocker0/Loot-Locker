import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import {
  ORDER_SESSION_TTL_SECONDS,
  orderSessionCookie,
  orderSessionCookieName,
  orderSessionMode,
  signOrderSessionToken,
  verifyOrderSessionToken,
} from "@/lib/order-session";

describe("order session token", () => {
  it("resolves a configured key, not the ephemeral dev fallback", () => {
    // If this ever reads "ephemeral-dev", every cross-process cookie assertion
    // in tests/api/orders.test.ts is meaningless (HANDOFF §28).
    expect(orderSessionMode).toBe("configured");
  });

  it("round-trips an order id", () => {
    expect(verifyOrderSessionToken(signOrderSessionToken("order_abc"))).toBe("order_abc");
  });

  it("rejects a tampered payload", () => {
    const token = signOrderSessionToken("order_abc");
    const [v, , exp, mac] = token.split(".");
    expect(verifyOrderSessionToken(`${v}.order_xyz.${exp}.${mac}`)).toBeNull();
  });

  it("rejects a token signed with a different key", () => {
    const exp = Math.floor(Date.now() / 1000) + ORDER_SESSION_TTL_SECONDS;
    const payload = `v1.order_abc.${exp}`;
    const mac = createHmac("sha256", "another-secret").update(payload).digest("base64url");
    expect(verifyOrderSessionToken(`${payload}.${mac}`)).toBeNull();
  });

  it("rejects an expired token even though its signature is valid", () => {
    const stale = signOrderSessionToken(
      "order_abc",
      Date.now() - (ORDER_SESSION_TTL_SECONDS + 1) * 1000,
    );
    expect(verifyOrderSessionToken(stale)).toBeNull();
  });

  it("rejects structurally wrong tokens without throwing", () => {
    const bads: (string | undefined | null)[] = [
      undefined,
      null,
      "",
      "garbage",
      "v1.order.123",
      "v2.order_abc.9999999999.aaaa",
      "v1.order_abc.notanumber.aaaa",
      "v1.order_abc.9999999999.",
    ];
    for (const bad of bads) {
      expect(verifyOrderSessionToken(bad)).toBeNull();
    }
  });

  it("names the cookie after the order and scopes it to the read route", () => {
    const c = orderSessionCookie({ id: "order_abc", orderNumber: "LL-12345" });
    expect(c.name).toBe(orderSessionCookieName("LL-12345"));
    expect(c.name).toBe("ll_ord_LL-12345");
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
    expect(c.path).toBe("/api/orders");
    expect(c.maxAge).toBe(48 * 60 * 60);
    // The token binds the id, never the order number — that is what makes
    // renaming a cookie useless.
    expect(verifyOrderSessionToken(c.value)).toBe("order_abc");
    expect(c.value).not.toContain("LL-12345");
  });
});
