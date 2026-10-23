'use strict';

/** 简单 TTL 缓存，key 命中才返回；过期即删，不做 LRU（数据量小） */
class TtlCache {
  constructor(ttlMs = 600000, maxEntries = 500) {
    this.ttl = ttlMs;
    this.max = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expire) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expire: Date.now() + (ttlMs || this.ttl) });
    return value;
  }

  async wrap(key, fn, ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { TtlCache };
