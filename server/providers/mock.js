'use strict';

const core = require('../../userscript/src/core.js');

/**
 * 确定性模拟数据源。
 * 没有联盟 key 时保证整条链路可跑通、可测试；同一个关键词永远生成同一批数据。
 */
const PLATFORM_PROFILE = {
  taobao: { factor: [0.90, 1.08], shops: ['优选生活旗舰店', '简物家居专营店', '潮流前线馆'], channels: ['', '', '聚划算'] },
  tmall: { factor: [0.92, 1.10], shops: ['天猫超市', '品牌官方旗舰店', '天猫国际直营'], channels: ['', '天猫超市', '天猫国际'] },
  jd: { factor: [0.86, 1.05], shops: ['京东自营', '京东国际自营', '京东大药房'], channels: ['', '京东国际', '京东图书'] },
  pdd: { factor: [0.78, 0.98], shops: ['百亿补贴官方店', '品牌黑标店', '工厂直营店'], channels: ['', ''] },
  vip: { factor: [0.84, 1.02], shops: ['唯品自营', '品牌特卖店', '全球购自营'], channels: [''] }
};

const VARIANTS = ['官方标配', '旗舰款', '升级版', '套装组合'];

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function basePriceOf(keyword, basePrice) {
  const given = core.parsePrice(basePrice);
  if (given) return given;
  const h = core.hashString(keyword);
  return core.round2(59 + (h % 150000) / 100);
}

function buildItem(platform, keyword, basePrice, index, page, cfg) {
  const profile = PLATFORM_PROFILE[platform];
  const seed = core.hashString(platform + '|' + keyword + '|' + index + '|' + page);
  const rand = rng(seed);
  const factor = profile.factor[0] + rand() * (profile.factor[1] - profile.factor[0]);
  const price = core.round2(Math.max(9.9, basePrice * factor));
  const originPrice = core.round2(price * (1.1 + rand() * 0.45));
  const hasCoupon = rand() < 0.55;
  const couponSteps = [5, 10, 15, 20, 30, 50, 80, 100];
  let coupon = 0;
  let threshold = 0;
  if (hasCoupon) {
    coupon = couponSteps[Math.floor(rand() * couponSteps.length)];
    if (coupon >= price * 0.5) coupon = Math.round(price * 0.1);
    // 门槛必须 ≤ 商品价，否则这张券在商品上根本用不了
    threshold = Math.max(1, Math.floor(price));
  }
  const sales = Math.floor(rand() * 60000) + (platform === 'pdd' ? 20000 : 300);
  const channel = pick(rand, profile.channels);
  const variant = VARIANTS[index % VARIANTS.length];
  const title = `${keyword} ${variant}`;

  return {
    platform,
    channel,
    id: 'mock-' + core.hashString(platform + keyword + index + page).toString(36),
    title,
    price,
    originPrice,
    coupon,
    couponThreshold: threshold,
    couponDesc: coupon ? `满${threshold}减${coupon}` : '',
    couponStart: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    couponEnd: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    shop: profile.shops[Math.floor(rand() * profile.shops.length)],
    sales,
    salesText: sales > 10000 ? (sales / 10000).toFixed(1) + '万' : String(sales),
    image: '',
    url: core.buildSearchUrl(platform, keyword),
    source: 'mock',
    mock: true
  };
}

module.exports = {
  name: 'mock',
  platform: 'multi',
  enabled(cfg) {
    return Boolean(cfg.mock && cfg.mock.enabled) && cfg.mode !== 'live';
  },
  ready() {
    return true;
  },
  async search(keyword, opts = {}, cfg) {
    const kw = String(keyword || '').trim();
    if (!kw) return [];
    // 与真实源的分页窗口保持一致，支持服务端在合并排序后提供第 2 页。
    const limit = Math.min(Number(opts.limit) || 8, 100);
    const page = Math.max(1, Number(opts.page) || 1);
    const basePrice = basePriceOf(kw, opts.basePrice);
    const platforms = Array.isArray(opts.platforms) && opts.platforms.length
      ? opts.platforms.filter((p) => PLATFORM_PROFILE[p])
      : Object.keys(PLATFORM_PROFILE);
    if (!platforms.length) return [];
    const perPlatform = Math.max(1, Math.ceil(limit / platforms.length));
    const out = [];
    // 平台顺序按关键词轮转，避免每次都淘宝排第一
    const offset = core.hashString(kw) % platforms.length;
    for (let i = 0; i < platforms.length; i++) {
      const pf = platforms[(i + offset) % platforms.length];
      for (let j = 0; j < perPlatform; j++) {
        out.push(buildItem(pf, kw, basePrice, j, page, cfg));
      }
    }
    const latency = cfg && cfg.mock ? Number(cfg.mock.latencyMs) || 0 : 0;
    if (latency > 0) await sleep(latency);
    return out;
  }
};
