// ==UserScript==
// @name               全网比价助手
// @name:zh            全网比价助手
// @namespace          https://github.com/qinmuran0316/bilian-price-comparison
// @version            1.1.3
// @author             qinmuran
// @description        商详页自动识别商品，跨淘宝、天猫、京东、拼多多、唯品会比价；显示隐藏优惠券、到手价、历史价格，支持按人气/销量/价格搜索。覆盖聚划算、天猫超市、天猫国际、京东国际、京东图书、京东电子书、京东工业品、京东大药房。
// @description:zh     商详页自动识别商品，跨淘宝、天猫、京东、拼多多、唯品会比价；显示隐藏优惠券、到手价、历史价格，支持按人气/销量/价格搜索。覆盖聚划算、天猫超市、天猫国际、京东国际、京东图书、京东电子书、京东工业品、京东大药房。
// @license            MIT
// @homepageURL        https://github.com/qinmuran0316/bilian-price-comparison
// @supportURL         https://github.com/qinmuran0316/bilian-price-comparison/issues
// @tag                比价
// @tag                购物
// @tag                优惠券
// @tag                历史价格
// @match              *://*.taobao.com/*
// @match              *://*.tmall.com/*
// @match              *://*.tmall.hk/*
// @match              *://*.ju.taobao.com/*
// @match              *://*.jd.com/*
// @match              *://*.jd.hk/*
// @match              *://*.yiyaojd.com/*
// @match              *://*.jkcsjd.com/*
// @match              *://*.jingdonghealth.cn/*
// @match              *://*.vip.com/*
// @match              *://*.vipglobal.hk/*
// @match              *://*.pinduoduo.com/*
// @match              *://*.yangkeduo.com/*
// @exclude            *://login.taobao.com/*
// @exclude            *://uland.taobao.com/*
// @exclude            *://login.tmall.com/*
// @exclude            *://pages.tmall.com/*
// @exclude            *://cart.taobao.com/*
// @exclude            *://cart.jd.com/*
// @exclude            *://order.jd.com/*
// @exclude            *://trade.jd.com/*
// @exclude            *://wq.jd.com/*
// @exclude            *://union.jd.com/*
// @exclude            *://pay.jd.com/*
// @grant              GM_xmlhttpRequest
// @grant              GM_getValue
// @grant              GM_setValue
// @grant              GM_openInTab
// @grant              GM_setClipboard
// @grant              unsafeWindow
// @connect            127.0.0.1
// @connect            localhost
// @run-at             document-idle
// @noframes
// ==/UserScript==

/* ==================== core.js ==================== */
/**
 * 公共核心：纯函数，不碰 DOM、不碰网络。
 * 浏览器里挂到 window.BL.core，Node 里走 module.exports（服务端和测试共用同一份）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BL = root.BL || {};
    root.BL.core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.1.3';
  var DAY_MS = 86400000;

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /** 价格解析：兼容 "¥1,299.00" / "1299,00" / "￥ 89" / 数字 / 分（由调用方标注） */
  function parsePrice(input) {
    if (typeof input === 'number') return isFinite(input) && input > 0 ? round2(input) : 0;
    if (input === null || input === undefined) return 0;
    var s = String(input).replace(/[^\d.,]/g, '');
    if (!s) return 0;
    // 欧洲写法 1.299,00：最后一个是小数点
    if (/,\d{1,2}$/.test(s) && /\./.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/,\d{1,2}$/.test(s) && !/\./.test(s)) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? round2(n) : 0;
  }

  /** 销量 "2.3万+" / "1.2亿" / "5000" -> 数字 */
  function parseSales(input) {
    if (typeof input === 'number') return Math.max(0, Math.round(input));
    var s = String(input || '').replace(/,/g, '');
    var m = s.match(/(\d+(?:\.\d+)?)\s*(万|亿|w|k)?/i);
    if (!m) return 0;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return 0;
    var unit = (m[2] || '').toLowerCase();
    if (unit === '万' || unit === 'w') n *= 10000;
    else if (unit === '亿') n *= 100000000;
    else if (unit === 'k') n *= 1000;
    return Math.round(n);
  }

  function toHalfWidth(str) {
    return String(str || '')
      .replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/\u3000/g, ' ');
  }

  // 促销词直接抹掉：跨平台标题差异主要来自这些装饰词
  var PROMO_WORDS = [
    '官方正品', '官方旗舰店', '旗舰店', '专卖店', '自营', '官方', '正品', '包邮',
    '百亿补贴', '补贴', '限时', '秒杀', '特价', '清仓', '促销', '优惠', '券后',
    '拍下', '立减', '满减', '赠品', '买一送一', '假一赔十', '顺丰', '现货',
    '预售', '新品', '新款', '爆款', '热卖', '同款', '专柜', '直营', '进口',
    '国行', '七天无理由', '24期免息', '分期免息', '支持花呗', '以旧换新',
    '直播间', '直播专享', '会员价', 'plus会员', 'plus', '京东自营', '天猫超市',
    '天猫国际', '海外直邮', '保税仓发货', '次日达', '当天发货', '官方直营',
    '正品保障', '品质保障', '厂直', '工厂直供', '一件代发', '批发', '团购'
  ];

  function normalizeTitle(title) {
    var t = toHalfWidth(String(title || '').toLowerCase());
    for (var i = 0; i < PROMO_WORDS.length; i++) {
      t = t.split(PROMO_WORDS[i].toLowerCase()).join(' ');
    }
    // 标点统一换成空格，保留数字里的点（型号 3.5 / 容量 1.5l）
    // 用十六进制写方括号，避免 ESLint no-useless-escape 把 \[ 判成多余转义；
    // 连字符放在字符类开头，行为仍是把这些标点替换为空格。
    t = t.replace(/[-\x5B\x5D【】()（）<>《》「」『』{}"'“”‘’·•…—_+*/\\|,，。!！?？:：;；~～@#$%^&^=]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function tokenize(title) {
    var t = normalizeTitle(title);
    var out = new Set();
    var latin = t.match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [];
    for (var i = 0; i < latin.length; i++) {
      var w = latin[i];
      if (w.length >= 2) out.add(w);
    }
    var cjkSegs = t.replace(/[a-z0-9.]+/g, ' ').split(/[^\u4e00-\u9fa5]+/);
    for (var j = 0; j < cjkSegs.length; j++) {
      var seg = cjkSegs[j].trim();
      if (!seg) continue;
      if (seg.length === 1) {
        out.add(seg);
        continue;
      }
      // 中文用 bigram：比单字稳，比分词器轻
      for (var k = 0; k < seg.length - 1; k++) out.add(seg.substr(k, 2));
    }
    return out;
  }

  function similarity(a, b) {
    var A = tokenize(a);
    var B = tokenize(b);
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (x) {
      if (B.has(x)) inter++;
    });
    var union = A.size + B.size - inter;
    var jaccard = union ? inter / union : 0;
    var contain = inter / Math.min(A.size, B.size);
    return round2(jaccard * 0.65 + contain * 0.35);
  }

  var SPEC_RE = /(\d+(?:\.\d+)?)\s*(ml|l|毫升|升|g|kg|克|千克|片|粒|袋|包|瓶|支|盒|件|双|只|套|张|抽|枚|条|个|寸|英寸)/gi;

  function extractSpec(title) {
    var out = new Set();
    var m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(String(title || ''))) !== null) {
      var n = parseFloat(m[1]);
      if (!isFinite(n)) continue;
      var unit = m[2].toLowerCase();
      if (unit === 'l' || unit === '升') {
        n = n * 1000;
        unit = 'ml';
      } else if (unit === '毫升') {
        unit = 'ml';
      } else if (unit === 'kg' || unit === '千克') {
        n = n * 1000;
        unit = 'g';
      } else if (unit === '克') {
        unit = 'g';
      } else if (unit === '英寸') {
        unit = '寸';
      }
      out.add(n + unit);
    }
    return out;
  }

  var GENERIC_TOKENS = {
    plus: 1, pro: 1, max: 1, mini: 1, new: 1, gen: 1, series: 1, model: 1,
    inch: 1, gb: 1, tb: 1, ml: 1, kg: 1, cm: 1, mm: 1, mah: 1, 'w': 1, 'v': 1,
    the: 1, and: 1, for: 1, with: 1, pack: 1, set: 1
  };

  function brandToken(title) {
    var words = String(title || '').toLowerCase().match(/[a-z][a-z0-9&'-]{2,}/g) || [];
    var best = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/[^a-z0-9]/g, '');
      if (!w || GENERIC_TOKENS[w]) continue;
      if (w.length > best.length) best = w;
    }
    return best;
  }

  /**
   * 同款打分 0-100。
   * 标题相似度为主，规格（容量/重量/片数）冲突直接扣分，品牌相同加分。
   */
  function scoreMatch(queryTitle, candidateTitle) {
    var sim = similarity(queryTitle, candidateTitle);
    var score = sim * 100;
    var qs = extractSpec(queryTitle);
    var cs = extractSpec(candidateTitle);
    if (qs.size && cs.size) {
      var overlap = 0;
      qs.forEach(function (x) {
        if (cs.has(x)) overlap++;
      });
      if (!overlap) score -= 18;
      else score += 4;
    }
    var qb = brandToken(queryTitle);
    var cb = brandToken(candidateTitle);
    if (qb && cb) score += qb === cb ? 8 : -6;
    return Math.round(clamp(score, 0, 100));
  }

  function computeFinalPrice(price, coupon, threshold) {
    var p = parsePrice(price);
    var c = parsePrice(coupon);
    var th = parsePrice(threshold);
    if (!p) return 0;
    if (!c) return round2(p);
    if (th && p < th) return round2(p);
    return round2(Math.max(0, p - c));
  }

  function hotScore(item) {
    var sales = parseSales(item && item.sales);
    var reviews = parseSales(item && item.reviews);
    return sales * 0.75 + reviews * 0.25;
  }

  var SORTS = ['renqi', 'xiaoliang', 'jiage'];

  function sortValue(item, sort) {
    if (sort === 'jiage') {
      var f = parsePrice(item.finalPrice || item.price);
      return f > 0 ? f : Number.MAX_SAFE_INTEGER;
    }
    if (sort === 'xiaoliang') return parseSales(item.sales);
    return hotScore(item);
  }

  /** 稳定排序：价格升序，其余降序；销量相同按到手价升序 */
  function sortItems(items, sort) {
    var arr = (items || []).slice();
    var dir = sort === 'jiage' ? 1 : -1;
    arr.sort(function (a, b) {
      var va = sortValue(a, sort);
      var vb = sortValue(b, sort);
      if (va !== vb) return (va - vb) * dir;
      var pa = parsePrice(a.finalPrice || a.price) || Number.MAX_SAFE_INTEGER;
      var pb = parsePrice(b.finalPrice || b.price) || Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
    return arr;
  }

  function formatPrice(n) {
    var v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    var fixed = v.toFixed(2);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '¥' + parts.join('.');
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(ts) {
    var diff = Date.now() - Number(ts || 0);
    if (!isFinite(diff) || diff < 0) return '';
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }

  /** 站点识别：只看 host，不看 path，避免被查询参数里的域名骗到 */
  function detectPlatform(host) {
    var h = String(host || '').toLowerCase().split(':')[0];
    if (!h) return '';
    if (/(^|\.)tmall\.hk$/.test(h)) return 'tmall';
    if (/(^|\.)pinduoduo\.com$/.test(h) || /(^|\.)yangkeduo\.com$/.test(h)) return 'pdd';
    if (/(^|\.)vip\.com$/.test(h) || /(^|\.)vipglobal\.hk$/.test(h)) return 'vip';
    if (/(^|\.)jd\.com$/.test(h) || /(^|\.)jd\.hk$/.test(h) ||
        /(^|\.)yiyaojd\.com$/.test(h) || /(^|\.)jkcsjd\.com$/.test(h) ||
        /(^|\.)jingdonghealth\.cn$/.test(h)) return 'jd';
    if (/(^|\.)tmall\.com$/.test(h)) return 'tmall';
    if (/(^|\.)taobao\.com$/.test(h)) return 'taobao';
    return '';
  }

  function detectChannel(host, pathname) {
    var h = String(host || '').toLowerCase().split(':')[0];
    var p = String(pathname || '');
    if (h.indexOf('ju.taobao.com') >= 0) return '聚划算';
    if (h.indexOf('chaoshi.') === 0) return '天猫超市';
    if (/(^|\.)tmall\.hk$/.test(h)) return '天猫国际';
    if (/(^|\.)jd\.hk$/.test(h)) return '京东国际';
    if (h === 'book.jd.com' || /^\/book\//.test(p)) return '京东图书';
    if (h === 'e.jd.com' || h === 'ebook.jd.com') return '京东电子书';
    if (h === 'gy.jd.com' || h.indexOf('gongyepin') >= 0) return '京东工业品';
    if (/(^|\.)yiyaojd\.com$/.test(h) || /(^|\.)jingdonghealth\.cn$/.test(h) ||
        /(^|\.)jkcsjd\.com$/.test(h)) return '京东大药房';
    if (/(^|\.)vip\.com$/.test(h) || /(^|\.)vipglobal\.hk$/.test(h)) return '唯品会';
    return '商品详情';
  }

  var PLATFORM_NAMES = {
    taobao: '淘宝', tmall: '天猫', jd: '京东', pdd: '拼多多', vip: '唯品会'
  };

  function platformName(p) {
    return PLATFORM_NAMES[p] || String(p || '');
  }

  function extractItemId(url, platform) {
    var u;
    try {
      u = new URL(String(url || ''));
    } catch (e) {
      return '';
    }
    var q = u.searchParams;
    var m;
    if (platform === 'taobao' || platform === 'tmall') {
      var id = q.get('id') || q.get('itemId') || q.get('item_id');
      if (id && /^\d{5,}$/.test(id)) return id;
      m = u.pathname.match(/\/i(\d+)\.htm/);
      if (m) return m[1];
    }
    if (platform === 'jd') {
      m = u.pathname.match(/\/(\d{5,})\.html/);
      if (m) return m[1];
      var sku = q.get('sku') || q.get('skuId');
      if (sku && /^\d{5,}$/.test(sku)) return sku;
    }
    if (platform === 'pdd') {
      var gid = q.get('goods_id') || q.get('goodsId');
      if (gid && /^\d{5,}$/.test(gid)) return gid;
    }
    if (platform === 'vip') {
      m = u.pathname.match(/detail-(\d+)-\d+\.html/);
      if (m) return m[1];
      m = u.pathname.match(/\/(\d{6,})\.html/);
      if (m) return m[1];
      var pid = q.get('pid') || q.get('productId');
      if (pid && /^\d{5,}$/.test(pid)) return pid;
    }
    var any = q.get('id') || q.get('goods_id') || q.get('sku') || q.get('pid');
    return any && /^\d{5,}$/.test(any) ? any : '';
  }

  function buildSearchUrl(platform, keyword) {
    var q = encodeURIComponent(String(keyword || ''));
    switch (platform) {
      case 'taobao': return 'https://s.taobao.com/search?q=' + q;
      case 'tmall': return 'https://list.tmall.com/search_product.htm?q=' + q;
      case 'jd': return 'https://search.jd.com/Search?keyword=' + q + '&enc=utf-8';
      case 'pdd': return 'https://mobile.yangkeduo.com/search_result.html?search_key=' + q;
      case 'vip': return 'https://category.vip.com/suggest.php?keyword=' + q;
      default: return '';
    }
  }

  /** FNV-1a，用于 mock 数据的确定性种子、缓存 key */
  function hashString(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDate(ts, withTime) {
    var d = new Date(Number(ts) || 0);
    if (isNaN(d.getTime())) return '';
    var base = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return withTime ? base + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : base;
  }

  /** 轴标签用的紧凑价格：1234.5 -> 1235，12345 -> 1.2万 */
  function shortPrice(v) {
    var n = Number(v) || 0;
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
    if (n >= 1000) return String(Math.round(n));
    return n % 1 ? n.toFixed(2) : String(Math.round(n));
  }

  /**
   * 按本地时区取「天」编号。
   * 用 UTC 毫秒除以 86400000 会在东八区把凌晨算到前一天，
   * 导致同一天的本地采样和上游数据被拆成两行。
   */
  function dayKey(ts) {
    var d = new Date(Number(ts) || 0);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /**
   * 按天聚合成交价，每天只留最低价。
   * 一天内反复刷新页面会产生大量同值采样，不聚合会把均值和分位数带偏。
   */
  function dailyMin(points) {
    var map = Object.create(null);
    (points || []).forEach(function (x) {
      var t = Number(x.t || x.ts || 0);
      var p = parsePrice(x.p !== undefined ? x.p : x.price);
      if (!t || !p) return;
      var day = dayKey(t);
      var cur = map[day];
      if (!cur || p < cur.p) {
        map[day] = { t: t, p: p, day: day };
      } else if (p === cur.p && t > cur.t) {
        cur.t = t;
      }
    });
    var out = [];
    for (var k in map) out.push(map[k]);
    out.sort(function (a, b) { return a.day - b.day; });
    return out;
  }

  /**
   * 历史价统计。输入是顺序无关的采样点，输出全部为可序列化数值，前后端共用。
   * position = 历史上比当前价更低的采样占比，用来判断「现在贵不贵」。
   */
  function buildHistoryStats(points, currentPrice, days) {
    var pts = dailyMin(points);
    var cur = parsePrice(currentPrice);
    if (!pts.length) {
      return {
        count: 0, current: cur, min: null, max: null, avg: 0, median: 0,
        vsMin: 0, vsMax: 0, vsAvg: 0, position: 0, trend: 0,
        range: [0, 0], days: days || 0, firstTs: 0, lastTs: 0
      };
    }
    if (!cur) cur = pts[pts.length - 1].p;

    var prices = pts.map(function (x) { return x.p; });
    var sum = 0;
    for (var i = 0; i < prices.length; i++) sum += prices[i];
    var minP = Math.min.apply(null, prices);
    var maxP = Math.max.apply(null, prices);
    var sorted = prices.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var median = sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);

    var minPt = pts[0];
    var maxPt = pts[0];
    for (var j = 1; j < pts.length; j++) {
      if (pts[j].p <= minPt.p) minPt = pts[j];
      if (pts[j].p >= maxPt.p) maxPt = pts[j];
    }

    var below = 0;
    for (var k = 0; k < prices.length; k++) if (prices[k] < cur) below++;
    var position = Math.round((below / prices.length) * 100);

    // 近 7 天均价 vs 前 7 天均价，判断短期是涨是跌
    var lastTs = pts[pts.length - 1].t;
    var recent = [];
    var prev = [];
    for (var m = 0; m < pts.length; m++) {
      if (pts[m].t > lastTs - 7 * DAY_MS) recent.push(pts[m]);
      else if (pts[m].t > lastTs - 14 * DAY_MS) prev.push(pts[m]);
    }
    function mean(arr) {
      if (!arr.length) return 0;
      var s = 0;
      for (var q = 0; q < arr.length; q++) s += arr[q].p;
      return s / arr.length;
    }
    var rAvg = mean(recent);
    var pAvg = mean(prev);
    var trend = pAvg && rAvg ? round2(((rAvg - pAvg) / pAvg) * 100) : 0;

    return {
      count: pts.length,
      current: round2(cur),
      min: { price: round2(minP), ts: minPt.t, date: formatDate(minPt.t) },
      max: { price: round2(maxP), ts: maxPt.t, date: formatDate(maxPt.t) },
      avg: round2(sum / prices.length),
      median: median,
      vsMin: minP ? round2(((cur - minP) / minP) * 100) : 0,
      vsMax: maxP ? round2(((cur - maxP) / maxP) * 100) : 0,
      vsAvg: sum ? round2(((cur - sum / prices.length) / (sum / prices.length)) * 100) : 0,
      position: position,
      trend: trend,
      range: [round2(minP), round2(maxP)],
      days: days || Math.max(1, Math.round((pts[pts.length - 1].t - pts[0].t) / DAY_MS)),
      firstTs: pts[0].t,
      lastTs: lastTs
    };
  }

  /** 把统计结果翻成人话，code 用于配色 */
  function historyAdvice(stats) {
    if (!stats || !stats.count) {
      return { code: 'unknown', label: '暂无历史数据', hint: '多打开几次商品页，价格会自动累积成曲线' };
    }
    if (stats.count < 3) {
      return { code: 'sampling', label: '采样中', hint: '目前只有 ' + stats.count + ' 个采样点，至少 3 天才有参考价值' };
    }
    if (stats.vsMin <= 1) {
      return { code: 'best', label: '接近历史最低', hint: '比历史最低仅高 ' + stats.vsMin.toFixed(1) + '%，可以入手' };
    }
    if (stats.position <= 25) {
      return { code: 'good', label: '低于多数历史价位', hint: '比 ' + (100 - stats.position) + '% 的历史时间更便宜' };
    }
    if (stats.position >= 80) {
      return { code: 'high', label: '高于多数历史价位', hint: '建议再等等，历史最低 ' + formatPrice(stats.min.price) };
    }
    return { code: 'normal', label: '价格处于中间区间', hint: '距历史最低还有 ' + stats.vsMin.toFixed(1) + '% 空间' };
  }

  /**
   * 生成走势图 SVG，返回 { svg, geom, stats }。
   * geom 带每个点的 viewBox 坐标，交互层（hover 竖线、tooltip）复用同一套映射，
   * 避免图形和命中区域算两遍。
   */
  function buildChartSvg(rawPoints, opts) {
    var o = opts || {};
    var W = o.width || 340;
    var H = o.height || 150;
    var compact = Boolean(o.compact);
    var pad = o.padding || (compact
      ? { l: 6, r: 6, t: 8, b: 6 }
      : { l: 46, r: 16, t: 18, b: 22 });
    var pts = dailyMin(rawPoints);
    if (!pts.length) return { svg: '', geom: null, stats: null };

    var plotW = W - pad.l - pad.r;
    var plotH = H - pad.t - pad.b;
    // 深色模式由调用方传色，core 不猜站点主题
    var C = Object.assign({
      line: '#e11d48',
      grid: '#eef0f3',
      axis: '#98a2b3',
      low: '#12b76a',
      lowText: '#067647',
      high: '#98a2b3',
      current: '#f79009',
      dot: '#fff',
      bg: '#fff'
    }, o.colors || {});
    var prices = pts.map(function (x) { return x.p; });
    var minP = o.min !== undefined && o.min !== null ? o.min : Math.min.apply(null, prices);
    var maxP = o.max !== undefined && o.max !== null ? o.max : Math.max.apply(null, prices);
    var span = maxP - minP;
    if (!span) span = Math.max(1, maxP * 0.08);
    // 上下留 12% 余量，曲线不贴边
    var lo = Math.max(0, minP - span * 0.12);
    var hi = maxP + span * 0.12;
    var ySpan = hi - lo || 1;

    function xs(i) {
      if (pts.length === 1) return pad.l + plotW / 2;
      return pad.l + (i / (pts.length - 1)) * plotW;
    }
    function ys(p) {
      return pad.t + (1 - (p - lo) / ySpan) * plotH;
    }

    var coords = [];
    var line = '';
    for (var i = 0; i < pts.length; i++) {
      var cx = xs(i);
      var cy = ys(pts[i].p);
      coords.push({ x: round2(cx), y: round2(cy), p: pts[i].p, t: pts[i].t, i: i });
      line += (i ? ' L' : 'M') + cx.toFixed(1) + ' ' + cy.toFixed(1);
    }
    var baseY = (pad.t + plotH).toFixed(1);
    var area = line + ' L' + xs(pts.length - 1).toFixed(1) + ' ' + baseY +
      ' L' + xs(0).toFixed(1) + ' ' + baseY + ' Z';

    var gid = 'blg' + (Math.abs(hashString(pts.map(function (x) { return x.t + ':' + x.p; }).join(','))) % 99991);
    var parts = [];

    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="bl-chart-svg" role="img" aria-label="历史价格走势">');
    parts.push('<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + C.line + '" stop-opacity="' + (compact ? '.16' : '.28') + '"/>' +
      '<stop offset="100%" stop-color="' + C.line + '" stop-opacity="0"/></linearGradient></defs>');

    if (!compact) {
      // 三条水平参考线 + 右侧价格刻度
      for (var g = 0; g < 3; g++) {
        var gy = pad.t + (plotH / 2) * g;
        var gv = hi - ((hi - lo) / 2) * g;
        parts.push('<line x1="' + pad.l + '" y1="' + gy.toFixed(1) + '" x2="' + (pad.l + plotW) +
          '" y2="' + gy.toFixed(1) + '" stroke="' + C.grid + '" stroke-width="1"/>');
        parts.push('<text x="' + (pad.l - 6) + '" y="' + (gy + 3.5).toFixed(1) +
          '" text-anchor="end" font-size="9.5" fill="' + C.axis + '">' + shortPrice(gv) + '</text>');
      }
    }

    parts.push('<path d="' + area + '" fill="url(#' + gid + ')"/>');
    parts.push('<path d="' + line + '" fill="none" stroke="' + C.line + '" stroke-width="' +
      (compact ? 1.6 : 2) + '" stroke-linejoin="round" stroke-linecap="round"/>');

    var minIdx = 0;
    var maxIdx = 0;
    for (var k = 1; k < pts.length; k++) {
      if (pts[k].p < pts[minIdx].p) minIdx = k;
      if (pts[k].p > pts[maxIdx].p) maxIdx = k;
    }

    // 当前价水平虚线，用户一眼看到现价在曲线哪个高度
    if (!compact && o.current) {
      var cyy = ys(Number(o.current));
      if (cyy > pad.t - 2 && cyy < pad.t + plotH + 2) {
        parts.push('<line x1="' + pad.l + '" y1="' + cyy.toFixed(1) + '" x2="' + (pad.l + plotW) +
          '" y2="' + cyy.toFixed(1) + '" stroke="' + C.current + '" stroke-width="1" stroke-dasharray="3 3" opacity=".85"/>');
      }
    }

    if (pts.length > 1) {
      parts.push('<circle cx="' + coords[minIdx].x + '" cy="' + coords[minIdx].y +
        '" r="' + (compact ? 2 : 3.2) + '" fill="' + C.low + '" stroke="' + C.dot + '" stroke-width="1.4"/>');
      // 最低点只标圆点，具体数值由下方统计格给，避免标签压曲线
      if (!compact && maxIdx !== minIdx) {
        parts.push('<circle cx="' + coords[maxIdx].x + '" cy="' + coords[maxIdx].y +
          '" r="2.6" fill="' + C.high + '" stroke="' + C.dot + '" stroke-width="1.2"/>');
      }
    } else {
      parts.push('<circle cx="' + coords[0].x + '" cy="' + coords[0].y +
        '" r="3" fill="' + C.line + '" stroke="' + C.dot + '" stroke-width="1.4"/>');
    }

    if (!compact) {
      // 首/中/尾三个日期，够定位时间段
      var ticks = pts.length >= 3 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0, pts.length - 1];
      var lastX = -999;
      ticks.forEach(function (idx) {
        var tx = xs(idx);
        if (Math.abs(tx - lastX) < 46) return;
        lastX = tx;
        var anchor = idx === 0 ? 'start' : (idx === pts.length - 1 ? 'end' : 'middle');
        parts.push('<text x="' + tx.toFixed(1) + '" y="' + (H - 6) +
          '" text-anchor="' + anchor + '" font-size="9.5" fill="' + C.axis + '">' +
          formatDate(pts[idx].t).slice(5) + '</text>');
      });
    }

    // 交互层占位，由 UI 填充属性
    if (!compact) {
      parts.push('<line class="bl-hover-line" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + plotH) +
        '" stroke="' + C.axis + '" stroke-width="1" stroke-dasharray="2 3" opacity="0"/>');
      parts.push('<circle class="bl-hover-dot" r="4" fill="' + C.dot + '" stroke="' + C.line + '" stroke-width="2" opacity="0"/>');
    }
    parts.push('</svg>');

    return {
      svg: parts.join(''),
      geom: {
        width: W, height: H, pad: pad,
        plot: { x: pad.l, y: pad.t, w: plotW, h: plotH },
        lo: lo, hi: hi,
        points: coords
      },
      stats: buildHistoryStats(pts, o.current, o.days)
    };
  }

  return {
    VERSION: VERSION,
    round2: round2,
    clamp: clamp,
    parsePrice: parsePrice,
    parseSales: parseSales,
    toHalfWidth: toHalfWidth,
    normalizeTitle: normalizeTitle,
    tokenize: tokenize,
    similarity: similarity,
    extractSpec: extractSpec,
    brandToken: brandToken,
    scoreMatch: scoreMatch,
    computeFinalPrice: computeFinalPrice,
    hotScore: hotScore,
    sortItems: sortItems,
    sortValue: sortValue,
    SORTS: SORTS,
    formatPrice: formatPrice,
    escapeHtml: escapeHtml,
    timeAgo: timeAgo,
    detectPlatform: detectPlatform,
    detectChannel: detectChannel,
    platformName: platformName,
    PLATFORM_NAMES: PLATFORM_NAMES,
    extractItemId: extractItemId,
    buildSearchUrl: buildSearchUrl,
    hashString: hashString,
    debounce: debounce,
    formatDate: formatDate,
    shortPrice: shortPrice,
    dayKey: dayKey,
    dailyMin: dailyMin,
    buildHistoryStats: buildHistoryStats,
    historyAdvice: historyAdvice,
    buildChartSvg: buildChartSvg,
    DAY_MS: DAY_MS
  };
});

/* ==================== platform.js ==================== */
/**
 * 站点规则表：每个平台一套候选选择器 + 详情页判定。
 * 选择器写多套并按顺序试，站点改版时只要有一套管用就能出结果。
 */
(function (root, factory) {
  var core = (typeof module === 'object' && module.exports)
    ? require('./core.js')
    : root.BL.core;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.platform = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  var RULES = {
    taobao: {
      title: ['.tb-main-title', '[class*="ItemHeader--mainTitle"]', '[class*="mainTitle--"]', '.tb-detail-hd h1', 'h1[class*="title"]'],
      price: ['.tb-rmb-num', '[class*="Price--priceText"]', '[class*="priceText--"]', '#J_PromoPriceNum', '.tm-price', '.tb-property-cont .tb-rmb-num'],
      image: ['#J_ImgBooth', '[class*="PicGallery"] img', '.tb-booth img', '[class*="mainPic"] img'],
      shop: ['.tb-shop-name', '[class*="ShopHeader--title"]', '.shop-name', '[class*="shopName"]']
    },
    tmall: {
      title: ['[class*="ItemHeader--mainTitle"]', '.tb-detail-hd h1', '#J_DetailMeta h1', 'h1[class*="mainTitle"]'],
      price: ['[class*="Price--priceText"]', '.tm-price', '#J_PromoPriceNum', '.tm-promo-price .tm-price', '[class*="priceText--"]'],
      image: ['#J_ImgBooth', '[class*="PicGallery"] img', '.tb-booth img'],
      shop: ['[class*="ShopHeader--title"]', '.slogo-shopname', '.shop-name']
    },
    jd: {
      title: ['.sku-name', '#name h1', '[class*="sku-name"]', '.itemInfo-wrap .sku-name'],
      price: ['.p-price .price', '#jd-price', '.summary-price .p-price .price', '[class*="price"] .price'],
      image: ['#spec-img', '#J_ImgBooth', '.jqzoom img'],
      shop: ['.J-hove-wrap .name a', '#popbox .mt .name', '.shopName .name', '.J-shop-name']
    },
    vip: {
      title: ['.goods-name', '[class*="goods-name"]', '.p-name', '.goods-title h1', 'h1'],
      price: ['.goods-price', '.vip-price', '.price .num', '#J_price', '[class*="goodsPrice"]'],
      image: ['.goods-img img', '#J_img', '[class*="goods-img"] img', '.pic img'],
      shop: ['.brand-name', '.shop-name', '[class*="brandName"]']
    },
    pdd: {
      title: ['[class*="goodsName"]', '.goods-name', '[class*="title"] h1', 'h1'],
      price: ['[class*="groupPrice"]', '.goods-price', '[class*="price"] span', '.price-num'],
      image: ['[class*="goodsImg"] img', '.goods-img img', '.banner-img img'],
      shop: ['[class*="mallName"]', '.mall-name', '.shop-name']
    }
  };

  var EXCLUDE_PATTERNS = [
    /^login\./, /^uland\./, /^cart\./, /^order\./, /^trade\./, /^pay\./,
    /^wq\./, /^union\./, /^passport\./, /^sso\./
  ];

  var EXCLUDE_PATHS = [
    /^\/cart/, /^\/order/, /^\/trade/, /^\/checkout/, /^\/login/, /^\/register/,
    /^\/user/, /^\/member/, /^\/my/
  ];

  function getRule(platform) {
    return RULES[platform] || null;
  }

  function isExcluded(host, pathname) {
    var h = String(host || '').toLowerCase().split(':')[0];
    var p = String(pathname || '/');
    for (var i = 0; i < EXCLUDE_PATTERNS.length; i++) {
      if (EXCLUDE_PATTERNS[i].test(h)) return true;
    }
    for (var j = 0; j < EXCLUDE_PATHS.length; j++) {
      if (EXCLUDE_PATHS[j].test(p)) return true;
    }
    return false;
  }

  /** 详情页判定：能抠出商品 id 就是详情页；列表页/搜索页不弹面板 */
  function isDetailPage(url, platform) {
    var u;
    try {
      u = new URL(url);
    } catch (err) {
      return false;
    }
    if (isExcluded(u.host, u.pathname)) return false;
    if (platform === 'pdd') return /goods\.html/.test(u.pathname) || Boolean(u.searchParams.get('goods_id'));
    if (platform === 'vip') return /detail-\d+-\d+\.html/.test(u.pathname) || /\/detail\//.test(u.pathname);
    if (platform === 'jd') return /\/\d{5,}\.html/.test(u.pathname);
    return Boolean(core.extractItemId(url, platform));
  }

  function isListPage(url) {
    var u;
    try {
      u = new URL(url);
    } catch (err) {
      return false;
    }
    return /(^|\.)(s|search|list|category|so)\./.test(u.host) ||
      /search|list|category|suggest/.test(u.pathname);
  }

  return {
    RULES: RULES,
    getRule: getRule,
    isExcluded: isExcluded,
    isDetailPage: isDetailPage,
    isListPage: isListPage
  };
});

/* ==================== extract.js ==================== */
/**
 * 商品信息抽取：四级降级
 *   1) meta / og 标签（最稳）
 *   2) 页面全局 JSON（__INITIAL_STATE__ 等，抗改版）
 *   3) DOM 选择器（多套候选）
 *   4) document.title + 正文价格正则（兜底，置信度最低）
 */
(function (root, factory) {
  var core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.BL.core;
  var platformApi = (typeof module === 'object' && module.exports) ? require('./platform.js') : root.BL.platform;
  var api = factory(core, platformApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.extract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, platformApi) {
  'use strict';

  var GLOBAL_KEYS = [
    '__INITIAL_STATE__', '__INITIAL_DATA__', '__NEXT_DATA__', '__NUXT__',
    '__APOLLO_STATE__', 'pageConfig', '__DETAIL_DATA__', '__GOODS_INFO__',
    '__ITEM_DATA__', 'rawData', '__PRELOADED_STATE__'
  ];

  var TITLE_KEYS = ['skuName', 'goodsName', 'itemTitle', 'productName', 'goods_name', 'title', 'name'];
  var PRICE_KEYS = ['pPrice', 'salePrice', 'vipPrice', 'zkFinalPrice', 'finalPrice', 'lowestPrice',
    'minGroupPrice', 'min_group_price', 'actPrice', 'promoPrice', 'price', 'jdPrice'];
  var IMAGE_KEYS = ['image', 'imageUrl', 'picUrl', 'mainPic', 'goodsImage', 'pict_url', 'skuPic', 'pic'];
  var SHOP_KEYS = ['shopName', 'shopTitle', 'mallName', 'brandName', 'storeName', 'venderName'];

  function qs(doc, sel) {
    try {
      return doc.querySelector(sel);
    } catch (err) {
      return null;
    }
  }

  function textOf(node) {
    if (!node) return '';
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function attrOf(node, name) {
    if (!node) return '';
    if (typeof node.getAttribute === 'function') return node.getAttribute(name) || '';
    return node[name] || '';
  }

  function pickText(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var t = textOf(qs(doc, selectors[i]));
      if (t) return t;
    }
    return '';
  }

  function pickAttr(doc, selectors, attr) {
    for (var i = 0; i < selectors.length; i++) {
      var node = qs(doc, selectors[i]);
      if (!node) continue;
      var v = attrOf(node, attr);
      if (v) return v;
    }
    return '';
  }

  function metaContent(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var node = qs(doc, 'meta[property="' + names[i] + '"]') || qs(doc, 'meta[name="' + names[i] + '"]');
      if (node) {
        var c = attrOf(node, 'content');
        if (c) return c.trim();
      }
    }
    return '';
  }

  function cleanTitle(raw) {
    var t = String(raw || '').replace(/\s+/g, ' ').trim();
    var suffixes = [
      /[-_|—]\s*淘宝网.*$/i, /[-_|—]\s*天猫.*$/i, /[-_|—]\s*Tmall.*$/i,
      /【行情\s*报价\s*价格\s*评测】[-_|—]?京东.*$/i, /[-_|—]\s*京东.*$/i,
      /[-_|—]\s*唯品会.*$/i, /[-_|—]\s*拼多多.*$/i, /[-_|—]\s*苏宁.*$/i
    ];
    for (var i = 0; i < suffixes.length; i++) t = t.replace(suffixes[i], '');
    t = t.replace(/^\s*【[^】]{0,20}】\s*/, function (m) {
      // 开头的【官方旗舰店】这类前缀去掉；【品牌名】保留
      return /旗舰|专营|自营|官方|促销|包邮/.test(m) ? '' : m;
    });
    return t.trim();
  }

  /** 深度遍历页面全局对象，找同时带标题和价格的那个节点 */
  function scanGlobals(win) {
    if (!win) return null;
    var visited = typeof WeakSet === 'function' ? new WeakSet() : null;
    var queue = [];
    for (var i = 0; i < GLOBAL_KEYS.length; i++) {
      try {
        var v = win[GLOBAL_KEYS[i]];
        if (v && typeof v === 'object') queue.push({ node: v, depth: 0 });
      } catch (err) {
        // 跨域属性直接跳过
      }
    }

    var found = null;
    var steps = 0;
    while (queue.length && steps < 4000 && !found) {
      var cur = queue.shift();
      steps++;
      var node = cur.node;
      if (!node || typeof node !== 'object') continue;
      if (visited) {
        if (visited.has(node)) continue;
        visited.add(node);
      }
      if (cur.depth > 9) continue;

      var title = '';
      var price = 0;
      var image = '';
      var shop = '';
      for (var t = 0; t < TITLE_KEYS.length; t++) {
        var tv = node[TITLE_KEYS[t]];
        if (typeof tv === 'string' && tv.trim().length >= 4 && tv.length <= 200) {
          title = tv.trim();
          break;
        }
      }
      if (title) {
        for (var p = 0; p < PRICE_KEYS.length; p++) {
          var pv = node[PRICE_KEYS[p]];
          var parsed = core.parsePrice(pv);
          if (parsed > 0 && parsed < 10000000) {
            price = parsed;
            break;
          }
        }
      }
      if (title && price) {
        for (var im = 0; im < IMAGE_KEYS.length; im++) {
          var iv = node[IMAGE_KEYS[im]];
          if (typeof iv === 'string' && iv.length > 4) {
            image = iv;
            break;
          }
        }
        for (var s = 0; s < SHOP_KEYS.length; s++) {
          var sv = node[SHOP_KEYS[s]];
          if (typeof sv === 'string' && sv.trim()) {
            shop = sv.trim();
            break;
          }
        }
        found = { title: title, price: price, image: image, shop: shop };
      }

      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && k < 120; k++) {
        var child;
        try {
          child = node[keys[k]];
        } catch (err) {
          continue;
        }
        if (child && typeof child === 'object') queue.push({ node: child, depth: cur.depth + 1 });
      }
    }
    return found;
  }

  function fromMeta(doc) {
    var title = cleanTitle(metaContent(doc, ['og:title', 'twitter:title']));
    var price = core.parsePrice(metaContent(doc, ['product:price:amount', 'og:price:amount', 'item:price']));
    var image = metaContent(doc, ['og:image', 'twitter:image']);
    return { title: title, price: price, image: image, shop: '' };
  }

  function fromDom(doc, rule) {
    if (!rule) return { title: '', price: 0, image: '', shop: '' };
    var title = cleanTitle(pickText(doc, rule.title));
    var priceText = pickText(doc, rule.price);
    var price = core.parsePrice(priceText);
    if (!price) {
      // 价格节点里常混着 "¥199.00" 和划线价，取第一个有效数字
      var m = String(priceText || '').match(/(\d+(?:[.,]\d{1,2})?)/);
      if (m) price = core.parsePrice(m[1]);
    }
    var image = pickAttr(doc, rule.image, 'data-origin') || pickAttr(doc, rule.image, 'src');
    if (image && image.indexOf('//') === 0) image = 'https:' + image;
    var shop = pickText(doc, rule.shop);
    return { title: title, price: price, image: image, shop: shop };
  }

  function priceFromBody(doc) {
    var body = doc && doc.body ? String(doc.body.textContent || '') : '';
    var slice = body.slice(0, 4000);
    var m = slice.match(/[¥￥]\s*(\d{1,7}(?:[.,]\d{1,2})?)/);
    return m ? core.parsePrice(m[1]) : 0;
  }

  function titleFromDoc(doc, win) {
    var t = cleanTitle(doc && doc.title ? doc.title : '');
    if (t.length >= 4) return t;
    var h1 = pickText(doc, ['h1']);
    return h1 ? cleanTitle(h1) : '';
  }

  /**
   * 主入口。
   * @param {Document} doc  document 或测试替身
   * @param {Window} win    取页面全局变量
   * @param {string} url
   */
  function extract(doc, win, url) {
    var u;
    try {
      u = new URL(url);
    } catch (err) {
      return { ok: false, reason: 'URL 非法' };
    }
    var platform = core.detectPlatform(u.host);
    if (!platform) return { ok: false, reason: '不支持的站点' };
    if (platformApi.isExcluded(u.host, u.pathname)) return { ok: false, reason: '排除的页面' };

    var rule = platformApi.getRule(platform);
    var sources = [];
    var candidates = [];

    var meta = fromMeta(doc);
    if (meta.title || meta.price) {
      candidates.push(Object.assign({ confidence: meta.title && meta.price ? 0.92 : 0.6, from: 'meta' }, meta));
    }
    var dom = fromDom(doc, rule);
    if (dom.title || dom.price) {
      candidates.push(Object.assign({ confidence: dom.title && dom.price ? 0.82 : 0.55, from: 'dom' }, dom));
    }
    var glob = scanGlobals(win);
    if (glob) {
      candidates.push(Object.assign({ confidence: 0.78, from: 'json' }, glob));
    }

    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var score = c.confidence;
      if (c.title && c.title.length >= 4) score += 0.05;
      if (c.price > 0) score += 0.05;
      c.score = score;
      if (!best || c.score > best.score) best = c;
    }

    var title = best && best.title ? best.title : titleFromDoc(doc, win);
    var price = best && best.price ? best.price : 0;
    var image = best && best.image ? best.image : '';
    var shop = best && best.shop ? best.shop : '';
    var from = best ? best.from : 'none';

    // 标题和价格必须各有一个来源；价格缺失时只做标题搜索，仍可用
    if (!title || title.length < 4) return { ok: false, reason: '未能识别商品标题' };
    if (!price) {
      var bp = priceFromBody(doc);
      if (bp) {
        price = bp;
        from = 'body';
      }
    }
    if (!image) {
      var ogImage = metaContent(doc, ['og:image']);
      if (ogImage) image = ogImage;
    }

    var itemId = core.extractItemId(url, platform);
    var channel = core.detectChannel(u.host, u.pathname);

    return {
      ok: true,
      platform: platform,
      platformName: core.platformName(platform),
      channel: channel,
      itemId: itemId,
      title: title,
      price: price,
      image: image,
      shop: shop,
      url: url,
      from: from,
      confidence: best ? core.round2(Math.min(1, best.score)) : 0.3
    };
  }

  return { extract: extract, cleanTitle: cleanTitle, scanGlobals: scanGlobals };
});

/* ==================== store.js ==================== */
/** 配置与状态存储：优先 GM 存储，退回 localStorage */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEYS = ['apiBase', 'panelPos', 'closed', 'collapsed', 'auto', 'sort', 'tab', 'lastQuery'];
  var cache = {};
  var ready = false;

  function gmGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        var v = GM_getValue(key);
        return v === undefined ? undefined : v;
      }
    } catch (err) { /* 被沙箱拒绝就退回 localStorage */ }
    try {
      var raw = root.localStorage && root.localStorage.getItem('bl.' + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err2) {
      return undefined;
    }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (err) { /* fallthrough */ }
    // Violentmonkey / 新版管理器可能只提供异步 GM.setValue。
    // set() 保持同步 API，持久化请求在后台完成，失败时静默退回 localStorage。
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
        var pending = GM.setValue(key, value);
        if (pending && typeof pending.catch === 'function') pending.catch(function () {});
        return;
      }
    } catch (errAsync) { /* fallthrough */ }
    try {
      if (root.localStorage) root.localStorage.setItem('bl.' + key, JSON.stringify(value));
    } catch (err2) { /* 隐私模式写不进去，忽略 */ }
  }

  var DEFAULTS = {
    apiBase: 'http://127.0.0.1:8787',
    panelPos: { right: 18, top: 96 },
    closed: false,
    collapsed: false,
    auto: true,
    sort: 'renqi',
    tab: 'compare',
    lastQuery: ''
  };

  function init() {
    return new Promise(function (resolve) {
      var needAsync = (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' &&
        typeof GM_getValue !== 'function');
      if (!needAsync) {
        KEYS.forEach(function (k) {
          var v = gmGet(k);
          cache[k] = v === undefined ? DEFAULTS[k] : v;
        });
        ready = true;
        resolve(cache);
        return;
      }
      Promise.all(KEYS.map(function (k) {
        return Promise.resolve(GM.getValue(k, DEFAULTS[k])).then(function (v) {
          cache[k] = v === undefined ? DEFAULTS[k] : v;
        }).catch(function () {
          cache[k] = DEFAULTS[k];
        });
      })).then(function () {
        ready = true;
        resolve(cache);
      });
    });
  }

  function get(key) {
    if (!ready) return DEFAULTS[key];
    return cache[key] === undefined ? DEFAULTS[key] : cache[key];
  }

  function set(key, value) {
    cache[key] = value;
    gmSet(key, value);
    return value;
  }

  return { init: init, get: get, set: set, KEYS: KEYS, DEFAULTS: DEFAULTS };
});

/* ==================== api.js ==================== */
/** 后端通讯：GM_xmlhttpRequest 跨域，无 GM 时退回 fetch */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.api = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var DEFAULT_BASE = 'http://127.0.0.1:8787';
  var base = DEFAULT_BASE;
  var timeout = 15000;

  // 脚本只服务于本机聚合服务，限制回环地址，避免被改成远端地址后悄悄外发浏览数据
  function isLoopback(url) {
    try {
      var host = new URL(String(url || '')).hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch (err) {
      return false;
    }
  }

  function setBase(url) {
    var next = String(url || '').replace(/\/+$/, '');
    base = isLoopback(next) ? next : DEFAULT_BASE;
  }

  function full(path) {
    return /^https?:\/\//.test(path) ? path : base + path;
  }

  function parse(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function gmRequest(url, options) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest 不可用'));
        return;
      }
      var timer = setTimeout(function () {
        reject(new Error('请求超时，后端没响应'));
      }, timeout + 2000);
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: url,
        headers: Object.assign({ 'Accept': 'application/json' }, options.headers || {}),
        data: options.body,
        timeout: timeout,
        onload: function (res) {
          clearTimeout(timer);
          var json = parse(res.responseText);
          if (res.status >= 200 && res.status < 300 && json) resolve(json);
          else reject(new Error((json && json.error) || ('HTTP ' + res.status)));
        },
        onerror: function () {
          clearTimeout(timer);
          reject(new Error('连不上后端，检查服务是否启动'));
        },
        ontimeout: function () {
          clearTimeout(timer);
          reject(new Error('请求超时'));
        }
      });
    });
  }

  function fetchRequest(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, timeout);
    return fetch(url, {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      body: options.body,
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.json();
    }).then(function (json) {
      if (json && json.ok === false) throw new Error(json.error || '接口返回失败');
      return json;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function request(path, options) {
    var opts = options || {};
    var url = full(path);
    if (typeof GM_xmlhttpRequest === 'function') return gmRequest(url, opts);
    return fetchRequest(url, opts);
  }

  function get(path, params) {
    var qs = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return request(path + (qs.length ? (path.indexOf('?') >= 0 ? '&' : '?') + qs.join('&') : ''), { method: 'GET' });
  }

  function post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  return {
    setBase: setBase,
    isLoopback: isLoopback,
    getBase: function () { return base; },
    setTimeout: function (ms) { timeout = ms; },
    health: function () { return get('/api/health'); },
    search: function (params) { return get('/api/search', params); },
    compare: function (item) { return post('/api/compare', item); },
    collect: function (item) { return post('/api/collect', item); },
    /**
     * 历史价：传 key 字符串走兼容模式，传对象则带上 url/platform/title，后端自己算 key。
     * 传 url 最准 —— 商品 id 能从链接里直接提出来。
     */
    history: function (query, days) {
      var q = typeof query === 'string' ? { key: query } : Object.assign({}, query || {});
      if (days) q.days = days;
      return get('/api/history', q);
    }
  };
});

/* ==================== ui.js ==================== */
/**
 * 面板 UI：Shadow DOM 隔离站点样式，四个视图（比价 / 搜索 / 券 / 设置）。
 * 只负责渲染和事件转发，不直接发请求。
 */
(function (root, factory) {
  var core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.BL.core;
  var api = factory(core, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BL.ui = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, root) {
  'use strict';

  var STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .bl-panel {
    position: fixed; right: 18px; top: 96px; width: 392px; max-height: calc(100vh - 140px);
    display: flex; flex-direction: column; overflow: hidden;
    background: #fff; color: #1b1f24; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, .22), 0 2px 8px rgba(15, 23, 42, .10);
    border: 1px solid rgba(15, 23, 42, .07);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    pointer-events: auto; transition: opacity .16s ease, transform .16s ease;
  }
  .bl-panel.hide { display: none; }
  .bl-panel.min .bl-tabs, .bl-panel.min .bl-body, .bl-panel.min .bl-foot { display: none; }
  .bl-panel.min { width: 236px; }
  .bl-head {
    display: flex; align-items: center; gap: 9px; padding: 0 12px; height: 50px; flex: 0 0 auto;
    background: linear-gradient(100deg, #ff5a1f 0%, #ff2757 55%, #e01e5a 100%);
    color: #fff; cursor: move; user-select: none;
  }
  .bl-logo {
    width: 26px; height: 26px; border-radius: 8px; flex: 0 0 auto;
    background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; letter-spacing: .5px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
  }
  .bl-titles { flex: 1; min-width: 0; }
  .bl-name { font-size: 13px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-sub { font-size: 11px; opacity: .82; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-hbtn {
    width: 24px; height: 24px; border: 0; border-radius: 7px; background: rgba(255,255,255,.14);
    color: #fff; cursor: pointer; font-size: 13px; line-height: 1; display: flex; align-items: center; justify-content: center;
    padding: 0; flex: 0 0 auto;
  }
  .bl-hbtn:hover { background: rgba(255,255,255,.28); }
  .bl-tabs { display: flex; gap: 2px; padding: 7px 8px 0; border-bottom: 1px solid #eef0f3; flex: 0 0 auto; background: #fff; }
  .bl-tab {
    flex: 1; border: 0; background: transparent; padding: 8px 6px 9px; font-size: 12.5px; color: #6b7280;
    cursor: pointer; border-radius: 8px 8px 0 0; position: relative; font-family: inherit;
  }
  .bl-tab:hover { color: #111827; background: #f8f9fb; }
  .bl-tab.on { color: #e11d48; font-weight: 600; }
  .bl-tab.on::after { content: ''; position: absolute; left: 18%; right: 18%; bottom: -1px; height: 2px; background: #e11d48; border-radius: 2px; }
  .bl-body { padding: 12px; overflow-y: auto; flex: 1 1 auto; background: #fff; }
  .bl-body::-webkit-scrollbar { width: 6px; }
  .bl-body::-webkit-scrollbar-thumb { background: #d7dbe2; border-radius: 3px; }
  .bl-foot {
    flex: 0 0 auto; padding: 7px 12px; border-top: 1px solid #eef0f3; font-size: 11px; color: #8b93a1;
    display: flex; align-items: center; gap: 6px; background: #fcfcfd;
  }
  .bl-dot { width: 6px; height: 6px; border-radius: 50%; background: #c2c8d2; flex: 0 0 auto; }
  .bl-dot.ok { background: #12b76a; } .bl-dot.err { background: #f04438; } .bl-dot.mock { background: #f79009; }
  .bl-foot a { color: #8b93a1; margin-left: auto; text-decoration: none; }
  .bl-foot a:hover { color: #e11d48; }

  .bl-item { display: flex; gap: 10px; padding: 10px; border: 1px solid #eef0f3; border-radius: 11px; background: #fcfcfd; }
  .bl-item img, .bl-ph {
    width: 54px; height: 54px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; background: #f2f4f7;
  }
  .bl-ph { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 18px; }
  .bl-ph.taobao { background: linear-gradient(135deg,#ff8a00,#ff5000); }
  .bl-ph.tmall { background: linear-gradient(135deg,#ff5f5f,#d0021b); }
  .bl-ph.jd { background: linear-gradient(135deg,#ff6a6a,#c81623); }
  .bl-ph.pdd { background: linear-gradient(135deg,#ff7a6b,#e02e24); }
  .bl-ph.vip { background: linear-gradient(135deg,#ff6fb5,#f10180); }
  .bl-item-main { min-width: 0; flex: 1; }
  .bl-item-title { font-size: 12.5px; line-height: 1.45; color: #111827; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bl-item-meta { margin-top: 4px; font-size: 11px; color: #8b93a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-item-price { margin-top: 3px; font-size: 17px; font-weight: 700; color: #e11d48; }
  .bl-item-price small { font-size: 11px; font-weight: 400; color: #98a2b3; text-decoration: line-through; margin-left: 6px; }

  .bl-best {
    margin: 10px 0; padding: 10px 12px; border-radius: 11px;
    background: linear-gradient(100deg, #fff4ed, #fff0f4); border: 1px solid #ffe0d1;
    display: flex; align-items: center; gap: 10px;
  }
  .bl-best .bl-best-k { font-size: 11px; color: #9a3412; }
  .bl-best .bl-best-v { font-size: 19px; font-weight: 750; color: #d61f3c; line-height: 1.2; }
  .bl-best .bl-best-p { font-size: 11px; color: #9a3412; background: #fff; border-radius: 999px; padding: 3px 8px; margin-left: auto; white-space: nowrap; }
  .bl-save { color: #067647; background: #ecfdf3; border: 1px solid #abefc6; border-radius: 8px; padding: 6px 9px; font-size: 11px; margin-bottom: 10px; }

  .bl-list { display: flex; flex-direction: column; gap: 6px; }
  .bl-row {
    display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px; border-radius: 9px; cursor: pointer;
    border: 1px solid transparent; transition: background .12s ease, border-color .12s ease;
  }
  .bl-row:hover { background: #f8f9fb; border-color: #eef0f3; }
  .bl-row.cur { background: #fffaf7; border-color: #ffe3d3; }
  .bl-pf {
    font-size: 10.5px; padding: 2px 6px; border-radius: 5px; color: #fff; flex: 0 0 auto; margin-top: 1px;
    font-weight: 600; letter-spacing: .2px;
  }
  .bl-pf.taobao { background: #ff5000; } .bl-pf.tmall { background: #d0021b; }
  .bl-pf.jd { background: #c81623; } .bl-pf.pdd { background: #e02e24; }
  .bl-pf.vip { background: #f10180; } .bl-pf.mock { background: #98a2b3; }
  .bl-row-main { flex: 1; min-width: 0; }
  .bl-row-title { font-size: 12px; line-height: 1.4; color: #344054; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bl-row-meta { font-size: 10.5px; color: #98a2b3; margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; }
  .bl-coupon-tag { color: #c11574; background: #fdf2fa; border-radius: 4px; padding: 0 4px; }
  .bl-row-price { text-align: right; flex: 0 0 auto; min-width: 74px; }
  .bl-row-price b { color: #e11d48; font-size: 14px; }
  .bl-row-price s { display: block; color: #b0b7c3; font-size: 10.5px; }
  .bl-go {
    border: 0; background: #fff1f2; color: #e11d48; border-radius: 6px; font-size: 11px;
    padding: 4px 7px; cursor: pointer; margin-top: 4px; font-family: inherit;
  }
  .bl-go:hover { background: #ffe4e6; }

  .bl-skeleton { padding: 8px 2px; }
  .bl-sk { height: 12px; border-radius: 6px; background: linear-gradient(90deg,#f1f3f6 25%,#e8ebf0 37%,#f1f3f6 63%); background-size: 400% 100%; animation: bl-sh 1.2s ease infinite; margin-bottom: 9px; }
  .bl-sk.w40 { width: 40%; } .bl-sk.w70 { width: 70%; } .bl-sk.w90 { width: 90%; }
  @keyframes bl-sh { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
  .bl-empty { text-align: center; color: #98a2b3; padding: 26px 10px; font-size: 12px; line-height: 1.8; }
  .bl-err { background: #fef3f2; border: 1px solid #fecdca; color: #b42318; border-radius: 10px; padding: 11px 12px; font-size: 12px; line-height: 1.65; }
  .bl-err code { background: rgba(180,35,24,.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
  .bl-btn {
    border: 1px solid #e4e7ec; background: #fff; color: #344054; border-radius: 8px; padding: 7px 11px;
    font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .bl-btn:hover { border-color: #fda4af; color: #e11d48; }
  .bl-btn.pri { background: #e11d48; border-color: #e11d48; color: #fff; }
  .bl-btn.pri:hover { background: #be123c; color: #fff; }
  .bl-row-btns { display: flex; gap: 8px; margin-top: 10px; }

  .bl-searchbar { display: flex; gap: 6px; }
  .bl-input {
    flex: 1; min-width: 0; border: 1px solid #e4e7ec; border-radius: 9px; padding: 8px 10px;
    font-size: 12.5px; color: #101828; background: #fff; outline: none; font-family: inherit;
  }
  .bl-input:focus { border-color: #fda4af; box-shadow: 0 0 0 3px rgba(225,29,72,.08); }
  .bl-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 9px 0 11px; }
  .bl-chip {
    border: 1px solid #e4e7ec; background: #fff; color: #667085; border-radius: 999px;
    font-size: 11px; padding: 4px 9px; cursor: pointer; font-family: inherit;
  }
  .bl-chip.on { border-color: #e11d48; color: #e11d48; background: #fff1f2; }
  .bl-count { font-size: 11px; color: #98a2b3; margin-bottom: 7px; }

  .bl-cpn {
    border: 1px dashed #f5c2d0; border-radius: 10px; padding: 9px 10px; margin-bottom: 8px;
    display: flex; align-items: center; gap: 10px; background: #fffafc;
  }
  .bl-cpn-amt { color: #e11d48; font-weight: 700; font-size: 18px; min-width: 58px; }
  .bl-cpn-amt span { font-size: 11px; font-weight: 400; }
  .bl-cpn-main { flex: 1; min-width: 0; }
  .bl-cpn-desc { font-size: 11.5px; color: #475467; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bl-cpn-sub { font-size: 10.5px; color: #98a2b3; margin-top: 2px; }
  .bl-cpn-btns { display: flex; flex-direction: column; gap: 4px; }

  .bl-sec { font-size: 11px; color: #98a2b3; margin: 12px 0 6px; letter-spacing: .3px; }
  .bl-hist { margin-top: 10px; border-top: 1px dashed #eef0f3; padding-top: 8px; }
  .bl-hist svg { width: 100%; height: 60px; display: block; }
  .bl-hist-meta { display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: #98a2b3; margin-top: 2px; }
  .bl-hist-more {
    border: 0; background: transparent; color: #e11d48; font-size: 10.5px; cursor: pointer;
    padding: 0; font-family: inherit;
  }
  .bl-hist-more:hover { text-decoration: underline; }

  .bl-range { display: flex; gap: 5px; margin: 2px 0 4px; }
  .bl-range .bl-chip { padding: 3px 9px; font-size: 10.5px; }
  .bl-chart { position: relative; margin: 6px 0 2px; touch-action: pan-y; }
  .bl-chart svg { width: 100%; height: 158px; display: block; }
  .bl-chart-empty {
    height: 158px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; color: #98a2b3; font-size: 12px; background: #fcfcfd; border: 1px dashed #eef0f3; border-radius: 10px;
  }
  .bl-tip {
    position: absolute; left: 0; top: 0; pointer-events: none; z-index: 6;
    background: rgba(16,24,40,.94); color: #fff; font-size: 11px; line-height: 1.4;
    padding: 5px 9px; border-radius: 7px; white-space: nowrap;
    transform: translate(-50%, -100%); opacity: 0; transition: opacity .1s ease;
  }
  .bl-tip.show { opacity: 1; }
  .bl-mock-tag {
    position: absolute; right: 4px; top: 2px; font-size: 10px; color: #b54708;
    background: #fffaeb; border: 1px solid #fedf89; border-radius: 5px; padding: 1px 5px; z-index: 3;
  }
  .bl-hero { display: flex; align-items: flex-end; gap: 8px; margin: 10px 0 6px; }
  .bl-hero-v { font-size: 25px; font-weight: 750; color: #e11d48; line-height: 1.1; letter-spacing: -.4px; }
  .bl-hero-u { font-size: 10.5px; color: #98a2b3; padding-bottom: 3px; }
  .bl-advice {
    display: flex; gap: 7px; align-items: flex-start; border-radius: 9px; padding: 8px 10px;
    font-size: 11.5px; line-height: 1.5; margin: 8px 0 2px;
  }
  .bl-advice b { font-weight: 650; }
  .bl-advice.best { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; }
  .bl-advice.good { background: #f0f9ff; color: #026aa2; border: 1px solid #b9e6fe; }
  .bl-advice.normal { background: #fffaeb; color: #b54708; border: 1px solid #fedf89; }
  .bl-advice.high { background: #fef3f2; color: #b42318; border: 1px solid #fecdca; }
  .bl-advice.sampling, .bl-advice.unknown { background: #f8f9fb; color: #667085; border: 1px solid #eef0f3; }
  .bl-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
  .bl-cell { background: #fcfcfd; border: 1px solid #eef0f3; border-radius: 9px; padding: 7px 9px; }
  .bl-cell .k { font-size: 10.5px; color: #98a2b3; }
  .bl-cell .v { font-size: 14px; font-weight: 650; color: #101828; margin-top: 1px; }
  .bl-cell .v small { font-size: 10px; font-weight: 400; color: #98a2b3; margin-left: 3px; }
  .bl-cell .v.green { color: #067647; } .bl-cell .v.red { color: #b42318; }
  .bl-src { font-size: 10.5px; color: #98a2b3; line-height: 1.6; margin-top: 9px; }
  .bl-src .up { color: #b42318; }
  .bl-src .down { color: #067647; }

  .bl-setting { display: flex; flex-direction: column; gap: 10px; }
  .bl-field { display: flex; flex-direction: column; gap: 5px; }
  .bl-field label { font-size: 11.5px; color: #667085; }
  .bl-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #344054; }
  .bl-kv { display: flex; justify-content: space-between; font-size: 11.5px; color: #667085; padding: 3px 0; border-bottom: 1px dashed #f2f4f7; }
  .bl-kv b { color: #101828; font-weight: 600; }

  .bl-fab {
    position: fixed; right: 0; top: 42%; background: linear-gradient(180deg,#ff5a1f,#e01e5a); color: #fff;
    border-radius: 10px 0 0 10px; padding: 10px 6px; font-size: 12px; letter-spacing: 2px; cursor: pointer;
    box-shadow: 0 6px 18px rgba(224,30,90,.35); writing-mode: vertical-rl; display: none; pointer-events: auto;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .bl-fab.show { display: block; }
  .bl-toast {
    position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%) translateY(8px);
    background: rgba(16,24,40,.92); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 12px;
    opacity: 0; transition: opacity .18s ease, transform .18s ease; pointer-events: none; white-space: nowrap;
    font-family: -apple-system, "PingFang SC", sans-serif;
  }
  .bl-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media (prefers-color-scheme: dark) {
    .bl-panel { background: #171a20; color: #e6e8ec; border-color: #262b33; }
    .bl-tabs { background: #171a20; border-color: #262b33; }
    .bl-tab { color: #9aa0a6; } .bl-tab:hover { background: #1d2129; color: #e6e8ec; }
    .bl-tab.on { color: #ff6b81; } .bl-tab.on::after { background: #ff6b81; }
    .bl-body { background: #171a20; }
    .bl-item { background: #1b1f27; border-color: #262b33; }
    .bl-item-title { color: #e6e8ec; }
    .bl-item-meta, .bl-row-meta { color: #8b93a1; }
    .bl-best { background: linear-gradient(100deg,#2a1a1f,#2a1720); border-color: #4a2530; }
    .bl-best .bl-best-k, .bl-best .bl-best-p { color: #ffb4a2; }
    .bl-best .bl-best-p { background: #171a20; }
    .bl-save { background: #10281f; border-color: #1d5a3f; color: #6ce9a6; }
    .bl-row:hover { background: #1d2129; border-color: #262b33; }
    .bl-row.cur { background: #241a1c; border-color: #3b2429; }
    .bl-row-title { color: #d0d5dd; }
    .bl-go { background: #2a151b; color: #ff8fa3; }
    .bl-input { background: #1b1f27; border-color: #2b3039; color: #e6e8ec; }
    .bl-chip { background: #1b1f27; border-color: #2b3039; color: #98a2b3; }
    .bl-chip.on { background: #2a151b; }
    .bl-btn { background: #1b1f27; border-color: #2b3039; color: #d0d5dd; }
    .bl-cpn { background: #201a1d; border-color: #3b2429; }
    .bl-cpn-desc { color: #d0d5dd; }
    .bl-kv b { color: #e6e8ec; }
    .bl-foot { background: #14171c; border-color: #262b33; }
    .bl-err { background: #2a1517; border-color: #4a2224; color: #fda29b; }
    .bl-sk { background: linear-gradient(90deg,#20242c 25%,#272c35 37%,#20242c 63%); background-size: 400% 100%; }
    .bl-chart-empty { background: #1b1f27; border-color: #262b33; color: #8b93a1; }
    .bl-cell { background: #1b1f27; border-color: #262b33; }
    .bl-cell .v { color: #e6e8ec; }
    .bl-cell .v.green { color: #6ce9a6; } .bl-cell .v.red { color: #fda29b; }
    .bl-advice.best { background: #10281f; border-color: #1d5a3f; color: #6ce9a6; }
    .bl-advice.good { background: #0b2436; border-color: #12496b; color: #84caff; }
    .bl-advice.normal { background: #2a2011; border-color: #4a3413; color: #fec84b; }
    .bl-advice.high { background: #2a1517; border-color: #4a2224; color: #fda29b; }
    .bl-advice.sampling, .bl-advice.unknown { background: #1b1f27; border-color: #262b33; color: #98a2b3; }
    .bl-mock-tag { background: #2a2011; border-color: #4a3413; color: #fec84b; }
    .bl-src { color: #8b93a1; }
  }
  @media (max-width: 640px) {
    .bl-panel {
      left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 76vh; border-radius: 16px;
    }
    .bl-panel.min { width: auto; left: auto; right: 10px; }
    .bl-head { height: 46px; cursor: default; }
  }
  `;

  function esc(s) {
    return core.escapeHtml(s);
  }

  function money(n) {
    return core.formatPrice(n);
  }

  function pfClass(item) {
    return item && item.platform ? item.platform : '';
  }

  function badge(item, extra) {
    return '<span class="bl-pf ' + esc(pfClass(item)) + '">' +
      esc(core.platformName(item.platform)) + '</span>' + (extra || '');
  }

  function imageBlock(item) {
    if (item.image) {
      return '<img src="' + esc(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    }
    var ch = (core.platformName(item.platform) || '?').slice(0, 1);
    return '<div class="bl-ph ' + esc(pfClass(item)) + '">' + esc(ch) + '</div>';
  }

  function rowHtml(item, opts) {
    var meta = [];
    if (item.coupon) meta.push('<span class="bl-coupon-tag">券 ¥' + item.coupon + '</span>');
    if (item.salesText || item.sales) meta.push('<span>月销 ' + esc(item.salesText || item.sales) + '</span>');
    if (item.shop) meta.push('<span>' + esc(item.shop) + '</span>');
    if (item.channel) meta.push('<span>' + esc(item.channel) + '</span>');
    if (item.isCurrent) meta.push('<span>当前页面</span>');
    if (opts && opts.showScore && item.matchScore) meta.push('<span>同款 ' + item.matchScore + '</span>');
    if (item.mock) meta.push('<span>模拟</span>');

    return '<div class="bl-row' + (item.isCurrent ? ' cur' : '') + '" data-act="open" data-url="' + esc(item.url) + '">' +
      badge(item) +
      '<div class="bl-row-main">' +
        '<div class="bl-row-title">' + esc(item.title) + '</div>' +
        '<div class="bl-row-meta">' + meta.join('') + '</div>' +
      '</div>' +
      '<div class="bl-row-price">' +
        '<b>' + money(item.finalPrice || item.price) + '</b>' +
        (item.originPrice ? '<s>' + money(item.originPrice) + '</s>' : (item.coupon ? '<s>' + money(item.price) + '</s>' : '')) +
        '<button class="bl-go" data-act="open" data-url="' + esc(item.url) + '">去看看</button>' +
      '</div>' +
    '</div>';
  }

  function sparkline(points, stats) {
    if (!points || !points.length) return '';
    var chart = core.buildChartSvg(points, { width: 340, height: 60, compact: true });
    if (!chart.svg) return '';
    var st = stats || core.buildHistoryStats(points, 0, 0);
    var meta = [];
    if (st.min) meta.push('<span>史低 ' + money(st.min.price) + '</span>');
    if (st.count > 1) meta.push('<span>均价 ' + money(st.avg) + '</span>');
    else meta.push('<span>已采样 ' + st.count + ' 次</span>');
    return '<div class="bl-hist">' + chart.svg +
      '<div class="bl-hist-meta">' + meta.join('') +
      '<button class="bl-hist-more" data-act="tab" data-tab="trend">完整走势 ›</button></div></div>';
  }

  function mount(opts) {
    if (document.getElementById('bl-root')) return null;
    var host = document.createElement('div');
    host.id = 'bl-root';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
    document.documentElement.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + STYLE + '</style>' +
      '<div class="bl-panel" part="panel">' +
        '<div class="bl-head">' +
          '<div class="bl-logo">比</div>' +
          '<div class="bl-titles"><div class="bl-name">比价助手</div><div class="bl-sub">正在识别…</div></div>' +
          '<button class="bl-hbtn" data-act="refresh" title="刷新">↻</button>' +
          '<button class="bl-hbtn" data-act="collapse" title="收起">–</button>' +
          '<button class="bl-hbtn" data-act="close" title="关闭">×</button>' +
        '</div>' +
        '<div class="bl-tabs">' +
          '<button class="bl-tab" data-act="tab" data-tab="compare">比价</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="trend">走势</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="search">搜索</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="coupon">优惠券</button>' +
          '<button class="bl-tab" data-act="tab" data-tab="settings">设置</button>' +
        '</div>' +
        '<div class="bl-body"></div>' +
        '<div class="bl-foot"><span class="bl-dot"></span><span class="bl-status">初始化…</span><a href="#" data-act="dashboard">控制台</a></div>' +
      '</div>' +
      '<div class="bl-fab" data-act="reopen">比价</div>' +
      '<div class="bl-toast"></div>';

    var panel = shadow.querySelector('.bl-panel');
    var body = shadow.querySelector('.bl-body');
    var toastEl = shadow.querySelector('.bl-toast');
    var statusEl = shadow.querySelector('.bl-status');
    var dotEl = shadow.querySelector('.bl-dot');
    var fab = shadow.querySelector('.bl-fab');
    var subEl = shadow.querySelector('.bl-sub');
    var state = opts.initial || {};

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }

    function applyPosition(pos) {
      if (!pos) return;
      if (root.matchMedia && root.matchMedia('(max-width: 640px)').matches) return;
      panel.style.right = Math.max(0, pos.right || 18) + 'px';
      panel.style.top = Math.max(0, pos.top || 96) + 'px';
    }

    function activeInputSnapshot() {
      var el = shadow.activeElement;
      if (!el || el.tagName !== 'INPUT') return null;
      return { id: el.id, start: el.selectionStart, end: el.selectionEnd, value: el.value };
    }

    function restoreInput(snap) {
      if (!snap) return;
      var el = shadow.getElementById(snap.id);
      if (!el) return;
      el.value = snap.value;
      el.focus();
      try { el.setSelectionRange(snap.start, snap.end); } catch (err) { /* number 输入不支持 */ }
    }

    function swapBody(html) {
      var snap = activeInputSnapshot();
      body.innerHTML = html;
      restoreInput(snap);
    }

    function renderItemCard(item) {
      if (!item) {
        return '<div class="bl-empty">未识别到商品信息<br><button class="bl-btn" data-act="refresh">重新识别</button></div>';
      }
      return '<div class="bl-item">' + imageBlock(item) +
        '<div class="bl-item-main">' +
          '<div class="bl-item-title">' + esc(item.title) + '</div>' +
          '<div class="bl-item-meta">' + esc(item.platformName) + (item.channel ? ' · ' + esc(item.channel) : '') +
            (item.itemId ? ' · ID ' + esc(item.itemId) : '') + '</div>' +
          '<div class="bl-item-price">' + (item.price ? money(item.price) : '价格未识别') +
            (item.originPrice ? '<small>' + money(item.originPrice) + '</small>' : '') + '</div>' +
        '</div>' +
      '</div>';
    }

    var chartGeom = null;

    var SEARCH_PLATFORMS = ['taobao', 'tmall', 'jd', 'pdd', 'vip'];

    // 后端没启动或没查到同款时，至少把用户送到其它平台的同款搜索结果
    function sameItemSearch(keyword, current) {
      var kw = String(keyword || '').trim();
      if (!kw) return '';
      var btns = SEARCH_PLATFORMS.filter(function (p) { return p !== current; }).map(function (p) {
        var url = core.buildSearchUrl(p, kw);
        return url ? '<button class="bl-chip" data-act="open" data-url="' + esc(url) + '">' +
          esc(core.platformName(p)) + '</button>' : '';
      }).join('');
      if (!btns) return '';
      return '<div class="bl-sec">去其它平台搜同款</div><div class="bl-chips">' + btns + '</div>';
    }

    function sourceText(h) {
      var map = { local: '本地采样', mixed: '历史源 + 本地采样', mock: '演示数据', none: '无' };
      if (h.source === 'manmanbuy') return '慢慢买历史价';
      return map[h.source] || h.source || '本地采样';
    }

    function trendChips() {
      var cur = state.historyDays || 180;
      return '<div class="bl-range">' + [30, 90, 180, 365].map(function (d) {
        return '<button class="bl-chip' + (d === cur ? ' on' : '') + '" data-act="range" data-days="' + d + '">' +
          (d === 365 ? '1 年' : d + ' 天') + '</button>';
      }).join('') + '</div>';
    }

    function renderTrend() {
      var s = state;
      var html = '';
      if (s.item) {
        html += '<div class="bl-item" style="padding:8px">' + imageBlock(s.item) +
          '<div class="bl-item-main">' +
            '<div class="bl-item-title" style="font-size:12px;-webkit-line-clamp:1">' + esc(s.item.title) + '</div>' +
            '<div class="bl-item-meta">' + esc(s.item.platformName) +
              (s.item.channel ? ' · ' + esc(s.item.channel) : '') +
              (s.item.itemId ? ' · ID ' + esc(s.item.itemId) : '') + '</div>' +
          '</div></div>';
      }
      html += trendChips();

      if (s.historyStatus === 'loading') {
        return html + '<div class="bl-chart"><div class="bl-chart-empty">正在拉取历史价…</div></div>' +
          '<div class="bl-skeleton"><div class="bl-sk w90"></div><div class="bl-sk w70"></div></div>';
      }
      if (s.historyStatus === 'error') {
        return html + '<div class="bl-err">' + esc(s.historyError || '历史价获取失败') +
          '<div class="bl-row-btns"><button class="bl-btn pri" data-act="history-refresh">重试</button></div></div>';
      }

      var h = s.history;
      if (!h || !h.stats || !h.stats.count) {
        return html + '<div class="bl-chart"><div class="bl-chart-empty">还没有历史价' +
          '<span style="font-size:11px;padding:0 16px;text-align:center;line-height:1.7">打开商品页会自动采样；' +
          '配好历史源后立刻有完整曲线</span></div></div>' +
          '<div class="bl-row-btns"><button class="bl-btn" data-act="history-refresh">重新获取</button></div>';
      }

      var stats = h.stats;
      var advice = h.advice || core.historyAdvice(stats);
      var dark = !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
      var chart = core.buildChartSvg(h.points, {
        width: 340,
        height: 158,
        current: stats.current,
        days: h.days,
        colors: dark ? {
          grid: '#2b313a', axis: '#8b93a1', line: '#ff6b81',
          low: '#4ade80', lowText: '#6ce9a6', high: '#8b93a1',
          current: '#f79009', dot: '#171a20', bg: '#171a20'
        } : null
      });
      chartGeom = chart.geom;

      html += '<div class="bl-hero"><div class="bl-hero-v">' + money(stats.current) + '</div>' +
        '<div class="bl-hero-u">当前价 · ' + (h.days || 0) + ' 天区间</div></div>';

      var arrow = advice.code === 'high' ? '▲' : (advice.code === 'best' || advice.code === 'good' ? '▼' : '•');
      html += '<div class="bl-advice ' + esc(advice.code) + '"><span>' + arrow + '</span>' +
        '<div><b>' + esc(advice.label) + '</b><br>' + esc(advice.hint) + '</div></div>';

      html += '<div class="bl-chart" id="bl-chart">' +
        (h.mock ? '<span class="bl-mock-tag">演示曲线</span>' : '') +
        chart.svg + '<div class="bl-tip"></div></div>';

      var posClass = stats.position <= 25 ? 'green' : (stats.position >= 75 ? 'red' : '');
      html += '<div class="bl-grid2">' +
        '<div class="bl-cell"><div class="k">历史最低</div><div class="v green">' + money(stats.min.price) +
          '<small>' + esc(stats.min.date || '') + '</small></div></div>' +
        '<div class="bl-cell"><div class="k">历史最高</div><div class="v">' + money(stats.max.price) +
          '<small>' + esc(stats.max.date || '') + '</small></div></div>' +
        '<div class="bl-cell"><div class="k">区间均价</div><div class="v">' + money(stats.avg) + '</div></div>' +
        '<div class="bl-cell"><div class="k">历史分位</div><div class="v ' + posClass + '">' +
          stats.position + '%<small>时间比现在便宜</small></div></div>' +
      '</div>';

      html += '<div class="bl-src">来源：' + esc(sourceText(h)) + ' · 采样 ' + stats.count + ' 天' +
        (stats.trend ? ' · 近 7 天 <span class="' + (stats.trend > 0 ? 'up' : 'down') + '">' +
          (stats.trend > 0 ? '↑' : '↓') + Math.abs(stats.trend).toFixed(1) + '%</span>' : '') +
        (h.note ? '<br>' + esc(h.note) : '') +
      '</div>';

      return html;
    }

    /** 走势图 hover：竖线 + 圆点 + 价格气泡，坐标映射复用 core 返回的 geom */
    function bindChart() {
      var wrap = shadow.getElementById('bl-chart');
      if (!wrap || !chartGeom || !chartGeom.points.length) return;
      var svg = wrap.querySelector('svg');
      var line = wrap.querySelector('.bl-hover-line');
      var dot = wrap.querySelector('.bl-hover-dot');
      var tip = wrap.querySelector('.bl-tip');
      if (!svg || !line || !dot || !tip) return;
      var pts = chartGeom.points;

      function nearest(clientX) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return null;
        var vx = ((clientX - rect.left) / rect.width) * chartGeom.width;
        var best = pts[0];
        var bestD = Infinity;
        for (var i = 0; i < pts.length; i++) {
          var d = Math.abs(pts[i].x - vx);
          if (d < bestD) { bestD = d; best = pts[i]; }
        }
        return { p: best, rect: rect };
      }

      function move(e) {
        var point = e.touches && e.touches[0] ? e.touches[0] : e;
        var hit = nearest(point.clientX);
        if (!hit) return;
        var p = hit.p;
        line.setAttribute('x1', p.x);
        line.setAttribute('x2', p.x);
        line.setAttribute('opacity', '1');
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        dot.setAttribute('opacity', '1');
        tip.textContent = core.formatDate(p.t) + ' · ' + core.formatPrice(p.p);
        var rect = hit.rect;
        var px = (p.x / chartGeom.width) * rect.width;
        var py = (p.y / chartGeom.height) * rect.height;
        tip.style.left = Math.max(46, Math.min(rect.width - 46, px)) + 'px';
        tip.style.top = Math.max(22, py - 6) + 'px';
        tip.classList.add('show');
      }

      function leave() {
        line.setAttribute('opacity', '0');
        dot.setAttribute('opacity', '0');
        tip.classList.remove('show');
      }

      wrap.addEventListener('mousemove', move);
      wrap.addEventListener('mouseleave', leave);
      // 移动端按住拖动看价格，不阻断纵向滚动
      wrap.addEventListener('touchstart', move, { passive: true });
      wrap.addEventListener('touchmove', move, { passive: true });
      wrap.addEventListener('touchend', leave);
    }

    function renderCompare() {
      var s = state;
      if (s.status === 'loading') {
        return '<div class="bl-skeleton">' +
          '<div class="bl-sk w40"></div><div class="bl-sk w90"></div><div class="bl-sk w70"></div>' +
          '<div style="height:8px"></div><div class="bl-sk w90"></div><div class="bl-sk w90"></div><div class="bl-sk w40"></div>' +
        '</div><div class="bl-empty" style="padding:8px">正在跨平台查价…</div>';
      }
      if (s.status === 'error') {
        return '<div class="bl-err">' + esc(s.error || '比价失败') +
          '<div style="margin-top:8px;color:#8b93a1;font-size:11px">后端没起来？在项目目录执行 <code>node server/index.js</code></div>' +
          '<div class="bl-row-btns"><button class="bl-btn pri" data-act="refresh">重试</button>' +
          '<button class="bl-btn" data-act="tab" data-tab="settings">检查设置</button></div></div>' +
          sameItemSearch(s.item && s.item.title, s.site && s.site.platform);
      }
      var html = renderItemCard(s.item);
      html += sameItemSearch(s.item && s.item.title, s.site && s.site.platform);
      if (!s.result) {
        return html + '<div class="bl-empty">' + (s.item ? '点右上角 ↻ 开始比价' : '') + '</div>';
      }
      var r = s.result;
      if (r.best) {
        html += '<div class="bl-best"><div><div class="bl-best-k">全网最低到手</div>' +
          '<div class="bl-best-v">' + money(r.best.finalPrice) + '</div></div>' +
          '<div class="bl-best-p">' + esc(r.best.platformName) + (r.best.mock ? ' · 模拟' : '') + '</div></div>';
      }
      if (r.savings) {
        html += '<div class="bl-save">换到' + esc(core.platformName(r.savings.to)) + '省 ' + money(r.savings.amount) +
          '（' + r.savings.percent + '%）</div>';
      }
      if (r.items && r.items.length) {
        html += '<div class="bl-sec">同款价格 · ' + r.items.length + ' 条</div><div class="bl-list">';
        var shown = r.items.slice(0, 12);
        // 当前页商品哪怕比前 12 名贵也要露出来，否则用户看不到自己的比价基准
        var current = null;
        for (var ci = 0; ci < r.items.length; ci++) {
          if (r.items[ci].isCurrent) { current = r.items[ci]; break; }
        }
        if (current && shown.indexOf(current) < 0) shown.push(current);
        shown.forEach(function (it) {
          html += rowHtml(it, { showScore: true });
        });
        html += '</div>';
        if (r.note) html += '<div class="bl-sec" style="line-height:1.6">' + esc(r.note) + '</div>';
        html += sparkline(r.history || [], r.historyStats);
      } else {
        html += '<div class="bl-empty">没有查到同款<br><span style="font-size:11px">' + esc(r.note || '') + '</span></div>';
      }
      return html;
    }

    function renderSearch() {
      var s = state;
      var sortChips = [['renqi', '人气'], ['xiaoliang', '销量'], ['jiage', '价格']].map(function (x) {
        return '<button class="bl-chip' + (s.sort === x[0] ? ' on' : '') + '" data-act="sort" data-sort="' + x[0] + '">' + x[1] + '</button>';
      }).join('');
      var pfChips = [['all', '全部'], ['taobao', '淘宝'], ['tmall', '天猫'], ['jd', '京东'], ['pdd', '拼多多'], ['vip', '唯品会']]
        .map(function (x) {
          return '<button class="bl-chip' + ((s.platform || 'all') === x[0] ? ' on' : '') + '" data-act="platform" data-platform="' + x[0] + '">' + x[1] + '</button>';
        }).join('');

      var html = '<div class="bl-searchbar">' +
        '<input id="bl-kw" class="bl-input" type="search" placeholder="输入商品标题搜索" value="' + esc(s.keyword || '') + '">' +
        '<button class="bl-btn pri" data-act="search">搜索</button></div>' +
        '<div class="bl-chips">' + sortChips + '</div>' +
        '<div class="bl-chips">' + pfChips + '</div>';

      if (s.searchStatus === 'loading') {
        html += '<div class="bl-skeleton"><div class="bl-sk w40"></div><div class="bl-sk w90"></div><div class="bl-sk w70"></div></div>';
        return html;
      }
      if (s.searchStatus === 'error') {
        html += '<div class="bl-err">' + esc(s.searchError || '搜索失败') + '</div>' +
          sameItemSearch(s.keyword, '');
        return html;
      }
      var res = s.searchResult;
      if (!res) {
        html += '<div class="bl-empty">按人气 / 销量 / 价格排序，跨五个平台一起搜</div>';
        return html;
      }
      html += '<div class="bl-count">共 ' + res.total + ' 条 · ' + esc((res.summary && res.summary.lowest ? res.summary.lowest.platformName + ' 最低 ' + money(res.summary.lowest.min) : '')) + '</div>';
      if (!res.list || !res.list.length) {
        html += '<div class="bl-empty">没有结果</div>';
        return html;
      }
      html += '<div class="bl-list">';
      res.list.forEach(function (it) { html += rowHtml(it, {}); });
      html += '</div>';
      return html;
    }

    function renderCoupon() {
      var s = state;
      if (s.status === 'loading') return '<div class="bl-skeleton"><div class="bl-sk w40"></div><div class="bl-sk w90"></div></div>';
      var list = (s.result && s.result.coupons) || [];
      if (!list.length) {
        return '<div class="bl-empty">当前商品没查到隐藏券<br><span style="font-size:11px">换个平台或稍后再试</span></div>';
      }
      var html = '<div class="bl-sec">可用券 ' + list.length + ' 张 · 按面额排序</div>';
      list.forEach(function (c) {
        html += '<div class="bl-cpn">' +
          '<div class="bl-cpn-amt">¥' + c.amount + '<span> 券</span></div>' +
          '<div class="bl-cpn-main"><div class="bl-cpn-desc">' + esc(c.platformName) + ' · ' + esc(c.desc) + '</div>' +
            '<div class="bl-cpn-sub">券后 ' + money(c.finalPrice) + ' · 约省 ' + c.rate + '%' +
            (c.end ? ' · ' + esc(c.end) + ' 到期' : '') + '</div></div>' +
          '<div class="bl-cpn-btns">' +
            '<button class="bl-btn" data-act="copy" data-text="' + esc(c.url) + '">复制</button>' +
            '<button class="bl-btn pri" data-act="open" data-url="' + esc(c.url) + '">领券</button>' +
          '</div></div>';
      });
      return html;
    }

    function renderSettings() {
      var s = state;
      var h = s.health;
      var healthRows = '';
      if (h) {
        healthRows = '<div class="bl-kv"><span>服务版本</span><b>' + esc(h.version) + '</b></div>' +
          '<div class="bl-kv"><span>运行模式</span><b>' + esc(h.mode) + '</b></div>' +
          '<div class="bl-kv"><span>已采集</span><b>' + (h.stats ? h.stats.collected : 0) + ' 条</b></div>' +
          '<div class="bl-kv"><span>数据源</span><b>' + esc((h.providers && h.providers.active || []).join(' / ') || 'none') + '</b></div>';
      }
      return '<div class="bl-setting">' +
        '<div class="bl-field"><label>后端地址（仅限本机）</label>' +
          '<input id="bl-api" class="bl-input" type="text" value="' + esc(s.apiBase || '') + '" placeholder="http://127.0.0.1:8787">' +
        '</div>' +
        '<label class="bl-check"><input id="bl-auto" type="checkbox"' + (s.auto ? ' checked' : '') + '> 打开商详页自动比价</label>' +
        '<div class="bl-row-btns"><button class="bl-btn pri" data-act="save">保存并测试</button>' +
          '<button class="bl-btn" data-act="refresh">重新识别</button></div>' +
        (healthRows ? '<div class="bl-sec">服务状态</div>' + healthRows : '<div class="bl-sec">服务状态 · 未连接</div>') +
        '<div class="bl-sec" style="line-height:1.7">只允许 127.0.0.1 / localhost。面板数据来自本机聚合服务，采集到的商品标题、价格和链接只写入本机，不会上传到其它服务器。未配置联盟密钥时展示模拟价并标注「模拟」。</div>' +
      '</div>';
    }

    function render() {
      var s = state;
      panel.classList.toggle('hide', !!s.closed);
      panel.classList.toggle('min', !!s.collapsed);
      fab.classList.toggle('show', !!s.closed);
      subEl.textContent = s.site
        ? (s.site.channel && s.site.channel !== s.site.platformName
          ? s.site.platformName + ' · ' + s.site.channel
          : s.site.platformName)
        : '正在识别…';
      Array.prototype.forEach.call(shadow.querySelectorAll('.bl-tab'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === s.tab);
      });
      if (s.collapsed) return;
      chartGeom = null;
      if (s.tab === 'trend') {
        swapBody(renderTrend());
        bindChart();
      } else if (s.tab === 'search') swapBody(renderSearch());
      else if (s.tab === 'coupon') swapBody(renderCoupon());
      else if (s.tab === 'settings') swapBody(renderSettings());
      else swapBody(renderCompare());

      var online = s.health && s.health.ok;
      dotEl.className = 'bl-dot ' + (online ? (s.result && s.result.mock ? 'mock' : 'ok') : 'err');
      var st = s.statusText || '';
      if (!st) {
        if (!online) st = '未连接后端';
        else if (s.tab === 'trend' && s.history && s.history.stats && s.history.stats.count) {
          st = s.history.stats.count + ' 天采样 · ' + (s.history.mock ? '含演示' : sourceText(s.history));
        } else if (s.result) st = '匹配 ' + (s.result.items ? s.result.items.length : 0) + ' 条 · ' + (s.result.stats ? s.result.stats.elapsedMs : 0) + 'ms';
        else st = '就绪';
      }
      statusEl.textContent = st;
    }

    function openUrl(url) {
      if (!url) return;
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: false, insert: true });
        return;
      }
      root.open(url, '_blank', 'noopener');
    }

    function copyText(text) {
      if (!text) return;
      var done = function () { toast('已复制'); };
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        done();
        return;
      }
      if (root.navigator && root.navigator.clipboard) {
        root.navigator.clipboard.writeText(text).then(done).catch(function () { toast('复制失败'); });
      } else {
        toast('复制失败');
      }
    }

    shadow.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!target) return;
      var act = target.getAttribute('data-act');
      if (act === 'open') {
        e.preventDefault();
        e.stopPropagation();
        openUrl(target.getAttribute('data-url'));
        return;
      }
      if (act === 'copy') {
        e.preventDefault();
        copyText(target.getAttribute('data-text'));
        return;
      }
      if (act === 'tab') {
        e.preventDefault();
        var tab = target.getAttribute('data-tab');
        if (state.collapsed) opts.onCollapse(false);
        opts.onTab(tab);
        return;
      }
      if (act === 'sort') {
        e.preventDefault();
        opts.onSort(target.getAttribute('data-sort'));
        return;
      }
      if (act === 'range') {
        e.preventDefault();
        opts.onRange(Number(target.getAttribute('data-days')) || 180);
        return;
      }
      if (act === 'history-refresh') {
        e.preventDefault();
        opts.onHistoryRefresh();
        return;
      }
      if (act === 'platform') {
        e.preventDefault();
        opts.onPlatform(target.getAttribute('data-platform'));
        return;
      }
      if (act === 'search') {
        e.preventDefault();
        var kw = shadow.getElementById('bl-kw');
        opts.onSearch((kw && kw.value || '').trim());
        return;
      }
      if (act === 'refresh') {
        e.preventDefault();
        opts.onRefresh();
        return;
      }
      if (act === 'collapse') {
        e.preventDefault();
        opts.onCollapse(!state.collapsed);
        return;
      }
      if (act === 'close') {
        e.preventDefault();
        opts.onClose();
        return;
      }
      if (act === 'reopen') {
        e.preventDefault();
        opts.onClose(false);
        return;
      }
      if (act === 'save') {
        e.preventDefault();
        var apiEl = shadow.getElementById('bl-api');
        var autoEl = shadow.getElementById('bl-auto');
        opts.onSave({
          apiBase: (apiEl && apiEl.value || '').trim(),
          auto: Boolean(autoEl && autoEl.checked)
        });
        return;
      }
      if (act === 'dashboard') {
        e.preventDefault();
        openUrl((state.apiBase || '').replace(/\/+$/, '') + '/');
      }
    });

    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'bl-kw') {
        e.preventDefault();
        opts.onSearch(String(e.target.value || '').trim());
      }
    });

    // 拖动：只认标题栏，按钮上不触发
    var drag = null;
    panel.addEventListener('pointerdown', function (e) {
      var head = e.target.closest && e.target.closest('.bl-head');
      if (!head || (e.target.closest && e.target.closest('button'))) return;
      if (root.matchMedia && root.matchMedia('(max-width: 640px)').matches) return;
      var rect = panel.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        right: root.innerWidth - rect.right,
        top: rect.top
      };
      panel.style.transition = 'none';
      if (panel.setPointerCapture) {
        try { panel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    });
    panel.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var right = Math.max(4, Math.min(root.innerWidth - 120, drag.right - (e.clientX - drag.startX)));
      var top = Math.max(4, Math.min(root.innerHeight - 80, drag.top + (e.clientY - drag.startY)));
      panel.style.right = right + 'px';
      panel.style.top = top + 'px';
      panel.dataset.right = String(right);
      panel.dataset.top = String(top);
    });
    panel.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      panel.style.transition = '';
      var right = Number(panel.dataset.right || 18);
      var top = Number(panel.dataset.top || 96);
      opts.onMove({ right: right, top: top });
    });

    return {
      render: function (next) {
        state = next;
        applyPosition(next.panelPos);
        render();
      },
      toast: toast,
      destroy: function () { host.remove(); }
    };
  }

  return { mount: mount };
});

/* ==================== main.js ==================== */
/**
 * 入口：挂载面板、监听 SPA 路由、自动提取 + 比价 + 上报。
 */
(function (root) {
  'use strict';

  var BL = root.BL;
  if (!BL || !BL.core) return;
  var core = BL.core;
  var platformApi = BL.platform;
  var extractApi = BL.extract;
  var store = BL.store;
  var api = BL.api;
  var uiFactory = BL.ui;

  var state = {
    site: null,
    item: null,
    status: 'idle',
    statusText: '',
    error: '',
    result: null,
    tab: 'compare',
    keyword: '',
    sort: 'renqi',
    platform: 'all',
    searchStatus: 'idle',
    searchResult: null,
    searchError: '',
    history: null,
    historyStatus: 'idle',
    historyError: '',
    historyDays: 180,
    apiBase: '',
    auto: true,
    health: null,
    collapsed: false,
    closed: false,
    panelPos: { right: 18, top: 96 }
  };

  var ui = null;
  var reqSeq = 0;
  var searchSeq = 0;
  var historySeq = 0;
  var lastUrl = '';
  var collectCache = {};
  var extractTimer = null;
  var stopExtract = null;

  function render() {
    if (ui) ui.render(state);
  }

  function siteOf(item) {
    var platform = (item && item.platform) || core.detectPlatform(location.host);
    var channel = (item && item.channel) || core.detectChannel(location.host, location.pathname);
    return {
      platform: platform,
      platformName: core.platformName(platform),
      channel: channel
    };
  }

  // 页面全局变量（__INITIAL_STATE__ 之类）要读未沙箱的 window，否则被隔离拿不到
  var pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : root;

  function safeExtract() {
    try {
      return extractApi.extract(document, pageWindow, location.href);
    } catch (err) {
      return { ok: false, reason: err && err.message };
    }
  }

  function updateItem(item) {
    state.item = item;
    state.site = siteOf(item);
    if (state.tab === 'search' && !state.keyword) state.keyword = item.title;
    render();
  }

  function collect(item) {
    if (!item || !item.price || !item.title) return;
    var key = item.platform + '|' + (item.itemId || item.title);
    if (collectCache[key] && Date.now() - collectCache[key] < 600000) return;
    collectCache[key] = Date.now();
    api.collect({
      platform: item.platform,
      itemId: item.itemId,
      title: item.title,
      price: item.price,
      originPrice: item.originPrice,
      image: item.image,
      shop: item.shop,
      channel: item.channel,
      url: item.url,
      host: location.host,
      path: location.pathname
    }).catch(function () { /* 采集失败不影响比价 */ });
  }

  function compare() {
    if (!state.item) {
      state.status = 'error';
      state.error = '还没识别到商品，稍等页面加载完再点刷新';
      render();
      return;
    }
    var seq = ++reqSeq;
    state.status = 'loading';
    state.error = '';
    state.statusText = '';
    render();

    api.compare({
      platform: state.item.platform,
      title: state.item.title,
      price: state.item.price,
      itemId: state.item.itemId,
      image: state.item.image,
      shop: state.item.shop,
      channel: state.item.channel,
      url: state.item.url,
      host: location.host,
      path: location.pathname
    }).then(function (res) {
      if (seq !== reqSeq) return;
      state.result = res;
      state.status = 'ready';
      state.statusText = '';
      render();
    }).catch(function (err) {
      if (seq !== reqSeq) return;
      state.status = 'error';
      state.error = (err && err.message) || '比价请求失败';
      render();
    });
  }

  function search(keyword) {
    var kw = String(keyword || '').trim();
    if (!kw) {
      state.searchStatus = 'error';
      state.searchError = '先输入商品标题';
      render();
      return;
    }
    state.keyword = kw;
    state.tab = 'search';
    store.set('lastQuery', kw);
    var seq = ++searchSeq;
    state.searchStatus = 'loading';
    state.searchError = '';
    render();

    api.search({
      keyword: kw,
      sort: state.sort,
      platform: state.platform,
      limit: 20
    }).then(function (res) {
      if (seq !== searchSeq) return;
      state.searchResult = res;
      state.searchStatus = 'ready';
      render();
    }).catch(function (err) {
      if (seq !== searchSeq) return;
      state.searchStatus = 'error';
      state.searchError = (err && err.message) || '搜索失败';
      render();
    });
  }

  /**
   * 拉历史价。同一个区间已经拿过就直接用缓存，切区间或手动刷新才重新请求。
   * 请求带上 url，后端能从链接里提到商品 id，比只传标题准。
   */
  function loadHistory(days, force) {
    if (!state.item) return;
    var d = Number(days) || state.historyDays || 180;
    state.historyDays = d;
    if (!force && state.history && state.history.days === d && state.historyStatus === 'ready') {
      render();
      return;
    }
    var seq = ++historySeq;
    state.historyStatus = 'loading';
    state.historyError = '';
    render();

    api.history({
      url: state.item.url,
      platform: state.item.platform,
      itemId: state.item.itemId,
      title: state.item.title,
      price: state.item.price,
      days: d
    }).then(function (res) {
      if (seq !== historySeq) return;
      state.history = res;
      state.historyStatus = 'ready';
      render();
    }).catch(function (err) {
      if (seq !== historySeq) return;
      state.historyStatus = 'error';
      state.historyError = (err && err.message) || '历史价获取失败';
      render();
    });
  }

  function checkHealth() {
    api.health().then(function (h) {
      state.health = h;
      if (h && h.ok === false) state.health = null;
      render();
    }).catch(function () {
      state.health = null;
      render();
    });
  }

  function syncSettingsFromStore() {
    state.apiBase = store.get('apiBase');
    state.auto = store.get('auto');
    state.sort = store.get('sort') || 'renqi';
    state.tab = store.get('tab') || 'compare';
    state.collapsed = Boolean(store.get('collapsed'));
    state.closed = Boolean(store.get('closed'));
    state.panelPos = store.get('panelPos') || { right: 18, top: 96 };
    api.setBase(state.apiBase);
    // 旧配置可能存了远端地址，这里回落到本机默认值并同步显示
    state.apiBase = api.getBase();
  }

  function mount(item) {
    if (ui) return;
    syncSettingsFromStore();
    state.site = siteOf(item);
    if (item) state.item = item;
    ui = uiFactory.mount({
      initial: state,
      onRefresh: function () {
        var fresh = safeExtract();
        if (fresh && fresh.ok) updateItem(fresh);
        state.history = null;
        compare();
        if (state.tab === 'trend') loadHistory(state.historyDays, true);
      },
      onTab: function (tab) {
        state.tab = tab;
        store.set('tab', tab);
        if (tab === 'search' && !state.keyword && state.item) state.keyword = state.item.title;
        // 走势是要额外请求的，等用户真点进来再拉，别拖慢首屏
        if (tab === 'trend' && state.item) {
          loadHistory();
          return;
        }
        render();
      },
      onRange: function (days) {
        loadHistory(days);
      },
      onHistoryRefresh: function () {
        loadHistory(state.historyDays, true);
      },
      onSearch: search,
      onSort: function (sort) {
        state.sort = sort;
        store.set('sort', sort);
        if (state.searchResult || state.keyword) search(state.keyword);
        else render();
      },
      onPlatform: function (platform) {
        state.platform = platform;
        if (state.searchResult || state.keyword) search(state.keyword);
        else render();
      },
      onCollapse: function (collapsed) {
        state.collapsed = collapsed;
        store.set('collapsed', collapsed);
        render();
      },
      onClose: function (forceOpen) {
        var closed = forceOpen === false ? false : !state.closed;
        state.closed = closed;
        store.set('closed', closed);
        render();
      },
      onSave: function (cfg) {
        var base = String(cfg.apiBase || '').replace(/\/+$/, '');
        if (!/^https?:\/\/[^\s]+$/.test(base)) {
          ui.toast('地址格式不对，要 http:// 开头');
          return;
        }
        if (!api.isLoopback(base)) {
          ui.toast('只允许本机地址（127.0.0.1 或 localhost）');
          return;
        }
        state.apiBase = base;
        state.auto = Boolean(cfg.auto);
        store.set('apiBase', base);
        store.set('auto', state.auto);
        api.setBase(base);
        checkHealth();
        ui.toast('已保存，正在连接…');
        setTimeout(function () {
          if (state.health && state.health.ok) ui.toast('后端连接正常');
          else ui.toast('连不上，检查地址和端口');
        }, 900);
      },
      onMove: function (pos) {
        state.panelPos = pos;
        store.set('panelPos', pos);
      }
    });

    checkHealth();
    if (state.auto && state.item && state.item.price) compare();
    else render();
    if (state.tab === 'trend' && state.item) loadHistory();
  }

  /** 轮询 + DOM 变动双触发，页面异步渲染也能抓到价格 */
  function scheduleExtract(onDone) {
    if (stopExtract) stopExtract();
    if (extractTimer) {
      clearTimeout(extractTimer);
      extractTimer = null;
    }
    var attempts = 0;
    var stopped = false;
    var observer = null;
    var observerTimer = null;

    function stop() {
      if (stopped) return;
      stopped = true;
      if (extractTimer) {
        clearTimeout(extractTimer);
        extractTimer = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (observerTimer) {
        clearTimeout(observerTimer);
        observerTimer = null;
      }
      if (stopExtract === stop) stopExtract = null;
    }
    stopExtract = stop;

    function finish(item) {
      if (stopped) return;
      stop();
      onDone(item);
    }

    function tick() {
      if (stopped) return;
      var item = safeExtract();
      attempts++;
      if (item && item.ok && item.price) {
        finish(item);
        return;
      }
      if (item && item.ok && attempts >= 4) {
        // 有标题没价格：先把面板挂出来，价格留给刷新
        finish(item);
        return;
      }
      if (attempts >= 18) {
        finish(item && item.ok ? item : null);
        return;
      }
      extractTimer = setTimeout(tick, attempts < 6 ? 400 : 900);
    }

    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(function () {
        if (stopped) return;
        var item = safeExtract();
        if (item && item.ok && item.price) {
          finish(item);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      observerTimer = setTimeout(function () {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        observerTimer = null;
      }, 20000);
    }

    tick();
  }

  function handlePage() {
    var url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    // SPA 快速切换时取消旧页面的轮询和 MutationObserver，避免旧商品回调覆盖新页面。
    if (stopExtract) stopExtract();

    var platform = core.detectPlatform(location.host);
    if (!platform) return;
    if (platformApi.isExcluded(location.host, location.pathname)) {
      if (ui) ui.destroy();
      ui = null;
      return;
    }

    var detail = platformApi.isDetailPage(url, platform);
    var list = platformApi.isListPage(url, platform);
    if (list && !detail) {
      if (ui) ui.destroy();
      ui = null;
      return;
    }

    // 切换商品：清掉上一个商品的结果，保留面板与设置
    state.status = 'idle';
    state.result = null;
    state.error = '';
    state.statusText = '';
    state.searchResult = null;
    state.searchStatus = 'idle';
    state.history = null;
    state.historyStatus = 'idle';
    state.historyError = '';
    state.item = null;
    state.site = siteOf(null);

    scheduleExtract(function (item) {
      if (!item) {
        if (!detail) {
          if (ui) ui.destroy();
          ui = null;
          return;
        }
        if (!ui) mount(null);
        state.status = 'error';
        state.error = '页面结构识别失败，可手动在搜索页输入标题';
        render();
        return;
      }
      updateItem(item);
      collect(item);
      if (!ui) mount(item);
      else {
        render();
        if (state.auto) compare();
      }
      state.keyword = item.title;
      if (!state.auto) state.statusText = '已识别，点 ↻ 比价';
      render();
      if (state.tab === 'trend') loadHistory();
    });
  }

  function watchNavigation() {
    var wrap = function (type) {
      var orig = history[type];
      if (typeof orig !== 'function') return;
      history[type] = function () {
        var ret = orig.apply(this, arguments);
        setTimeout(handlePage, 60);
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    root.addEventListener('popstate', function () { setTimeout(handlePage, 60); });
    setInterval(function () {
      if (location.href !== lastUrl) handlePage();
    }, 1200);
  }

  function init() {
    store.init().then(function () {
      syncSettingsFromStore();
      lastUrl = '';
      handlePage();
      watchNavigation();
      if (root.console) {
        console.info('%c比价助手 ' + core.VERSION + '%c 已载入 · 后端 ' + state.apiBase,
          'color:#fff;background:#e11d48;padding:2px 6px;border-radius:4px',
          'color:#888');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  root.BL.app = {
    compare: compare,
    search: search,
    loadHistory: loadHistory,
    state: state,
    get ui() { return ui; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
