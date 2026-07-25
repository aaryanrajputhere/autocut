import type { DetectionSettings, KeepRange } from "./types";
import { secondsToUs } from "./time";

export function detectKeepRanges(
  loudness: number[],
  windowMs: number,
  durationSeconds: number,
  settings: DetectionSettings,
) {
  const speech = loudness.map((db) => db > settings.silenceThresholdDb);
  const minSilentWindows = Math.ceil(settings.minimumSilenceMs / windowMs);

  for (let index = 0; index < speech.length;) {
    if (speech[index]) { index += 1; continue; }
    const start = index;
    while (index < speech.length && !speech[index]) index += 1;
    if (index - start < minSilentWindows) speech.fill(true, start, index);
  }

  const ranges: KeepRange[] = [];
  const minSpeechWindows = Math.ceil(settings.minimumSpeechMs / windowMs);
  for (let index = 0; index < speech.length;) {
    if (!speech[index]) { index += 1; continue; }
    const start = index;
    while (index < speech.length && speech[index]) index += 1;
    if (index - start < minSpeechWindows) continue;
    const startSeconds = Math.max(0, start * windowMs / 1000 - settings.paddingBeforeMs / 1000);
    const endSeconds = Math.min(durationSeconds, index * windowMs / 1000 + settings.paddingAfterMs / 1000);
    const previous = ranges.at(-1);
    if (previous && secondsToUs(startSeconds) <= previous.sourceEndUs) {
      previous.sourceEndUs = secondsToUs(endSeconds);
    } else {
      ranges.push({
        id: crypto.randomUUID(),
        sourceStartUs: secondsToUs(startSeconds),
        sourceEndUs: secondsToUs(endSeconds),
        enabled: true,
      });
    }
  }
  return ranges;
}

export function normalizeRanges(ranges: KeepRange[], durationUs: number) {
  return ranges
    .map((range) => ({
      ...range,
      sourceStartUs: Math.max(0, Math.min(durationUs, Math.round(range.sourceStartUs))),
      sourceEndUs: Math.max(0, Math.min(durationUs, Math.round(range.sourceEndUs))),
    }))
    .filter((range) => range.sourceEndUs > range.sourceStartUs)
    .sort((a, b) => a.sourceStartUs - b.sourceStartUs);
}
