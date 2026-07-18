/**
 * Cross-service trace propagation.
 *
 * A tiny, dependency-free request-scoped `traceId` that flows through the
 * async call stack via {@link AsyncLocalStorage} and is propagated to
 * downstream services over the `x-trace-id` HTTP header.
 *
 * DESIGN GOALS
 * - Minimal & self-contained: imports only Node builtins, so it can be pulled
 *   into leaf modules (e.g. the logger) without creating import cycles.
 * - Backward-compatible: a complete no-op when no context is established.
 *   {@link getTraceId} returns `undefined`, {@link traceHeaders} returns `{}`,
 *   and logs simply carry no `traceId`.
 * - Ambient: because it is stored in AsyncLocalStorage, loggers and clients
 *   created at module-load time can still read the *current request's* traceId
 *   at emit/call time without threading it through every function signature.
 *
 * This is intentionally separate from the richer observability
 * `ExecutionContext` (correlationId / spans). It is a single, cheap identifier
 * whose only job is end-to-end request correlation across service hops and log
 * lines.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Canonical (lowercase) header used to carry the trace id across service hops. */
export const TRACE_ID_HEADER = 'x-trace-id';

interface TraceContext {
    readonly traceId: string;
}

/** One AsyncLocalStorage for the request-scoped trace id. */
const traceStorage = new AsyncLocalStorage<TraceContext>();

type HeaderBag = Record<string, string | string[] | undefined> | null | undefined;

/**
 * Generate a fresh trace id (UUID v4).
 * Used at request entry when no upstream `x-trace-id` is present.
 */
export function generateTraceIdValue(): string {
    return randomUUID();
}

/**
 * Read the `x-trace-id` header from an incoming header bag (case-insensitive,
 * array-tolerant, trimmed). Returns `undefined` when absent or blank.
 */
export function readTraceIdHeader(headers: HeaderBag): string | undefined {
    if (!headers) return undefined;

    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== TRACE_ID_HEADER) continue;
        const raw = headers[ key ];
        const value = Array.isArray(raw) ? raw[ 0 ] : raw;
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed) return trimmed;
    }

    return undefined;
}

/**
 * Resolve the trace id for an incoming request: reuse the upstream
 * `x-trace-id` header when present, otherwise generate a new UUID.
 */
export function resolveIncomingTraceId(headers: HeaderBag): string {
    return readTraceIdHeader(headers) ?? generateTraceIdValue();
}

/**
 * Get the current request-scoped trace id, or `undefined` when no trace
 * context is established (graceful degradation — never throws).
 */
export function getTraceId(): string | undefined {
    return traceStorage.getStore()?.traceId;
}

/**
 * Run `fn` within a trace scope. The provided `traceId` (or a freshly
 * generated one if blank) is visible via {@link getTraceId} for the duration
 * of `fn` and every async operation it spawns.
 */
export function runWithTraceId<T>(traceId: string | undefined, fn: () => T): T {
    const id = traceId?.trim() || generateTraceIdValue();
    return traceStorage.run({ traceId: id }, fn);
}

/**
 * Convenience for request entry points: resolve the incoming `x-trace-id`
 * (or generate one) and run `fn` within that trace scope.
 */
export function runWithIncomingTraceContext<T>(headers: HeaderBag, fn: () => T): T {
    return runWithTraceId(resolveIncomingTraceId(headers), fn);
}

/**
 * Headers to attach to an outbound cross-service call so the trace id
 * propagates. Returns `{}` when there is no active trace context, so callers
 * can always spread it safely.
 *
 * @example
 * await fetch(url, { headers: { 'content-type': 'application/json', ...traceHeaders() } });
 */
export function traceHeaders(): Record<string, string> {
    const id = getTraceId();
    return id ? { [ TRACE_ID_HEADER ]: id } : {};
}

/**
 * Non-destructively merge the current trace id into an existing headers object.
 * - No active trace context → returns the input unchanged.
 * - An `x-trace-id` already present (any casing) → left untouched (an explicit
 *   caller-supplied value always wins).
 */
export function injectTraceHeaders<H extends Record<string, any>>(headers?: H): H {
    const id = getTraceId();
    const base = (headers ?? {}) as H;
    if (!id) return base;

    const alreadySet = Object.keys(base).some(k => k.toLowerCase() === TRACE_ID_HEADER);
    if (alreadySet) return base;

    return { ...base, [ TRACE_ID_HEADER ]: id };
}
