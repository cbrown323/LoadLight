import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import TopBar      from './components/TopBar'
import LeftPanel   from './components/LeftPanel'
import CenterPanel from './components/CenterPanel'
import RightPanel  from './components/RightPanel'
import BottomBar   from './components/BottomBar'
import styles      from './App.module.css'

export default function App() {
  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.main}>
        <LeftPanel />
        <CenterPanel />
        <RightPanel />
      </div>
      <BottomBar />
      <Analytics />
    </div>
  )
}
