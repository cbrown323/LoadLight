/**
 * Image sequence vs version detection — editorial-style naming (Resolve/Nuke/ffmpeg image2).
 *
 * Versions: varying token is v001, ver02, version3, etc. → separate queue items.
 * Sequences: varying token is a frame index (1, 01, 1001, …) with stable prefix → one group.
 * Camera rolls (IMG_1867, DSC_0123, …) are shot IDs, not frames → always singles.
 *
 * Manual test vectors (expected):
 *   fileexample_v001.jpg ×3           → 3 singles (version stack)
 *   fileexample_v001.1001–1003.jpg    → 1 sequence, 3 frames
 *   fileexample_v001.1001 + v002.1001 → 2 singles (same frame, different versions)
 *   render.1001–1050.exr               → 1 sequence
 *   hero_001–120.png                  → 1 sequence (medium confidence)
 *   IMG_1867–1871.jpg                 → 5 singles (camera roll, not a sequence)
 */

/** @typedef {'literal'|'frame'|'version'|'unknown-numeric'} TokenKind */

/** @typedef {{ start: number, end: number, raw: string, digits: string, value: number, kind: TokenKind }} NumericRun */

/** @typedef {{ file: File, frameNumber: number, sortKey: string }} SequenceFrame */

/** @typedef {'high'|'medium'|'low'} SequenceConfidence */

/**
 * @typedef {object} SequenceGroup
 * @property {string} id
 * @property {'sequence'} kind
 * @property {string} displayName
 * @property {string|null} versionLabel
 * @property {SequenceFrame[]} frames
 * @property {SequenceConfidence} confidence
 * @property {string} reason
 * @property {string} signature
 */

/**
 * @typedef {object} AmbiguousGroup
 * @property {string} id
 * @property {string} displayName
 * @property {File[]} files
 * @property {SequenceGroup} asSequence
 * @property {string} reason
 */

/**
 * @typedef {object} IngestPlan
 * @property {SequenceGroup[]} sequences
 * @property {File[]} singles
 * @property {AmbiguousGroup[]} ambiguous
 */

export const MIN_SEQUENCE_FRAMES = 2
export const DEFAULT_SEQUENCE_FPS = 24

const VERSION_RAW_RE = /^v(?:er(?:sion)?)?(\d+)$/i

/**
 * Camera / phone still naming — sequential shot counters, not frame indices.
 * Matches IMG_1867, DSC_0123, DSCF0001, _MG_1234, PXL_…, etc.
 * @param {string} stem
 */
export function isCameraRollStem(stem) {
  if (/^PXL[_-]/i.test(stem)) return true
  return /^(?:IMG|DSC|DSCF|_MG|MG|SAM|PICT|PIC|PHOTO|MOV)[_-]?\d+$/i.test(stem)
}

/** @param {string} name */
export function ingestStemAndExt(name) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return { stem: base, ext: '' }
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() }
}

/** @param {string} stem @returns {NumericRun[]} */
export function findNumericRuns(stem) {
  /** @type {NumericRun[]} */
  const runs = []
  const re = /\d+/g
  let m
  while ((m = re.exec(stem)) !== null) {
    const digitStart = m.index
    const digitEnd = m.index + m[0].length
    let start = digitStart
    const before = stem.slice(Math.max(0, digitStart - 10), digitStart)
    const verPrefix = before.match(/(?:^|[_\-.])(v(?:er(?:sion)?)?)$/i)
    if (verPrefix) start = digitStart - verPrefix[1].length
    const raw = stem.slice(start, digitEnd)
    const digits = m[0]
    runs.push({
      start,
      end: digitEnd,
      raw,
      digits,
      value: parseInt(digits, 10),
      kind: classifyRun(raw, digits, stem, start),
    })
  }
  return runs
}

/**
 * @param {string} raw
 * @param {string} digits
 * @param {string} stem
 * @param {number} start
 */
function classifyRun(raw, digits, stem, start) {
  if (VERSION_RAW_RE.test(raw)) return 'version'
  // Shot IDs on camera rolls are 4-digit counters — never treat as frames.
  if (isCameraRollStem(stem)) return 'unknown-numeric'

  const value = parseInt(digits, 10)
  const prev = start > 0 ? stem[start - 1] : ''
  // Nuke / ffmpeg image2: name.1001.ext
  if (prev === '.') return 'frame'
  // Zero-padded indices (0001, 0100) strongly suggest frames
  if (digits.length >= 3 && digits[0] === '0') return 'frame'
  if (digits.length >= 4 || value >= 1001) return 'frame'
  if (value >= 1 && value <= 999) return 'unknown-numeric'
  return 'frame'
}

/** @param {string} stem @param {NumericRun} run */
function signatureForRun(stem, run) {
  return stem.slice(0, run.start) + '#' + stem.slice(run.end)
}

/** @param {number[]} values */
function isMonotonicStep(values, step = 1) {
  if (values.length < 2) return true
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return false
  }
  return true
}

/** @param {NumericRun} run @param {number} count */
function confidenceForRun(run, count) {
  if (run.kind === 'frame') return count >= 3 ? 'high' : 'medium'
  if (run.kind === 'version') return 'low'
  if (count >= 5 && isMonotonicStep) return 'medium'
  if (count >= 3) return 'medium'
  return 'low'
}

/** @param {string} signature @param {string} ext */
function displayNameFromSignature(signature, ext) {
  const name = signature.replace(/#/g, '####')
  return ext ? `${name}.${ext}` : name
}

/** @param {string} stem @param {NumericRun|null} versionRun */
function extractVersionLabel(stem, versionRun) {
  if (!versionRun) return null
  const m = versionRun.raw.match(VERSION_RAW_RE)
  if (!m) return versionRun.raw
  return `v${m[1]}`
}

/** Find a stable version token in stem (non-varying within a sequence group). */
function findFixedVersionRun(stem, runs) {
  return runs.find((r) => r.kind === 'version') || null
}

let _gid = 0
function nextId() {
  _gid += 1
  return `seq-${_gid}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Build ingest plan from raster still image files.
 * Video-like files should be passed separately as singles by the caller.
 *
 * @param {File[]} files
 * @param {{ minFrames?: number }} [opts]
 * @returns {IngestPlan}
 */
export function planIngest(files, opts = {}) {
  const minFrames = opts.minFrames ?? MIN_SEQUENCE_FRAMES
  /** @type {Map<string, { signature: string, ext: string, runKind: TokenKind, members: { file: File, run: NumericRun, runs: NumericRun[] }[] }>} */
  const buckets = new Map()

  for (const file of files) {
    const { stem, ext } = ingestStemAndExt(file.name)
    // Camera roll counters (IMG_1867, DSC_0123, …) are separate stills, not a sequence.
    if (isCameraRollStem(stem)) continue

    const runs = findNumericRuns(stem)
    if (!runs.length) continue

    for (const run of runs) {
      const signature = signatureForRun(stem, run)
      const key = `${ext}::${signature}::${run.start}:${run.end}`
      if (!buckets.has(key)) {
        buckets.set(key, { signature, ext, runKind: run.kind, members: [] })
      }
      buckets.get(key).members.push({ file, run, runs })
    }
  }

  /** @type {{ bucket: typeof buckets extends Map<string, infer V> ? V : never, score: number }[]} */
  const candidates = []

  for (const bucket of buckets.values()) {
    if (bucket.members.length < minFrames) continue

    const values = bucket.members.map((m) => m.run.value)
    const sorted = [...values].sort((a, b) => a - b)
    const stepOk = isMonotonicStep(sorted, 1) || isMonotonicStep(sorted, sorted[1] - sorted[0] || 1)
    const runKind = bucket.runKind
    const count = bucket.members.length

    if (runKind === 'version') {
      continue
    }

    let confidence = confidenceForRun({ kind: runKind, raw: '', digits: '', value: 0, start: 0, end: 0 }, count)
    if (runKind === 'unknown-numeric' && !stepOk) continue
    if (runKind === 'unknown-numeric' && count < 3) {
      confidence = 'low'
    }

    const runPos = bucket.members[0].run.start
    const score = count * 1000 + runPos * 10 + (confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1)
    candidates.push({ bucket, score })
  }

  candidates.sort((a, b) => b.score - a.score)

  const usedFiles = new Set()
  /** @type {SequenceGroup[]} */
  const sequences = []
  /** @type {AmbiguousGroup[]} */
  const ambiguous = []

  for (const { bucket } of candidates) {
    const members = bucket.members.filter((m) => !usedFiles.has(m.file))
    if (members.length < minFrames) continue

    const values = bucket.members.map((m) => m.run.value)
    const sortedMembers = [...members].sort((a, b) => a.run.value - b.run.value)
    const runKind = bucket.runKind
    const count = members.length
    const confidence = confidenceForRun(members[0].run, count)

    if (runKind === 'unknown-numeric' && confidence === 'low') {
      const sampleStem = ingestStemAndExt(members[0].file.name).stem
      const asSequence = buildSequenceGroup(bucket.signature, bucket.ext, sortedMembers, sampleStem, 'medium', 'Unlabeled numeric suffix — confirm sequence vs separate files')
      ambiguous.push({
        id: nextId(),
        displayName: asSequence.displayName,
        files: sortedMembers.map((m) => m.file),
        asSequence,
        reason: `${count} files share “${bucket.signature}” — could be a frame sequence or numbered variants.`,
      })
      sortedMembers.forEach((m) => usedFiles.add(m.file))
      continue
    }

    const sampleStem = ingestStemAndExt(members[0].file.name).stem
    const versionRun = findFixedVersionRun(sampleStem, members[0].runs)
    const group = buildSequenceGroup(
      bucket.signature,
      bucket.ext,
      sortedMembers,
      sampleStem,
      runKind === 'unknown-numeric' ? 'medium' : confidence,
      runKind === 'frame' || runKind === 'unknown-numeric'
        ? `${count} frames detected (${sortedMembers[0].run.value}–${sortedMembers[sortedMembers.length - 1].run.value})`
        : `${count} frames`,
    )
    group.versionLabel = extractVersionLabel(sampleStem, versionRun)

    sequences.push(group)
    sortedMembers.forEach((m) => usedFiles.add(m.file))
  }

  /** @type {File[]} */
  const singles = files.filter((f) => !usedFiles.has(f))

  return { sequences, singles, ambiguous }
}

/**
 * @param {string} signature
 * @param {string} ext
 * @param {{ file: File, run: NumericRun }[]} sortedMembers
 * @param {string} sampleStem
 * @param {SequenceConfidence} confidence
 * @param {string} reason
 */
function buildSequenceGroup(signature, ext, sortedMembers, sampleStem, confidence, reason) {
  /** @type {SequenceFrame[]} */
  const frames = sortedMembers.map((m, i) => ({
    file: m.file,
    frameNumber: m.run.value,
    sortKey: String(m.run.value).padStart(8, '0'),
  }))

  const versionRun = findFixedVersionRun(sampleStem, findNumericRuns(sampleStem))
  const versionLabel = extractVersionLabel(sampleStem, versionRun)
  let displayName = displayNameFromSignature(signature, ext)
  if (versionLabel) displayName = displayName.replace('#', versionLabel)

  return {
    id: nextId(),
    kind: 'sequence',
    displayName,
    versionLabel,
    frames,
    confidence,
    reason,
    signature,
  }
}

/** @param {SequenceGroup} group */
export function sequenceFrameRange(group) {
  if (!group.frames.length) return { start: null, end: null }
  return {
    start: group.frames[0].frameNumber,
    end: group.frames[group.frames.length - 1].frameNumber,
  }
}

/** Representative File for a sequence (first frame). */
export function sequenceRepresentativeFile(group) {
  return group.frames[0].file
}
