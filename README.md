# Brancher

Two tools in one app.

**The status board** is the front page: one row per client, one colour per environment, in words anyone can read. It answers "is everything up, and is anything waiting to ship".

**The repo tools** live under `/r` and are unchanged: branches, commit graph, and comparisons for anyone who needs the detail.

## Run

```sh
pnpm install
cp clients.example.json server/data/clients.json   # only the first time
pnpm dev
```

Open http://localhost:5317. The API runs on http://127.0.0.1:4317 and only listens on this machine.

## The status board

Each client is a row. Each environment is a cell with a colour, one word, and one sentence:

- **Working** — every address answers and nothing is overdue to ship.
- **Behind** — changes have been waiting too long to reach this environment.
- **Degraded** — a secondary service (live updates, chat, payments) is not answering.
- **Down** — the website, admin panel or API is not answering.
- **No checks** — nothing is being probed here yet.

A cell also says "Deploys by hand only" when pushing to its branch triggers no deploy, so a branch that is up to date is never mistaken for a site that is up to date.

Add `?kiosk=1` for the office screen: larger type, dark, no controls, refreshing on its own.

Click a client to see how a change travels through its repos, what is waiting on each hop, and which addresses were reachable over the last day. Every hop opens the full comparison in the repo tools.

**Add client** opens a wizard that reads the real branches out of your clones, proposes the usual addresses from one domain, and checks each of them before you save. It is also the editor.

### What it needs

Clones of the repos you bind, sitting beside brancher so the first-run scan finds them. The board reads them with `git fetch` once a minute and never writes. Everything else lives in `server/data/`: `clients.json` for the setup, `status.db` for the history.

Configuration and behaviour are described in `STATUS-BOARD-PLAN.md`.

`?kiosk=1` gives the wall-screen layout, and `?theme=light` or `?theme=dark` pins the theme from the
address, so a tablet can be pointed at one URL and left alone.

## Design

The interface follows [Arcane](https://github.com/ofkm/arcane)'s design system: shadcn tokens on a
violet base, a 14px radius, Montserrat for the interface and Geist Mono for branch names. Dark is the
default. Every screen, including the repository tools, sits in one frame with one sidebar, so nothing
ever feels like a different program.

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
shared/status.ts       shapes for the status board
server/src/status/     config, probes, git lag, workflow triggers, the engine
web/src/pages/BoardPage.tsx    the board; ClientPage and WizardPage sit beside it
server/src/sources/    local.ts (runs git) and github.ts (REST + GraphQL), same interface
server/src/index.ts    Hono API
web/src/lib/graphLayout.ts   lane layout for the commit graph
web/src/pages/         Overview, Branches, Graph, Compare
```
