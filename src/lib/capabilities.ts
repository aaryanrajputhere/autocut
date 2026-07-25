import { ffmpegSupported } from "./ffmpeg-engine";

export type Capabilities = {
  ffmpeg: boolean;
  filePicker: boolean;
  workers: boolean;
  crossOriginIsolated: boolean;
};

export async function inspectCapabilities(): Promise<Capabilities> {
  return {
    ffmpeg: ffmpegSupported(),
    filePicker: "showSaveFilePicker" in window,
    workers: "Worker" in window,
    crossOriginIsolated: window.crossOriginIsolated,
  };
}
