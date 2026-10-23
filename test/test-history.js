'use strict';

const assert = require('node:assert');
const core = require('../userscript/src/core.js');
const hp = require('../server/providers/history.js');
const { resolveQuery } = require('../server/service/history.js');

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    fail++;
    console.error('  \u2717 ' + name + '\n      ' + (err && err.stack || err));
  }
}

const DAY = core.DAY_MS;
const NOW = Date.now();

function p(price, daysAgo) {
  return { t: NOW - daysAgo * DAY, p: price };
}

t('dailyMin 同一天多个采样只保留最低价', () => {
  const t0 = NOW;
  const out = core.dailyMin([
    { t: t0, p: 100 },
    { t: t0 - 3600000, p: 90 },
    { t: t0 - 7200000, p: 120 }
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].p, 90);
});

t('dailyMin 按天排序并过滤非法点', () => {
  const out = core.dailyMin([
    p(120, 1),
    p(110, 3),
    { t: 0, p: 99 },
    { t: NOW, p: 0 },
    { t: NOW, p: -5 }
  ]);
  assert.strictEqual(out.length, 2);
  assert.ok(out[0].t < out[1].t);
});

t('buildHistoryStats 最低/最高/均价/日期', () => {
  const stats = core.buildHistoryStats([p(100, 5), p(80, 4), p(120, 2), p(90, 0)], 95);
  assert.strictEqual(stats.count, 4);
  assert.strictEqual(stats.min.price, 80);
  assert.strictEqual(stats.max.price, 120);
  assert.strictEqual(stats.avg, 97.5);
  assert.ok(stats.min.date && /^\d{4}-\d{2}-\d{2}$/.test(stats.min.date));
  assert.strictEqual(stats.current, 95);
});

t('buildHistoryStats 分位：现价最低时为 0', () => {
  const stats = core.buildHistoryStats([p(100, 3), p(90, 2), p(80, 1)], 80);
  assert.strictEqual(stats.position, 0);
  assert.strictEqual(stats.vsMin, 0);
});

t('buildHistoryStats 分位：现价最高时为 100', () => {
  const stats = core.buildHistoryStats([p(100, 3), p(90, 2), p(80, 1)], 200);
  assert.strictEqual(stats.position, 100);
  assert.ok(stats.vsMin > 100);
});

t('buildHistoryStats 空输入不抛异常', () => {
  const stats = core.buildHistoryStats([], 0);
  assert.strictEqual(stats.count, 0);
  assert.strictEqual(stats.min, null);
  assert.strictEqual(stats.position, 0);
});

t('buildHistoryStats 没有现价时用最后一个采样点', () => {
  const stats = core.buildHistoryStats([p(100, 2), p(88, 0)], 0);
  assert.strictEqual(stats.current, 88);
});

t('historyAdvice 采样不足给 sampling', () => {
  const a = core.historyAdvice(core.buildHistoryStats([p(100, 1)], 100));
  assert.strictEqual(a.code, 'sampling');
});

t('historyAdvice 接近史低给 best', () => {
  const a = core.historyAdvice(core.buildHistoryStats([p(100, 3), p(80, 2), p(81, 1)], 80.5));
  assert.strictEqual(a.code, 'best');
});

t('historyAdvice 高位给 high', () => {
  const a = core.historyAdvice(core.buildHistoryStats([p(100, 5), p(90, 4), p(80, 3), p(85, 2), p(70, 1)], 99));
  assert.strictEqual(a.code, 'high');
});

t('historyAdvice 空数据给 unknown', () => {
  assert.strictEqual(core.historyAdvice(core.buildHistoryStats([], 0)).code, 'unknown');
});

t('buildChartSvg 输出路径、坐标与统计', () => {
  const r = core.buildChartSvg([p(100, 4), p(80, 2), p(90, 0)], { width: 340, height: 150, current: 90 });
  assert.ok(r.svg.indexOf('<svg') === 0);
  assert.ok(r.svg.indexOf('<path') > 0);
  assert.ok(r.svg.indexOf('bl-chart-svg') > 0);
  assert.ok(r.svg.indexOf('bl-hover-line') > 0, '缺少 hover 占位');
  assert.strictEqual(r.geom.points.length, 3);
  assert.strictEqual(r.stats.min.price, 80);
  // 最低点 y 应该比最高点 y 小（SVG 坐标向下增长）
  const low = r.geom.points.find((x) => x.p === 80);
  const high = r.geom.points.find((x) => x.p === 100);
  assert.ok(low.y > high.y);
});

t('buildChartSvg 单点不崩，坐标居中', () => {
  const r = core.buildChartSvg([p(99, 0)], { width: 340, height: 150 });
  assert.ok(r.svg.indexOf('<svg') === 0);
  assert.strictEqual(r.geom.points.length, 1);
  assert.ok(r.geom.points[0].x > 100 && r.geom.points[0].x < 240);
});

t('buildChartSvg 空数据显示空串', () => {
  const r = core.buildChartSvg([], {});
  assert.strictEqual(r.svg, '');
  assert.strictEqual(r.geom, null);
});

t('buildChartSvg 全等价不出现 NaN', () => {
  const r = core.buildChartSvg([p(100, 2), p(100, 1), p(100, 0)], {});
  assert.ok(r.svg.indexOf('NaN') < 0);
});

t('normalizePayload 兼容参考脚本 {data:{his}}', () => {
  const out = hp.normalizePayload({
    data: {
      max: 200,
      min: 90,
      his: [
        { price: '199.00', updatetime: '2026-01-02' },
        { price: '90.50', updatetime: '2026-01-01' }
      ]
    }
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].p, 90.5);
  assert.ok(out[0].t < out[1].t);
});

t('normalizePayload 兼容 {data:[...]} 的 date/price', () => {
  const out = hp.normalizePayload({
    data: [
      { date: '2026-02-01', price: '88.8' },
      { date: '2026-02-03', price: 99 }
    ]
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].p, 99);
});

t('normalizePayload 支持分单位换算', () => {
  const out = hp.normalizePayload({ data: [{ date: '2026-02-01', price: 8880 }] }, true);
  assert.strictEqual(out[0].p, 88.8);
});

t('normalizePayload 丢掉没有价格或日期的行', () => {
  const out = hp.normalizePayload({
    data: [{ date: '2026-02-01' }, { price: 10 }, { date: '2026-02-02', price: 20 }]
  });
  assert.strictEqual(out.length, 1);
});

t('parseTime 支持秒/毫秒/日期串', () => {
  assert.strictEqual(hp.parseTime(1700000000), 1700000000000);
  assert.strictEqual(hp.parseTime(1700000000000), 1700000000000);
  assert.ok(hp.parseTime('2026-02-01') > 0);
  assert.strictEqual(hp.parseTime(''), 0);
});

t('mockSeries 同一 key 输出完全一致', () => {
  const a = hp.mockSeries('jd:100012043978', 88, 90);
  const b = hp.mockSeries('jd:100012043978', 88, 90);
  assert.strictEqual(a.length, 90);
  assert.deepStrictEqual(a.map((x) => x.p), b.map((x) => x.p));
});

t('mockSeries 末点钉到现价', () => {
  const s = hp.mockSeries('jd:1', 123.45, 30);
  assert.strictEqual(s[s.length - 1].p, 123.45);
  assert.ok(s.every((x) => x.p > 0));
});

t('mockSeries 不同 key 形态不同', () => {
  const a = hp.mockSeries('jd:1', 100, 60).map((x) => x.p);
  const b = hp.mockSeries('jd:2', 100, 60).map((x) => x.p);
  assert.notDeepStrictEqual(a, b);
});

t('mergeSeries 真实数据覆盖同日演示数据', () => {
  const day = Math.floor(NOW / DAY);
  const fake = [{ t: day * DAY + 1000, p: 50, mock: true }, { t: (day - 1) * DAY + 1000, p: 51, mock: true }];
  const real = [{ t: day * DAY + 2000, p: 70 }];
  const out = hp.mergeSeries(real, fake);
  const today = out.find((x) => Math.floor(x.t / DAY) === day);
  assert.strictEqual(today.p, 70);
  assert.strictEqual(today.mock, false);
  assert.strictEqual(out.length, 2);
});

t('resolveQuery 从京东链接推 key', () => {
  const q = resolveQuery({ url: 'https://item.jd.com/100012043978.html', price: 88 });
  assert.strictEqual(q.platform, 'jd');
  assert.strictEqual(q.itemId, '100012043978');
  assert.strictEqual(q.key, 'jd:100012043978');
});

t('resolveQuery 从淘宝链接推 key', () => {
  const q = resolveQuery({ url: 'https://item.taobao.com/item.htm?id=654321987' });
  assert.strictEqual(q.key, 'taobao:654321987');
});

t('resolveQuery 只有标题时用标题哈希', () => {
  const q = resolveQuery({ platform: 'jd', title: '罗技 G304 无线鼠标' });
  assert.strictEqual(q.key, 'jd:' + core.hashString(core.normalizeTitle('罗技 G304 无线鼠标')));
});

t('resolveQuery 无任何定位信息时 key 为空', () => {
  assert.strictEqual(resolveQuery({}).key, '');
});

t('短价格格式：千位与万位', () => {
  assert.strictEqual(core.shortPrice(199), '199');
  assert.strictEqual(core.shortPrice(1234), '1234');
  assert.strictEqual(core.shortPrice(12345), '1.2万');
});

console.log(`\nhistory: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
