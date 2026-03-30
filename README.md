# LoadLight ⚡

> Web-first media encoder — export web-ready images, GIFs, and video in one click.

## Stack

- **React 18** + **Vite 5**
- **Zustand** — global state
- **ffmpeg.wasm** — client-side video/GIF encoding (no backend needed)
- **JSZip** — ZIP bundling
- **CSS Modules** — scoped styles

---

## Local Development

```bash
npm install
npm run dev
# Open http://localhost:5173
```

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
gh repo create loadlight --public --push
# or push manually to github.com
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Import your `loadlight` GitHub repo
4. Leave all settings as defaults — Vercel auto-detects Vite
5. Click **Deploy**

The `vercel.json` in this repo automatically sets the required
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers
that ffmpeg.wasm needs to use SharedArrayBuffer.

### 3. Custom domain (optional)

In your Vercel project → **Settings → Domains** → add your domain.
Vercel handles SSL automatically.

---

## Features

- Drag & drop or folder import
- Real after-preview (images re-encode live, video encodes a 4s clip on demand)
- WebP / AVIF / JPG / PNG / MP4 / WebM / GIF output
- Responsive breakpoint export with upscale guard
- HTML `<picture>` snippet generation
- Poster frame extraction for video
- ZIP or individual file download
- Save / Load named presets (localStorage)
- Keyboard shortcuts: Space (play), ← → (seek), L (loop)
- AVIF browser detection with automatic fallback

---

## Project Structure

```
src/
├── main.jsx
├── App.jsx
├── index.css               ← CSS design tokens
├── store/useStore.js       ← Zustand store — all state + logic
├── lib/
│   ├── imageEncoder.js     ← Canvas-based image encoding + unsharp mask
│   ├── videoEncoder.js     ← ffmpeg.wasm video/GIF encoding
│   ├── videoPreviewEncoder.js ← 4s preview clip encoder
│   ├── ffmpegLoader.js     ← ffmpeg.wasm singleton loader
│   ├── exportEngine.js     ← Full export pipeline
│   ├── previewEncoder.js   ← Debounced image preview encoder
│   ├── formatSupport.js    ← AVIF/WebP browser detection
│   └── presets.js          ← localStorage preset persistence
└── components/
    ├── TopBar              ← Logo, project name, view toggle, presets
    ├── LeftPanel           ← Drop zone, file list, batch controls
    ├── CenterPanel         ← Before/After preview + scrubber
    ├── RightPanel          ← Format, quality, responsive, output settings
    ├── BottomBar           ← Export queue, progress, stats
    └── Toggle              ← Reusable toggle switch
```
