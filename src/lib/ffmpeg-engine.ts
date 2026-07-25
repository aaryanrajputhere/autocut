"use client";

import { FFmpeg, type LogEventCallback } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { AnalysisResult, DetectionSettings, KeepRange, VideoMetadata } from "./types";
import { secondsToUs } from "./time";

type ProgressCallback = (progress: number, stage?: string) => void;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let loadedFileKey: string | null = null;

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function getFfmpeg(onProgress: ProgressCallback) {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loadPromise) return loadPromise;
  const instance = new FFmpeg();
  ffmpeg = instance;
  loadPromise = (async () => {
    onProgress(0.01, "Loading FFmpeg");
    await instance.load({
      coreURL: "/ffmpeg/ffmpeg-core.js",
      wasmURL: "/ffmpeg/ffmpeg-core.wasm",
    });
    onProgress(0.06, "FFmpeg ready");
    return instance;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function ensureInput(instance: FFmpeg, file: File, onProgress: ProgressCallback) {
  const key = fileKey(file);
  if (loadedFileKey === key) return "input.mp4";
  onProgress(0.07, "Copying video into FFmpeg");
  await instance.writeFile("input.mp4", await fetchFile(file));
  loadedFileKey = key;
  onProgress(0.12, "Video ready");
  return "input.mp4";
}

export async function analyzeWithFfmpeg(
  file: File,
  metadata: VideoMetadata,
  settings: DetectionSettings,
  onProgress: ProgressCallback,
): Promise<AnalysisResult> {
  const instance = await getFfmpeg(onProgress);
  const input = await ensureInput(instance, file, onProgress);
  const messages: string[] = [];
  const durationSeconds = metadata.durationUs / 1e6;

  const onLog: LogEventCallback = ({ message }) => {
    messages.push(message);
    const time = parseFfmpegTime(message);
    if (time !== null) onProgress(Math.min(0.97, 0.12 + time / durationSeconds * 0.85), "Detecting silence");
  };
  instance.on("log", onLog);
  try {
    const exitCode = await instance.exec([
      "-i", input,
      "-vn",
      "-af",
      `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level,silencedetect=noise=${settings.silenceThresholdDb}dB:d=${settings.minimumSilenceMs / 1000}`,
      "-f", "null",
      "-",
    ]);
    if (exitCode !== 0) throw new Error(lastMeaningfulLog(messages) ?? `FFmpeg exited with code ${exitCode}.`);
  } finally {
    instance.off("log", onLog);
  }

  const loudness = parseLoudness(messages);
  const windowMs = loudness.length ? durationSeconds * 1000 / loudness.length : 20;
  const waveform = makeWaveform(loudness, 900);
  const ranges = rangesFromSilenceLog(messages, durationSeconds, settings);
  onProgress(1, "Analysis complete");
  return { metadata, waveform, loudness, windowMs, ranges };
}

export async function exportWithFfmpeg({
  file,
  ranges,
  onProgress,
  signal,
}: {
  file: File;
  metadata: VideoMetadata;
  ranges: KeepRange[];
  onProgress: ProgressCallback;
  signal: AbortSignal;
}) {
  const enabled = ranges.filter((range) => range.enabled);
  if (!enabled.length) throw new Error("Enable at least one keep range before exporting.");
  const instance = await getFfmpeg(onProgress);
  const input = await ensureInput(instance, file, onProgress);
  const totalDuration = enabled.reduce((sum, range) => sum + (range.sourceEndUs - range.sourceStartUs) / 1e6, 0);
  const outputName = "autocut-output.mp4";
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

  const onLog: LogEventCallback = ({ message }) => {
    const time = parseFfmpegTime(message);
    if (time !== null) onProgress(Math.min(0.98, time / totalDuration), "Rendering MP4");
  };
  instance.on("log", onLog);
  const abort = () => cancelFfmpeg();
  signal.addEventListener("abort", abort, { once: true });
  try {
    onProgress(0.01, "Preparing export");
    const exitCode = await instance.exec([
      "-i", input,
      "-filter_complex", filterParts.join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outputName,
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg export exited with code ${exitCode}.`);
    const data = await instance.readFile(outputName);
    await instance.deleteFile(outputName);
    if (typeof data === "string") throw new Error("FFmpeg returned an invalid video file.");
    onProgress(1, "Export complete");
    return new Blob([data.slice().buffer], { type: "video/mp4" });
  } finally {
    instance.off("log", onLog);
    signal.removeEventListener("abort", abort);
  }
}

export async function createHevcPreviewProxy(
  file: File,
  metadata: VideoMetadata,
  onProgress: ProgressCallback,
) {
  if (metadata.videoCodec !== "hevc") return null;
  const instance = await getFfmpeg(onProgress);
  const input = await ensureInput(instance, file, onProgress);
  const outputName = "autocut-preview.mp4";
  const durationSeconds = metadata.durationUs / 1e6;
  const onLog: LogEventCallback = ({ message }) => {
    const time = parseFfmpegTime(message);
    if (time !== null) onProgress(Math.min(0.98, time / durationSeconds), "Creating H.264 preview");
  };
  instance.on("log", onLog);
  try {
    onProgress(0.01, "Preparing HEVC preview");
    const exitCode = await instance.exec([
      "-i", input,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-vf", "scale='min(960,iw)':-2",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "30",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputName,
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg preview conversion exited with code ${exitCode}.`);
    const data = await instance.readFile(outputName);
    await instance.deleteFile(outputName);
    if (typeof data === "string") throw new Error("FFmpeg returned an invalid preview file.");
    onProgress(1, "Preview ready");
    return new Blob([data.slice().buffer], { type: "video/mp4" });
  } finally {
    instance.off("log", onLog);
  }
}

export function cancelFfmpeg() {
  ffmpeg?.terminate();
  ffmpeg = null;
  loadPromise = null;
  loadedFileKey = null;
}

export function ffmpegSupported() {
  return typeof WebAssembly !== "undefined" && typeof Worker !== "undefined";
}

function parseFfmpegTime(message: string) {
  const match = message.match(/\btime=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseLoudness(messages: string[]) {
  return messages.flatMap((message) => {
    const match = message.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    if (!match) return [];
    return [match[1] === "-inf" ? -100 : Number(match[1])];
  });
}

export function rangesFromSilenceLog(
  messages: string[],
  durationSeconds: number,
  settings: DetectionSettings,
) {
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

  const raw: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.start > cursor) raw.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < durationSeconds) raw.push({ start: cursor, end: durationSeconds });
  if (!silences.length) raw.push({ start: 0, end: durationSeconds });

  const padded = raw
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
