import { beforeAll, describe, expect, it } from "vitest";
import { detectKeepRanges, normalizeRanges } from "./detection";
import { DEFAULT_SETTINGS } from "./types";

beforeAll(() => {
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => "test-id" });
  }
});

describe("detectKeepRanges", () => {
  it("keeps speech and applies padding", () => {
    const loudness = [
      ...Array(30).fill(-100),
      ...Array(50).fill(-12),
      ...Array(30).fill(-100),
    ];
    const ranges = detectKeepRanges(loudness, 20, 2.2, {
      ...DEFAULT_SETTINGS,
      minimumSilenceMs: 400,
      paddingBeforeMs: 100,
      paddingAfterMs: 100,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].sourceStartUs).toBe(500_000);
    expect(ranges[0].sourceEndUs).toBe(1_700_000);
  });

  it("does not cut a brief quiet gap", () => {
    const loudness = [
      ...Array(30).fill(-10),
      ...Array(10).fill(-100),
      ...Array(30).fill(-10),
    ];
    const ranges = detectKeepRanges(loudness, 20, 1.4, {
      ...DEFAULT_SETTINGS,
      minimumSilenceMs: 500,
      paddingBeforeMs: 0,
      paddingAfterMs: 0,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].sourceStartUs).toBe(0);
    expect(ranges[0].sourceEndUs).toBe(1_400_000);
  });

  it("returns no ranges for an entirely silent file", () => {
    expect(detectKeepRanges(Array(100).fill(-100), 20, 2, DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe("normalizeRanges", () => {
  it("clamps, filters and sorts ranges", () => {
    const result = normalizeRanges([
      { id: "b", sourceStartUs: 800, sourceEndUs: 1200, enabled: true },
      { id: "bad", sourceStartUs: 500, sourceEndUs: 400, enabled: true },
      { id: "a", sourceStartUs: -100, sourceEndUs: 300, enabled: true },
    ], 1000);
    expect(result.map((range) => range.id)).toEqual(["a", "b"]);
    expect(result[0].sourceStartUs).toBe(0);
    expect(result[1].sourceEndUs).toBe(1000);
  });
});
