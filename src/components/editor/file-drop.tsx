"use client";

import { useRef, useState } from "react";
import { Film, LockKeyhole, Upload } from "lucide-react";

type FileDropProps = { onFile: (file: File) => void; busy: boolean };

export function FileDrop({ onFile, busy }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <section className="empty-editor">
      <div
        className={`drop-card ${dragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files); }}
      >
        <div className="drop-icon"><Upload size={27} /></div>
        <h1>Drop a video to begin</h1>
        <p>We’ll find the silent gaps and build an editable timeline.</p>
        <button className="button button-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Film size={17} /> {busy ? "Reading video…" : "Choose MP4"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
          hidden
          onChange={(event) => accept(event.target.files)}
        />
        <div className="format-note">H.264 or HEVC + AAC · MP4/MOV · up to 1080p · 60 minutes · 2 GB</div>
      </div>
      <div className="local-banner"><LockKeyhole size={16} /><span><strong>Private temporary upload</strong>Your video uploads directly to private storage and is processed on your device.</span></div>
    </section>
  );
}
