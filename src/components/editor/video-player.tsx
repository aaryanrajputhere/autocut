"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Pause, Play, Scissors } from "lucide-react";
import { useEditorStore } from "@/lib/editor-store";
import { formatTime, secondsToUs, usToSeconds } from "@/lib/time";

type VideoPlayerProps = {
  playable: boolean;
  storyboardUrls: string[];
  creatingPreview: boolean;
  onCreatePreview: () => void;
};

export function VideoPlayer({
  playable,
  storyboardUrls,
  creatingPreview,
  onCreatePreview,
}: VideoPlayerProps) {
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
        {sourceUrl && playable && <video ref={videoRef} src={sourceUrl} playsInline />}
        {!playable && storyboardUrls.length > 0 && (
          <div className="storyboard-preview">
            <div className="storyboard-grid" aria-label="Video storyboard">
              {storyboardUrls.map((url, index) => (
                <Image
                  key={url}
                  src={url}
                  alt={`Video preview frame ${index + 1}`}
                  width={320}
                  height={180}
                  unoptimized
                />
              ))}
            </div>
            <div className="storyboard-message">
              <strong>HEVC storyboard</strong>
              <span>Your browser cannot play this HEVC file directly.</span>
              <button className="button button-primary" onClick={onCreatePreview} disabled={creatingPreview}>
                <Film size={16} /> {creatingPreview ? "Creating preview…" : "Create playable preview"}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="transport">
        <button className="icon-button" disabled={!keepRanges.length || !playable} aria-label={playing ? "Pause" : "Play"} onClick={() => {
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
