- 1. Goals, constraints, defaults
  - 1.1 Developer experience goals
    - 1.1.1 Monolith-first default (zero-config)
    - 1.1.2 Spring Boot–like conventions and sane defaults
    - 1.1.3 Advanced control without fighting the framework
  - 1.2 Architectural constraints
    - 1.2.1 Build-time vs runtime separation (constructs vs DI)
    - 1.2.2 Physical handler files per DU
    - 1.2.3 Route params style `{id}`
  - 1.3 Default DU strategy
    - 1.3.1 APIs: single DU by default
    - 1.3.2 Queues: one DU per queue-handler
    - 1.3.3 Tasks: one DU per task-handler
    - 1.3.4 Streams: one DU per stream-handler
    - 1.3.5 Special DUs (audit/search): needs: ['allEntities']

- 2. Module system (dual-surface contract)
  - 2.1 Build-surface
    - 2.1.1 buildExports: env (incl. SSM/Secrets), policies
    - 2.1.2 Infra hints (optional constructs/resources)
    - 2.1.3 Assets and outputs exposure
  - 2.2 Runtime-surface
    - 2.2.1 runtimeProviders(): DI providers/entities/services
    - 2.2.2 Capability declarations: controllers/queues/tasks/streams
    - 2.2.3 Tags for grouping (e.g., 'audit', 'search', 'allEntitiesExporter')
  - 2.3 Module dependencies
    - 2.3.1 imports:[] and versioning
    - 2.3.2 Topological order
    - 2.3.3 Cycle detection and errors

- 3. Manifest (generated, no code execution)
  - 3.1 Minimal schema
    - 3.1.1 modules[]
    - 3.1.2 capabilities[]
    - 3.1.3 entities[]
    - 3.1.4 deploymentUnits[]
    - 3.1.5 resourceIntents[]
    - 3.1.6 env/secrets
  - 3.2 Extraction rules
    - 3.2.1 Decorator metadata and explicit registries
    - 3.2.2 Merge code-level vs decorator config
    - 3.2.3 Light static analysis; no synth-time imports
  - 3.2.4 Verified: Controllers/tasks/queues auto-export handlers via decorators; synth must not import app code (current constructs do)
  - 3.3 Validation
  - 3.3.1 Schema validation (manual TypeScript validation)
    - 3.3.2 Module graph/toposort
    - 3.3.3 Resource intents completeness
    - 3.3.4 Provider variant coverage (tenant/version/flags)

- 4. Deployment units (DUs)
  - 4.1 Default strategies (practical)
    - 4.1.1 API as single DU
    - 4.1.2 Per-queue DU
    - 4.1.3 Per-task DU
    - 4.1.4 Per-stream DU
    - 4.1.5 Audit/search DUs with needs: ['allEntities']
  - 4.2 Developer-controlled modes
    - 4.2.1 perModule
    - 4.2.2 perType (controllers|queues|tasks|streams)
    - 4.2.3 custom mixed groups
  - 4.3 Hierarchical overrides
    - 4.3.1 Levels: defaults → group → DU → capability
    - 4.3.2 Merge rules (replace/merge-by-key)
    - 4.3.3 Examples
  - 4.4 DU routing/integration
    - 4.4.1 API DUs: in-process router
    - 4.4.2 Queue/task/stream DUs: direct handler mapping

- 5. DI model and selectors
  - 5.1 Unit-scope and request-scope containers
    - 5.1.1 Warm container per DU
    - 5.1.2 Request-scoped child for each invocation
  - 5.2 Provider variants
    - 5.2.1 selector: { tenantId?, version?, featureFlag? }
    - 5.2.2 Specificity precedence + priority
    - 5.2.3 Entity variants (schemas/services)
  - 5.3 Cross-cutting resolvers
    - 5.3.1 Audit/search middlewares
    - 5.3.2 “All entities” inclusion for special DUs

- 6. Env/secrets and IAM
  - 6.1 Env precedence
    - 6.1.1 defaults < app < module < DU < capability
    - 6.1.2 zod validation
  - 6.2 Secrets handling
    - 6.2.1 SSM/SecretsManager refs
    - 6.2.2 Resolution by infra; no plaintext in repo
  - 6.3 Resource intents → least-privilege IAM
    - 6.3.1 Tables/indexes/buckets/queues/topics
    - 6.3.2 Deny wildcards by default; per-DU escape hatch

- 7. Build pipeline and codegen
  - 7.1 Manifest generation
    - 7.1.1 ts-morph scanning + registries
    - 7.1.2 Merging and validation
  - 7.2 DU bootstrap generation
    - 7.2.1 Deterministic imports
    - 7.2.2 RuntimeProviders registration
    - 7.2.3 Router/handler wiring
  - 7.3 Bundling and shared layers
    - 7.3.1 esbuild/rollup with metafile
    - 7.3.2 Up to N vendor layers; size caps
    - 7.3.3 Pinning libraries into DU bundle if needed

- 8. CDK consumption
  - 8.1 Provisioning from manifest
    - 8.1.1 One RestApi; map routes to API DU(s)
    - 8.1.2 One Lambda per DU; env/IAM injection
    - 8.1.3 Queue/schedule/stream bindings
  - 8.2 Module infra hints
    - 8.2.1 Provision resources (topics/buckets)
    - 8.2.2 Wiring via named outputs

- 9. Code organization guidelines
  - 9.1 Capability file-per-handler
  - 9.2 Static imports only
  - 9.3 Explicit module registries (optional)
  - 9.4 Avoid top-level DI side-effects

- 10. Testing and CI
  - 10.1 Unit tests (DI selectors, merge rules)
  - 10.2 Integration tests (DU bootstrap, local router)
  - 10.3 CDK assertions (resources/IAM/env)
  - 10.4 CI checks (manifest build, size reports)

- 11. Migration plan
  - 11.1 Phase 1: Read-only manifest + reports
  - 11.2 Phase 2: Single API DU + per-handler DUs for queues/tasks/streams
  - 11.3 Phase 3: Special DUs (audit/search) + least-privilege IAM
  - 11.4 Phase 4: Custom DU mappings + shared layers caps
  - 11.5 Phase 5: Hardening (observability, docs, templates)

- 12. Risks and mitigations
  - 12.1 Module authoring discipline
  - 12.2 Variant complexity
  - 12.3 Bundle/layer tuning
  - 12.4 Inter-module dependency cycles

## 1. Goals, constraints, defaults (details)

### 1.1 Developer experience goals
- **Monolith-first default (zero-config)**: One DU for APIs by default; queues/tasks/streams auto-deployed per-handler.
- **Conventions and sane defaults**: Minimal required config; env validation; least-privilege IAM derived from intents.
- **Advanced control**: Opt-in DU customization modes (perModule/perType/custom) and hierarchical overrides.

### 1.2 Architectural constraints
- **Strict build/runtime separation**: Constructs operate at synth time; DI runs inside Lambda only.
- **Physical handler per DU**: Deterministic, generated bootstrap per DU becomes the Lambda handler file.
- **Route style**: Controllers use `{id}` style route params consistently.
  - Verified in code: method decorators store routes as `METHOD|/path` with `{param}` segments, and API router converts `{param}` → path-to-regexp at runtime for matching.

### 1.3 Default DU strategy
- **APIs**: Single DU `api` hosting all controllers with an in-process router.
- **Queues**: One DU per queue handler.
- **Tasks**: One DU per scheduled task handler.
- **Streams**: One DU per stream handler.
- **Special DUs**: Audit/Search define `needs: ['allEntities']` to include all entity providers.

## 2. Module system (dual-surface contract) (details)

### 2.1 Build-surface
- `buildExports` (optional):
  - `env`: map of string values or references `{ from: 'ssm'|'secretsManager', name }`.
  - `policies`: named policy snippets that can be exported/consumed.
  - `assets`: optional static assets to publish.
  - `constructs`: optional infra hints (e.g., buckets/topics) to be provisioned.

### 2.2 Runtime-surface
- `runtimeProviders(ctx)`: returns array of DI providers (services/config/schemas), with optional `selector` for tenant/version/flags and `priority`.
- Capabilities can be discovered via decorators or explicit registries exported by the module.
- Tags (e.g., `audit`, `search`, `allEntitiesExporter`) help group capabilities during DU selection.

### 2.3 Module dependencies
- `imports: ModuleName[]` supports composition and reuse; generator topo-sorts modules; cycles are errors with clear messages.

### 2.x Example module contract (proposed)
```ts
// posts.module.ts
export const PostsModule: ModuleContract = {
  name: 'posts',
  version: '1.0.0',
  imports: [ 'core' ],
  buildExports: {
    env: { POSTS_MAX_RETRIES: '3' },
    policies: { 'posts:list-bucket': {/* ... */} },
  },
  runtimeProviders(ctx) {
    return [
      { provide: 'PostsConfig', kind: 'config', useValue: { softDelete: true } },
      { provide: PostSchemaProvider, kind: 'schema', forEntity: 'post' },
      { provide: PostService, kind: 'service', forEntity: 'post' },
    ];
  },
  capabilities: [
    { kind: 'controller', file: './controllers/post.controller.ts', exportName: 'PostController' },
    { kind: 'queue', file: './queues/post-import.queue.ts', exportName: 'PostImportQueueHandler' }
  ],
  tags: [ 'search' ]
}
```

## 3. Manifest (generated, no code execution) (details)

### 3.1 Minimal schema (TypeScript)
```ts
export type SecretRef = { from: 'ssm'|'secretsManager'; name: string };

export interface Manifest {
  manifestVersion: '1.0.0';
  app: {
    name: string;
    version: string;
    defaults?: {
      functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64'|'x86_64' };
      env?: Record<string, string | SecretRef>;
    };
  };

  modules: ModuleDescriptor[];
  entities: EntityDescriptor[];
  capabilities: CapabilityDescriptor[];
  resourceIntents: ResourceIntent[];
  deploymentUnits: DeploymentUnitDescriptor[];

  sharedLayersPlan?: {
    maxLayers: number;
    maxLayerSizeMB: number;
    assignments: Array<{ layerName: string; includes: string[] }>; // chunk ids or module ids
  };
}

export interface ModuleDescriptor {
  name: string;
  version?: string;
  path: string;
  imports?: string[];
  buildExports?: {
    env?: Record<string, string | SecretRef>;
    policies?: Record<string, any>;
    assets?: Array<{ source: string; target: string }>;
    constructs?: Array<{ type: string; props: any }>;
    // Proposed: support layering and warmup
    layers?: Array<{ name: string; includes?: string[] }>;
    entryPackages?: string[];
  };
  runtime?: {
    providers?: ProviderDescriptor[];
    entities?: EntityRef[];
    capabilities?: CapabilityRef[];
    tags?: string[];
  };
}

export interface EntityRef {
  name: string;
  schemaProviderToken?: string;
  providerToken?: string;
}

export interface CapabilityRef {
  kind: 'controller'|'queue'|'task'|'stream';
  file: string;        // path to source file (module-relative or absolute)
  exportName: string;  // exported symbol to load (class/function)
  tags?: string[];
}

export interface ProviderDescriptor {
  provide: string; // token/class id
  kind: 'service'|'config'|'schema'|'other';
  forEntity?: string;
  priority?: number;
  selector?: { tenantId?: string; version?: string; featureFlag?: string };
  tags?: string[];
  // optional registration hints (manifest-safe references)
  useClassToken?: string;     // referenced class token/name
  useFactoryToken?: string;   // referenced factory token/name
  useValue?: any;             // serializable value
}

export interface EntityDescriptor {
  name: string;
  schemaProviderToken: string;
  variants?: Array<{ selector: ProviderDescriptor['selector']; providerToken: string }>;
  tags?: string[];
}

export interface CapabilityDescriptor {
  id: string;
  kind: 'controller'|'queue'|'task'|'stream';
  sourceFile: string;
  exportName: string;
  routing?: { 
    basePath?: string; 
    routes?: Array<{ 
      method: string; 
      path: string;
      // Proposed: authorizer and targets as captured from decorators
      authorizer?: { type: 'AWS_IAM'|'COGNITO'|'JWT'|'CUSTOM'|'NONE'; name?: string; groups?: string[]; requireRouteInGroupConfig?: boolean } | 'AWS_IAM'|'COGNITO'|'JWT'|'CUSTOM'|'NONE';
      target?: 'function'|'queue'|'topic';
      targetName?: string; // for queue/topic mapping when target != function
    }> 
  };
  schedule?: { rate: string };
  queue?: { name: string };
  stream?: { source: 'dynamodb'|'kinesis'; table?: string; streamArn?: string };
  tags?: string[];
  requires?: {
    modules?: string[];
    entities?: Array<string | { tag: string } | { name: string; variant?: { tenantId?: string; version?: string; featureFlag?: string } }>;
    env?: Record<string, string | SecretRef>;
    resourceIntents?: ResourceIntent[];
  };
  configSources?: { decorators?: any; code?: any; merged?: any };
  diagnostics?: BuildDiagnostic[]; // proposed: non-fatal issues recorded during extraction
}

export type BuildDiagnostic = {
  level: 'info'|'warn'|'error';
  code: string; // e.g., ROUTE_CONFLICT, AMBIGUOUS_VARIANT
  message: string;
  hint?: string;
  source?: { file: string; line?: number; symbol?: string };
}

export interface ResourceIntent {
  kind: 'table'|'index'|'bucket'|'queue'|'topic'|'parameter'|'secret';
  name: string;
  permissions: Array<'read'|'write'|'publish'|'subscribe'|'list'|'describe'>;
  scope?: { index?: string; prefix?: string };
}

export interface DeploymentUnitDescriptor {
  name: string;
  kind: 'api'|'worker'|'stream'|'mixed';
  include?: {
    modules?: Array<string|{ tag: string }>;
    capabilities?: Array<string|{ kind: CapabilityDescriptor['kind']; tag?: string }>;
  };
  exclude?: { capabilities?: string[] };
  needs?: Array<'allEntities'|'allSchemas'|'allServices'>;
  functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64'|'x86_64' };
  env?: Record<string, string | SecretRef>;
  iam?: { allowWildcard?: boolean; justification?: string }; // justification required if allowWildcard is true
  routing?: { domain?: string; stage?: string; basePath?: string; apiName?: string }; // apiName proposed for multi-API
  // Proposed: logging controls at DU-level
  logging?: { logRetentionDays?: number; logRemovalPolicy?: 'DESTROY'|'RETAIN' };
}
```

### 3.2 Extraction rules
- Use decorator metadata + optional explicit registries; no module evaluation at synth.
- Merge code-level config (Application/DU) over decorator defaults; record provenance in `configSources`.
- Light static analysis for route paths/methods; `{id}` normalization.
- Conflict detection: detect duplicate `(method, fullPath)` across controllers; emit ROUTE_CONFLICT diagnostics with file/symbol.

### 3.3 Validation
- Manual TypeScript validation (no external schema lib):
  - Narrow types via type guards; collect errors with codes and hints.
  - Validate required fields and basic constraints (ids, paths, kinds, permissions).
- Toposort modules; detect cycles and emit actionable errors.
- Ensure every capability declares resource intents (or deny by default).
- Provider variants coverage checks to flag ambiguous selectors.

## 3.4 DeploymentUnitsConfig schema (authoring)
```ts
export type Match = {
  kind?: 'controller'|'queue'|'task'|'stream';
  module?: string;     // module name
  tag?: string;        // capability or module tag
  id?: string;         // capability id (format: `${module}:${kind}:${exportName}`)
  basePath?: string;   // for controller base path grouping
};

export interface DeploymentUnitsConfig {
  mode?: 'default'|'perModule'|'perType'|'custom';
  defaults?: {
    functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64'|'x86_64' };
    env?: Record<string, string | SecretRef>;
    iam?: { allowWildcard?: boolean };
  };
  groups?: Array<{
    match: Match;
    functionProps?: { memorySize?: number; timeout?: number; arch?: 'arm64'|'x86_64' };
    env?: Record<string, string | SecretRef>;
    iam?: { allowWildcard?: boolean };
  }>;
  units?: Array<DeploymentUnitDescriptor>; // as defined in manifest schema
}
```

## 3.5 Manifest versioning and provider tokens
- Add `manifestVersion: '1.0.0'` to `Manifest`.
- Provider tokens must be stable strings: `namespace.tokenName` (e.g., `posts.PostService`).
- `useClassToken`/`useFactoryToken`/`schemaProviderToken` must use the same tokenization.

```ts
export interface Manifest {
  manifestVersion: '1.0.0';
  // existing fields...
}
```

## 4. Deployment units (DUs) (details)

### 4.1 Default strategies (practical)
- API → single DU `api`.
- Queues → one DU per queue handler.
- Tasks → one DU per task handler.
- Streams → one DU per stream handler.
- Audit/Search → separate DUs with `needs: ['allEntities']`.

### 4.2 Developer-controlled modes
- `mode: 'default'|'perModule'|'perType'|'custom'`.
- `perModule`: one DU per module, with override ability to merge/split.
- `perType`: DUs by capability type (controllers/queues/tasks/streams), still one per handler for non-API.
- `custom`: explicit DU lists.

### 4.3 Hierarchical overrides
- Levels: `defaults → group(match) → DU → capability` (use capability-level sparingly).
- Merge: primitive replace; arrays merged by unique id; maps shallow-merged.
- Example:
```ts
deploymentUnits: {
  mode: 'default',
  defaults: { functionProps: { timeout: 15 } },
  groups: [
    { match: { kind: 'queue' }, functionProps: { memorySize: 768 } },
    { match: { module: 'posts' }, env: { POSTS_MAX_RETRIES: '5' } },
  ],
  units: [
    { name: 'webhooks-post', include: { modules: ['posts'] }, exclude: { capabilities: ['posts:controller:UserController'] }, functionProps: { timeout: 30 } },
    { name: 'audit-stream', include: { capabilities: [{ kind: 'stream', tag: 'audit' }] }, needs: ['allEntities'] },
  ]
}
```

### 4.4 DU routing/integration
- API DUs: generated router dispatches to controller methods; consistent middlewares.
- Queue/Task/Stream DUs: direct event handler mapping; no extra routing.
  - Verified: current router matches `{param}` with path-to-regexp conversion and prioritizes more literal segments.

## 5. DI model and selectors (details)

### 5.1 Scopes
- Unit-scope DI container (warm) per DU.
- Request-scope child per invocation; carries `tenantId`, `featureFlags`, `versionLabels`.

### 5.2 Provider variants (proposed)
- Selector precedence: (tenantId+version+flag) > (tenantId+version) > (tenantId) > (version) > (flag) > default; ties broken by `priority`. (Proposed; current DI supports tags and numeric `priority`, no selector object.)
- Entities can declare schema/service variants the same way; stream/audit DUs include all variants; selection occurs per-record if needed. (Proposed)

### 5.3 Cross-cutting
- Middlewares for request context, auth, audit, search; installed in bootstrap in fixed order.
  - Verified capability: APIController supports global middleware via `useMiddleware`; order is insertion-based. Specific middleware implementations are app-defined.

## 6. Env/secrets and IAM (details)

### 6.1 Env precedence (proposed)
- `defaults < app < module < DU < capability` with zod validation; fail early on conflicts/unresolved refs. (Proposed; current system merges Application-level env + global env + per-capability `env` into functions.)

### 6.2 Secrets
- Use SecretRef; CDK resolves and injects; never commit plaintext.

### 6.3 Resource intents → IAM
- Tables/indexes/buckets/queues/topics/params/secrets with granular permissions.
- Deny wildcard by default; explicit `allowWildcard` per DU logs rationale.
  - Governance: if `allowWildcard` is true, require a non-empty `iam.justification`; warn in synth, gate in CI.

## 6.4 Resource-intent derivation rules
- Controllers: union of controller-level resourceAccess + entity-derived intents (if declared) + module infra hints explicitly referenced.
- Queues/tasks: handler-level resourceAccess + queues/buckets/topics they bind to.
- Streams: implied read access to the source stream/table + entity set declared by `needs` (often allEntities).
- Defaults: deny any access not declared; build fails if capability references a resource without an intent.

## 7. Build pipeline and codegen (details)

### 7.1 Manifest generation
- ts-morph scans decorators/registries; merges code-level overrides; writes `app.manifest.json`.

### 7.2 DU bootstrap generation
- One TS file per DU with deterministic imports (topo-ordered modules), provider registration, router/handler wiring, middlewares, and `export const handler`.

### 7.3 Bundling and shared layers
- Use esbuild/rollup with metafile to extract up to N vendor layers; defaults N=1 with size cap.
- Allow pinning libraries (e.g., `@aws-sdk`) into DU bundle or vendor layer based on cold start.
- Emit per-DU bundle report (size, deps, shared chunks) to guide tuning.

## 7.4 Observability baseline
- Middleware injects: correlationId (requestId), actor (if available), DU name, capability id, latency.
- Logs: structured JSON with level, context, and error fields.
- Metrics: success/error counts, p50/p95 latency per capability.

## 8. CDK consumption (details)

### 8.1 Provisioning from manifest
- Create one `RestApi` (or more if configured) and map controllers to the `api` DU Lambda integration.
- Create one Lambda per DU; inject env; attach IAM from intents; set memory/timeout/arch.
- Create schedules, event source mappings (queues/streams) and bind handlers.
  - Verified current state: APIConstruct scans controllers at synth (imports app code) and registers handlers; migration plan replaces this with manifest consumption.

### 8.2 Module infra hints
- Provision declared resources (buckets/topics) in dependency order; expose outputs by name; wire cross-DU dependencies.

## 9. Code organization guidelines (details)
- Capability per file; avoid coupling.
- Static imports only; no runtime `require` based on env.
- Optional explicit registries to avoid heavy AST work.
- No top-level DI registration; only via `runtimeProviders()`.

## 10. Testing and CI (details)
- Unit tests: DI selector precedence, override merging, manifest schema.
- Integration: DU bootstrap + local router; event routing for non-API DUs.
- CDK assertions: resources created, IAM least-privilege, env injection.
- CI: build manifest, bundle, enforce size caps, print reports.

## 10.5 Testing matrix for selectors
- Cases:
  - tenant-only selector
  - version-only selector
  - tenant+version combined
  - featureFlag-only
  - default fallback
- Assertions:
  - Most-specific match wins; ties resolved by `priority`.
  - Request-scope context controls selection; unit-scope holds all variants.
  - Ambiguity checks: overlapping selectors with equal specificity must emit AMBIGUOUS_VARIANT error.

## 11. Migration plan (details)
- Phase 1: Generate manifest read-only; report controllers/capabilities/modules/entities/resources.
- Phase 2: Switch to single API DU + per-handler DUs for queues/tasks/streams; remove synth-time imports and runtime entryPackages.
- Phase 3: Create audit/search DUs with `needs: ['allEntities']`; enable least-privilege IAM.
- Phase 4: Enable custom DU mappings; introduce shared vendor layer caps and tuning reports.
- Phase 5: Add observability baseline, docs, templates; finalize authoring guidelines.

## 12. Risks and mitigations (details)
- Module authoring discipline: provide templates, lint rules, and examples.
- Variant complexity: strong tests and diagnostics for selector coverage; clear fallback rules.
- Bundle/layer tuning: default caps + reports; knobs to pin libs.
- Dependency cycles: topo-sort with explicit cycle errors and remediation tips.

## 12.5 Security override governance
- `iam.allowWildcard: true` requires a justification string; emit a CDK warning with the reason and list of affected intents.
- CI policy: wildcard usage count must remain under a threshold; otherwise fail.
  - Proposed CI thresholds and messages included in diagnostics section.

## 13. Examples

### 13.1 Generated manifest (excerpt)
```json
{
  "app": { "name": "my-app", "version": "1.0.0" },
  "modules": [
    {
      "name": "posts",
      "path": "packages/posts",
      "imports": ["core"],
      "runtime": {
        "providers": [
          { "provide": "PostsConfig", "kind": "config", "useValue": { "softDelete": true } },
          { "provide": "PostSchemaProvider", "kind": "schema", "forEntity": "post" },
          { "provide": "PostService", "kind": "service", "forEntity": "post" }
        ],
        "capabilities": [
          { "kind": "controller", "file": "./controllers/post.controller.ts", "exportName": "PostController" },
          { "kind": "queue", "file": "./queues/post-import.queue.ts", "exportName": "PostImportQueueHandler" }
        ]
      }
    }
  ],
  "deploymentUnits": [
    { "name": "api", "kind": "api" },
    { "name": "post-import-queue", "kind": "worker", "include": { "capabilities": [ { "kind": "queue", "tag": "post-import" } ] } },
    { "name": "audit-stream", "kind": "stream", "needs": ["allEntities"], "include": { "capabilities": [ { "kind": "stream", "tag": "audit" } ] } }
  ]
}
```

### 13.2 DU bootstrap (sketch)
```ts
// .fw24/.generated/du-api.bootstrap.ts
import { createUnitContainer } from '@fw24/runtime/di';
import { registerProviders } from '.fw24/.generated/providers-api';
import { createRouter } from '@fw24/runtime/router';
import controllers from '.fw24/.generated/controllers-api';
// Proposed: middlewares are explicitly imported per DU; ordering is [ requestContext, auth, audit, ...custom ]
import { requestContext, auth, audit } from '@fw24/runtime/middlewares';

const unit = createUnitContainer();
registerProviders(unit);
const router = createRouter(controllers, unit, [ requestContext, auth, audit ]);
export const handler = router.lambdaHandler();
```

## 14. Diagnostics and CLI (proposed)

### 14.1 Diagnostics
- ROUTE_CONFLICT [error]: duplicate `(METHOD, path)` across controllers, includes sources.
- AMBIGUOUS_VARIANT [error]: multiple provider variants with identical specificity and priority.
- ENV_OVERRIDE [warn]: env overridden at higher-precedence level, includes provenance.
- IAM_WILDCARD [error]: `iam.allowWildcard` true without `justification`.

### 14.2 CLI
- `fw24 manifest:build` — build manifest without side effects; emits diagnostics.
- `fw24 du:gen` — generate DU bootstraps from manifest.
- `fw24 bundle:report` — print DU size/layer allocation from bundler metafile.
- `fw24 du:plan --explain` — show how capabilities map to DUs based on config.

## 15. Acceptance criteria
- System controllers as core module
  - The framework ships system controllers (e.g., `/system/search`). Represent them as capabilities in a `fw24-core` module in the manifest with `kind: 'controller'`, real `sourceFile`/`exportName`, and tag `'system'`.
  - Infra should consume them like any other capability; no special synth-time copy/registration.

## 16. Search indexing representation (proposed)
- Represent search indexer as a worker capability linked to the table stream or a queue handler:
  - `kind: 'stream'` with `stream: { source: 'dynamodb', table: string }`, or `kind: 'queue'` with `queue: { name: string }`.
- Record engine config as env refs at module/buildExports or DU-level env:
  - `SEARCH_INDEXER_TABLE_NAME_ENV_KEY`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `ALLOWED_ENTITY_NAMES`.
- Use `needs: ['allEntities']` for indexer DU when all entities should be considered; allow narrowing via `requires.entities`.

## 17. Migration notes (resourceAccess, policies, UI-config)
- resourceAccess → resourceIntents
  - For each controller/task/queue, translate existing `resourceAccess` into `ResourceIntent[]`.
  - Existing named `policies` pass through unchanged; manifest includes them and infra attaches accordingly.
- Entity CRUD defaults
  - Default intents for entity controllers: allow table read/write on the entity’s table unless overridden explicitly.
- UI-config generator
  - Replace DI/runtime scanning with manifest-driven inputs: use `modules.runtime.providers`, `entities`, and `capabilities` to build UI config.

## 18. Manifest evolution and compatibility (proposed)
- Versioning:
  - `manifestVersion` follows semver for schema changes; generator emits both `manifestVersion` and `generatorVersion`.
  - Add `compat: { minInfraVersion, minRuntimeVersion }` to block incompatible deployments.
- Deprecations:
  - Mark fields with `deprecated: true` and emit diagnostics; support shims for one major version.
- Extensions:
  - `extensions?: Record<string, any>` namespaced by module (`vendor.feature`) to carry optional metadata without schema churn.

## 19. Resilience controls (proposed)
- DU-level resilience policy:
  - `retries`, `backoff`, `dlq` for queues/tasks/streams; `throttling` and `circuitBreaker` hints for APIs.
  - Idempotency config: `idempotencyKeySource`, `ttl`; generator adds middleware stub and env.

## 20. Performance budgets and bundling hints (proposed)
- Budgets:
  - Per-DU cold start and P95 budgets; CI fails when budgets are exceeded.
- Hints:
  - `bundleHints: { hoistDeps?: string[], pinDeps?: string[], externalize?: string[] }` and `runtimeProfile: 'latency'|'throughput'`.
- Reports:
  - Persist per-DU bundle metrics (size, init time estimate) for trend analysis.

## 21. Security and secrets lifecycle (proposed)
- Policy composition:
  - Allow composing named policies with parameters; render under least-privilege with variable substitution.
- Secrets lifecycle:
  - `secrets: { rotation?: '30d'|'60d'|'90d', provider?: 'secretsManager'|'ssm', scope?: 'DU'|'GLOBAL' }` with diagnostics if missing.
- Data classification:
  - Tag capabilities/entities as `public|internal|restricted`; CI enforces cross-boundary comms and logging redaction.

## 22. Observability SLOs and CI gates (proposed)
- SLOs:
  - Per-capability SLOs: `availability`, `latency`, `errorRate`; exported as metrics and enforced by CI dashboards.
- Tracing:
  - First-class trace config `tracing: 'X-Ray'|'OpenTelemetry'` with sampling rate; DU bootstrap includes instrumentation hook.
- CI gates:
  - Fail on SLO regression thresholds; surface flamegraphs (when enabled) per DU.

## 23. Developer ergonomics (proposed)
- Local emulation:
  - `fw24 dev` spins a local API router, queue/task schedulers, and mock search; reads manifest.
- Test harness hooks:
  - Generated per-DU harness entry with `LambdaTestHarness` integration and fixture points for env/DI/middlewares.

## 24. Multi-tenancy and canarying strategy (proposed)
- Canary DUs:
  - Allow `selector` on DUs for canary label (e.g., version or feature flag); router forwards based on header or token claim.
- Tenant isolation:
  - Optional tenant-scoped DUs (namespaced env/iam) or runtime selection through DI; document tradeoffs and costs.

## 25. Capability graph and dependency model (proposed)
- Graph:
  - Build a capability-level DAG from `requires` and resource references; detect cycles and missing dependencies.
- Ordering:
  - Codegen imports in topological order and ensures module/provider availability before bootstrap.

## 26. Scanning efficiency and registries (proposed)
- Explicit registries:
  - Encourage each module to export capability registries; generator uses them to avoid AST where available.
- Caching:
  - Cache AST results by file hash; partial rebuilds only re-scan changed files; parallel scan across packages.

## 27. Extensibility for new capability kinds (proposed)
- New kinds:
  - Support `websocket`, `eventBridge`, `graphql` in the future via plugin hooks.
- Plugin surface:
  - `plugins: { build?: Function[], runtime?: Function[] }` to add generators or middlewares without forking the framework.
- Schema frozen: `Manifest`, `DeploymentUnitDescriptor`, and token formats with `manifestVersion: '1.0.0'`.
- Verified rules: route normalization `{id}` and conflict detection; DI selector precedence; wildcard governance.
- Bootstrap contract: deterministic imports, middleware insertion points, `export const handler` per DU.
- Tests enumerated: route conflicts, selector precedence/ambiguity, env precedence, IAM intents coverage, bundle/layer caps.
- CI integration: diagnostics surfaced; thresholds for wildcard usage and bundle caps; non-zero error diagnostics fail.

## 28. Phase 1 deliverables (authoritative)
- Manifest generation and extraction
  - Extract routes with `method/path/authorizer/target/targetName` using explicit registries first; AST fallback patterns documented.
  - Translate `resourceAccess` and named `policies` to `resourceIntents` and policy refs.
  - Manual TypeScript validation with clear error codes.
- Infra consumption (minimal)
  - Single API DU; per-handler workers; least-privilege IAM synthesized from intents.
  - System controllers via `fw24-core` module capabilities; no synth-time special paths.
- Reports/artifacts
  - Write `.fw24/out/manifest.json` and `.fw24/reports/{routes.md, capabilities.md, intents.md, bundles.json}`.
  - Include conflict diagnostics and missing-intents errors.
- Tests
  - Authorizer/target extraction fidelity; route conflict detection; resourceAccess→intents mapping; IAM synthesis for AWS_IAM; bundle metrics emission.
- Performance
  - Module capability registries required; file-hash cache and parallel scanning enabled.
