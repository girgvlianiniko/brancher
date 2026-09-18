import type { Commit } from '../../../shared/types'

/**
 * One row of the commit graph. `before` / `after` are the lanes crossing the top and
 * bottom edge of the row: each slot holds the sha that lane is heading towards, or
 * `null` when the slot is free.
 */
export interface GraphRow {
  commit: Commit
  /** Lane the commit's dot sits in. */
  column: number
  before: (string | null)[]
  after: (string | null)[]
  /** Lane each parent continues in, in parent order. */
  parentColumns: number[]
}

export interface GraphLayout {
  rows: GraphRow[]
  /** Widest point of the graph, in lanes. */
  laneCount: number
}

/**
 * Assigns every commit a lane. Expects children before parents (newest first), which is
 * what both sources return. A commit takes the lane that was waiting for it (the leftmost,
 * if several children were); its first parent carries that lane on and merge parents
 * branch out to free lanes, or join a lane already heading to the same commit.
 * Lanes are never shifted sideways, so a straight line always means "same lane".
 */
export function layoutGraph(commits: Commit[]): GraphLayout {
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  let laneCount = 0

  const freeLane = () => {
    const index = lanes.indexOf(null)
    if (index !== -1) return index
    lanes.push(null)
    return lanes.length - 1
  }

  for (const commit of commits) {
    const before = lanes.slice()
    let column = lanes.indexOf(commit.sha)
    if (column === -1) column = freeLane()

    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.sha) lanes[i] = null

    const parentColumns = commit.parents.map((parent, index) => {
      const existing = lanes.indexOf(parent)
      if (existing !== -1) return existing
      const lane = index === 0 && lanes[column] === null ? column : freeLane()
      lanes[lane] = parent
      return lane
    })

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({ commit, column, before, after: lanes.slice(), parentColumns })
    laneCount = Math.max(laneCount, before.length, lanes.length, column + 1)
  }

  return { rows, laneCount }
}

export const LANE_COLORS = 8
export const laneColor = (lane: number) => `var(--lane-${(lane % LANE_COLORS) + 1})`
