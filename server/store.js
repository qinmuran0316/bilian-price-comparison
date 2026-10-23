'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');
const core = require('../userscript/src/core.js');

const MAX_COLLECTED = 3000;
const MAX_HISTORY_POINTS = 400;
const MAX_HISTORY_KEYS = 2000;

/**
 * 单文件 JSON 存储。
 * 写入走 tmp + rename，进程被杀不会留下半截文件。
 */
class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'store.json');
    this.data = { collected: [], history: {}, createdAt: Date.now() };
    this.timer = null;
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data.collected = Array.isArray(parsed.collected) ? parsed.collected : [];
        this.data.history = parsed.history && typeof parsed.history === 'object' ? parsed.history : {};
        this.data.createdAt = parsed.createdAt || Date.now();
      }
      logger.info(`存储载入: ${this.data.collected.length} 条采集, ${Object.keys(this.data.history).length} 个价格序列`);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('存储载入失败，使用空存储:', err.message);
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      logger.error('存储写入失败:', err.message);
    }
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, 400);
  }

  recordCollected(item) {
    if (!item || !item.title || !item.platform) return null;
    const now = Date.now();
    const price = core.parsePrice(item.price);
    const key = item.platform + ':' + (item.itemId || core.hashString(core.normalizeTitle(item.title)));
    const record = {
      key,
      platform: item.platform,
      itemId: item.itemId || '',
      title: String(item.title).slice(0, 200),
      price,
      originPrice: core.parsePrice(item.originPrice) || 0,
      image: item.image || '',
      url: item.url || '',
      shop: item.shop || '',
      channel: item.channel || '',
      ts: now
    };
    const idx = this.data.collected.findIndex((x) => x.key === key);
    if (idx >= 0) {
      // 价格没变就只刷新时间，避免把序列刷成噪声
      const prev = this.data.collected[idx];
      if (prev.price !== record.price) {
        this.recordHistory(key, record.price, now);
      }
      this.data.collected[idx] = Object.assign({}, prev, record);
    } else {
      this.data.collected.push(record);
      this.recordHistory(key, record.price, now);
    }
    if (this.data.collected.length > MAX_COLLECTED) {
      this.data.collected.sort((a, b) => b.ts - a.ts);
      this.data.collected.length = MAX_COLLECTED;
    }
    this.scheduleSave();
    return record;
  }

  recordHistory(key, price, ts) {
    if (!key || !price) return;
    const list = this.data.history[key] || (this.data.history[key] = []);
    const last = list[list.length - 1];
    // 同价合并：同一天同一价格只留一个点
    if (last && last.p === price && ts - last.t < 6 * 3600 * 1000) return;
    list.push({ t: ts || Date.now(), p: price });
    if (list.length > MAX_HISTORY_POINTS) list.splice(0, list.length - MAX_HISTORY_POINTS);
    const keys = Object.keys(this.data.history);
    if (keys.length > MAX_HISTORY_KEYS) {
      keys
        .map((k) => ({ k, t: (this.data.history[k].slice(-1)[0] || {}).t || 0 }))
        .sort((a, b) => a.t - b.t)
        .slice(0, keys.length - MAX_HISTORY_KEYS)
        .forEach((x) => delete this.data.history[x.k]);
    }
  }

  getHistory(key, days = 90) {
    const cutoff = Date.now() - days * 86400000;
    return (this.data.history[key] || []).filter((p) => p.t >= cutoff);
  }

  findCollected(text, limit = 20) {
    const norm = core.normalizeTitle(text);
    if (!norm) return [];
    return this.data.collected
      .map((x) => ({ item: x, score: core.scoreMatch(text, x.title) }))
      .filter((x) => x.score >= 40)
      .sort((a, b) => b.score - a.score || b.item.ts - a.item.ts)
      .slice(0, limit)
      .map((x) => Object.assign({}, x.item, { matchScore: x.score }));
  }

  stats() {
    const platforms = {};
    for (const x of this.data.collected) {
      platforms[x.platform] = (platforms[x.platform] || 0) + 1;
    }
    return {
      collected: this.data.collected.length,
      historyKeys: Object.keys(this.data.history).length,
      platforms,
      createdAt: this.data.createdAt
    };
  }

  recent(limit = 20) {
    return this.data.collected.slice().sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}

module.exports = { Store, MAX_COLLECTED };
