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
