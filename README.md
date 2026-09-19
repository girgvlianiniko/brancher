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

## Running it on a server

The container serves the API and the web app on one port, and keeps two volumes: `/data`
for the client config, repository list and status history, and `/repos` for the clones.

```sh
cp .env.example .env     # put a GitHub token in it
docker compose up -d --build
```

Nothing else is needed. On first boot it writes the token into git's credential store,
clones everything named in `BRANCHER_CLONE`, and starts watching.

| Variable | What it does |
|---|---|
| `GITHUB_TOKEN` | Read access to the repositories you watch. Also settable in Settings. |
| `BRANCHER_CLONE` | `owner/repo` list, comma separated, cloned on first boot. |
| `BRANCHER_PORT` | Published port. Defaults to 4317. |
| `BRANCHER_DATA_DIR` | Where config and history are written. `/data` in the container. |
| `BRANCHER_REPOS_DIR` | Where clones live. `/repos` in the container. |
| `BRANCHER_HOST` | Interface to bind. `0.0.0.0` in the container, loopback otherwise. |
| `BRANCHER_PUBLIC_URL` | Where the board lives, so alerts can link back to it. |

Clones are blobless (`--filter=blob:none`): the full history and every ref, without every
version of every file. That is everything the board counts and compares, at a fraction of
the disk and the first-clone wait.

## Alerts

Add a destination under Alerts and Brancher tells it when something changes. Slack,
Telegram and Discord are built in, plus your own endpoint and anything an
[Apprise](https://github.com/caronc/apprise) container can reach.

Each destination carries its own rule: which severities are worth a message, whether
recovery is worth one too, which clients and environments to watch, and how long to wait
first. That wait matters. The board checks every thirty seconds, so without it a single
slow response would page somebody at 3am for something that fixed itself before they
read the message. Anything that recovers inside the window is never sent at all.

Quiet hours hold back everything except a site that is actually down.

### Behind a reverse proxy

If something already terminates TLS, drop the published port and put brancher on the
proxy's network instead, so the proxy is the only way in rather than a suggestion:

```yaml
services:
  brancher:
    # no ports:
    networks: [proxy-net]
networks:
  proxy-net:
    external: true
```

A Caddy site for it, with a password until there are accounts:

```
brancher.example.com {
	basic_auth {
		brancher $2a$14$...        # caddy hash-password
	}
	reverse_proxy brancher:4317
}
```

### Before it faces the internet

**There is no authentication.** Anyone who reaches the port sees every client, every
address, and the commit history of every repository, and can edit or delete clients. Put
it behind whatever already guards your other services, or keep it on a private network,
until that is built.

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
