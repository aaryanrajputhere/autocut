# AutoCut Web

A private video editor that uses native server-side FFmpeg to detect silent gaps, lets you refine the keep ranges, previews the edited timeline, and exports a precise MP4.

## Requirements

- Node.js 22+
- Native `ffmpeg` available on `PATH` (or set `FFMPEG_PATH`)
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

## Checks

```bash
npm run lint
npm test
npm run build
```

Metadata and preview stay in the browser. The source uploads once to temporary server storage; native FFmpeg performs analysis and export, and uploads expire after six hours.

Run this app on a persistent Node/Docker host with writable temporary storage. Multi-instance and serverless deployments should replace the temporary-media module with shared object storage and a job queue.

HEVC inputs play directly when the browser supports them. Otherwise, native server FFmpeg creates a lightweight H.264 preview. Analysis and final export also use native server FFmpeg. Audio-only M4A/AAC files are not video-editor inputs.
