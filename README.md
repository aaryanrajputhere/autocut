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

## Queued HEVC previews

HEVC uploads also create a queued 720p H.264 proxy job. Connect a Neon
Postgres integration so `DATABASE_URL` is available, and enable Vercel
Queues for the project. The upload completion callback publishes to
`video-preview-jobs`; the private queue consumer runs the bundled FFmpeg
binary and stores its result under `previews/<user>/<job>.mp4`.

The consumer is configured for a 30-minute, 4 GB function in `vercel.json`,
which requires a Pro or Enterprise project with the extended-duration beta.
The editor polls the job and switches to the authenticated private preview
route when it is ready. Browser-side five-second chunks remain the fallback.

The table is created lazily by the app. For explicit migrations, run
`db/preview-jobs.sql` against the connected Neon database.
