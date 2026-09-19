# Status board plan

A shareholder-facing status layer on top of Brancher. One page answers "is every client up, and is anything waiting to ship". Clicking a client opens a client-scoped page. One more click lands on Brancher's existing per-repo tabs, unchanged.

This document is the spec for whoever implements it. It records the decisions taken in the grilling session on 19 Sep 2026 and the facts read from the `core-platform-handover` GitHub org the same day. Where something is still unknown it says so.

Companion file: `clients.example.json`, the starter config with the real client map.

## 1. Decisions already made

| Topic | Decision |
|---|---|
| Health source | HTTP probes of each service's domain. No Grafana exists (the `promotes-monitoring` repo is an unmodified template fork). Keep the probe behind an adapter interface so other sources can be added later. |
| Colours | Red: a service is down. Yellow: deploy lag over threshold, or one service of several down. Green: all up and within thresholds. Grey: not configured or never probed. |
| Lag definition | Two edges per client: development to staging, staging to production. Mirror to production as a third edge where a mirror exists. Both "commits waiting" and "age of oldest waiting commit" count. |
| Real commits | Card shows commits that change files. Merge-only commits are noise and are shown only in the drill-down. |
| Thresholds | Yellow at 10 or more real commits waiting, or oldest waiting commit older than 7 days. Global default, per-client override. |
| Deployed means | The branch was pushed. Running-version detection is out of scope for now. |
| Hosting | Runs locally inside the existing Brancher server process. Local clones, fetched every 60 seconds. |
| History | Kept. SQLite. Enables "Down since 14:02" and uptime over the last day. |
| Alerts | None in this phase. Design the status transitions so a Slack or Telegram adapter is a later addition, not a rewrite. |
| Wizard | Yes. Used only when onboarding or editing a client. Discovers branches from real refs, proposes domains, probes them live. Also the editor and the delete path. |
| Drill-down | Client-scoped page first, existing repo tabs one click below. Roles and auth are not decided and not in scope. |
| Deploy-trigger detection | Yes. Parse workflow files in each clone, show "auto-deploy off" on cells whose branch has no live push trigger. |
| Front page | New home route, no sidebar, auto-refresh 30 s, dark by default. |
| Not in scope | Slack, roles, auth, testautomation results, `branch-status` repo (ignored for now), running-version detection. |

## 2. What was read from the org, and what it means

### Repos and branches per environment

Derived from `on.push.branches` in each repo's workflows, cross-checked against real refs. User-stated names (`prod_korea`, `prod_africa`) are not the real ones.

| Environment | Site domains | oribet-monorepo | oribet-admin | api-laravel |
|---|---|---|---|---|
| Development (shared) | oribet.space, admin., api. | `develop` | `develop` | `develop` |
| asdfbet staging (Korea) | asdfbet-staging.com | `global_develop`, `dev_korean` | `global_develop` (manual), `dev_korean` | `global_staging`, `dev_korean` |
| asdfbet production | asdfbet.com | `prod_korean` | `prod_korean` | `prod_korean` |
| asdfbet mirror | atmbet.casino | `mirror_atmbet` | none seen | none seen |
| efsobet staging (Turkey) | efsobet-staging.com | `global_develop`, `dev_turkey` | `dev_turkey` | `global_staging`, `dev_turkey` |
| efsobet production | efsobet.com | `efsobet_prod` | `efsobet_prod` | `efsobet-prod` |
| mycryptobet production (Africa) | mycryptobet.com | `africa_prod` | `afrika_prod` | `afrika_prod` |
| oribets.com (inner brand) | oribets.com | `main` | `main` | `main` |
| agentpay (shared, multi-tenant) | pay.asdfbet-staging.com seen; production domain unknown | repo `agentpay`, `develop` then `main` | | |

Additional subdomains per site: `ws.` (websocket-node), `chat.` (chat-node), `pay.` (agentpay). Off by default in the wizard.

api-laravel health endpoint: `GET /health-check`. Use it as the api probe path. Front and admin probe the root URL.

### Staging has several feeders

In the monorepo a push to `global_develop` runs an affected-apps job that calls the same staging deploy workflows `dev_korean` and `dev_turkey` trigger directly. Nothing writes back to those branches. So an environment maps to a **set** of branches. The one with the most recent commit is the **primary** and lag is computed from it. The card names the primary. The drill-down shows all of them.

### Disabled deploy triggers

These workflows listen on branches that do not exist, so their environments deploy only by manual dispatch:

| Repo | Workflow | Listens on | Real branch |
|---|---|---|---|
| oribet-monorepo | deploy_korean_prod.yml | none (dispatch only) | `prod_korean` (a second workflow, asdfbet-com-prod-front.yaml, does listen on it) |
| oribet-admin | dev_afrika.yaml | `afrika_prodfdasfas` | `afrika_prod` |
| api-laravel | develop_asdfbet-staging.yaml | `develop_korean` | `dev_korean` |
| api-laravel | develop_efsobet-staging.yaml | `develop_turkey` | `dev_turkey` |
| api-laravel | production_efsobet.yaml | `efsobetprod` | `efsobet-prod` |
| api-laravel | asdgbet-scale.yaml | `prod_koreanfdsafsa` | `prod_korean` |
| api-laravel | production_oribets-com.yaml | `production` | `main` |

This is why the board must show "auto-deploy off" rather than assume pushed equals deployed.

### Unknowns to resolve during setup, not before

- What `oribet.click` is. A monorepo workflow deploys the `mirror` branch against it into the Turkey directory. Leave mirrors as an optional slot; the wizard will show whether the domain answers.
- agentpay's production domain.
- Whether `dev_korean` is a real promotion step or just an alternate trigger. Modelled as a feeder set, which is correct either way.

## 3. Domain model

Keep it small. Names below are the ones to use in code and config.

```
Client
  id, name, region, thresholds?            thresholds overrides the global defaults
  environments: Environment[]

Environment
  kind: development | staging | production | mirror
  label                                     e.g. "Staging"
  services: Service[]
  repos: RepoBinding[]
  feedsFrom?: kind                          staging feeds from development, production from staging, mirror from production

Service
  kind: front | admin | api | ws | chat | pay
  url                                       full URL to probe, e.g. https://api.asdfbet.com/health-check
  enabled

RepoBinding
  repoId                                    Brancher's existing RepoConfig.id
  branches: string[]                        feeder set; primary = most recent commit

Shared
  development: Environment                  oribet.space, develop everywhere; every client's staging feeds from it
  agentpay: Environment                     one production, one staging, own repo
```

Derived, never stored in config:

```
ProbeSample   serviceRef, at, ok, httpStatus, latencyMs, error?
ServiceState  serviceRef, status: up|down|unknown, since, consecutiveFailures, lastLatencyMs
LagEdge       clientId, repoId, fromEnv, toEnv, fromBranch, toBranch,
              realCommits, mergeCommits, filesChanged, oldestWaitingAt, computedAt
DeployTrigger repoId, branch, mode: push|manual|none, workflowFile
CellStatus    clientId, envKind, colour: green|yellow|red|grey, word, sentence, lastDeployedAt, autoDeploy: on|off|mixed
StatusChange  cellRef, from, to, at                     the hook alerts will consume later
```

## 4. Status rules

Evaluate per cell (client × environment), in this order. First match wins the colour.

1. Any enabled service `down` → **red**. Word: "Down". Sentence: "<service> not answering since <time>".
2. Any enabled service `unknown` and none down → **grey**. Word: "Checking".
3. Any lag edge into this environment over threshold → **yellow**. Word: "Behind". Sentence: "<n> changes waiting from <fromEnv>" or "oldest change waiting <d> days".
4. Otherwise → **green**. Word: "Working". Sentence: "Deployed <ago>" using the primary branch's last commit date.

Extra line on every cell, muted, when applicable: "auto-deploy off" if any bound repo's primary branch has no live push trigger.

Service state transitions:

- `up` → `down` after **2 consecutive** failed probes.
- `down` → `up` after 1 successful probe.
- A probe is a GET with a 5 s timeout. 2xx and 3xx are success. Everything else, including timeouts and TLS errors, is failure. No geo-blocking exists today; if it appears later, add a per-service list of accepted status codes.

Lag edge computation, on local clones after fetch, using `origin/<branch>` refs:

- `realCommits` = `git rev-list --count --no-merges to..from`
- `mergeCommits` = total minus real
- `filesChanged` = number of paths in `git diff --name-only to...from`
- `oldestWaitingAt` = author date of the first commit in `git log --reverse --no-merges --format=%aI to..from`
- Reuse `LocalSource.position()` and `compare()` from `server/src/sources/local.ts` for the drill-down. The three commands above are new and belong next to them.

Threshold check: `realCommits >= thresholds.commits` or `now - oldestWaitingAt >= thresholds.days`.

## 5. Background work

All inside the existing Hono process. Start on boot, stop on SIGTERM.

| Loop | Interval | Does |
|---|---|---|
| fetch | 60 s | `git fetch --all --prune` on every repo bound to any client. Reuse `LocalSource.fetch()`. Skip a repo if its previous fetch is still running. |
| lag | after each fetch | Recompute every LagEdge for every client. Cheap: a few rev-list calls per edge. |
| probe | 30 s | Probe every enabled service concurrently with a cap of 8 in flight. Write a ProbeSample, update ServiceState. |
| triggers | on boot and after each fetch when `.github/workflows` changed | Parse `on.push.branches` from every workflow YAML in each clone. Store DeployTrigger rows. |
| status | after lag or probe finishes | Recompute CellStatus. If a cell's colour changed, append a StatusChange. |

Workflow parsing: a real YAML parser is worth the dependency. Match each `branches` entry against real refs. A branch that appears only in a workflow with no matching ref is a broken trigger; record it with `mode: none` and keep the file name so the drill-down can say which file.

## 6. Storage

- Config: `server/data/clients.json`, same folder and style as the existing `repos.json`. Written only by the wizard endpoints.
- History: SQLite at `server/data/status.db` through `node:sqlite`, which is available in the Node version in use. Tables: `probe_samples`, `status_changes`, `lag_edges` (latest per edge, overwritten). Retain probe samples 30 days; delete older rows once a day.
- Everything else is recomputed and held in memory.

## 7. API

Prefix `/api`, alongside the existing routes.

| Method and path | Returns or does |
|---|---|
| `GET /board` | Every client with its CellStatus per environment plus the shared development and agentpay rows. One call renders the front page. Includes `generatedAt`. |
| `GET /clients` | Config list. |
| `GET /clients/:id` | Config plus full derived detail: services with state and last 24 h of samples, lag edges, deploy triggers, status changes. Feeds the client page. |
| `POST /clients`, `PUT /clients/:id`, `DELETE /clients/:id` | Wizard writes. Validate that every `repoId` exists in Brancher's repo list and every branch exists as `origin/<branch>`. |
| `GET /discover/branches?repoId=` | Branch names with last commit date, for the wizard's pickers. Reuse `LocalSource.branches()`. |
| `POST /discover/probe` body `{ url }` | One immediate probe, returns status and latency. Wizard uses it live. |
| `GET /discover/triggers?repoId=` | DeployTrigger rows for that repo. |
| `GET /clients/:id/history?hours=24` | Status changes and probe samples for charts. |

Errors follow the existing `HttpError` pattern.

## 8. Frontend

### Routes

| Route | Page | Sidebar |
|---|---|---|
| `/` | Board | none |
| `/c/:clientId` | Client page | none, has a "back to board" link |
| `/c/:clientId/setup` and `/c/new` | Wizard | none |
| `/r/:repoId/:tab?` | Existing repo tabs | existing sidebar, unchanged |

The old home redirect to the first repo goes away. The repo sidebar is only rendered under `/r/`.

### Board

- One row per client, plus a shared "Development" row at the top and an "agentpay" row. Columns: Staging, Production, Mirror. Cells with no environment configured show a dim "none".
- Cell content: colour dot, word, one sentence, "Deployed <ago>", optional "auto-deploy off". Service tags underneath, coloured only when they are the reason for the state.
- Header: title, "Updated <n> s ago", count of clients needing attention.
- Refetch every 30 s. Dark theme default on this route. `?kiosk=1` hides the header links and enlarges type for a wall screen.
- Plain words only. No shas, branch names or percentages on this page.

### Client page

Layout is deliberately not fixed here. It could not be settled by discussion and should be prototyped once the API exists, then adjusted from one line of feedback. Minimum content, in whatever arrangement:

- The client's cells again, larger, with all services and their latency.
- For each bound repo, a horizontal promotion rail: development → staging → production → mirror, one box per environment naming the primary branch and the feeder set, with the lag numbers on each edge (real commits, merge commits, files, oldest age). Each edge links to Brancher's Compare tab with `base` and `head` prefilled.
- Deploy triggers per repo per environment: on, off, or broken, with the workflow file name.
- Last 24 h strip per service from probe samples.
- Recent status changes.
- Edit button to the wizard.

### Wizard

Steps, each backed by discovery, each editable later since the same screens are the editor:

1. **Client**: name, region, optional threshold override.
2. **Repos**: pick from Brancher's repo list. Default all of oribet-monorepo, oribet-admin, api-laravel.
3. **Environments**: for each of staging, production, mirror decide whether it exists. Development is shared and not asked.
4. **Branches**: for each environment and each repo, multi-select from real branches, sorted by recency, with a fuzzy suggestion from the environment name and client region. Show the deploy trigger state next to each candidate.
5. **Domains**: enter the site domain per environment. Propose `admin.`, `api.` with `/health-check`, and the optional `ws.`, `chat.`, `pay.` off by default. Every field is overridable. Probe all of them live and show the result inline before saving.
6. **Review and save.**

Delete lives on the client page behind a confirmation, same wording style as the existing repo removal.

## 9. Reuse from Brancher

| Existing | Reused for |
|---|---|
| `server/src/sources/local.ts` `position`, `compare`, `branches`, `fetch` | Lag numbers, discovery, fetch loop, drill-down links |
| `server/src/repos.ts` | Repo registry and id resolution for RepoBinding |
| `server/src/cache.ts` | Memoising `/board` between recomputes |
| `server/src/errors.ts` | Validation errors from the wizard |
| `web/src/api.ts` React Query setup | New hooks follow the same pattern |
| `web/src/components/ui.tsx` | Card, Stat, Empty, ErrorBox, Segmented |
| `web/src/pages/CompareTab.tsx` | Deep-link target from lag edges |

Nothing existing is removed. The only behaviour change to existing code is the home route.

## 10. Phasing

Each phase ends usable.

**Phase 1, board.** Domain model, config loader, fetch and lag loops, probe loop, SQLite, status rules, `/board`, board page with kiosk mode. Config is hand-edited from `clients.example.json`. Outcome: the wall screen works.

**Phase 2, drill-down.** `/clients/:id`, client page with promotion rails linking into Compare, probe history strip, status changes. Prototype the layout, adjust once.

**Phase 3, wizard.** Discovery endpoints, the six steps, edit and delete. Deploy-trigger parsing and the "auto-deploy off" line on cells.

**Later, not planned here.** Alert adapter consuming StatusChange (Slack webhook already exists in CI secrets). Additional health adapters. testautomation results (Allure from GitHub Actions) as a new service kind. Running-version detection via a version endpoint or Actions run history.

## 11. Acceptance for phase 1

- With `clients.example.json` copied to `server/data/clients.json` and the four repos cloned beside brancher, `pnpm dev` starts, the board shows every client, and every cell has a colour within one minute.
- Stopping a site, or pointing a service at a dead URL, turns its cell red within about 60 s and back to green within about 30 s of recovery. Never flips on a single failed probe.
- Pushing a commit to `develop` in any bound repo changes the staging lag numbers after the next fetch without a restart.
- A repo whose environment branch has no live push trigger shows "auto-deploy off" on that cell.
- The board page contains no sha, branch name or percentage.
- `pnpm typecheck` passes. No `any`.

## 12. Risks

- **Two feeders per staging** means "what is on staging" is a guess by recency. Acceptable because "pushed equals deployed" was chosen; revisit when running-version detection arrives.
- **Broken triggers are common.** Without the "auto-deploy off" line the board would lie. Ship it in phase 3 at the latest; earlier if cheap.
- **Probing from one office machine** measures one path to each site. A local network problem paints everything red. The header should show when the probe host itself cannot reach a known-good control URL, and hold colours instead of flipping.
- **Node version.** `node:sqlite` needs Node 22.5 or later. The machine runs 26. Pin `engines` in package.json.
