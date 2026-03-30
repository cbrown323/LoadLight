import React from 'react'
import s from './Toggle.module.css'

export default function Toggle({ on, onChange }) {
  return (
    <div className={`${s.sw} ${on ? '' : s.off}`} onClick={() => onChange(!on)}>
      <div className={s.knob} />
    </div>
  )
}
