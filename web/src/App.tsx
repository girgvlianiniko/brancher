import { Navigate, Route, Routes } from 'react-router'

import { useRepos } from './api'
import { Sidebar } from './components/Sidebar'
import { Empty, ErrorBox, Spinner } from './components/ui'
import { BoardPage } from './pages/BoardPage'
import { ClientPage } from './pages/ClientPage'
import { WizardPage } from './pages/WizardPage'
import { RepoPage } from './pages/RepoPage'

/** Landing spot for the repo tools: the first repo in the list. */
function FirstRepo() {
  const repos = useRepos()
  if (repos.isPending) return <Spinner />
  if (repos.isError)
    return (
      <div className="p-6">
        <ErrorBox error={repos.error} />
      </div>
    )
  const first = repos.data[0]
  if (first) return <Navigate to={`/r/${first.id}`} replace />
  return <Empty>No repos yet. Add a local folder or a GitHub repo from the sidebar.</Empty>
}

/** The repo tools keep their sidebar; the status board does not have one. */
function RepoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 md:overflow-y-auto">{children}</main>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/c/new" element={<WizardPage />} />
      <Route path="/c/:clientId/setup" element={<WizardPage />} />
      <Route path="/c/:clientId" element={<ClientPage />} />
      <Route
        path="/r"
        element={
          <RepoShell>
            <FirstRepo />
          </RepoShell>
        }
      />
      <Route
        path="/r/:repoId/:tab?"
        element={
          <RepoShell>
            <RepoPage />
          </RepoShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
