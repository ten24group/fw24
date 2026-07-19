# Cross-service trace propagation

fw24 stitches a request together across service boundaries and log lines using a
**single** identifier: the observability **`correlationId`**. There is no second
trace id. `correlationId` is established at every entry point, propagated to
downstream services, and stamped onto every structured log line — so the Logtrail
Correlation view can follow one request across services by a field present on all
forwarded logs.

It is **backward-compatible**: when no ExecutionContext is established, logs
simply carry no `correlationId` (a no-op) and nothing breaks.

---

## Why `correlationId` (and not a parallel `x-trace-id`)

fw24 already has a mature observability `ExecutionContext`
(`src/core/runtime/execution-context/`) built around `correlationId` + spans. It:

- is established at **every** entry point (API, SQS, task, mail) via
  `runWithExecutionContext`, so it is ambient throughout the async call stack;
- is already **propagated on every hop** — over HTTP (`x-correlation-id` + W3C
  `traceparent`) and over SQS / SNS / EventBridge / Step Functions (message
  attributes / event detail).

So the id that ties a request together already exists and already flows
everywhere. The only missing piece was putting it on **log lines**. A separate
`x-trace-id` would have been a redundant second identifier that only covered the
HTTP path. We fold onto `correlationId` instead.

---

## How it works

### 1. Ambient context (AsyncLocalStorage)

The ExecutionContext owns one `AsyncLocalStorage<ExecutionContextData>`
(`execution-context/storage.ts`). `correlationId` is set once at entry and is
readable anywhere downstream — including in async callbacks and in loggers
created at module-load time — via `getCurrentExecutionContext()?.correlationId`,
without threading it through function signatures.

### 2. Entry points establish `correlationId`

| Entry point | correlationId source |
| --- | --- |
| API Gateway (`api-gateway-controller.ts`) | `request.requestId` (AWS request id); upstream `x-correlation-id` / `traceparent` becomes `causedBy` |
| SQS / queue (`sqs-controller.ts`) | Lambda `awsRequestId` (per invocation); upstream SQS/SNS `correlationId` becomes `causedBy` |
| Task / cron (`task-controller.ts`) | Lambda `awsRequestId` |
| Mail processor (`mail-processor.ts`) | `record.messageId` (per record); upstream becomes `causedBy` |

Each wraps its handler in `runWithExecutionContext(execCtx, …)`.

### 3. Logs carry `correlationId`

`createLogger()` wraps tslog's `overwrite.addMeta` hook (read fresh on every
`log()` call). It delegates to tslog's own default meta builder and then stamps
the ambient `correlationId` onto the produced `_meta`:

```json
{ "0": "order created", "_meta": { "name": "OrderController", "logLevelName": "INFO",
  "date": "…", "correlationId": "3f2b…" } }
```

The **log forwarder** (`log-forwarder-handler.ts`) lifts `correlationId` out of
tslog `_meta` into the shipped Vector record alongside the existing `requestId`.

> Note: `correlationId` rides in tslog **`_meta`**, serialized on the JSON output
> path the forwarder parses. In tslog's default *pretty* console mode the field
> is present in `_meta` but not rendered in the pretty template. Forwarded
> services should emit JSON (`createLogger({ name, type: 'json' })`).

### 4. Outbound propagation

Already handled by the existing ExecutionContext helpers, unchanged:

- `createHttpHeaders(ctx)` → `x-correlation-id`, `x-caused-by`, W3C `traceparent`.
- `createSqsAttributes(ctx)` / `createSnsAttributes(ctx)` /
  `createEventBridgeContext(ctx)` → `correlationId` + `causedBy` attributes.

---

## Security: inbound header sanitization (P0)

An inbound `x-correlation-id` / `x-caused-by` (and the correlation id extracted
from SQS/SNS attributes) is **untrusted** and can flow into outbound headers and
structured logs. To prevent outbound-header injection (CR/LF → header
splitting / an availability bug) and log injection/amplification, every
untrusted extraction boundary runs the value through `sanitizeTraceId()`
(`execution-context/propagation.ts`):

- Accepts only `^[A-Za-z0-9._-]{1,128}$` — a superset of UUIDs, W3C hex
  trace-ids, and AWS request ids, with **no** header/log-breaking characters.
- On violation the value is **dropped**, so the entry point mints a fresh id
  instead of propagating the poisoned one.

The W3C `traceparent` and X-Ray paths were already constrained by strict hex
regexes; the custom `x-correlation-id` path (previously only `.trim()`) is the
one this closes.

---

## Backward compatibility

- **No behavior change when unused.** No ExecutionContext ⇒ logs carry no
  `correlationId`; outbound propagation is unchanged.
- **Logger hook.** The `addMeta` wrapper delegates to tslog's own meta builder
  and is guarded: if tslog internals change (`_addMetaToLogObj` missing) it
  silently skips enrichment rather than break logging.
- **`correlationId` is a plain correlation id**, not an authenticated value —
  treated as untrusted input (used only for correlation, never authorization),
  and sanitized at every untrusted boundary.
