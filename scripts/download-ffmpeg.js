/**
 * scripts/download-ffmpeg.js
 * Run once: node scripts/download-ffmpeg.js
 * Downloads ffmpeg.wasm assets into public/ffmpeg/ so they're served
 * from the same origin — no CORS, no worker restrictions on Vercel.
 */
import https from 'https'
import fs    from 'fs'
import path  from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR   = path.join(__dirname, '..', 'public', 'ffmpeg')

const FILES = [
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    dest: 'ffmpeg-core.js',
  },
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    dest: 'ffmpeg-core.wasm',
  },
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js',
    dest: 'worker.js',
  },
]

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(OUT_DIR, dest)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      console.log(`  ✓ ${dest} already exists — skipping`)
      return resolve()
    }
    console.log(`  ↓ Downloading ${dest}…`)
    const file = fs.createWriteStream(filePath)
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          console.log(`  ✓ ${dest} (${(fs.statSync(filePath).size/1048576).toFixed(1)} MB)`)
          resolve()
        })
      }).on('error', reject)
    }
    get(url)
  })
}

console.log('Downloading ffmpeg.wasm assets → public/ffmpeg/\n')
for (const f of FILES) await download(f.url, f.dest)
console.log('\nAll done. Commit public/ffmpeg/ and redeploy.')
