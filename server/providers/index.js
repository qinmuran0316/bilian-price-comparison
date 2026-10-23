'use strict';

const taobao = require('./taobao');
const jd = require('./jd');
const pdd = require('./pdd');
const vip = require('./vip');
const mock = require('./mock');
const collected = require('./collected');
const core = require('../../userscript/src/core.js');
const logger = require('../logger');

const ALL = [taobao, jd, pdd, vip, mock, collected];
const REAL = [taobao, jd, pdd, vip];
const PLATFORM_NAMES = ['taobao', 'tmall', 'jd', 'pdd', 'vip'];

function missingMockPlatforms(real) {
  const covered = new Set();
  for (const p of real) {
    // 淘宝客接口同时覆盖淘宝和天猫。
    if (p.name === 'taobao') {
      covered.add('taobao');
      covered.add('tmall');
    } else if (p.platform) {
      covered.add(p.platform);
    }
  }
  return PLATFORM_NAMES.filter((name) => !covered.has(name));
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时(${ms}ms)`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/**
 * 决定这一轮跑哪些数据源。
 * hybrid 模式下只有「一个真实源都没配」时才退回模拟数据，避免真假价格混在一起。
 */
function plan(cfg) {
  const real = REAL.filter((p) => p.enabled(cfg) && p.ready(cfg));
  const skipped = REAL.filter((p) => p.enabled(cfg) && !p.ready(cfg)).map((p) => ({
    name: p.name,
    reason: '未配置密钥'
  }));
  const list = [];
  let mockPlatforms = PLATFORM_NAMES.slice();

  if (cfg.mode === 'mock') {
    if (mock.enabled(cfg)) list.push(mock);
  } else if (real.length > 0) {
    list.push(...real);
    mockPlatforms = missingMockPlatforms(real);
    if (cfg.mock && cfg.mock.enabled && cfg.mock.fallback && cfg.mode === 'hybrid') {
      // 配了真实源但部分平台缺 key 时，用 mock 补位，响应里会打 mock 标记
      const missing = REAL.filter((p) => !real.includes(p) && p.enabled(cfg));
      if (missing.length > 0) list.push(mock);
    }
  } else if (cfg.mock && cfg.mock.enabled) {
    list.push(mock);
  }

  if (cfg.providers.collected && cfg.providers.collected.enabled !== false) list.push(collected);
  return { providers: list, skipped, mockPlatforms };
}

async function searchAll(keyword, opts, cfg, ctx) {
  const { providers, skipped, mockPlatforms } = plan(cfg);
  const timeout = (cfg.requestTimeoutMs || 8000) + 1500;

  const settled = await Promise.all(providers.map(async (p) => {
    const started = Date.now();
    try {
      const providerOpts = p.name === 'mock'
        ? Object.assign({}, opts, { platforms: mockPlatforms })
        : opts;
      const items = await withTimeout(p.search(keyword, providerOpts, cfg, ctx), timeout, p.name);
      const normalized = (items || [])
        .map((it) => require('../service/normalize').finalize(it))
        .filter(Boolean);
      return { name: p.name, ok: true, count: normalized.length, ms: Date.now() - started, items: normalized };
    } catch (err) {
      logger.warn(`数据源 ${p.name} 失败: ${err.message}`);
      return { name: p.name, ok: false, count: 0, ms: Date.now() - started, error: err.message, items: [] };
    }
  }));

  const items = [];
  for (const r of settled) items.push(...r.items);

  const providersStatus = settled.map((r) => ({
    name: r.name,
    ok: r.ok,
    count: r.count,
    ms: r.ms,
    error: r.error || ''
  }));

  let degraded = false;
  let note = '';
  if (items.length === 0) {
    degraded = true;
    if (skipped.length && cfg.mode !== 'mock') {
      note = '没有可用的真实数据源，且未启用模拟数据。配置联盟密钥或打开 mock.fallback。';
    } else {
      note = '没有匹配到同款，换个更精确的商品标题试试。';
    }
  } else if (items.some((x) => x.mock)) {
    note = '部分价格来自模拟数据源（未配置对应平台联盟密钥）';
  }

  return { items, providers: providersStatus, skipped, degraded, note };
}

function describe(cfg) {
  const { providers, skipped } = plan(cfg);
  return {
    mode: cfg.mode,
    active: providers.map((p) => p.name),
    skipped,
    realReady: REAL.filter((p) => p.enabled(cfg) && p.ready(cfg)).map((p) => p.name)
  };
}

module.exports = { searchAll, describe, plan, ALL, REAL, withTimeout, normalizeTitle: core.normalizeTitle };
