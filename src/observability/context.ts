import { randomUUID } from 'crypto';

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
  sampled?: boolean;
}

const TRACEPARENT_HEADER = 'traceparent';
const XRAY_HEADER = 'x-amzn-trace-id';

export const extractTraceContextFromHeaders = (headers: Record<string, string | undefined>): TraceContext => {
  const traceParent = headers[TRACEPARENT_HEADER];
  if (traceParent) {
    const [version, traceId, parentId, flags] = traceParent.split('-');
    if (version && traceId && parentId && flags) {
      return {
        traceId,
        parentSpanId: parentId,
        sampled: flags === '01',
      };
    }
  }

  const xray = headers[XRAY_HEADER];
  if (xray) {
    const traceMatch = xray.match(/Root=1-[a-f0-9]{8}-([a-f0-9]{24})/i);
    const parentMatch = xray.match(/Parent=([a-f0-9]{16})/i);
    const sampledMatch = xray.match(/Sampled=([01])/i);
    if (traceMatch) {
      return {
        traceId: traceMatch[1],
        parentSpanId: parentMatch?.[1],
        sampled: sampledMatch?.[1] === '1',
      };
    }
  }

  const lambdaTrace = process.env._X_AMZN_TRACE_ID;
  if (lambdaTrace) {
    return extractTraceContextFromHeaders({ [XRAY_HEADER]: lambdaTrace });
  }

  return { traceId: randomUUID() };
};

export const injectTraceContextHeaders = (traceId: string, spanId: string) => ({
  [TRACEPARENT_HEADER]: `00-${traceId}-${spanId}-01`,
  [XRAY_HEADER]: `Root=1-${traceId.slice(0, 8)}-${traceId.slice(8)};Parent=${spanId};Sampled=1`,
});

export const addTraceContextToSqs = (attributes: Record<string, any> = {}, traceId: string, spanId: string) => ({
  ...attributes,
  traceId: { DataType: 'String', StringValue: traceId },
  parentSpanId: { DataType: 'String', StringValue: spanId },
});

export const extractTraceContextFromSqs = (attributes: Record<string, any> = {}): TraceContext => {
  const traceAttr = attributes.traceId?.StringValue;
  const parentAttr = attributes.parentSpanId?.StringValue;
  return {
    traceId: traceAttr || randomUUID(),
    parentSpanId: parentAttr,
  };
};

