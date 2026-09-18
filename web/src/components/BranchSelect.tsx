import type { Branch } from '../../../shared/types'

/** Native select over a repo's branches, grouped into local and remote. */
export function BranchSelect({ label, value, branches, onChange }: { label: string; value: string; branches: Branch[]; onChange: (value: string) => void }) {
  const local = branches.filter((b) => b.kind === 'local')
  const remote = branches.filter((b) => b.kind === 'remote')
  const known = branches.some((b) => b.name === value)
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-fg-3 sm:max-w-80">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 rounded-md border border-line bg-surface px-2 text-sm text-fg focus:border-accent focus:outline-none"
      >
        {!known && value && <option value={value}>{value}</option>}
        {local.length > 0 && (
          <optgroup label={remote.length ? 'Local' : 'Branches'}>
            {local.map((b) => <option key={`l:${b.name}`} value={b.name}>{b.name}</option>)}
          </optgroup>
        )}
        {remote.length > 0 && (
          <optgroup label="Remote">
            {remote.map((b) => <option key={`r:${b.name}`} value={b.name}>{b.name}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  )
}
