# DaddyCutter Web

A private video editor that uploads sources directly to private Vercel Blob storage, uses browser FFmpeg to detect silent gaps, lets you refine the keep ranges, and exports a precise MP4.

## Requirements

- Node.js 22+
- Current desktop Chrome or Edge
- H.264 or HEVC video with AAC audio in MP4/MOV, up to 1080p, 60 minutes, and 2 GB

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The landing page links to `/editor`.

Each signed-in Clerk account receives one free successful video export. Set
`DODO_PAYMENTS_CHECKOUT_URL` to your DodoPayments payment-link or checkout URL;
after the free export is used, later export attempts redirect there.

## Vercel Blob

Create a private Blob store under the Vercel project's **Storage** tab and
connect it to the project. Vercel supplies `BLOB_READ_WRITE_TOKEN`; redeploy
after connecting the store. Uploads use the authenticated
`/api/blob/upload` token endpoint and go directly from the browser to Blob
with multipart upload, avoiding the Vercel Function request-body limit.

## Checks

```bash
npm run lint
npm test
npm run build
```

Metadata and processing stay in the browser. The source uploads once to
private Blob storage and is deleted after a successful export. Abandoned
uploads should additionally be cleaned up with a scheduled retention job.
HEVC inputs play directly when the browser supports the actual file. On
unsupported devices, AutoCut creates a lightweight storyboard and lets the
user explicitly request a playable H.264 proxy. Final exports use browser
FFmpeg. Audio-only M4A/AAC files are not video-editor inputs.

## HEVC previews

When the browser cannot play HEVC directly, the editor creates five-second
H.264 preview chunks with browser FFmpeg. It prepares the first chunk before
opening the timeline, preloads upcoming chunks, and keeps a bounded cache
around the playhead. The original private Blob upload continues independently
and no database, queue, or long-running server function is required.
