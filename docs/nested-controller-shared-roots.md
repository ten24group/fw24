# Nested controllers & shared root segments

## What this is about

Controllers nested under a shared folder — e.g. `controllers/internal/notifications`,
`controllers/internal/audit` — all serve routes under a shared path segment (`/internal`). fw24
deploys each controller in its own CloudFormation **nested stack**, but the shared `/internal`
segment is a single API Gateway resource that can only be created in **one** stack and referenced
by the others.

## How it works: one owner, decided by config — never by order

The shared root segment is created **exactly once in a stable owner stack** and referenced by every
sibling nested stack via its resource-id token (CDK wires it across stacks automatically). The owner
is fixed by configuration, **never** by which controller registers first — so the segment's
CloudFormation logical id is identical on every synth. This is what removes the historical failures:

- **No more `409 AlreadyExists`** when a new controller sorts before an existing one — nobody races
  to create `/internal`; siblings only reference it.
- **No live AWS calls at synth** — synthesis stays deterministic and offline.
- **No hardcoded root names** — any shared segment (`internal`, `admin`, `webhooks`, …) works.
- **No "deploy twice"** — nested-controller apps set `deploy: false` and publish exactly one
  `Deployment` + one `Stage` after every nested stack is registered, with `api.deploymentStage`
  assigned so usage plans bind to a real stage.

## Choosing a strategy

Set `nestedControllerRootStrategy` on the API construct config. Default is `'main-stack'`. In every
strategy the owner is decided up front (never by registration order), so the 409/ordering bug cannot
occur, and no segment name is ever hardcoded.

| Strategy | Best for | What you configure | Notes |
|----------|----------|--------------------|-------|
| `'main-stack'` *(default)* | **New apps** | Nothing | Main stack owns each root. Zero config, fully offline. An app already deployed with a root in a nested stack moves it once — see below. |
| `'pinned'` | **Already-deployed apps** | `nestedControllerRootOwners: { internal: 'internal/team' }` | Root stays where it already is. Deterministic & offline; moves no live resource. Unlisted roots fall back to the main stack. |
| `'auto'` | **Already-deployed apps in CI/CD** | Nothing | Looks up deployed CloudFormation at build time to discover the current owner (matched by route, not logical id) and keeps the root there. No config, moves no live resource — but the build needs AWS credentials. |

**New app:** do nothing (`'main-stack'`). Add nested controllers in any order, several per deploy.

**Already-deployed app — pick one:**

- **`'auto'` — hands-off, fits CI/CD.** No config. At build time (where CI/CD already has the
  target env's credentials) it queries CloudFormation, finds which controller stack currently owns
  each root, and keeps the root there. Nothing is committed, nothing moves, the deploy doesn't fail.
  Per-environment divergence is handled automatically (each env's build resolves its own state).
  Caveats: the build **needs credentials** — a local `cdk diff` without them, or a genuinely
  ambiguous/dirty deployed state, makes it **fail loud** (it never guesses). For those cases set a
  `nestedControllerRootOwners` entry as an explicit fallback.
- **`'pinned'` — explicit & offline.** Add one line per already-deployed root naming its current
  stack. No credentials needed at build. You find the owner once by looking at the deployed stack
  (the nested stack containing the `/internal` resource). Owners can differ per environment, so set
  per-environment if they diverged.
- **Cleanest end-state: keep the default and `cdk refactor` once per env** (below). Moves `/internal`
  into the main stack so you carry no config or lookup afterward.

## Cleaning up to the zero-config end-state (optional)

Move `/internal` into the main stack **once per environment**, with that account's credentials.

### Recommended: `cdk refactor` (declarative move, no recreate, zero downtime)

```bash
# 1. Build with the new fw24 version (code already targets main-stack ownership; no config needed).

# 2. Preview the move: CDK compares the DEPLOYED stacks to the new synthesis and detects that
#    /internal moved from the nested stack into the main stack.
cdk refactor --dry-run

# 3. Execute the move. CloudFormation relocates the existing /internal resource into the main stack
#    WITHOUT deleting/recreating it. Child routes keep the same physical resource id throughout.
cdk refactor

# 4. From now on, deploy normally.
cdk deploy
```

If `cdk refactor` cannot auto-match the resource, pass an explicit mapping file
(`--mapping-file`) listing the old logical location → new logical location for the `/internal`
resource. Validate on a non-production environment first.

### Fallback: retain → orphan → import (if `cdk refactor` is unavailable)

1. Add `RemovalPolicy.RETAIN` to the existing `/internal` resource in its current nested stack and
   `cdk deploy` — so removing it later will not delete the physical resource.
2. Switch to the new fw24 version (main-stack ownership) and `cdk deploy` the nested stack: it stops
   declaring `/internal`, but the retained physical resource survives (now unmanaged).
3. `cdk import` the existing `/internal` resource into the main stack, matching it by its API
   Gateway resource id. No create, no 409.

Both paths are zero-downtime: the `/internal` resource id never changes, so the child routes in
other nested stacks keep resolving to it the whole time.

### After migration

Every environment owns `/internal` in the main stack — identical everywhere, no per-environment
config, and you never think about shared-root ownership again.

## Known limitations (accepted)

These are intentional boundaries — not gaps to fix in a follow-up redesign:

- **`auto` needs build-time AWS credentials** — local `cdk synth` / `cdk diff` without credentials
  for the target account will fail loud rather than guess an owner. Use `'pinned'` or
  `nestedControllerRootOwners` as an explicit fallback for offline synth.
- **Ambiguous deployed ownership fails loud** — if more than one nested stack already declares the
  same root segment, lookup logs a warning and does not pick a winner silently.
- **`auto` is mock-tested only in unit tests** — validate against real CloudFormation on a non-prod
  environment before relying on `'auto'` in production CI.
- **Brownfield one-time move** — apps that already deployed a shared root inside a nested stack need
  either `'pinned'` / `'auto'`, or a one-time `cdk refactor` (or retain/import) to reach the
  zero-config `'main-stack'` end state. This is migration work, not a deploy-order bug.
- **Supersedes PR #289 / #263 approaches** — do not merge the older nested-controller migration
  handler or synth-introspection lineages; this stable-root design is the supported path.
