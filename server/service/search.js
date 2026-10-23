'use strict';

const core = require('../../userscript/src/core.js');
const registry = require('../providers');

function httpError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function summarize(items) {
  const byPlatform = {};
  for (const it of items) {
    const g = byPlatform[it.platform] || (byPlatform[it.platform] = {
      platform: it.platform,
      platformName: it.platformName,
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      sum: 0
    });
    g.count++;
    g.sum += it.finalPrice;
    if (!g.min || it.finalPrice < g.min) g.min = it.finalPrice;
    if (it.finalPrice > g.max) g.max = it.finalPrice;
  }
  const platforms = Object.values(byPlatform).map((g) => {
    g.avg = core.round2(g.sum / g.count);
    delete g.sum;
    return g;
  }).sort((a, b) => a.min - b.min);
  return {
    platforms,
    lowest: platforms[0] || null,
    highest: platforms[platforms.length - 1] || null,
    count: items.length
  };
}

/**
 * 搜索：关键词 + 三种排序（人气 / 销量 / 价格）。
 * 排序在服务端完成，分页只切窗口，保证跨平台混排顺序稳定。
 */
async function search(params, cfg, ctx) {
  const keyword = String(params.keyword || '').replace(/\s+/g, ' ').trim();
  if (keyword.length < 1) throw httpError('缺少关键词（keyword）');
  if (keyword.length > 80) throw httpError('关键词过长（最多 80 字）');

  const sort = core.SORTS.includes(params.sort) ? params.sort : 'renqi';
  const page = Math.max(1, Math.min(20, parseInt(params.page, 10) || 1));
  const limit = Math.max(4, Math.min(60, parseInt(params.limit, 10) || 20));
  const platform = params.platform && params.platform !== 'all' ? String(params.platform) : '';
  const source = params.source === 'page' ? 'page' : 'panel';

  // 数据源结果需要先合并再排序，不能同时让上游分页、这里再分页。
  // 固定拉取一个完整窗口并缓存，保证 page=1 和 page=2 使用同一批候选，
  // 不会因为扩大候选集导致排序变化、重复或漏项。真实源通常最多支持 100 条。
  const fetchLimit = 100;
  const cacheKey = ['search', keyword, sort, platform, source, fetchLimit].join('|');
  const result = await ctx.cache.wrap(cacheKey, async () => {
    return registry.searchAll(keyword, { sort, page: 1, limit: fetchLimit }, cfg, ctx);
  }, cfg.cacheTtlMs);

  let items = result.items.map((it) => Object.assign({}, it, {
    matchScore: core.scoreMatch(keyword, it.title)
  }));
  if (platform) items = items.filter((it) => it.platform === platform);
  const sorted = core.sortItems(items, sort);
  const total = sorted.length;
  const start = (page - 1) * limit;

  return {
    ok: true,
    keyword,
    sort,
    page,
    limit,
    total,
    // total 是固定窗口内的数量，超过窗口的结果不在本接口的分页范围内。
    hasMore: start + limit < total,
    list: sorted.slice(start, start + limit),
    summary: summarize(sorted),
    stats: {
      elapsedMs: 0,
      providers: result.providers
    },
    skipped: result.skipped,
    degraded: result.degraded,
    note: result.note,
    mock: sorted.some((x) => x.mock)
  };
}

module.exports = { search, summarize };
