import { describe, expect, it } from "vitest";
import { formatTime, parseTime, secondsToUs, usToSeconds } from "./time";

describe("time helpers", () => {
  it("converts seconds and microseconds", () => {
    expect(secondsToUs(1.234567)).toBe(1_234_567);
    expect(usToSeconds(2_500_000)).toBe(2.5);
  });

  it("formats timeline timecodes", () => {
    expect(formatTime(65_123_000)).toBe("01:05.123");
    expect(formatTime(3_665_000_000)).toBe("01:01:05.000");
  });

  it("parses timestamp fields", () => {
    expect(parseTime("01:05.250")).toBe(65_250_000);
    expect(parseTime("bad")).toBeNull();
  });
});
