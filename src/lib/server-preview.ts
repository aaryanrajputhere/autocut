import "server-only";

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { get, put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import type { PreviewJob } from "./preview-jobs";

export async function transcodePreview(job: PreviewJob) {
  const directory = join(tmpdir(), "autocut-preview", job.id);
  const input = join(directory, "source.media");
  const output = join(directory, "preview.mp4");
  await mkdir(directory, { recursive: true });

  try {
    const source = await get(job.sourceUrl, { access: "private", useCache: false });
    if (!source || source.statusCode !== 200) throw new Error("The source video is no longer available.");
    await pipeline(
      Readable.fromWeb(source.stream as import("node:stream/web").ReadableStream<Uint8Array>),
      createWriteStream(input),
    );

    await runFfmpeg(input, output);
    const info = await stat(output);
    if (!info.size) throw new Error("FFmpeg created an empty preview.");

    const previewPathname = `previews/${job.userId}/${job.id}.mp4`;
    const blob = await put(previewPathname, createReadStream(output), {
      access: "private",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    });
    return { pathname: blob.pathname, url: blob.url };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runFfmpeg(input: string, output: string) {
  const binary = process.env.FFMPEG_PATH || ffmpegPath;
  if (!binary) throw new Error("The FFmpeg binary is unavailable.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, [
      "-hide_banner", "-y", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale=w='min(1280,iw)':h=-2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      output,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      log = `${log}${chunk}`.slice(-16_000);
    });
    child.once("error", (error) => reject(new Error(`Could not start FFmpeg: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(lastFfmpegMessage(log) || `FFmpeg exited with code ${code}.`));
    });
  });
}

function lastFfmpegMessage(log: string) {
  return log.split(/\r?\n|\r/).reverse().find((line) => /error|invalid|failed|unsupported/i.test(line))?.trim();
}
