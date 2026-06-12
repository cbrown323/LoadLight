import React from 'react'
import s from './IngestReviewModal.module.css'

/**
 * @param {object} props
 * @param {import('../lib/sequenceNaming.js').AmbiguousGroup[]} groups
 * @param {(id: string, choice: 'sequence'|'singles') => void} onResolve
 * @param {(id: string) => void} onDismiss
 */
export default function IngestReviewModal({ groups, onResolve, onDismiss }) {
  if (!groups.length) return null
  const group = groups[0]

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-labelledby="ingest-review-title">
      <div className={s.modal}>
        <h2 id="ingest-review-title" className={s.title}>Review import</h2>
        <p className={s.subtitle}>
          {groups.length > 1
            ? `${groups.length} groups need a decision — showing the first.`
            : 'These files could be a frame sequence or separate versions.'}
        </p>

        <div className={s.groupCard}>
          <div className={s.groupName}>{group.displayName}</div>
          <div className={s.groupMeta}>{group.files.length} files · {group.reason}</div>
          <ul className={s.fileList}>
            {group.files.slice(0, 6).map((f) => (
              <li key={f.name + f.size}>{f.name}</li>
            ))}
            {group.files.length > 6 && (
              <li className={s.more}>…and {group.files.length - 6} more</li>
            )}
          </ul>
        </div>

        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={() => onResolve(group.id, 'sequence')}>
            Import as sequence
          </button>
          <button type="button" className={s.secondary} onClick={() => onResolve(group.id, 'singles')}>
            Separate files
          </button>
          <button type="button" className={s.ghost} onClick={() => onDismiss(group.id)}>
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
