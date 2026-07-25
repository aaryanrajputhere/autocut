export type KeepRange = {
  id: string;
  sourceStartUs: number;
  sourceEndUs: number;
  enabled: boolean;
};

export type DetectionSettings = {
  silenceThresholdDb: number;
  minimumSilenceMs: number;
  minimumSpeechMs: number;
  paddingBeforeMs: number;
  paddingAfterMs: number;
};

export type VideoMetadata = {
  durationUs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  sampleRate: number;
  channels: number;
  size: number;
};

export type AnalysisResult = {
  metadata: VideoMetadata;
  waveform: number[];
  loudness: number[];
  windowMs: number;
  ranges: KeepRange[];
};

export type PreviewChunkStatus = "queued" | "processing" | "ready" | "failed";

export type PreviewChunk = {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  status: PreviewChunkStatus;
  blobUrl?: string;
  error?: string;
};

export const DEFAULT_SETTINGS: DetectionSettings = {
  silenceThresholdDb: -38,
  minimumSilenceMs: 500,
  minimumSpeechMs: 250,
  paddingBeforeMs: 120,
  paddingAfterMs: 180,
};
