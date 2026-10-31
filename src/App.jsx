import { useState } from 'react'
import TopBar from './components/TopBar'
import HomePage from './components/HomePage'
import VibeWorkbench from './components/vibe/VibeWorkbench'
import NavigatorWorkbench from './components/navigator/NavigatorWorkbench'

export default function App() {
  const [view, setView] = useState('home')

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <TopBar view={view} onBack={() => setView('home')} />
      <main className="min-h-0 flex-1">
        {view === 'home' && <HomePage onEnter={setView} />}
        {view === 'vibe' && <VibeWorkbench />}
        {view === 'navigator' && <NavigatorWorkbench />}
      </main>
    </div>
  )
}
