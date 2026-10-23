'use strict';

const core = require('../../userscript/src/core.js');
const registry = require('../providers');
const { finalize, dedupe, pickPerPlatform } = require('./normalize');

function historyKey(platform, itemId, title) {
  return platform + ':' + (itemId || core.hashString(core.normalizeTitle(title)));
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

/**
 * 比价主流程：
 * 1. 用页面提取到的标题去各平台搜同款
 * 2. 标题相似度 + 规格/品牌校正打分，过滤低分
 * 3. 算到手价（券后），同平台保留低价若干条
 * 4. 输出最低方案、可省金额、券列表、当前商品历史价
 */
async function compare(input, cfg, ctx) {
  const started = Date.now();
  const title = String(input.title || '').replace(/\s+/g, ' ').trim();
  if (title.length < 2) throw httpError('缺少商品标题（title）');

  const platform = input.platform || core.detectPlatform(input.host || '') || '';
  const itemId = String(input.itemId || core.extractItemId(input.url || '', platform) || '');
  const source = {
    platform,
    itemId,
    title,
    price: core.parsePrice(input.price),
    originPrice: core.parsePrice(input.originPrice),
    image: input.image || '',
    url: input.url || '',
    shop: input.shop || '',
    channel: input.channel || '',
    isCurrent: true
  };
  if (!platform) throw httpError('无法识别来源平台（platform）');

  const searched = await registry.searchAll(title, {
    sort: 'renqi',
    limit: 20,
    basePrice: source.price
  }, cfg, ctx);

  const threshold = cfg.matching.threshold;
  const scored = searched.items
    .map((it) => Object.assign({}, it, { matchScore: core.scoreMatch(title, it.title) }))
    .filter((it) => it.matchScore > 0);

  let matched = scored.filter((it) => it.matchScore >= threshold);
  let relaxed = false;
  if (matched.length === 0 && scored.length > 0) {
    // 没有过线的就放宽一档，但把分数标出来，别假装是精确同款
    matched = scored.filter((it) => it.matchScore >= Math.max(30, threshold - 15));
    relaxed = matched.length > 0;
  }

  matched = dedupe(matched);
  matched = pickPerPlatform(matched, cfg.matching.maxPerPlatform || 4);

  // 当前页面商品始终作为一条候选，标记 isCurrent
  if (source.price > 0) {
    const current = finalize({
      platform: source.platform,
      channel: source.channel,
      id: source.itemId,
      title: source.title,
      price: source.price,
      originPrice: source.originPrice,
      shop: source.shop,
      image: source.image,
      url: source.url,
      source: 'page'
    });
    if (current) {
      current.isCurrent = true;
      current.matchScore = 100;
      matched = matched.filter((it) => !(it.platform === current.platform &&
        it.id && current.id && it.id === current.id));
      matched.unshift(current);
    }
  }

  const sorted = core.sortItems(matched, 'jiage').slice(0, cfg.matching.maxCandidates || 60);

  // 最优方案：到手价最低；同价时真实数据优先于模拟数据
  const pool = sorted.filter((x) => x.finalPrice > 0);
  let best = null;
  if (pool.length) {
    best = pool.reduce(function (a, b) {
      if (b.finalPrice < a.finalPrice - 0.001) return b;
      if (Math.abs(b.finalPrice - a.finalPrice) < 0.001 && a.mock && !b.mock) return b;
      return a;
    }, pool[0]);
  }

  let savings = null;
  if (best && source.price > 0 && !best.isCurrent && best.finalPrice < source.price) {
    savings = {
      amount: core.round2(source.price - best.finalPrice),
      percent: core.round2(((source.price - best.finalPrice) / source.price) * 100),
      from: source.platform,
      to: best.platform
    };
  }

  const key = historyKey(platform, itemId, title);
  if (source.price > 0) ctx.store.recordHistory(key, source.price, Date.now());
  // 比价主流程只读本地采样，不请求上游历史源，避免一个慢接口拖住整次比价
  const historyCfg = cfg.history || {};
  const historyDays = Math.max(1, Math.min(
    Number(historyCfg.maxDays) || 730,
    Number(historyCfg.days) || 180
  ));
  const history = ctx.store.getHistory(key, historyDays);
  const historyStats = core.buildHistoryStats(history, source.price, historyDays);

  const coupons = require('./coupon').build(sorted);

  return {
    ok: true,
    query: {
      title,
      platform,
      platformName: core.platformName(platform),
      price: source.price,
      itemId,
      channel: source.channel || core.detectChannel(input.host || '', input.path || ''),
      url: source.url
    },
    best,
    savings,
    items: sorted,
    coupons,
    history,
    historyKey: key,
    historyStats,
    historyAdvice: core.historyAdvice(historyStats),
    stats: {
      candidates: searched.items.length,
      matched: sorted.length,
      threshold,
      relaxed,
      elapsedMs: Date.now() - started,
      providers: searched.providers
    },
    skipped: searched.skipped,
    degraded: searched.degraded,
    note: relaxed ? (searched.note ? searched.note + '；' : '') + '同款匹配已放宽，请核对规格' : searched.note,
    mock: sorted.some((x) => x.mock)
  };
}

module.exports = { compare, historyKey };
