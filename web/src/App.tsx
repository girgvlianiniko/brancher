import { Navigate, Route, Routes } from 'react-router'

import { AlertsPage } from './pages/AlertsPage'
import { BoardPage } from './pages/BoardPage'
import { ClientPage } from './pages/ClientPage'
import { RepoPage } from './pages/RepoPage'
import { ReposPage } from './pages/ReposPage'
import { SettingsPage } from './pages/SettingsPage'
import { WizardPage } from './pages/WizardPage'

/** Every route renders its own Shell, so the frame is identical on all of them. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/c/new" element={<WizardPage />} />
      <Route path="/c/:clientId/setup" element={<WizardPage />} />
      <Route path="/c/:clientId" element={<ClientPage />} />
      <Route path="/r" element={<ReposPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/r/:repoId/:tab?" element={<RepoPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
