# Cross-service trace propagation

A single request-scoped **`traceId`** that flows through the async call stack,
appears on every log line, and rides to downstream services over the
**`x-trace-id`** HTTP header — so one identifier stitches a request together
across service boundaries and log lines.

It is **zero-config** and **backward-compatible**: when nothing establishes a
trace context, everything degrades to a no-op (no `traceId` on logs, no header
on outbound calls, no errors).

---

## Why a dedicated trace id (vs. the existing `correlationId`)

fw24 already has a rich observability `ExecutionContext` built around
`correlationId` + spans (`src/core/runtime/execution-context/`). That system is
per-invocation, requires a non-empty correlation id, and clones its context when
entering span scopes.

Trace propagation is a smaller, orthogonal concern: one cheap, stable string
whose only job is **request correlation across hops and logs**. Keeping it in a
tiny self-contained module (`src/core/runtime/trace-context.ts`, imports only
Node builtins) means:

- **No risk** to the observability context semantics all backends depend on.
- **No import cycles** — the logger (a leaf) can read the trace id safely.
- A **truly no-op** fallback when unused.

The two coexist: at an HTTP entry point both the trace context and the execution
context are established, and `createHttpHeaders()` emits `x-trace-id` alongside
the existing `x-correlation-id` / `traceparent`.

---

## How it works

### 1. Ambient context (AsyncLocalStorage)

`trace-context.ts` owns one `AsyncLocalStorage<{ traceId }>`. The id is set once
at request entry and is then readable anywhere downstream — including in async
callbacks and in loggers/clients created at module-load time — without threading
it through function signatures.

### 2. Request entry: reuse or generate

At the HTTP entry point (`APIController.LambdaHandler`), before running the
handler:

```ts
const traceId = resolveIncomingTraceId(request.headers); // reuse x-trace-id, else new UUID
return runWithTraceId(traceId, () =>
  runWithExecutionContext(execCtx, async () => { /* handler */ })
);
```

- Incoming `x-trace-id` (case-insensitive, array-tolerant, trimmed) is **reused**
  so a trace started upstream continues unbroken.
- Otherwise a fresh **UUID v4** is generated.

### 3. Logs carry `traceId`

`createLogger()` wraps tslog's `overwrite.addMeta` hook (read fresh on every
`log()` call). It delegates to tslog's own default meta builder and then stamps
the ambient `traceId` onto the produced `_meta`:

```json
{ "0": "order created", "_meta": { "name": "OrderController", "logLevelName": "INFO",
  "date": "…", "traceId": "3f2b…" } }
```

The **log forwarder** (`log-forwarder-handler.ts`) already lifts fields out of
tslog `_meta`; it now also lifts `traceId` into the shipped Vector record
alongside the existing `requestId`. `requestId` (surfaced from the AWS Lambda log
prefix) is untouched.

> Note: `traceId` rides in tslog **`_meta`**, which is serialized on the JSON
> output path the forwarder parses. In tslog's default *pretty* console mode the
> field is present in `_meta` but not rendered in the pretty template. Services
> whose logs are forwarded should emit JSON (`createLogger({ name, type: 'json' })`
> or set it globally) for the field to appear in the shipped record.

### 4. Outbound propagation

`createHttpHeaders(ctx)` — fw24's outbound HTTP header helper — now appends
`x-trace-id` from the ambient context (no-op when none). Any caller already
spreading these headers into a `fetch`/axios/SigV4-signed request propagates the
trace automatically.

For clients that build headers by hand, two small helpers are provided:

```ts
import { traceHeaders, injectTraceHeaders, getTraceId } from '@ten24group/fw24';

// spread form
await fetch(url, { headers: { 'content-type': 'application/json', ...traceHeaders() } });

// non-destructive merge (never overwrites an explicit caller value)
const headers = injectTraceHeaders(signedHeaders);

// raw read
const id = getTraceId(); // string | undefined
```

---

## Public API (`@ten24group/fw24`)

| Export | Purpose |
| --- | --- |
| `TRACE_ID_HEADER` | The header name constant, `'x-trace-id'`. |
| `getTraceId()` | Current request-scoped trace id, or `undefined`. |
| `resolveIncomingTraceId(headers)` | Read `x-trace-id` from a header bag, else generate a UUID. |
| `runWithTraceId(id, fn)` | Run `fn` within a trace scope (generates if `id` is blank). |
| `runWithIncomingTraceContext(headers, fn)` | Resolve from headers + run, in one call. |
| `traceHeaders()` | `{ 'x-trace-id': id }` when active, else `{}`. |
| `injectTraceHeaders(headers?)` | Merge the trace id into a headers object (won't overwrite). |
| `readTraceIdHeader(headers)` / `generateTraceIdValue()` | Lower-level building blocks. |

---

## Zero-config adoption

- **HTTP controllers** — already wired. No change needed; logs and
  `createHttpHeaders`-based outbound calls carry the trace automatically.
- **Outbound HTTP you build by hand** — spread `...traceHeaders()` or wrap your
  headers with `injectTraceHeaders(...)`.
- **Non-HTTP entry points** (SQS / EventBridge / Step Functions / cron) — these
  don't have an `x-trace-id` header. To extend a trace into them, resolve the id
  from the message contract you control and wrap the handler body in
  `runWithTraceId(id, fn)`. Until then they simply run without a trace id
  (no-op), exactly as before.

## Backward compatibility & risks

- **No behavior change when unused.** No context ⇒ `getTraceId()` is `undefined`,
  logs carry no `traceId`, outbound headers are unchanged.
- **Logger hook.** The `addMeta` wrapper delegates to tslog's own meta builder
  and is guarded: if tslog internals change (`_addMetaToLogObj` missing), it
  silently skips enrichment rather than break logging. fw24 uses no sub-loggers,
  so instance-bound delegation is safe.
- **`x-trace-id` is a plain correlation id**, not a signed/authenticated value —
  treat it as untrusted input (it is only used for correlation, never
  authorization).
- **Pretty vs. JSON logs.** The forwarder's `_meta` lift only sees `traceId` on
  the JSON output path (see note above).
