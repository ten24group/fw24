export interface ICacheProvider {
  get(key: string): Promise<any | undefined>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(prefix: string): Promise<void>;
}

export class MemoryCacheProvider implements ICacheProvider {
  private cache = new Map<string, { value: any, expires: number }>();

  async get(key: string): Promise<any | undefined> {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    this.cache.set(key, { value, expires: Date.now() + (ttl * 1000) });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(prefix: string): Promise<void> {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}
