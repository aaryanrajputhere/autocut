import { afterEach, describe, expect, it } from "vitest";
import {
  dodoCheckoutUrl,
  freeExportMetadata,
  hasUsedFreeExport,
  withUserExportLock,
} from "./export-entitlement";

afterEach(() => {
  delete process.env.DODO_PAYMENTS_CHECKOUT_URL;
});

describe("export entitlement", () => {
  it("allows an account until its first successful export is recorded", () => {
    expect(hasUsedFreeExport({})).toBe(false);
    expect(hasUsedFreeExport(freeExportMetadata())).toBe(true);
  });

  it("only accepts an HTTPS Dodo checkout URL", () => {
    process.env.DODO_PAYMENTS_CHECKOUT_URL = "https://checkout.dodopayments.com/buy/example";
    expect(dodoCheckoutUrl()).toBe("https://checkout.dodopayments.com/buy/example");

    process.env.DODO_PAYMENTS_CHECKOUT_URL = "javascript:alert(1)";
    expect(dodoCheckoutUrl()).toBeNull();
  });

  it("serializes exports for the same account", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withUserExportLock("user_1", async () => {
      events.push("first-start");
      await firstPaused;
      events.push("first-end");
    });
    const second = withUserExportLock("user_1", async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
