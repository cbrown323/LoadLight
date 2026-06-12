/**
 * Orchestrate file collection → validation → sequence grouping → queue payloads.
 */
import { validateIngestFile, isRasterStillImage, isVideoLike } from './mediaIngest.js'
import {
  planIngest,
  sequenceRepresentativeFile,
  sequenceFrameRange,
  DEFAULT_SEQUENCE_FPS,
} from './sequenceNaming.js'
import { collectFromFileList, collectFromDataTransfer } from './folderCollect.js'

/** @typedef {'flat'|'smart-sequence'} IngestMode */

/**
 * @typedef {object} QueuePayload
 * @property {'single'|'sequence'} kind
 * @property {File} file
 * @property {import('./sequenceNaming.js').SequenceFrame[]|null} frames
 * @property {string|null} sequenceBaseName
 * @property {string|null} versionLabel
 * @property {number} frameCount
 * @property {number|null} startFrame
 * @property {number|null} endFrame
 * @property {number} fps
 * @property {string|null} ingestNote
 */

/**
 * @typedef {object} IngestBatch
 * @property {QueuePayload[]} queue
 * @property {import('./sequenceNaming.js').AmbiguousGroup[]} ambiguous
 * @property {string[]} skipReasons
 * @property {string|null} summary
 */

/**
 * @param {FileList|File[]|DataTransfer} input
 * @param {{ mode?: IngestMode, fromFolder?: boolean }} [opts]
 * @returns {Promise<IngestBatch>}
 */
export async function buildIngestBatch(input, opts = {}) {
  const mode = opts.mode ?? 'smart-sequence'

  /** @type {File[]} */
  let files
  if (input instanceof DataTransfer) {
    files = await collectFromDataTransfer(input)
  } else {
    files = collectFromFileList(input)
  }

  /** @type {string[]} */
  const skipReasons = []
  /** @type {File[]} */
  const valid = []

  for (const file of files) {
    const v = validateIngestFile(file)
    if (!v.ok) {
      skipReasons.push(v.reason)
      continue
    }
    valid.push(file)
  }

  /** @type {QueuePayload[]} */
  const queue = []
  /** @type {import('./sequenceNaming.js').AmbiguousGroup[]} */
  let ambiguous = []

  const motion = valid.filter((f) => isVideoLike(f))
  const stills = valid.filter((f) => isRasterStillImage(f))

  motion.forEach((file) => queue.push(buildSinglePayload(file)))

  if (mode === 'flat' || stills.length === 0) {
    stills.forEach((file) => queue.push(buildSinglePayload(file)))
  } else {
    const plan = planIngest(stills)
    ambiguous = plan.ambiguous

    for (const seq of plan.sequences) {
      const { start, end } = sequenceFrameRange(seq)
      const rep = sequenceRepresentativeFile(seq)
      queue.push({
        kind: 'sequence',
        file: rep,
        frames: seq.frames,
        sequenceBaseName: seq.displayName.replace(/\.[^.]+$/, ''),
        versionLabel: seq.versionLabel,
        frameCount: seq.frames.length,
        startFrame: start,
        endFrame: end,
        fps: DEFAULT_SEQUENCE_FPS,
        ingestNote: seq.reason,
      })
    }

    plan.singles.forEach((file) => queue.push(buildSinglePayload(file)))
  }

  let summary = null
  const seqCount = queue.filter((q) => q.kind === 'sequence').length
  if (seqCount > 0) {
    summary = `Imported ${seqCount} image sequence${seqCount === 1 ? '' : 's'}.`
  }
  if (ambiguous.length > 0) {
    summary = (summary ? summary + ' ' : '') + `${ambiguous.length} group(s) need review.`
  }

  return { queue, ambiguous, skipReasons, summary }
}

/** @param {File} file */
function buildSinglePayload(file) {
  return {
    kind: 'single',
    file,
    frames: null,
    sequenceBaseName: null,
    versionLabel: null,
    frameCount: 1,
    startFrame: null,
    endFrame: null,
    fps: DEFAULT_SEQUENCE_FPS,
    ingestNote: null,
  }
}

/**
 * Resolve an ambiguous group after user choice.
 * @param {import('./sequenceNaming.js').AmbiguousGroup} group
 * @param {'sequence'|'singles'} choice
 * @returns {QueuePayload[]}
 */
export function resolveAmbiguousGroup(group, choice) {
  if (choice === 'singles') {
    return group.files.map((file) => buildSinglePayload(file))
  }
  const seq = group.asSequence
  const { start, end } = sequenceFrameRange(seq)
  const rep = sequenceRepresentativeFile(seq)
  return [{
    kind: 'sequence',
    file: rep,
    frames: seq.frames,
    sequenceBaseName: seq.displayName.replace(/\.[^.]+$/, ''),
    versionLabel: seq.versionLabel,
    frameCount: seq.frames.length,
    startFrame: start,
    endFrame: end,
    fps: DEFAULT_SEQUENCE_FPS,
    ingestNote: seq.reason,
  }]
}
