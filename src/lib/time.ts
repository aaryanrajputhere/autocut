export const US_PER_SECOND = 1_000_000;

export function secondsToUs(seconds: number) {
  return Math.round(seconds * US_PER_SECOND);
}

export function usToSeconds(us: number) {
  return us / US_PER_SECOND;
}

export function formatTime(us: number, withMs = true) {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  const base = `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return withMs ? `${base}.${String(milliseconds).padStart(3, "0")}` : base;
}

export function parseTime(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some(Number.isNaN) || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return secondsToUs(seconds);
}
