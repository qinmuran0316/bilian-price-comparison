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

  var VERSION = '1.1.4';
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
