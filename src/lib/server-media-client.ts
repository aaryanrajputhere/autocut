"use client";

import type { AnalysisResult, DetectionSettings, KeepRange, VideoMetadata } from "./types";

type ProgressCallback = (progress: number, stage?: string) => void;

type UploadResponse = { mediaId: string };

export class PaymentRequiredError extends Error {
  constructor(public readonly checkoutUrl: string) {
    super("Your free video has been used. Redirecting to payment.");
    this.name = "PaymentRequiredError";
  }
}

export function uploadMedia(file: File, onProgress: ProgressCallback, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/media?name=${encodeURIComponent(file.name)}`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total, "Uploading video");
    };
    request.onerror = () => reject(new Error("The video upload failed."));
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    request.onload = () => {
      let body: UploadResponse | { error?: string } = {};
      try {
        body = JSON.parse(request.responseText) as UploadResponse | { error?: string };
      } catch {
        // The status-based error below is more useful than a JSON parse error.
      }
      if (request.status < 200 || request.status >= 300 || !("mediaId" in body)) {
        reject(new Error("error" in body && body.error ? body.error : "The server rejected the video upload."));
        return;
      }
      resolve(body.mediaId);
    };
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export async function analyzeOnServer(
  mediaId: string,
  metadata: VideoMetadata,
  settings: DetectionSettings,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const response = await fetch(`/api/media/${mediaId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata, settings }),
    signal,
  });
  const body = await response.json() as AnalysisResult | { error?: string };
  if (!response.ok || !("ranges" in body)) {
    throw new Error("error" in body && body.error ? body.error : "Server analysis failed.");
  }
  return body;
}

export async function exportOnServer(
  mediaId: string,
  ranges: KeepRange[],
  signal: AbortSignal,
  onProgress: ProgressCallback,
) {
  const responsePromise = fetch(`/api/media/${mediaId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ranges }),
    signal,
  });
  const poll = window.setInterval(() => {
    void fetch(`/api/media/${mediaId}/export`, {
      method: "GET",
      cache: "no-store",
      signal,
    }).then(async (progressResponse) => {
      if (!progressResponse.ok) return;
      const update = await progressResponse.json() as { progress: number; stage: string };
      onProgress(update.progress, update.stage);
    }).catch(() => undefined);
  }, 500);
  let response: Response;
  try {
    response = await responsePromise;
  } finally {
    window.clearInterval(poll);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; checkoutUrl?: string };
    if (response.status === 402 && body.checkoutUrl) {
      throw new PaymentRequiredError(body.checkoutUrl);
    }
    throw new Error(body.error || "Server export failed.");
  }
  onProgress(1, "Export ready");
  return response;
}

export async function createPreviewOnServer(mediaId: string, signal: AbortSignal) {
  const response = await fetch(`/api/media/${mediaId}/preview`, { method: "POST", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Server preview conversion failed.");
  }
  return response.blob();
}
