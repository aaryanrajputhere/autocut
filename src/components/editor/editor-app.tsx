"use client";

import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton, useAuth, useClerk } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileVideo, Scissors, Undo2, Redo2, X } from "lucide-react";
import { FileDrop } from "./file-drop";
import { Inspector } from "./inspector";
import { Timeline } from "./timeline";
import { VideoPlayer } from "./video-player";
import { useEditorStore } from "@/lib/editor-store";
import { readMetadata } from "@/lib/media";
import {
  checkExportEntitlement,
  claimFreeExport,
  deleteStoredMedia,
  PaymentRequiredError,
  uploadMedia,
} from "@/lib/server-media-client";
import {
  analyzeWithFfmpeg,
  cancelFfmpeg,
  createHevcPreviewProxy,
  exportWithFfmpeg,
} from "@/lib/ffmpeg-engine";
import { saveProject, sourceFingerprint } from "@/lib/project-storage";
import { formatTime } from "@/lib/time";

export function EditorApp() {
  const { isSignedIn, userId } = useAuth();
  const { openSignIn } = useClerk();
  const processingAbortRef = useRef<AbortController | null>(null);
  const [blobPathname, setBlobPathname] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState("");
  const file = useEditorStore((state) => state.file);
  const metadata = useEditorStore((state) => state.metadata);
  const ranges = useEditorStore((state) => state.ranges);
  const settings = useEditorStore((state) => state.settings);
  const status = useEditorStore((state) => state.status);
  const progress = useEditorStore((state) => state.progress);
  const error = useEditorStore((state) => state.error);
  const past = useEditorStore((state) => state.past);
  const future = useEditorStore((state) => state.future);
  const sourceUrl = useEditorStore((state) => state.sourceUrl);
  const loadFile = useEditorStore((state) => state.loadFile);
  const setAnalysis = useEditorStore((state) => state.setAnalysis);
  const setSourceUrl = useEditorStore((state) => state.setSourceUrl);
  const setStatus = useEditorStore((state) => state.setStatus);
  const setError = useEditorStore((state) => state.setError);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => {
    if (!file || !metadata || !ranges.length || status !== "ready") return;
    const timeout = window.setTimeout(() => {
      void saveProject({
        id: sourceFingerprint(file),
        name: file.name,
        sourceFingerprint: sourceFingerprint(file),
        metadata,
        settings,
        ranges,
        updatedAt: Date.now(),
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [file, metadata, ranges, settings, status]);

  const analyze = async (nextFile: File, nextMetadata: NonNullable<typeof metadata>, abort: AbortController) => {
    setStatus("analyzing", 0);
    try {
      if (!userId) {
        openSignIn();
        setStatus("empty");
        return;
      }
      const blob = await uploadMedia(nextFile, userId, (value, stage) => {
        setProcessingStage(stage ?? "Uploading video");
        setStatus("analyzing", value * 0.45);
      }, abort.signal);
      setBlobPathname(blob.pathname);
      setProcessingStage("Analyzing audio on your device");
      const result = await analyzeWithFfmpeg(nextFile, nextMetadata, settings, (value, stage) => {
        setProcessingStage(stage ?? "Analyzing audio on your device");
        setStatus("analyzing", 0.45 + value * 0.55);
      });
      if (nextMetadata.videoCodec === "hevc" && !browserCanPlayHevc()) {
        const proxy = await createHevcPreviewProxy(nextFile, nextMetadata, (value, stage) => {
          setProcessingStage(stage ?? "Creating browser preview");
          setStatus("analyzing", value);
        });
        if (proxy) setSourceUrl(URL.createObjectURL(proxy));
      }
      setAnalysis(result);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setStatus("empty");
      else setError(cause instanceof Error ? cause.message : "The browser could not analyze this video.");
    }
  };

  const handleFile = async (nextFile: File) => {
    if (!userId) {
      openSignIn();
      return;
    }
    try {
      setStatus("analyzing", 0);
      const nextMetadata = await readMetadata(nextFile);
      const url = URL.createObjectURL(nextFile);
      loadFile(nextFile, url, nextMetadata);
      const abort = new AbortController();
      processingAbortRef.current = abort;
      await analyze(nextFile, nextMetadata, abort);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this video.");
    }
  };

  const handleExport = async () => {
    if (!file || !metadata) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    if (!blobPathname) {
      setError("The video upload is unavailable. Select the video again.");
      return;
    }
    const abort = new AbortController();
    processingAbortRef.current = abort;
    try {
      await checkExportEntitlement(abort.signal);
      setStatus("exporting", 0);
      setProcessingStage("Rendering MP4 on your device");
      setStatus("exporting", 0.02);
      const output = await exportWithFfmpeg({
        file,
        metadata,
        ranges,
        signal: abort.signal,
        onProgress: (value, stage) => {
          setProcessingStage(stage ?? "Rendering MP4 on your device");
          setStatus("exporting", value);
        },
      });
      await claimFreeExport(abort.signal);
      const handle = await maybeSaveWithPicker(`${file.name.replace(/\.[^.]+$/, "")}-autocut.mp4`);
      if (handle) {
        const writable = await handle.createWritable();
        await output.stream().pipeTo(writable);
      } else {
        const url = URL.createObjectURL(output);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${file.name.replace(/\.[^.]+$/, "")}-autocut.mp4`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      void deleteStoredMedia(blobPathname);
      setStatus("ready", 1);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setStatus("ready");
      else if (cause instanceof PaymentRequiredError) window.location.assign(cause.checkoutUrl);
      else setError(cause instanceof Error ? cause.message : "Export failed.");
    }
  };

  const exportReady = Boolean(blobPathname);
  const keptDuration = ranges.filter((range) => range.enabled).reduce((sum, range) => sum + range.sourceEndUs - range.sourceStartUs, 0);

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <Link href="/" className="brand"><span className="brand-mark"><Scissors size={17} /></span>autocut</Link>
        <div className="header-center">
          {file && <><FileVideo size={15} /><span>{file.name}</span><small>{metadata ? formatBytes(metadata.size) : ""}</small></>}
        </div>
        <div className="header-actions">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="button button-ghost auth-compact">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="button button-primary auth-compact">Sign up</button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
          <button className="icon-button" aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={17} /></button>
          <button className="icon-button" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
          {file && <button className="button button-primary export-button" onClick={() => void handleExport()} disabled={!exportReady || status !== "ready" || !ranges.some((range) => range.enabled)}>
            <Download size={16} /> Export MP4
          </button>}
        </div>
      </header>

      <div className="compatibility-note"><Check /><div><strong>Private multipart upload</strong><span>Your source is stored privately while browser FFmpeg analyzes and exports it.</span></div></div>
      {!file ? <FileDrop onFile={(selected) => void handleFile(selected)} busy={status === "analyzing"} /> : (
        <div className="workspace">
          <div className="workspace-main">
            <VideoPlayer />
            <Timeline />
            <footer className="status-bar">
              <span><Check size={13} /> Local project</span>
              <span>{ranges.filter((range) => range.enabled).length} clips · {formatTime(keptDuration, false)} output</span>
              <span>H.264 · {metadata?.width}×{metadata?.height}</span>
            </footer>
          </div>
          <Inspector />
        </div>
      )}

      {(status === "analyzing" || status === "exporting") && (
        <div className="progress-overlay" role="status" aria-live="polite">
          <div className="progress-card">
            <div className="spinner" />
            <strong>{processingStage || (status === "analyzing" ? "Listening for silent gaps…" : "Rendering your clean cut…")}</strong>
            <p>{status === "analyzing" ? "Your video uploads directly to private Blob storage, then browser FFmpeg analyzes it." : "Browser FFmpeg is encoding H.264 and AAC on your device."}</p>
            <div className="progress-track"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <span>{Math.round(progress * 100)}%</span>
            <button className="button button-ghost" onClick={() => {
              processingAbortRef.current?.abort();
              cancelFfmpeg();
              setStatus(file ? "ready" : "empty");
            }}><X size={15} /> Cancel</button>
          </div>
        </div>
      )}
      {error && (
        <div className="toast error-toast" role="alert"><AlertTriangle size={18} /><div><strong>Something went wrong</strong><span>{error}</span></div><button aria-label="Dismiss error" onClick={() => setStatus(file ? "ready" : "empty")}><X size={16} /></button></div>
      )}
    </main>
  );
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

async function maybeSaveWithPicker(name: string) {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!picker) return null;
  return picker({
    suggestedName: name,
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function browserCanPlayHevc() {
  const video = document.createElement("video");
  return Boolean(
    video.canPlayType('video/mp4; codecs="hvc1"') ||
    video.canPlayType('video/mp4; codecs="hev1"'),
  );
}
