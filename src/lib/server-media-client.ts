"use client";

import type { PutBlobResult } from "@vercel/blob";
import { upload } from "@vercel/blob/client";
import type { AnalysisResult, DetectionSettings, KeepRange, VideoMetadata } from "./types";

type ProgressCallback = (progress: number, stage?: string) => void;

export class PaymentRequiredError extends Error {
  constructor(public readonly checkoutUrl: string) {
    super("Your free video has been used. Redirecting to payment.");
    this.name = "PaymentRequiredError";
  }
}

export function uploadMedia(
  file: File,
  userId: string,
  previewJobId: string | null,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<PutBlobResult> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  return upload(`videos/${userId}/${crypto.randomUUID()}-${safeName}`, file, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    multipart: true,
    contentType: file.type || "video/mp4",
    clientPayload: JSON.stringify({ previewJobId }),
    abortSignal: signal,
    onUploadProgress: ({ percentage }) => {
      onProgress(percentage / 100, "Uploading video securely");
    },
  });
}

export async function getPreviewJob(jobId: string, signal: AbortSignal) {
  const response = await fetch(`/api/preview-jobs/${jobId}`, { cache: "no-store", signal });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({})) as {
    status?: "queued" | "processing" | "ready" | "failed";
    error?: string | null;
    attempts?: number;
  };
  if (!response.ok || !body.status) throw new Error(body.error || "Could not check preview status.");
  return body;
}

export async function claimFreeExport(signal: AbortSignal) {
  return requestExportEntitlement("POST", signal);
}

export async function checkExportEntitlement(signal: AbortSignal) {
  return requestExportEntitlement("GET", signal);
}

async function requestExportEntitlement(method: "GET" | "POST", signal: AbortSignal) {
  const response = await fetch("/api/export-entitlement", { method, signal });
  const body = await response.json().catch(() => ({})) as { error?: string; checkoutUrl?: string };
  if (response.status === 402 && body.checkoutUrl) throw new PaymentRequiredError(body.checkoutUrl);
  if (!response.ok) throw new Error(body.error || "Could not verify export access.");
}

export async function deleteStoredMedia(pathname: string, previewJobId?: string | null) {
  const response = await fetch("/api/blob/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname, previewJobId }),
    keepalive: true,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "The exported video's temporary upload could not be deleted.");
  }
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
