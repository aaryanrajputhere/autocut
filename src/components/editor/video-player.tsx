"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Pause, Play, Scissors } from "lucide-react";
import { useEditorStore } from "@/lib/editor-store";
import type { PreviewChunk } from "@/lib/types";
import { formatTime, secondsToUs, usToSeconds } from "@/lib/time";

type VideoPlayerProps = {
  playable: boolean;
  chunks: PreviewChunk[];
  storyboardUrls: string[];
  creatingPreview: boolean;
  onCreatePreview: () => void;
  onRequestChunk: (timeSeconds: number) => void;
  onNativePlaybackFailure: () => void;
};

export function VideoPlayer({
  playable,
  chunks,
  storyboardUrls,
  creatingPreview,
  onCreatePreview,
  onRequestChunk,
  onNativePlaybackFailure,
}: VideoPlayerProps) {
  const originalRef = useRef<HTMLVideoElement>(null);
  const chunkRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const sourceUrl = useEditorStore((state) => state.sourceUrl);
  const ranges = useEditorStore((state) => state.ranges);
  const playheadUs = useEditorStore((state) => state.playheadUs);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const splitAt = useEditorStore((state) => state.splitAt);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const resumeWhenReady = useRef(false);
  const updatingFromVideoRef = useRef(false);
  const chunkMode = !playable;
  const keepRanges = useMemo(
    () => ranges.filter((range) => range.enabled).sort((a, b) => a.sourceStartUs - b.sourceStartUs),
    [ranges],
  );
  const readyChunks = useMemo(() => new Map(chunks.filter((chunk) => chunk.status === "ready").map((chunk) => [chunk.index, chunk])), [chunks]);
  const activeChunkIndex = Math.max(0, Math.floor(usToSeconds(playheadUs) / 5));
  const activeChunk = readyChunks.get(activeChunkIndex);
  const nextChunk = readyChunks.get(activeChunkIndex + 1);
  const activeVideo = () => chunkMode ? chunkRefs[activeSlot].current : originalRef.current;

  useEffect(() => {
    if (!chunkMode) return;
    onRequestChunk(usToSeconds(playheadUs));
    if (!activeChunk) {
      setBuffering(true);
      const video = chunkRefs[activeSlot].current;
      if (video && !video.paused) {
        resumeWhenReady.current = true;
        video.pause();
      }
      return;
    }
    const video = chunkRefs[activeSlot].current;
    if (!video) return;
    if (video.src !== activeChunk.blobUrl) video.src = activeChunk.blobUrl!;
    const localTime = usToSeconds(playheadUs) - activeChunk.sourceStart;
    if (Math.abs(video.currentTime - localTime) > 0.04) video.currentTime = Math.max(0, localTime);
    setBuffering(false);
    if (resumeWhenReady.current) {
      resumeWhenReady.current = false;
      void safePlay(video);
    }
    const preload = chunkRefs[activeSlot === 0 ? 1 : 0].current;
    if (preload && nextChunk?.blobUrl && preload.src !== nextChunk.blobUrl) {
      preload.src = nextChunk.blobUrl;
      preload.load();
    }
  }, [activeChunk, activeSlot, chunkMode, nextChunk, onRequestChunk, playheadUs]);

  useEffect(() => {
    const video = activeVideo();
    if (!video) return;
    let animationFrame = 0;
    const syncAndSkipCuts = () => {
      const currentUs = chunkMode && activeChunk
        ? secondsToUs(activeChunk.sourceStart + video.currentTime)
        : secondsToUs(video.currentTime);
      const target = snapToKeptTime(currentUs, keepRanges);
      if (target === null) {
        video.pause();
        return;
      }
      if (target !== currentUs) {
        updatingFromVideoRef.current = true;
        setPlayhead(target);
        return;
      }
      if (chunkMode && activeChunk && currentUs >= secondsToUs(activeChunk.sourceEnd) - 35_000) {
        const next = readyChunks.get(activeChunk.index + 1);
        if (!next) {
          resumeWhenReady.current = true;
          setBuffering(true);
          video.pause();
          onRequestChunk(activeChunk.sourceEnd);
          return;
        }
        const nextSlot = activeSlot === 0 ? 1 : 0;
        const nextVideo = chunkRefs[nextSlot].current;
        if (nextVideo) {
          nextVideo.currentTime = 0;
          setActiveSlot(nextSlot);
          updatingFromVideoRef.current = true;
          setPlayhead(secondsToUs(next.sourceStart));
          void safePlay(nextVideo);
          return;
        }
      }
      updatingFromVideoRef.current = true;
      setPlayhead(currentUs);
    };
    const monitor = () => {
      syncAndSkipCuts();
      if (!video.paused) animationFrame = requestAnimationFrame(monitor);
    };
    const onPlay = () => { setPlaying(true); animationFrame = requestAnimationFrame(monitor); };
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", syncAndSkipCuts);
    return () => {
      cancelAnimationFrame(animationFrame);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", syncAndSkipCuts);
    };
  // activeSlot intentionally rebinds listeners after a chunk swap.
  }, [activeChunk, activeSlot, chunkMode, keepRanges, onRequestChunk, readyChunks, setPlayhead]);

  useEffect(() => {
    if (updatingFromVideoRef.current) {
      updatingFromVideoRef.current = false;
      return;
    }
    const target = snapToKeptTime(playheadUs, keepRanges);
    if (target === null) return;
    if (target !== playheadUs) setPlayhead(target);
    if (chunkMode) onRequestChunk(usToSeconds(target));
    else if (originalRef.current && Math.abs(secondsToUs(originalRef.current.currentTime) - target) > 20_000) {
      originalRef.current.currentTime = usToSeconds(target);
    }
  }, [chunkMode, keepRanges, onRequestChunk, playheadUs, setPlayhead]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        const video = activeVideo();
        if (video) void togglePlayback(video, playheadUs, keepRanges, (target) => {
          setPlayhead(target);
          if (chunkMode) onRequestChunk(usToSeconds(target));
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSlot, chunkMode, keepRanges, onRequestChunk, playheadUs, setPlayhead]);

  const trimmedTimeUs = sourceToTrimmedTime(playheadUs, keepRanges);
  const trimmedDurationUs = keepRanges.reduce((total, range) => total + range.sourceEndUs - range.sourceStartUs, 0);
  const canPlay = playable || Boolean(activeChunk);

  return (
    <section className="player-panel">
      <div className="video-stage">
        {sourceUrl && playable && (
          <video
            ref={originalRef}
            src={sourceUrl}
            playsInline
            onError={onNativePlaybackFailure}
            onLoadedData={(event) => {
              if (!event.currentTarget.videoWidth || !event.currentTarget.videoHeight) {
                onNativePlaybackFailure();
              }
            }}
          />
        )}
        {chunkMode && <>
          <video ref={chunkRefs[0]} className={activeSlot === 0 ? "chunk-active" : "chunk-preload"} playsInline />
          <video ref={chunkRefs[1]} className={activeSlot === 1 ? "chunk-active" : "chunk-preload"} playsInline />
        </>}
        {buffering && <div className="chunk-buffering"><span className="spinner" /><strong>Preparing next 5 seconds…</strong></div>}
        {!playable && !activeChunk && storyboardUrls.length > 0 && (
          <div className="storyboard-preview">
            <div className="storyboard-grid" aria-label="Video storyboard">
              {storyboardUrls.map((url, index) => <Image key={url} src={url} alt={`Video preview frame ${index + 1}`} width={320} height={180} unoptimized />)}
            </div>
          </div>
        )}
      </div>
      <div className="transport">
        <button className="icon-button" disabled={!keepRanges.length || !canPlay} aria-label={playing ? "Pause" : "Play"} onClick={() => {
          const video = activeVideo();
          if (video) void togglePlayback(video, playheadUs, keepRanges, (target) => {
            setPlayhead(target);
            if (chunkMode) onRequestChunk(usToSeconds(target));
          });
        }}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <span className="timecode">{formatTime(trimmedTimeUs)} / {formatTime(trimmedDurationUs)}</span>
        <button className="tool-button" onClick={() => splitAt(playheadUs)}><Scissors size={15} /> Split at playhead</button>
        {chunkMode && <button className="tool-button" onClick={onCreatePreview} disabled={creatingPreview}><Film size={15} /> {creatingPreview ? "Building…" : "Build complete preview"}</button>}
      </div>
    </section>
  );
}

function snapToKeptTime(sourceUs: number, ranges: { sourceStartUs: number; sourceEndUs: number }[]) {
  if (!ranges.length) return null;
  const active = ranges.find((range) => sourceUs >= range.sourceStartUs && sourceUs < range.sourceEndUs);
  if (active) return sourceUs;
  return ranges.find((range) => range.sourceStartUs > sourceUs)?.sourceStartUs ?? ranges.at(-1)!.sourceEndUs;
}

function sourceToTrimmedTime(sourceUs: number, ranges: { sourceStartUs: number; sourceEndUs: number }[]) {
  let elapsed = 0;
  for (const range of ranges) {
    if (sourceUs < range.sourceStartUs) return elapsed;
    if (sourceUs < range.sourceEndUs) return elapsed + sourceUs - range.sourceStartUs;
    elapsed += range.sourceEndUs - range.sourceStartUs;
  }
  return elapsed;
}

async function safePlay(video: HTMLVideoElement) {
  try { await video.play(); } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  }
}

async function togglePlayback(
  video: HTMLVideoElement,
  playheadUs: number,
  ranges: { sourceStartUs: number; sourceEndUs: number }[],
  seek: (target: number) => void,
) {
  if (!video.paused) {
    video.pause();
    return;
  }
  const target = snapToKeptTime(playheadUs, ranges);
  if (target === null) return;
  const lastEnd = ranges.at(-1)?.sourceEndUs ?? 0;
  if (playheadUs >= lastEnd - 20_000) seek(ranges[0].sourceStartUs);
  else if (target !== playheadUs) seek(target);
  await safePlay(video);
}
