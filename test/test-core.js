'use strict';

const assert = require('node:assert');
const core = require('../userscript/src/core.js');

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

function near(a, b, tol = 0.02) {
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
}

console.log('core: 价格与文本');

t('parsePrice 普通数字', () => assert.strictEqual(core.parsePrice(199), 199));
t('parsePrice 带符号千分位', () => assert.strictEqual(core.parsePrice('¥1,299.00'), 1299));
t('parsePrice 人民币符号与空格', () => assert.strictEqual(core.parsePrice('￥ 89.90'), 89.9));
t('parsePrice 小数点逗号', () => assert.strictEqual(core.parsePrice('1299,00'), 1299));
t('parsePrice 非法输入返回 0', () => {
  assert.strictEqual(core.parsePrice(''), 0);
  assert.strictEqual(core.parsePrice(null), 0);
  assert.strictEqual(core.parsePrice('abc'), 0);
});
t('parseSales 万', () => assert.strictEqual(core.parseSales('2.3万+'), 23000));
t('parseSales 亿', () => assert.strictEqual(core.parseSales('1.2亿'), 120000000));
t('parseSales 纯数字', () => assert.strictEqual(core.parseSales(5600), 5600));

t('normalizeTitle 抹掉促销词', () => {
  const n = core.normalizeTitle('【官方旗舰店】罗技 G304 无线鼠标 包邮 限时秒杀');
  assert.ok(!n.includes('旗舰'), n);
  assert.ok(!n.includes('包邮'), n);
  assert.ok(n.includes('罗技'), n);
  assert.ok(n.includes('g304'), n);
});
t('normalizeTitle 全角转半角', () => {
  assert.ok(core.normalizeTitle('Ｇ３０４　鼠标').includes('g304'));
});
t('cleanTitle 不在 core 里，但 similarity 对同款应接近 1', () => {
  const a = '罗技 G304 无线游戏鼠标 黑色';
  assert.ok(core.similarity(a, a) === 1);
});
t('similarity 不同商品应明显偏低', () => {
  const s = core.similarity('罗技 G304 无线鼠标', '小米空气净化器 滤芯');
  assert.ok(s < 0.2, String(s));
});
t('similarity 同款不同装饰词应较高', () => {
  const s = core.similarity(
    '罗技 G304 无线鼠标 黑色',
    '罗技g304无线鼠标 黑色 官方旗舰店 包邮'
  );
  assert.ok(s > 0.7, String(s));
});

console.log('core: 同款打分');

t('scoreMatch 同款高分', () => {
  const s = core.scoreMatch('罗技 G304 无线鼠标', '罗技 G304 无线鼠标 官方标配');
  assert.ok(s >= 70, String(s));
});
t('scoreMatch 容量冲突扣分', () => {
  const same = core.scoreMatch('巴黎水 500ml 24瓶', '巴黎水 500ml 24瓶');
  const diff = core.scoreMatch('巴黎水 500ml 24瓶', '巴黎水 1.5L 12瓶');
  assert.ok(same > diff, `${same} vs ${diff}`);
});
t('scoreMatch 无关商品低分', () => {
  assert.ok(core.scoreMatch('罗技 G304 无线鼠标', '戴森吹风机 HD15') < 35);
});
t('extractSpec 单位归一', () => {
  const s = core.extractSpec('牛奶 1L');
  assert.ok(s.has('1000ml'), Array.from(s).join(','));
});

console.log('core: 到手价与排序');

t('computeFinalPrice 有券', () => {
  assert.strictEqual(core.computeFinalPrice(199, 20, 199), 179);
});
t('computeFinalPrice 未达门槛', () => {
  assert.strictEqual(core.computeFinalPrice(99, 20, 199), 99);
});
t('computeFinalPrice 无券', () => {
  assert.strictEqual(core.computeFinalPrice(199, 0), 199);
});
t('sortItems 价格升序', () => {
  const list = [
    { finalPrice: 300, sales: 10 },
    { finalPrice: 100, sales: 5 },
    { finalPrice: 200, sales: 50 }
  ];
  const out = core.sortItems(list, 'jiage').map((x) => x.finalPrice);
  assert.deepStrictEqual(out, [100, 200, 300]);
});
t('sortItems 销量降序', () => {
  const list = [
    { finalPrice: 300, sales: 10 },
    { finalPrice: 100, sales: 5 },
    { finalPrice: 200, sales: 50 }
  ];
  const out = core.sortItems(list, 'xiaoliang').map((x) => x.sales);
  assert.deepStrictEqual(out, [50, 10, 5]);
});
t('sortItems 人气介于两者之间', () => {
  const list = [
    { finalPrice: 300, sales: 10, reviews: 1000 },
    { finalPrice: 100, sales: 5, reviews: 0 }
  ];
  assert.strictEqual(core.sortItems(list, 'renqi')[0].sales, 10);
});
t('formatPrice 千分位', () => assert.strictEqual(core.formatPrice(12345.6), '¥12,345.60'));

console.log('core: 平台与 ID');

const CASES = [
  ['https://item.taobao.com/item.htm?id=654321987', 'taobao', '654321987'],
  ['https://detail.tmall.com/item.htm?spm=a1z10&id=123456789', 'tmall', '123456789'],
  ['https://detail.tmall.hk/item.htm?id=987654321', 'tmall', '987654321'],
  ['https://item.jd.com/100012043978.html', 'jd', '100012043978'],
  ['https://item.jd.hk/100012043978.html', 'jd', '100012043978'],
  ['https://item.yiyaojd.com/100012043978.html', 'jd', '100012043978'],
  ['https://detail.vip.com/detail-1234567-987654321.html', 'vip', '1234567'],
  ['https://mobile.yangkeduo.com/goods.html?goods_id=123456789', 'pdd', '123456789']
];

CASES.forEach(([url, platform, id]) => {
  t(`extractItemId ${platform}`, () => {
    assert.strictEqual(core.extractItemId(url, platform), id);
  });
});

t('detectPlatform 各站点', () => {
  assert.strictEqual(core.detectPlatform('ju.taobao.com'), 'taobao');
  assert.strictEqual(core.detectPlatform('chaoshi.detail.tmall.com'), 'tmall');
  assert.strictEqual(core.detectPlatform('detail.tmall.hk'), 'tmall');
  assert.strictEqual(core.detectPlatform('item.jd.hk'), 'jd');
  assert.strictEqual(core.detectPlatform('item.yiyaojd.com'), 'jd');
  assert.strictEqual(core.detectPlatform('detail.vip.com'), 'vip');
  assert.strictEqual(core.detectPlatform('mobile.yangkeduo.com'), 'pdd');
  assert.strictEqual(core.detectPlatform('example.com'), '');
});
t('detectChannel 频道识别', () => {
  assert.strictEqual(core.detectChannel('ju.taobao.com', '/'), '聚划算');
  assert.strictEqual(core.detectChannel('chaoshi.detail.tmall.com', '/item.htm'), '天猫超市');
  assert.strictEqual(core.detectChannel('detail.tmall.hk', '/item.htm'), '天猫国际');
  assert.strictEqual(core.detectChannel('item.jd.hk', '/1.html'), '京东国际');
  assert.strictEqual(core.detectChannel('book.jd.com', '/'), '京东图书');
  assert.strictEqual(core.detectChannel('e.jd.com', '/'), '京东电子书');
  assert.strictEqual(core.detectChannel('gy.jd.com', '/'), '京东工业品');
  assert.strictEqual(core.detectChannel('item.yiyaojd.com', '/1.html'), '京东大药房');
});
t('buildSearchUrl 生成各平台搜索地址', () => {
  assert.ok(core.buildSearchUrl('taobao', '测试').startsWith('https://s.taobao.com/search?q='));
  assert.ok(core.buildSearchUrl('jd', '测试').includes('keyword='));
  assert.ok(core.buildSearchUrl('pdd', '测试').includes('search_key='));
});
t('hashString 稳定', () => {
  assert.strictEqual(core.hashString('abc'), core.hashString('abc'));
  assert.notStrictEqual(core.hashString('abc'), core.hashString('abd'));
});

console.log(`\ncore: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
