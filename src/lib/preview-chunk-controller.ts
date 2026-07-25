"use client";

import { generatePreviewChunk } from "./ffmpeg-engine";
import type { PreviewChunk } from "./types";

export const PREVIEW_CHUNK_SECONDS = 5;
export const PREVIEW_CACHE_CHUNKS = 12;

type Listener = (chunks: PreviewChunk[]) => void;

export class PreviewChunkController {
  private chunks = new Map<number, PreviewChunk>();
  private queue: number[] = [];
  private listeners = new Set<Listener>();
  private running = false;
  private cancelled = false;
  private playheadIndex = 0;

  constructor(
    private readonly file: File,
    private readonly durationSeconds: number,
  ) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return [...this.chunks.values()].sort((a, b) => a.index - b.index);
  }

  requestAt(timeSeconds: number, onProgress: (progress: number, stage?: string) => void = () => undefined) {
    const index = this.indexAt(timeSeconds);
    this.playheadIndex = index;
    this.enqueue(index, true);
    this.enqueueForward(index);
    this.evict();
    void this.drain(onProgress);
    return index;
  }

  async prepareFirst(onProgress: (progress: number, stage?: string) => void) {
    this.requestAt(0, onProgress);
    while (!this.cancelled) {
      const chunk = this.chunks.get(0);
      if (chunk?.status === "ready") return chunk;
      if (chunk?.status === "failed") throw new Error(chunk.error ?? "The first preview chunk failed.");
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    throw new DOMException("Preview generation was cancelled.", "AbortError");
  }

  cancel() {
    this.cancelled = true;
    this.queue = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.blobUrl) URL.revokeObjectURL(chunk.blobUrl);
    }
    this.chunks.clear();
    this.emit();
  }

  private indexAt(timeSeconds: number) {
    const max = Math.max(0, Math.ceil(this.durationSeconds / PREVIEW_CHUNK_SECONDS) - 1);
    return Math.min(max, Math.max(0, Math.floor(timeSeconds / PREVIEW_CHUNK_SECONDS)));
  }

  private enqueue(index: number, priority = false) {
    const start = index * PREVIEW_CHUNK_SECONDS;
    if (start >= this.durationSeconds) return;
    const existing = this.chunks.get(index);
    if (existing?.status === "ready" || existing?.status === "processing") return;
    this.chunks.set(index, {
      index,
      sourceStart: start,
      sourceEnd: Math.min(start + PREVIEW_CHUNK_SECONDS, this.durationSeconds),
      status: "queued",
    });
    this.queue = this.queue.filter((item) => item !== index);
    priority ? this.queue.unshift(index) : this.queue.push(index);
    this.emit();
  }

  private enqueueForward(index: number) {
    for (let offset = 1; offset < PREVIEW_CACHE_CHUNKS; offset += 1) this.enqueue(index + offset);
  }

  private async drain(onProgress: (progress: number, stage?: string) => void) {
    if (this.running || this.cancelled) return;
    this.running = true;
    try {
      while (this.queue.length && !this.cancelled) {
        const index = this.queue.shift()!;
        const chunk = this.chunks.get(index);
        if (!chunk || chunk.status !== "queued") continue;
        this.chunks.set(index, { ...chunk, status: "processing", error: undefined });
        this.emit();
        try {
          const blob = await generatePreviewChunk(
            this.file,
            chunk.sourceStart,
            chunk.sourceEnd - chunk.sourceStart,
            onProgress,
          );
          if (this.cancelled) break;
          this.chunks.set(index, { ...chunk, status: "ready", blobUrl: URL.createObjectURL(blob) });
        } catch (cause) {
          if (this.cancelled) break;
          this.chunks.set(index, {
            ...chunk,
            status: "failed",
            error: cause instanceof Error ? cause.message : "Preview encoding failed.",
          });
        }
        this.evict();
        this.emit();
      }
    } finally {
      this.running = false;
    }
  }

  private evict() {
    const ready = [...this.chunks.values()]
      .filter((chunk) => chunk.status === "ready")
      .sort((a, b) => Math.abs(a.index - this.playheadIndex) - Math.abs(b.index - this.playheadIndex));
    for (const chunk of ready.slice(PREVIEW_CACHE_CHUNKS)) {
      if (chunk.blobUrl) URL.revokeObjectURL(chunk.blobUrl);
      this.chunks.delete(chunk.index);
    }
  }

  private emit() {
    const value = this.snapshot();
    this.listeners.forEach((listener) => listener(value));
  }
}
