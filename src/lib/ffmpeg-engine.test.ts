import { beforeAll, describe, expect, it } from "vitest";
import { rangesFromSilenceLog } from "./ffmpeg-engine";
import { DEFAULT_SETTINGS } from "./types";

beforeAll(() => {
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => "test-id" });
  }
});

describe("rangesFromSilenceLog", () => {
  it("turns FFmpeg silence events into padded keep ranges", () => {
    const ranges = rangesFromSilenceLog([
      "[silencedetect] silence_start: 2",
      "[silencedetect] silence_end: 4 | silence_duration: 2",
    ], 6, {
      ...DEFAULT_SETTINGS,
      paddingBeforeMs: 100,
      paddingAfterMs: 200,
    });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ sourceStartUs: 0, sourceEndUs: 2_200_000 });
    expect(ranges[1]).toMatchObject({ sourceStartUs: 3_900_000, sourceEndUs: 6_000_000 });
  });

  it("keeps the full file when FFmpeg reports no silence", () => {
    const ranges = rangesFromSilenceLog([], 10, DEFAULT_SETTINGS);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ sourceStartUs: 0, sourceEndUs: 10_000_000 });
  });

  it("returns no keep ranges for a fully silent file", () => {
    const ranges = rangesFromSilenceLog([
      "silence_start: 0",
      "silence_end: 8 | silence_duration: 8",
    ], 8, DEFAULT_SETTINGS);
    expect(ranges).toEqual([]);
  });
});
