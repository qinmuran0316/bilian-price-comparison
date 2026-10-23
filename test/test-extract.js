'use strict';

const assert = require('node:assert');
const extractApi = require('../userscript/src/extract.js');
const platformApi = require('../userscript/src/platform.js');

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    fail++;
    console.error('  \u2717 ' + name + '\n      ' + err.message);
  }
}

/** 最小 DOM 替身：查表返回节点，够 extract 用的那几个方法就行 */
function makeDoc(config) {
  const map = config.selectors || {};
  return {
    title: config.title || '',
    body: { textContent: config.body || '' },
    querySelector(sel) {
      return Object.prototype.hasOwnProperty.call(map, sel) ? map[sel] : null;
    }
  };
}

function el(text, attrs) {
  return {
    textContent: text,
    getAttribute(name) {
      return attrs && attrs[name] !== undefined ? attrs[name] : null;
    }
  };
}

console.log('extract: 四级降级');

t('meta 优先，能同时拿到标题与价格', () => {
  const doc = makeDoc({
    selectors: {
      'meta[property="og:title"]': el('', { content: '罗技 G304 无线鼠标 黑色' }),
      'meta[property="product:price:amount"]': el('', { content: '199.00' }),
      'meta[property="og:image"]': el('', { content: 'https://img.example.com/a.jpg' })
    }
  });
  const r = extractApi.extract(doc, {}, 'https://item.jd.com/100012043978.html');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.platform, 'jd');
  assert.strictEqual(r.price, 199);
  assert.strictEqual(r.from, 'meta');
  assert.ok(r.title.includes('罗技'));
  assert.ok(r.confidence >= 0.85, String(r.confidence));
});

t('DOM 选择器：京东商详页', () => {
  const doc = makeDoc({
    selectors: {
      '.sku-name': el('小米 移动电源 10000mAh 22.5W'),
      '.p-price .price': el('￥ 89.00'),
      '#spec-img': el('', { 'data-origin': '//img14.360buyimg.com/x.jpg' })
    }
  });
  const r = extractApi.extract(doc, {}, 'https://item.jd.com/100012043978.html');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.price, 89);
  assert.strictEqual(r.from, 'dom');
  assert.strictEqual(r.image, 'https://img14.360buyimg.com/x.jpg');
});

t('页面全局 JSON：字段名不标准也能抠出来', () => {
  const win = {
    __INITIAL_STATE__: {
      page: {
        goods: {
          goodsName: '巴黎水 500ml 24瓶 整箱',
          price: '129.90',
          image: 'https://img.example.com/p.jpg',
          shopName: '天猫超市'
        }
      }
    }
  };
  const doc = makeDoc({});
  const r = extractApi.extract(doc, win, 'https://detail.tmall.com/item.htm?id=123456789');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.from, 'json');
  assert.strictEqual(r.price, 129.9);
  assert.ok(r.title.includes('巴黎水'));
  assert.strictEqual(r.shop, '天猫超市');
});

t('标题兜底 + 正文价格', () => {
  const doc = makeDoc({
    title: '某某蓝牙耳机 降噪版 - 淘宝网',
    body: '限时价 ¥ 129.00 起，库存充足'
  });
  const r = extractApi.extract(doc, {}, 'https://item.taobao.com/item.htm?id=654321987');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.price, 129);
  assert.strictEqual(r.from, 'body');
  assert.strictEqual(r.title, '某某蓝牙耳机 降噪版');
  assert.strictEqual(r.channel, '商品详情');
});

t('拼多多：券后价取第一个价格数字', () => {
  const doc = makeDoc({
    selectors: {
      '[class*="goodsName"]': el('厨房收纳盒 大号 三个装'),
      '.goods-price': el('券后 ¥19.90 ¥39.90'),
      '[class*="goodsImg"] img': el('', { src: 'https://img.pddpic.com/a.jpg' })
    }
  });
  const r = extractApi.extract(doc, {}, 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.platform, 'pdd');
  assert.strictEqual(r.price, 19.9);
  assert.strictEqual(r.itemId, '123456789');
});

t('频道识别：天猫国际', () => {
  const doc = makeDoc({
    selectors: {
      '[class*="ItemHeader--mainTitle"]': el('资生堂 红腰子 精华 50ml'),
      '[class*="Price--priceText"]': el('¥ 899')
    }
  });
  const r = extractApi.extract(doc, {}, 'https://detail.tmall.hk/item.htm?id=987654321');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.channel, '天猫国际');
  assert.strictEqual(r.price, 899);
});

t('只有标题没有价格：仍然可用（做标题搜索）', () => {
  const doc = makeDoc({
    selectors: {
      '.goods-name': el('唯品会 自营 女士风衣 中长款')
    }
  });
  const r = extractApi.extract(doc, {}, 'https://detail.vip.com/detail-1234567-987654321.html');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.price, 0);
  assert.strictEqual(r.platform, 'vip');
  assert.strictEqual(r.itemId, '1234567');
});

t('登录页直接排除', () => {
  const doc = makeDoc({ title: '淘宝登录' });
  const r = extractApi.extract(doc, {}, 'https://login.taobao.com/member/login.jhtml');
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('排除'));
});

t('未支持站点返回失败而不是抛错', () => {
  const r = extractApi.extract(makeDoc({ title: '某网站' }), {}, 'https://example.com/p/1.html');
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('不支持'));
});

t('空页面不崩', () => {
  const r = extractApi.extract(makeDoc({}), {}, 'https://item.jd.com/1.html');
  assert.strictEqual(r.ok, false);
});

t('cleanTitle 去掉店铺前缀与站点后缀', () => {
  assert.strictEqual(
    extractApi.cleanTitle('【官方旗舰店】罗技 G304 无线鼠标-天猫Tmall.com'),
    '罗技 G304 无线鼠标'
  );
  assert.strictEqual(
    extractApi.cleanTitle('【戴森】吹风机 HD15【行情 报价 价格 评测】-京东'),
    '【戴森】吹风机 HD15'
  );
});

t('scanGlobals 不因循环引用死循环', () => {
  const a = { goodsName: '测试商品A', price: 10 };
  a.self = a;
  const win = { __INITIAL_STATE__: a };
  const r = extractApi.scanGlobals(win);
  assert.ok(r && r.title === '测试商品A');
});

console.log('extract: 频道页判定');

t('各频道详情页能识别', () => {
  assert.strictEqual(platformApi.isDetailPage('https://detail.tmall.hk/item.htm?id=123456789', 'tmall'), true, '天猫国际');
  assert.strictEqual(platformApi.isDetailPage('https://detail.ju.taobao.com/home.htm?id=123456789', 'taobao'), true, '聚划算');
  assert.strictEqual(platformApi.isDetailPage('https://chaoshi.detail.tmall.com/item.htm?id=123456789', 'tmall'), true, '天猫超市');
  assert.strictEqual(platformApi.isDetailPage('https://item.jd.hk/100012043978.html', 'jd'), true, '京东国际');
  assert.strictEqual(platformApi.isDetailPage('https://item.yiyaojd.com/100012043978.html', 'jd'), true, '京东大药房');
  assert.strictEqual(platformApi.isDetailPage('https://detail.vip.com/detail-1234567-987654321.html', 'vip'), true, '唯品会');
  assert.strictEqual(platformApi.isDetailPage('https://mobile.yangkeduo.com/goods.html?goods_id=123456789', 'pdd'), true, '拼多多');
});

t('首页/列表页不误挂面板', () => {
  assert.strictEqual(platformApi.isDetailPage('https://www.jd.com/', 'jd'), false);
  assert.strictEqual(platformApi.isDetailPage('https://www.taobao.com/', 'taobao'), false);
  assert.strictEqual(platformApi.isListPage('https://s.taobao.com/search?q=鼠标'), true);
  assert.strictEqual(platformApi.isListPage('https://search.jd.com/Search?keyword=鼠标'), true);
  assert.strictEqual(platformApi.isListPage('https://item.jd.com/100012043978.html'), false);
});

t('登录/购物车/订单页被排除', () => {
  assert.strictEqual(platformApi.isExcluded('login.taobao.com', '/member/login.jhtml'), true);
  assert.strictEqual(platformApi.isExcluded('cart.jd.com', '/cart.html'), true);
  assert.strictEqual(platformApi.isExcluded('item.jd.com', '/100012043978.html'), false);
  assert.strictEqual(platformApi.isExcluded('order.jd.com', '/center/list.action'), true);
});

console.log(`\nextract: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
