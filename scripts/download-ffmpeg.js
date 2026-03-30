const https = require('https')
const fs    = require('fs')
const path  = require('path')

const OUT_DIR = path.join(__dirname, '..', 'public', 'ffmpeg')

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
      console.log('  already exists, skipping: ' + dest)
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
          const mb = (fs.statSync(filePath).size / 1048576).toFixed(1)
          console.log('  done: ' + dest + ' (' + mb + ' MB)')
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
  console.log('\nAll done. Run: git add . && git commit -m "add ffmpeg assets" && git push')
}

main().catch(e => { console.error(e); process.exit(1) })
