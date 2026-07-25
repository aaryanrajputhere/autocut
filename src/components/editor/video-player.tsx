"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors } from "lucide-react";
import { useEditorStore } from "@/lib/editor-store";
import { formatTime, secondsToUs, usToSeconds } from "@/lib/time";

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceUrl = useEditorStore((state) => state.sourceUrl);
  const ranges = useEditorStore((state) => state.ranges);
  const playheadUs = useEditorStore((state) => state.playheadUs);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const splitAt = useEditorStore((state) => state.splitAt);
  const [playing, setPlaying] = useState(false);
  const updatingFromVideoRef = useRef(false);
  const keepRanges = useMemo(
    () => ranges.filter((range) => range.enabled).sort((a, b) => a.sourceStartUs - b.sourceStartUs),
    [ranges],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let animationFrame = 0;

    const syncAndSkipCuts = () => {
      const currentUs = secondsToUs(video.currentTime);
      const active = keepRanges.find((range) => currentUs >= range.sourceStartUs && currentUs < range.sourceEndUs);
      if (!active) {
        const next = keepRanges.find((range) => range.sourceStartUs > currentUs);
        if (next) {
          video.currentTime = usToSeconds(next.sourceStartUs);
          updatingFromVideoRef.current = true;
          setPlayhead(next.sourceStartUs);
        } else {
          video.pause();
          const end = keepRanges.at(-1)?.sourceEndUs;
          if (end !== undefined) {
            video.currentTime = usToSeconds(end);
            updatingFromVideoRef.current = true;
            setPlayhead(end);
          }
        }
        return;
      }
      updatingFromVideoRef.current = true;
      setPlayhead(currentUs);
    };

    const monitorPlayback = () => {
      syncAndSkipCuts();
      if (!video.paused) animationFrame = requestAnimationFrame(monitorPlayback);
    };
    const onPlay = () => {
      setPlaying(true);
      syncAndSkipCuts();
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(monitorPlayback);
    };
    const onPause = () => setPlaying(false);
    const onTime = () => syncAndSkipCuts();
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(animationFrame);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [keepRanges, setPlayhead]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (updatingFromVideoRef.current) {
      updatingFromVideoRef.current = false;
      return;
    }
    const target = snapToKeptTime(playheadUs, keepRanges);
    if (target === null) {
      video.pause();
      return;
    }
    if (Math.abs(secondsToUs(video.currentTime) - target) > 20_000) {
      video.currentTime = usToSeconds(target);
    }
    if (target !== playheadUs) {
      updatingFromVideoRef.current = true;
      setPlayhead(target);
    }
  }, [keepRanges, playheadUs, setPlayhead]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        const video = videoRef.current;
        if (video) void togglePlayback(video, keepRanges);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keepRanges]);

  const trimmedTimeUs = sourceToTrimmedTime(playheadUs, keepRanges);
  const trimmedDurationUs = keepRanges.reduce(
    (total, range) => total + range.sourceEndUs - range.sourceStartUs,
    0,
  );

  return (
    <section className="player-panel">
      <div className="video-stage">
        {sourceUrl && <video ref={videoRef} src={sourceUrl} playsInline />}
      </div>
      <div className="transport">
        <button className="icon-button" disabled={!keepRanges.length} aria-label={playing ? "Pause" : "Play"} onClick={() => {
          const video = videoRef.current;
          if (video) void togglePlayback(video, keepRanges);
        }}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <span className="timecode" title="Trimmed preview time">
          {formatTime(trimmedTimeUs)} / {formatTime(trimmedDurationUs)}
        </span>
        <button className="tool-button" onClick={() => splitAt(playheadUs)}><Scissors size={15} /> Split at playhead</button>
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

async function togglePlayback(
  video: HTMLVideoElement,
  ranges: { sourceStartUs: number; sourceEndUs: number }[],
) {
  if (!video.paused) {
    video.pause();
    return;
  }
  const currentUs = secondsToUs(video.currentTime);
  const target = snapToKeptTime(currentUs, ranges);
  if (target === null) return;
  const lastEnd = ranges.at(-1)?.sourceEndUs ?? 0;
  video.currentTime = usToSeconds(currentUs >= lastEnd - 20_000 ? ranges[0].sourceStartUs : target);
  try {
    await video.play();
  } catch (error) {
    // A cut boundary can intentionally pause or seek while play() is still
    // settling. Browsers reject that superseded request with AbortError.
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  }
}
