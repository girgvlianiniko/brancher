import { Navigate, Route, Routes } from 'react-router'

import { useRepos } from './api'
import { Sidebar } from './components/Sidebar'
import { Empty, ErrorBox, Spinner } from './components/ui'
import { RepoPage } from './pages/RepoPage'

function Home() {
  const repos = useRepos()
  if (repos.isPending) return <Spinner />
  if (repos.isError) return <div className="p-6"><ErrorBox error={repos.error} /></div>
  const first = repos.data[0]
  if (first) return <Navigate to={`/r/${first.id}`} replace />
  return <Empty>No repos yet. Add a local folder or a GitHub repo from the sidebar.</Empty>
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 md:overflow-y-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/r/:repoId/:tab?" element={<RepoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
