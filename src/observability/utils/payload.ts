const MAX_PAYLOAD_BYTES = 350 * 1024;

export const safeStringify = (value: any, visited = new WeakSet()): any => {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (visited.has(value)) {
    return '[Circular]';
  }

  visited.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => safeStringify(item, visited));
  }

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = safeStringify(val, visited);
  }

  visited.delete(value);
  return result;
};

export const truncatePayload = <T>(payload: T, maxBytes = MAX_PAYLOAD_BYTES): T | Record<string, any> => {
  const safePayload = safeStringify(payload);
  const serialized = JSON.stringify(safePayload);

  if (serialized.length <= maxBytes) {
    return payload;
  }

  return {
    _truncated: true,
    _originalSize: serialized.length,
    preview: serialized.substring(0, maxBytes) + '... [TRUNCATED]',
  };
};

