"use client";

import { create } from "zustand";
import { normalizeRanges } from "./detection";
import { DEFAULT_SETTINGS, type AnalysisResult, type DetectionSettings, type KeepRange, type VideoMetadata } from "./types";

type Snapshot = { ranges: KeepRange[]; settings: DetectionSettings };

type EditorState = {
  file: File | null;
  sourceUrl: string | null;
  metadata: VideoMetadata | null;
  waveform: number[];
  loudness: number[];
  windowMs: number;
  ranges: KeepRange[];
  detectedRanges: KeepRange[];
  settings: DetectionSettings;
  playheadUs: number;
  selectedRangeId: string | null;
  status: "empty" | "ready" | "analyzing" | "exporting" | "error";
  progress: number;
  error: string | null;
  past: Snapshot[];
  future: Snapshot[];
  loadFile: (file: File, url: string, metadata: VideoMetadata) => void;
  setAnalysis: (result: AnalysisResult) => void;
  setStatus: (status: EditorState["status"], progress?: number) => void;
  setError: (error: string) => void;
  setPlayhead: (us: number) => void;
  setSourceUrl: (url: string) => void;
  selectRange: (id: string | null) => void;
  updateRange: (id: string, patch: Partial<KeepRange>) => void;
  toggleRange: (id: string) => void;
  deleteRange: (id: string) => void;
  splitAt: (us: number) => void;
  mergeWithNext: (id: string) => void;
  updateSettings: (patch: Partial<DetectionSettings>) => void;
  replaceDetectedRanges: (ranges: KeepRange[]) => void;
  resetDetection: () => void;
  undo: () => void;
  redo: () => void;
};

const snapshot = (state: EditorState): Snapshot => ({
  ranges: structuredClone(state.ranges),
  settings: { ...state.settings },
});

const mutate = (state: EditorState, ranges: KeepRange[]) => ({
  ranges: normalizeRanges(ranges, state.metadata?.durationUs ?? Number.MAX_SAFE_INTEGER),
  past: [...state.past.slice(-49), snapshot(state)],
  future: [],
});

export const useEditorStore = create<EditorState>((set) => ({
  file: null,
  sourceUrl: null,
  metadata: null,
  waveform: [],
  loudness: [],
  windowMs: 20,
  ranges: [],
  detectedRanges: [],
  settings: DEFAULT_SETTINGS,
  playheadUs: 0,
  selectedRangeId: null,
  status: "empty",
  progress: 0,
  error: null,
  past: [],
  future: [],
  loadFile: (file, sourceUrl, metadata) => set({
    file, sourceUrl, metadata, status: "ready", error: null, ranges: [],
    detectedRanges: [], waveform: [], loudness: [], playheadUs: 0, past: [], future: [],
  }),
  setAnalysis: (result) => set({
    ...result, ranges: result.ranges, detectedRanges: structuredClone(result.ranges),
    status: "ready", progress: 1, error: null, past: [], future: [],
  }),
  setStatus: (status, progress = 0) => set({ status, progress, error: null }),
  setError: (error) => set({ status: "error", error, progress: 0 }),
  setPlayhead: (playheadUs) => set({ playheadUs }),
  setSourceUrl: (sourceUrl) => set({ sourceUrl }),
  selectRange: (selectedRangeId) => set({ selectedRangeId }),
  updateRange: (id, patch) => set((state) => mutate(state, state.ranges.map((range) => range.id === id ? { ...range, ...patch } : range))),
  toggleRange: (id) => set((state) => mutate(state, state.ranges.map((range) => range.id === id ? { ...range, enabled: !range.enabled } : range))),
  deleteRange: (id) => set((state) => ({ ...mutate(state, state.ranges.filter((range) => range.id !== id)), selectedRangeId: null })),
  splitAt: (us) => set((state) => {
    const range = state.ranges.find((item) => item.enabled && us > item.sourceStartUs && us < item.sourceEndUs);
    if (!range || us - range.sourceStartUs < 50_000 || range.sourceEndUs - us < 50_000) return {};
    return mutate(state, state.ranges.flatMap((item) => item.id !== range.id ? [item] : [
      { ...item, sourceEndUs: us },
      { ...item, id: crypto.randomUUID(), sourceStartUs: us },
    ]));
  }),
  mergeWithNext: (id) => set((state) => {
    const index = state.ranges.findIndex((range) => range.id === id);
    if (index < 0 || index === state.ranges.length - 1) return {};
    const current = state.ranges[index];
    const next = state.ranges[index + 1];
    return mutate(state, state.ranges.toSpliced(index, 2, { ...current, sourceEndUs: next.sourceEndUs }));
  }),
  updateSettings: (patch) => set((state) => ({
    settings: { ...state.settings, ...patch },
    past: [...state.past.slice(-49), snapshot(state)],
    future: [],
  })),
  replaceDetectedRanges: (ranges) => set((state) => mutate(state, ranges)),
  resetDetection: () => set((state) => mutate(state, structuredClone(state.detectedRanges))),
  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return {};
    return {
      ...previous,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, 50),
    };
  }),
  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return {};
    return {
      ...next,
      past: [...state.past, snapshot(state)].slice(-50),
      future: state.future.slice(1),
    };
  }),
}));
