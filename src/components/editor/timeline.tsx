"use client";

import { useRef, type PointerEvent } from "react";
import { useEditorStore } from "@/lib/editor-store";
import { formatTime } from "@/lib/time";

export function Timeline() {
  const ref = useRef<HTMLDivElement>(null);
  const metadata = useEditorStore((state) => state.metadata);
  const waveform = useEditorStore((state) => state.waveform);
  const ranges = useEditorStore((state) => state.ranges);
  const playheadUs = useEditorStore((state) => state.playheadUs);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const selectRange = useEditorStore((state) => state.selectRange);
  const updateRange = useEditorStore((state) => state.updateRange);
  if (!metadata) return null;
  const duration = metadata.durationUs;

  const pointerUs = (event: PointerEvent) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration);
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string, edge: "start" | "end") => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      const us = Math.round(Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width)) * duration);
      updateRange(id, edge === "start" ? { sourceStartUs: us } : { sourceEndUs: us });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-heading"><strong>Timeline · trimmed preview</strong><span>{formatTime(duration, false)}</span></div>
      <div className="timeline-ruler">
        {[0, .25, .5, .75, 1].map((part) => <span key={part} style={{ left: `${part * 100}%` }}>{formatTime(duration * part, false)}</span>)}
      </div>
      <div
        ref={ref}
        className="timeline"
        role="slider"
        tabIndex={0}
        aria-label="Video timeline playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(playheadUs / 1000)}
        onPointerDown={(event) => setPlayhead(pointerUs(event))}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 5_000_000 : 100_000;
          if (event.key === "ArrowLeft") { event.preventDefault(); setPlayhead(Math.max(0, playheadUs - step)); }
          if (event.key === "ArrowRight") { event.preventDefault(); setPlayhead(Math.min(duration, playheadUs + step)); }
        }}
      >
        <div className="waveform" aria-hidden="true">
          {waveform.map((height, index) => <i key={index} style={{ height: `${height * 100}%` }} />)}
        </div>
        {ranges.map((range) => (
          <div
            key={range.id}
            className={`range-overlay ${range.enabled ? "kept" : "disabled"}`}
            style={{
              left: `${range.sourceStartUs / duration * 100}%`,
              width: `${(range.sourceEndUs - range.sourceStartUs) / duration * 100}%`,
            }}
            onPointerDown={(event) => { event.stopPropagation(); selectRange(range.id); }}
          >
            <button aria-label="Adjust range start" className="range-handle start" onPointerDown={(event) => startDrag(event, range.id, "start")} />
            <button aria-label="Adjust range end" className="range-handle end" onPointerDown={(event) => startDrag(event, range.id, "end")} />
          </div>
        ))}
        <div className="playhead" style={{ left: `${playheadUs / duration * 100}%` }}><span /></div>
      </div>
      <div className="timeline-legend"><span><i className="dot kept" />Kept</span><span><i className="dot removed" />Removed</span><span>Drag handles to refine cuts</span></div>
    </section>
  );
}
