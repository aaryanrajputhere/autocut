import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewChunkController } from "./preview-chunk-controller";

describe("PreviewChunkController", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => `blob:test-${blob.size}-${Math.random()}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes the first five seconds before prepareFirst resolves", async () => {
    const encode = vi.fn(async (_file: File, start: number, duration: number) => {
      expect(start).toBe(0);
      expect(duration).toBe(5);
      return new Blob(["preview"], { type: "video/mp4" });
    });
    const controller = new PreviewChunkController(videoFile(), 12, encode);

    const first = await controller.prepareFirst(() => undefined);

    expect(first).toMatchObject({
      index: 0,
      sourceStart: 0,
      sourceEnd: 5,
      status: "ready",
    });
    expect(first.blobUrl).toMatch(/^blob:test-/);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toHaveLength(1);
    controller.cancel();
  });

  it("prioritizes a sought chunk and queues chunks ahead of the playhead", async () => {
    const starts: number[] = [];
    const encode = vi.fn(async (_file: File, start: number) => {
      starts.push(start);
      return new Blob([String(start)], { type: "video/mp4" });
    });
    const controller = new PreviewChunkController(videoFile(), 90, encode);

    const index = controller.requestAt(31);
    await waitFor(() => controller.snapshot().some((chunk) => chunk.index === index && chunk.status === "ready"));

    expect(index).toBe(6);
    expect(starts[0]).toBe(30);
    expect(controller.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 6, sourceStart: 30, status: "ready" }),
      expect.objectContaining({ index: 7, sourceStart: 35 }),
    ]));
    controller.cancel();
  });
});

function videoFile() {
  return new File(["video"], "source.mov", { type: "video/quicktime" });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for preview chunk.");
}
