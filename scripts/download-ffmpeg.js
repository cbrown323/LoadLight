const https = require('https')
const fs    = require('fs')
const path  = require('path')

const OUT_DIR = path.join(__dirname, '..', 'public', 'ffmpeg')

const FILES = [
  // Core wasm engine
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    dest: 'ffmpeg-core.js',
  },
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    dest: 'ffmpeg-core.wasm',
  },
  // ffmpeg package worker (spawned by FFmpeg class)
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js',
    dest: 'worker.js',
  },
  // ffmpeg ESM bundle — loaded via dynamic import, NOT bundled by Vite
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js',
    dest: 'ffmpeg-esm.js',
  },
  // util ESM bundle
  {
    url:  'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js',
    dest: 'util-esm.js',
  },
]

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(OUT_DIR, dest)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 500) {
      console.log('  already exists: ' + dest)
      return resolve()
    }
    console.log('  downloading: ' + dest)
    const file = fs.createWriteStream(filePath)
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location)
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + u))
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          const kb = (fs.statSync(filePath).size / 1024).toFixed(0)
          console.log('  done: ' + dest + ' (' + kb + ' KB)')
          resolve()
        })
      }).on('error', reject)
    }
    get(url)
  })
}

async function main() {
  console.log('Downloading ffmpeg assets to public/ffmpeg/\n')
  for (const f of FILES) await download(f.url, f.dest)
  console.log('\nAll done.')
}

main().catch(e => { console.error(e); process.exit(1) })
