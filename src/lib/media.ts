import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { VideoMetadata } from "./types";
import { secondsToUs } from "./time";

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 60 * 60;

export async function canPlayVideoFile(file: File) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.preload = "auto";

  try {
    return await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => finish(false), 6000);
      const finish = (supported: boolean) => {
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        resolve(supported);
      };
      video.addEventListener("loadeddata", () => finish(true), { once: true });
      video.addEventListener("error", () => finish(false), { once: true });
      video.src = url;
      video.load();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function browserMemoryWarning(file: File, metadata: VideoMetadata) {
  if (metadata.videoCodec !== "hevc") return null;
  const deviceMemoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const estimatedWorkingBytes = file.size * 3 + 512 * 1024 * 1024;
  const risky = deviceMemoryGb
    ? estimatedWorkingBytes > deviceMemoryGb * 1024 ** 3 * 0.35
    : file.size > 500 * 1024 * 1024;
  if (!risky) return null;
  return `This HEVC video may need about ${(estimatedWorkingBytes / 1024 ** 3).toFixed(1)} GB of working memory. Browser processing may be slow or close unexpectedly.`;
}

export async function readMetadata(file: File): Promise<VideoMetadata> {
  if (file.size > MAX_FILE_BYTES) throw new Error("This file is larger than the 2 GB limit.");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const [video, audio, duration] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.computeDuration(),
  ]);
  if (!video && audio) {
    throw new Error("This is an audio-only AAC/M4A file, despite its .mp4 extension. DaddyCutter currently requires a video track.");
  }
  if (!video) throw new Error("No video track was found.");
  if (!audio) throw new Error("DaddyCutter needs a video with an audio track.");
  const [width, height, videoCodec, audioCodec, sampleRate, channels] = await Promise.all([
    video.getDisplayWidth(),
    video.getDisplayHeight(),
    video.getCodec(),
    audio.getCodec(),
    audio.getSampleRate(),
    audio.getNumberOfChannels(),
  ]);
  input.dispose();
  if (duration > MAX_DURATION_SECONDS) throw new Error("This video is longer than the 60 minute limit.");
  if (width > 1920 || height > 1920) throw new Error("The MVP supports video up to 1080p.");
  if (!["avc", "hevc"].includes(videoCodec ?? "") || audioCodec !== "aac") {
    throw new Error(`Unsupported codecs: ${videoCodec ?? "unknown"} video / ${audioCodec ?? "unknown"} audio. Use H.264 or HEVC video with AAC audio.`);
  }
  return {
    durationUs: secondsToUs(duration),
    width, height,
    videoCodec: videoCodec!,
    audioCodec,
    sampleRate, channels,
    size: file.size,
  };
}
