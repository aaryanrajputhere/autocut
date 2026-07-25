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
import { browserMemoryWarning, canPlayVideoFile, readMetadata } from "@/lib/media";
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
  createHevcStoryboard,
  exportWithFfmpeg,
} from "@/lib/ffmpeg-engine";
import { PreviewChunkController } from "@/lib/preview-chunk-controller";
import type { PreviewChunk } from "@/lib/types";
import { saveProject, sourceFingerprint } from "@/lib/project-storage";
import { formatTime } from "@/lib/time";

export function EditorApp() {
  const { isSignedIn, userId } = useAuth();
  const { openSignIn } = useClerk();
  const processingAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const chunkControllerRef = useRef<PreviewChunkController | null>(null);
  const [blobPathname, setBlobPathname] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "ready" | "failed">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [processingStage, setProcessingStage] = useState("");
  const [videoPlayable, setVideoPlayable] = useState(true);
  const [storyboardUrls, setStoryboardUrls] = useState<string[]>([]);
  const [creatingPreview, setCreatingPreview] = useState(false);
  const [previewChunks, setPreviewChunks] = useState<PreviewChunk[]>([]);
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
  useEffect(() => () => {
    storyboardUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [storyboardUrls]);
  useEffect(() => () => chunkControllerRef.current?.cancel(), []);
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

  const startUpload = (nextFile: File, nextUserId: string) => {
    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadError("");
    void uploadMedia(nextFile, nextUserId, (value) => {
      setUploadProgress(value);
    }, abort.signal).then((blob) => {
      setBlobPathname(blob.pathname);
      setUploadProgress(1);
      setUploadStatus("ready");
    }).catch((cause) => {
      if (abort.signal.aborted) {
        setUploadError("Upload cancelled. Retry before exporting.");
      } else {
        setUploadError(cause instanceof Error ? cause.message : "Private upload failed.");
      }
      setUploadStatus("failed");
    });
  };

  const analyze = async (nextFile: File, nextMetadata: NonNullable<typeof metadata>, abort: AbortController, nativePlayable: boolean) => {
    setStatus("analyzing", 0);
    try {
      if (!nativePlayable) {
        const controller = new PreviewChunkController(nextFile, nextMetadata.durationUs / 1e6);
        chunkControllerRef.current?.cancel();
        chunkControllerRef.current = controller;
        controller.subscribe(setPreviewChunks);
        await controller.prepareFirst((value, stage) => {
          setProcessingStage(stage ?? "Preparing the first 5 seconds");
          setStatus("analyzing", value);
        });
      }
      setStatus("ready", 1);
      setProcessingStage("Analyzing audio on your device");
      const result = await analyzeWithFfmpeg(nextFile, nextMetadata, settings, (value, stage) => {
        setProcessingStage(stage ?? "Analyzing audio on your device");
      });
      if (abort.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setAnalysis(result);
      if (!nativePlayable) chunkControllerRef.current?.requestAt(0);
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) setStatus("empty");
      else if (!nativePlayable) {
        try {
          const frames = await createHevcStoryboard(nextFile, nextMetadata, () => undefined);
          setStoryboardUrls(frames.map((frame) => URL.createObjectURL(frame)));
        } catch { /* The original error is more useful. */ }
        setError(cause instanceof Error ? cause.message : "The browser could not prepare this video.");
      } else setError(cause instanceof Error ? cause.message : "The browser could not analyze this video.");
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
      const warning = browserMemoryWarning(nextFile, nextMetadata);
      if (warning && !window.confirm(`${warning}\n\nContinue anyway?`)) {
        setStatus("empty");
        return;
      }
      setStoryboardUrls([]);
      setPreviewChunks([]);
      setBlobPathname(null);
      const nativePlayable = nextMetadata.videoCodec !== "hevc" || await canPlayVideoFile(nextFile);
      setVideoPlayable(nativePlayable);
      const url = URL.createObjectURL(nextFile);
      loadFile(nextFile, url, nextMetadata);
      const abort = new AbortController();
      processingAbortRef.current = abort;
      startUpload(nextFile, userId);
      await analyze(nextFile, nextMetadata, abort, nativePlayable);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this video.");
    }
  };

  const handleCreatePreview = async () => {
    if (!file || !metadata || creatingPreview) return;
    const abort = new AbortController();
    processingAbortRef.current = abort;
    setCreatingPreview(true);
    setStatus("analyzing", 0);
    try {
      const proxy = await createHevcPreviewProxy(file, metadata, (value, stage) => {
        setProcessingStage(stage ?? "Creating H.264 preview");
        setStatus("analyzing", value);
      });
      if (proxy) {
        chunkControllerRef.current?.cancel();
        chunkControllerRef.current = null;
        setPreviewChunks([]);
        setSourceUrl(URL.createObjectURL(proxy));
        setVideoPlayable(true);
      }
      setStatus("ready", 1);
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) setStatus("ready");
      else setError(cause instanceof Error ? cause.message : "Could not create a playable preview.");
    } finally {
      setCreatingPreview(false);
    }
  };

  const handleNativePlaybackFailure = () => {
    if (!file || !metadata || metadata.videoCodec !== "hevc" || chunkControllerRef.current) return;
    const controller = new PreviewChunkController(file, metadata.durationUs / 1e6);
    chunkControllerRef.current = controller;
    controller.subscribe(setPreviewChunks);
    setVideoPlayable(false);
    controller.requestAt(useEditorStore.getState().playheadUs / 1e6);
  };

  const handleExport = async () => {
    if (!file || !metadata) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    const abort = new AbortController();
    processingAbortRef.current = abort;
    try {
      await checkExportEntitlement(abort.signal);
      if (!blobPathname) {
        setError("The video upload is unavailable. Select the video again.");
        return;
      }
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
      const handle = await maybeSaveWithPicker(`${file.name.replace(/\.[^.]+$/, "")}-daddycutter.mp4`);
      if (handle) {
        const writable = await handle.createWritable();
        await output.stream().pipeTo(writable);
      } else {
        const url = URL.createObjectURL(output);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${file.name.replace(/\.[^.]+$/, "")}-daddycutter.mp4`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      await deleteStoredMedia(blobPathname);
      setBlobPathname(null);
      setUploadStatus("idle");
      setProcessingStage("Private source deleted");
      setStatus("ready", 1);
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) setStatus("ready");
      else if (cause instanceof PaymentRequiredError) window.location.assign(cause.checkoutUrl);
      else setError(cause instanceof Error ? cause.message : "Export failed.");
    }
  };

  const exportReady = Boolean(file && metadata && uploadStatus === "ready");
  const keptDuration = ranges.filter((range) => range.enabled).reduce((sum, range) => sum + range.sourceEndUs - range.sourceStartUs, 0);

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <Link href="/" className="brand"><span className="brand-mark"><Scissors size={17} /></span>DaddyCutter</Link>
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

      <div className="compatibility-note">
        {uploadStatus === "failed" ? <AlertTriangle /> : <Check />}
        <div>
          <strong>Private upload: {uploadStatus === "uploading" ? `${Math.round(uploadProgress * 100)}%` : uploadStatus}</strong>
          <span>{uploadStatus === "failed" ? uploadError : "Local editing runs independently; export unlocks after upload completes."}</span>
        </div>
        {uploadStatus === "failed" && file && userId && <button className="button button-ghost" onClick={() => startUpload(file, userId)}>Retry upload</button>}
        {uploadStatus === "uploading" && <button className="button button-ghost" onClick={() => uploadAbortRef.current?.abort()}>Cancel upload</button>}
      </div>
      {!file ? <FileDrop onFile={(selected) => void handleFile(selected)} busy={status === "analyzing"} /> : (
        <div className="workspace">
          <div className="workspace-main">
            <VideoPlayer
              playable={videoPlayable}
              chunks={previewChunks}
              storyboardUrls={storyboardUrls}
              creatingPreview={creatingPreview}
              onCreatePreview={() => void handleCreatePreview()}
              onRequestChunk={(seconds) => chunkControllerRef.current?.requestAt(seconds)}
              onNativePlaybackFailure={handleNativePlaybackFailure}
            />
            <Timeline />
            <footer className="status-bar">
              <span><Check size={13} /> Local project</span>
              <span>{ranges.filter((range) => range.enabled).length} clips · {formatTime(keptDuration, false)} output</span>
              <span>{metadata?.videoCodec === "hevc" ? "HEVC" : "H.264"} · {metadata?.width}×{metadata?.height}</span>
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
            <p>{status === "analyzing" ? "Preparing local playback. The private upload continues independently." : "Browser FFmpeg is encoding H.264 and AAC on your device."}</p>
            <div className="progress-track"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <span>{Math.round(progress * 100)}%</span>
            <button className="button button-ghost" onClick={() => {
              processingAbortRef.current?.abort();
              chunkControllerRef.current?.cancel();
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
