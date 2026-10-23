'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../userscript/src/core.js');
const { loadConfig } = require('../server/config.js');
const { createApp } = require('../server/index.js');

let pass = 0;
let fail = 0;

async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    fail++;
    console.error('  \u2717 ' + name + '\n      ' + (err && err.stack || err));
  }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilian-test-'));
  const cfg = loadConfig();
  cfg.mode = 'mock';
  cfg.dataDir = dir;
  cfg.mock.latencyMs = 0;
  cfg.cacheTtlMs = 500;
  cfg.matching.threshold = 40;
  // 测试不碰外网：历史源全部关掉，只验本地采样 + 演示铺底
  cfg.history.upstreams = [];

  const app = createApp(cfg);
  const server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`server: 测试实例 ${base}，数据目录 ${dir}\n`);

  async function getJson(p, opts) {
    const res = await fetch(base + p, opts);
    const json = await res.json();
    return { res, json };
  }

  await t('GET /api/health 返回运行状态', async () => {
    const { res, json } = await getJson('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.mode, 'mock');
    assert.ok(json.providers.active.includes('mock'), JSON.stringify(json.providers));
  });

  await t('GET / 返回控制台 HTML', async () => {
    const res = await fetch(base + '/');
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('比价聚合控制台'));
    assert.ok(html.includes('/api/search'));
  });

  await t('GET /api/search 价格排序：到手价升序', async () => {
    const { res, json } = await getJson('/api/search?keyword=' + encodeURIComponent('罗技 G304 无线鼠标') + '&sort=jiage&limit=30');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(json.list.length > 0, '没有返回商品');
    for (let i = 1; i < json.list.length; i++) {
      assert.ok(json.list[i].finalPrice >= json.list[i - 1].finalPrice - 0.001,
        `第 ${i} 条价格乱序: ${json.list[i - 1].finalPrice} -> ${json.list[i].finalPrice}`);
    }
    assert.ok(json.summary.lowest && json.summary.lowest.min > 0);
  });

  await t('GET /api/search 第 2 页不会被二次切空', async () => {
    const kw = encodeURIComponent('机械键盘');
    const first = await getJson('/api/search?keyword=' + kw + '&sort=jiage&page=1&limit=10');
    const second = await getJson('/api/search?keyword=' + kw + '&sort=jiage&page=2&limit=10');
    assert.ok(first.json.list.length > 0);
    assert.ok(second.json.list.length > 0, '第 2 页不应为空');
    const ids = new Set(first.json.list.map((x) => x.id));
    assert.ok(second.json.list.every((x) => !ids.has(x.id)), '第 2 页与第 1 页重复');
    assert.strictEqual(second.json.hasMore, true);
  });

  await t('GET /api/search 销量排序：销量降序', async () => {
    const { json } = await getJson('/api/search?keyword=' + encodeURIComponent('蓝牙耳机') + '&sort=xiaoliang&limit=30');
    assert.ok(json.list.length > 0);
    for (let i = 1; i < json.list.length; i++) {
      assert.ok(json.list[i].sales <= json.list[i - 1].sales + 0.001,
        `销量乱序: ${json.list[i - 1].sales} -> ${json.list[i].sales}`);
    }
  });

  await t('GET /api/search 平台过滤只返回该平台', async () => {
    const { json } = await getJson('/api/search?keyword=' + encodeURIComponent('保温杯') + '&platform=jd&limit=20');
    assert.ok(json.list.length > 0);
    assert.ok(json.list.every((x) => x.platform === 'jd'));
  });

  await t('GET /api/search 带出优惠券汇总', async () => {
    const { json } = await getJson('/api/search?keyword=' + encodeURIComponent('洗发水') + '&sort=jiage&limit=40');
    assert.ok(Array.isArray(json.coupons));
    assert.ok(json.coupons.length > 0, '40 条结果里应该有券');
    assert.ok(json.coupons[0].amount > 0);
    for (let i = 1; i < json.coupons.length; i++) {
      assert.ok(json.coupons[i].amount <= json.coupons[i - 1].amount);
    }
  });

  await t('POST /api/compare 返回最低方案与当前页面商品', async () => {
    const { res, json } = await getJson('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'taobao',
        title: '罗技 G304 无线鼠标 黑色',
        price: 199,
        url: 'https://item.taobao.com/item.htm?id=654321987',
        image: 'https://img.example.com/a.jpg',
        channel: '商品详情'
      })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(json.best && json.best.finalPrice > 0);
    const prices = json.items.map((x) => x.finalPrice);
    assert.strictEqual(json.best.finalPrice, Math.min.apply(null, prices));
    assert.ok(json.items.some((x) => x.isCurrent), '缺少当前页面商品');
    const cur = json.items.find((x) => x.isCurrent);
    assert.strictEqual(cur.price, 199);
    assert.ok(Array.isArray(json.history));
    assert.ok(json.stats.matched >= 1);
  });

  await t('POST /api/compare 券后价参与排序', async () => {
    const { json } = await getJson('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'jd', title: '巴黎水 500ml 24瓶 整箱', price: 129 })
    });
    const withCoupon = json.items.filter((x) => x.coupon > 0);
    assert.ok(withCoupon.length > 0, '模拟数据里应该有带券商品');
    withCoupon.forEach((x) => {
      assert.ok(x.finalPrice <= x.price, `${x.finalPrice} > ${x.price}`);
    });
  });

  await t('POST /api/collect 采集真实页面价格', async () => {
    const { res, json } = await getJson('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'jd',
        itemId: '100012043978',
        title: '测试商品 无线鼠标 静音版',
        price: '88.00',
        originPrice: '129.00',
        shop: '京东自营',
        url: 'https://item.jd.com/100012043978.html'
      })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.saved.price, 88);
    assert.ok(json.stats.collected >= 1);
  });

  await t('采集数据会进入后续比价结果', async () => {
    const { json } = await getJson('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'taobao', title: '测试商品 无线鼠标 静音版', price: 99 })
    });
    assert.ok(json.items.some((x) => x.source === 'collected'),
      '结果里没有采集源: ' + json.items.map((x) => x.source).join(','));
  });

  await t('POST /api/collect 参数缺失返回 400', async () => {
    const { res, json } = await getJson('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'jd', title: '没有价格' })
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(json.ok, false);
  });

  await t('GET /api/history 按 key 查本地采样', async () => {
    const title = '测试商品 无线鼠标 静音版';
    const key = 'taobao:' + core.hashString(core.normalizeTitle(title));
    const { json } = await getJson('/api/history?key=' + encodeURIComponent(key));
    assert.strictEqual(json.ok, true);
    assert.ok(json.points.length >= 1, '没有历史点');
    assert.strictEqual(json.points[json.points.length - 1].p, 99);
    assert.ok(json.stats && json.stats.count >= 1);
    assert.ok(json.advice && json.advice.code);
  });

  await t('GET /api/history 按 URL 查：演示铺底 + 完整统计', async () => {
    const url = 'https://item.jd.com/100012043978.html';
    const { res, json } = await getJson('/api/history?url=' + encodeURIComponent(url) + '&price=88&days=180');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.key, 'jd:100012043978');
    assert.ok(json.points.length >= 30, '应有演示序列铺底，实际 ' + json.points.length);
    assert.ok(json.stats.min.price > 0);
    assert.ok(json.stats.max.price >= json.stats.min.price);
    assert.ok(json.stats.avg > 0);
    assert.ok(json.stats.position >= 0 && json.stats.position <= 100);
    // 兼容参考脚本后端字段
    assert.strictEqual(json.data.min, json.stats.min.price);
    assert.strictEqual(json.data.max, json.stats.max.price);
    assert.strictEqual(json.data.his.length, json.points.length);
    assert.ok(json.data.his[0].updatetime);
    assert.strictEqual(json.mock, true, '没有真实历史源时应标记 mock');
  });

  await t('GET /api/history 缺定位参数返回 400', async () => {
    const { res, json } = await getJson('/api/history');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(json.ok, false);
  });

  await t('GET /api/history 按窗口截断点数', async () => {
    const url = 'https://item.jd.com/100012043978.html';
    const { json } = await getJson('/api/history?url=' + encodeURIComponent(url) + '&price=88&days=30');
    assert.strictEqual(json.days, 30);
    assert.ok(json.points.length <= 31, '30 天窗口不该超过 31 个点，实际 ' + json.points.length);
  });

  await t('GET /core.js 输出共享核心', async () => {
    const res = await fetch(base + '/core.js');
    const js = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(js.includes('buildChartSvg'));
    assert.ok(js.includes('buildHistoryStats'));
  });

  await t('未知接口返回 404 JSON + CORS 头', async () => {
    const res = await fetch(base + '/api/nope');
    const json = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });

  await t('OPTIONS 预检返回 204', async () => {
    const res = await fetch(base + '/api/compare', { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-methods').includes('POST'), true);
  });

  await t('POST /api/compare 缺标题返回 400', async () => {
    const { res, json } = await getJson('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'taobao' })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(json.error.includes('标题'));
  });

  await t('重复请求命中缓存（同关键词耗时下降）', async () => {
    const q = '/api/search?keyword=' + encodeURIComponent('机械键盘') + '&sort=jiage&limit=20';
    await getJson(q);
    const { json } = await getJson(q);
    assert.strictEqual(json.ok, true);
    assert.ok(json.list.length > 0);
  });

  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\nserver: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('测试启动失败:', err);
  process.exit(1);
});
