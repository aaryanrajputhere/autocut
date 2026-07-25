"use client";

import { Eye, EyeOff, Merge, RotateCcw, Trash2 } from "lucide-react";
import { useEditorStore } from "@/lib/editor-store";
import { detectKeepRanges } from "@/lib/detection";
import { formatTime, parseTime } from "@/lib/time";
import type { DetectionSettings } from "@/lib/types";

const settingsFields: { key: keyof DetectionSettings; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "silenceThresholdDb", label: "Silence threshold", min: -60, max: -15, step: 1, unit: "dB" },
  { key: "minimumSilenceMs", label: "Minimum silence", min: 100, max: 2000, step: 50, unit: "ms" },
  { key: "paddingBeforeMs", label: "Padding before", min: 0, max: 500, step: 10, unit: "ms" },
  { key: "paddingAfterMs", label: "Padding after", min: 0, max: 500, step: 10, unit: "ms" },
];

export function Inspector() {
  const ranges = useEditorStore((state) => state.ranges);
  const settings = useEditorStore((state) => state.settings);
  const loudness = useEditorStore((state) => state.loudness);
  const windowMs = useEditorStore((state) => state.windowMs);
  const metadata = useEditorStore((state) => state.metadata);
  const updateSettings = useEditorStore((state) => state.updateSettings);
  const replaceDetectedRanges = useEditorStore((state) => state.replaceDetectedRanges);
  const updateRange = useEditorStore((state) => state.updateRange);
  const toggleRange = useEditorStore((state) => state.toggleRange);
  const deleteRange = useEditorStore((state) => state.deleteRange);
  const mergeWithNext = useEditorStore((state) => state.mergeWithNext);
  const resetDetection = useEditorStore((state) => state.resetDetection);

  const applyDetection = () => {
    if (!metadata) return;
    replaceDetectedRanges(detectKeepRanges(loudness, windowMs, metadata.durationUs / 1e6, settings));
  };

  return (
    <aside className="inspector">
      <div className="inspector-section">
        <div className="section-title"><strong>Detection</strong><button className="bare-button" onClick={resetDetection}><RotateCcw size={13} /> Reset</button></div>
        {settingsFields.map((field) => (
          <label className="setting" key={field.key}>
            <span>{field.label}<output>{settings[field.key]} {field.unit}</output></span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={settings[field.key]}
              onChange={(event) => updateSettings({ [field.key]: Number(event.target.value) })}
              onPointerUp={applyDetection}
              onKeyUp={applyDetection}
            />
          </label>
        ))}
      </div>
      <div className="inspector-section cuts-section">
        <div className="section-title"><strong>Keep ranges</strong><span className="count-badge">{ranges.filter((range) => range.enabled).length}</span></div>
        <div className="cut-list">
          {ranges.map((range, index) => (
            <article className={`cut-row ${range.enabled ? "" : "is-disabled"}`} key={range.id}>
              <div className="cut-row-head">
                <span>Clip {String(index + 1).padStart(2, "0")}</span>
                <div>
                  <button aria-label={range.enabled ? "Disable range" : "Enable range"} onClick={() => toggleRange(range.id)}>{range.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                  <button aria-label="Merge with next range" disabled={index === ranges.length - 1} onClick={() => mergeWithNext(range.id)}><Merge size={14} /></button>
                  <button aria-label="Delete range" onClick={() => deleteRange(range.id)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="time-inputs">
                <label>IN<input defaultValue={formatTime(range.sourceStartUs)} onBlur={(event) => {
                  const value = parseTime(event.target.value);
                  if (value !== null) updateRange(range.id, { sourceStartUs: value });
                }} /></label>
                <span>→</span>
                <label>OUT<input defaultValue={formatTime(range.sourceEndUs)} onBlur={(event) => {
                  const value = parseTime(event.target.value);
                  if (value !== null) updateRange(range.id, { sourceEndUs: value });
                }} /></label>
              </div>
            </article>
          ))}
        </div>
      </div>
    </aside>
  );
}
