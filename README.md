# Brancher

See your git branches and how far apart they are. Works on local repos, and on GitHub repos through the API.

## Run

```sh
pnpm install
pnpm dev
```

Open http://localhost:5317. The API runs on http://127.0.0.1:4317 and only listens on this machine.

On first start the server scans the folder brancher sits in and adds every git repo it finds. Add more from the sidebar: a local folder path, or `owner/repo` for GitHub.

## What it shows

- **Overview**: current branch, HEAD commit, remotes, branch/tag/commit/contributor counts, uncommitted changes, commits per week, top contributors, recent tags.
- **Branches**: every local and remote branch, with commits ahead/behind the default branch and push/pull status against its upstream.
- **Graph**: commit history drawn as lanes, with branch and tag labels. Click a commit for details.
- **Compare**: pick two branches to see how far they've diverged, the commits only on each side, and the files changed since they split.

**Fetch** runs `git fetch --all --prune` on local repos. Brancher never runs any other git command that changes a repo.

## Config

Copy `.env.example` to `.env`:

- `GITHUB_TOKEN`: optional. Without it, GitHub repos are public-only, limited to 60 requests an hour, and branch lists have no last-commit details or ahead/behind counts.
- `BRANCHER_SCAN_DIR`: the folder scanned on first start.
- `BRANCHER_PORT`: API port (default 4317).

The repo list is saved in `server/data/repos.json`. That file is the first thing to move into SpacetimeDB later.

## Layout

```
shared/types.ts        shapes shared by server and web
server/src/sources/    local.ts (runs git) and github.ts (REST + GraphQL), same interface
server/src/index.ts    Hono API
web/src/lib/graphLayout.ts   lane layout for the commit graph
web/src/pages/         Overview, Branches, Graph, Compare
```
