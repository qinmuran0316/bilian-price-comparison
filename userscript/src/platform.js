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
