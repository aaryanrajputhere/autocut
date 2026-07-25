import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { VideoMetadata } from "./types";
import { secondsToUs } from "./time";

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 60 * 60;

export async function readMetadata(file: File): Promise<VideoMetadata> {
  if (file.size > MAX_FILE_BYTES) throw new Error("This file is larger than the 2 GB limit.");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const [video, audio, duration] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.computeDuration(),
  ]);
  if (!video && audio) {
    throw new Error("This is an audio-only AAC/M4A file, despite its .mp4 extension. AutoCut currently requires a video track.");
  }
  if (!video) throw new Error("No video track was found.");
  if (!audio) throw new Error("AutoCut needs a video with an audio track.");
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
