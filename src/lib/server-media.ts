import "server-only";

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DetectionSettings, KeepRange, VideoMetadata } from "./types";
import { secondsToUs } from "./time";

const MEDIA_ROOT = join(tmpdir(), "autocut-media");
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const JOB_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f-]{36}$/;
const exportProgress = new Map<string, { progress: number; stage: string }>();

export async function storeMedia(id: string, body: ReadableStream<Uint8Array>, declaredBytes: number | null) {
  if (declaredBytes !== null && declaredBytes > MAX_FILE_BYTES) throw new Error("This file is larger than the 2 GB limit.");
  await cleanupExpiredMedia();
  const directory = mediaDirectory(id);
  await mkdir(directory, { recursive: true });
  const input = join(directory, "input.media");
  let received = 0;
  const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_FILE_BYTES) source.destroy(new Error("This file is larger than the 2 GB limit."));
  });
  const { createWriteStream } = await import("node:fs");
  try {
    await pipeline(source, createWriteStream(input, { flags: "wx" }));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function analyzeMedia(id: string, metadata: VideoMetadata, settings: DetectionSettings) {
  const input = await requireInput(id);
  const messages = await runFfmpeg([
    "-hide_banner", "-i", input, "-vn",
    "-af", `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level,silencedetect=noise=${settings.silenceThresholdDb}dB:d=${settings.minimumSilenceMs / 1000}`,
    "-f", "null", "-",
  ]);
  const durationSeconds = metadata.durationUs / 1e6;
  const loudness = parseLoudness(messages);
  return {
    metadata,
    loudness,
    windowMs: loudness.length ? durationSeconds * 1000 / loudness.length : 20,
    waveform: makeWaveform(loudness, 900),
    ranges: rangesFromSilenceLog(messages, durationSeconds, settings),
  };
}

export async function exportMedia(id: string, ranges: KeepRange[]) {
  const input = await requireInput(id);
  const enabled = ranges.filter((range) => range.enabled);
  if (!enabled.length) throw new Error("Enable at least one keep range before exporting.");
  if (enabled.length > 500) throw new Error("This project contains too many keep ranges.");
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  enabled.forEach((range, index) => {
    const start = (range.sourceStartUs / 1e6).toFixed(6);
    const end = (range.sourceEndUs / 1e6).toFixed(6);
    filterParts.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  });
  filterParts.push(`${concatInputs.join("")}concat=n=${enabled.length}:v=1:a=1[vout][aout]`);
  const output = join(mediaDirectory(id), "output.mp4");
  const totalDuration = enabled.reduce(
    (sum, range) => sum + (range.sourceEndUs - range.sourceStartUs) / 1e6,
    0,
  );
  exportProgress.set(id, { progress: 0.02, stage: "Preparing export" });
  await rm(output, { force: true });
  await runFfmpeg([
    "-hide_banner", "-y", "-i", input,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", output,
  ], (message) => {
    const seconds = parseFfmpegTime(message);
    if (seconds !== null && totalDuration > 0) {
      exportProgress.set(id, {
        progress: Math.min(0.98, seconds / totalDuration),
        stage: "Rendering MP4",
      });
    }
  });
  exportProgress.set(id, { progress: 1, stage: "Export ready" });
  const info = await stat(output);
  const nodeStream = createReadStream(output);
  return {
    size: info.size,
    stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
  };
}

export function getExportProgress(id: string) {
  mediaDirectory(id);
  return exportProgress.get(id) ?? { progress: 0, stage: "Waiting for FFmpeg" };
}

export async function createPreview(id: string) {
  const input = await requireInput(id);
  const output = join(mediaDirectory(id), "preview.mp4");
  await rm(output, { force: true });
  await runFfmpeg([
    "-hide_banner", "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='min(960,iw)':-2",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart", output,
  ]);
  const info = await stat(output);
  return {
    size: info.size,
    stream: Readable.toWeb(createReadStream(output)) as ReadableStream<Uint8Array>,
  };
}

function mediaDirectory(id: string) {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid media id.");
  return join(MEDIA_ROOT, id);
}

async function requireInput(id: string) {
  const input = join(mediaDirectory(id), "input.media");
  await stat(input).catch(() => {
    throw new Error("This upload has expired. Please select the video again.");
  });
  return input;
}

async function runFfmpeg(args: string[], onMessage?: (message: string) => void) {
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    const messages: string[] = [];
    let remainder = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      remainder += chunk;
      const lines = remainder.split(/\r?\n|\r/);
      remainder = lines.pop() ?? "";
      messages.push(...lines);
      lines.forEach((line) => onMessage?.(line));
      if (messages.length > 250_000) messages.splice(0, messages.length - 250_000);
    });
    child.once("error", (error) => reject(new Error(`Could not start native FFmpeg: ${error.message}`)));
    child.once("close", (code) => {
      if (remainder) messages.push(remainder);
      if (code === 0) resolve(messages);
      else reject(new Error(lastMeaningfulLog(messages) || `FFmpeg exited with code ${code}.`));
    });
  });
}

function parseFfmpegTime(message: string) {
  const match = message.match(/\btime=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseLoudness(messages: string[]) {
  return messages.flatMap((message) => {
    const match = message.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    return match ? [match[1] === "-inf" ? -100 : Number(match[1])] : [];
  });
}

function rangesFromSilenceLog(messages: string[], durationSeconds: number, settings: DetectionSettings) {
  const silences: { start: number; end: number }[] = [];
  let openStart: number | null = null;
  for (const message of messages) {
    const start = message.match(/silence_start:\s*([\d.]+)/);
    if (start) openStart = Number(start[1]);
    const end = message.match(/silence_end:\s*([\d.]+)/);
    if (end) {
      silences.push({ start: openStart ?? 0, end: Number(end[1]) });
      openStart = null;
    }
  }
  if (openStart !== null) silences.push({ start: openStart, end: durationSeconds });
  const speech: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.start > cursor) speech.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < durationSeconds) speech.push({ start: cursor, end: durationSeconds });
  if (!silences.length) speech.push({ start: 0, end: durationSeconds });
  const padded = speech
    .filter((range) => (range.end - range.start) * 1000 >= settings.minimumSpeechMs)
    .map((range) => ({
      start: Math.max(0, range.start - settings.paddingBeforeMs / 1000),
      end: Math.min(durationSeconds, range.end + settings.paddingAfterMs / 1000),
    }));
  const merged: typeof padded = [];
  for (const range of padded) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map((range) => ({
    id: crypto.randomUUID(),
    sourceStartUs: secondsToUs(range.start),
    sourceEndUs: secondsToUs(range.end),
    enabled: true,
  }));
}

function makeWaveform(loudness: number[], bins: number) {
  if (!loudness.length) return Array(bins).fill(0.08);
  return Array.from({ length: bins }, (_, bin) => {
    const from = Math.floor(bin * loudness.length / bins);
    const to = Math.max(from + 1, Math.floor((bin + 1) * loudness.length / bins));
    let peak = -100;
    for (let index = from; index < Math.min(to, loudness.length); index += 1) peak = Math.max(peak, loudness[index]);
    return Math.max(0.03, Math.min(1, Math.pow(10, peak / 20) * 2.5));
  });
}

function lastMeaningfulLog(messages: string[]) {
  return [...messages].reverse().find((message) => /error|invalid|failed|unsupported/i.test(message));
}

async function cleanupExpiredMedia() {
  await mkdir(MEDIA_ROOT, { recursive: true });
  const entries = await readdir(MEDIA_ROOT, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = join(MEDIA_ROOT, entry.name);
    const info = await stat(directory);
    if (Date.now() - info.mtimeMs > JOB_MAX_AGE_MS) await rm(directory, { recursive: true, force: true });
  }));
}
