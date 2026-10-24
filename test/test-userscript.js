'use strict';

/**
 * 用户脚本端到端测试：jsdom 造一个京东商详页，注入 GM 垫片，
 * 加载打包后的 .user.js，验证面板渲染、比价、搜索、排序、券、折叠、设置。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
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

function waitFor(fn, timeout = 8000, interval = 60) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      let value;
      try {
        value = fn();
      } catch (err) {
        value = false;
      }
      if (value) return resolve(value);
      if (Date.now() - started > timeout) return reject(new Error('等待超时: ' + fn.toString().slice(0, 120)));
      setTimeout(poll, interval);
    })();
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilian-ui-'));
  const cfg = loadConfig();
  cfg.mode = 'mock';
  cfg.dataDir = dir;
  cfg.mock.latencyMs = 0;
  cfg.matching.threshold = 40;
  // 历史源关掉，测试不碰外网
  cfg.history.upstreams = [];

  const app = createApp(cfg);
  const server = app.server;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`userscript: 测试后端 ${base}\n`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>罗技 G304 无线鼠标 黑色-京东</title>
</head><body>
  <div class="itemInfo-wrap">
    <div class="sku-name">罗技 G304 无线鼠标 黑色</div>
    <div class="summary-price"><div class="p-price"><span class="price">￥199.00</span></div></div>
    <img id="spec-img" data-origin="https://img.example.com/g304.jpg">
    <div class="J-hove-wrap"><div class="name"><a>罗技京东自营旗舰店</a></div></div>
  </div>
</body></html>`;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => {
    const msg = String(err && err.message || err);
    // jsdom 的 CSS 解析器不认识部分现代语法，这类噪声忽略
    if (msg.includes('Could not parse CSS')) return;
    errors.push(msg);
  });

  const dom = new JSDOM(html, {
    url: 'https://item.jd.com/100012043978.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  const prefs = { apiBase: base, auto: true };

  // 只提供现代异步 GM 存储 API，覆盖旧版管理器没有 GM_getValue/GM_setValue 的场景。
  w.GM = {
    getValue: async (k, d) => (Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : d),
    setValue: async (k, v) => { prefs[k] = v; }
  };
  w.GM_openInTab = () => {};
  w.GM_setClipboard = () => {};
  w.GM_xmlhttpRequest = (o) => {
    const opts = { method: o.method || 'GET', headers: o.headers || {} };
    if (o.data !== undefined && o.data !== null) opts.body = o.data;
    fetch(o.url, opts).then(async (res) => {
      const text = await res.text();
      if (o.onload) o.onload({ status: res.status, responseText: text, responseHeaders: '' });
    }).catch((err) => {
      if (o.onerror) o.onerror(err);
    });
  };
  w.unsafeWindow = w;

  const code = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'dist', 'bilian.user.js'), 'utf8');
  assert.ok(code.includes('// ==UserScript=='), '打包产物缺少元数据头');

  // 脚本站审核规则：权限最小化、描述不堆关键词、首页可访问
  const header = code.split('// ==/UserScript==')[0];
  assert.ok(!/@connect\s+\*/.test(header), '@connect 不允许通配符');
  assert.ok(header.includes('// @tag'), '缺少 @tag 标签');
  assert.ok(/@description\s+\S/.test(header), '缺少脚本描述');
  assert.ok(!header.includes('聚划算'), '@description 不应堆渠道关键词');
  assert.ok(/@homepageURL\s+https:\/\//.test(header), '@homepageURL 必须是公开地址');

  try {
    w.eval(code);

    const host = await waitFor(() => w.document.getElementById('bl-root'), 6000);
    const sh = () => host.shadowRoot;
    await waitFor(() => sh() && sh().querySelector('.bl-panel'), 4000);

    const panel = () => sh().querySelector('.bl-panel');
    const rows = () => sh().querySelectorAll('.bl-body .bl-row');
    const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

    await t('面板挂载在商详页，标题栏显示平台', async () => {
      assert.strictEqual(sh().querySelector('.bl-name').textContent, '比价助手');
      assert.ok(sh().querySelector('.bl-sub').textContent.includes('京东'), sh().querySelector('.bl-sub').textContent);
      assert.strictEqual(panel().classList.contains('hide'), false);
    });

    await t('自动识别商品标题、价格、店铺', async () => {
      await waitFor(() => sh().querySelector('.bl-item-title'), 6000);
      const title = sh().querySelector('.bl-item-title').textContent;
      assert.ok(title.includes('罗技 G304'), title);
      const price = sh().querySelector('.bl-item-price').textContent;
      assert.ok(price.includes('199.00'), price);
      const meta = sh().querySelector('.bl-item-meta').textContent;
      assert.ok(meta.includes('京东'), meta);
    });

    await t('自动比价：出现最低价与价格列表', async () => {
      await waitFor(() => rows().length > 0, 8000);
      const best = sh().querySelector('.bl-best-v').textContent;
      assert.ok(best.startsWith('¥'), best);
      assert.ok(rows().length >= 3, '结果只有 ' + rows().length + ' 条');
      const platforms = Array.from(rows()).map((r) => r.querySelector('.bl-pf').textContent.trim());
      assert.ok(new Set(platforms).size >= 2, '结果平台太单一: ' + platforms.join(','));
    });

    await t('当前页面商品被标记', async () => {
      const metas = Array.from(rows()).map((r) => r.querySelector('.bl-row-meta').textContent);
      assert.ok(metas.some((m) => m.includes('当前页面')), metas.join(' | '));
    });

    await t('底部状态显示匹配条数与耗时', async () => {
      await waitFor(() => /匹配 \d+ 条/.test(sh().querySelector('.bl-status').textContent), 4000);
      const status = sh().querySelector('.bl-status').textContent;
      assert.ok(status.includes('ms'), status);
    });

    await t('切到搜索页，输入框预填当前商品标题', async () => {
      click(sh().querySelector('[data-tab="search"]'));
      await waitFor(() => sh().querySelector('#bl-kw'), 3000);
      const val = sh().querySelector('#bl-kw').value;
      assert.ok(val.includes('罗技'), val);
    });

    await t('搜索：输入关键词并出结果', async () => {
      const input = sh().querySelector('#bl-kw');
      input.value = '蓝牙耳机';
      click(sh().querySelector('[data-act="search"]'));
      await waitFor(() => sh().querySelector('.bl-count') && rows().length > 0, 8000);
      const count = sh().querySelector('.bl-count').textContent;
      assert.ok(/共 \d+ 条/.test(count), count);
      assert.ok(rows().length > 0);
    });

    await t('搜索：价格排序切到最后生效并重排', async () => {
      const before = Array.from(rows()).map((r) => Number(r.querySelector('.bl-row-price b').textContent.replace(/[^\d.]/g, '')));
      click(sh().querySelector('[data-act="sort"][data-sort="jiage"]'));
      await waitFor(() => {
        const chip = sh().querySelector('[data-act="sort"][data-sort="jiage"]');
        return chip && chip.classList.contains('on') && sh().querySelectorAll('.bl-list .bl-row').length > 0;
      }, 6000);
      await new Promise((r) => setTimeout(r, 350));
      const after = Array.from(rows()).map((r) => Number(r.querySelector('.bl-row-price b').textContent.replace(/[^\d.]/g, '')));
      for (let i = 1; i < after.length; i++) {
        assert.ok(after[i] >= after[i - 1], `排序后价格乱序: ${after[i - 1]} -> ${after[i]}`);
      }
      assert.ok(before.length > 0);
    });

    await t('优惠券页展示券面额与券后价', async () => {
      click(sh().querySelector('[data-tab="coupon"]'));
      await waitFor(() => sh().querySelector('.bl-cpn') || sh().textContent.includes('没查到隐藏券'), 5000);
      const cards = sh().querySelectorAll('.bl-cpn');
      assert.ok(cards.length > 0, '比价结果里应该有券');
      const first = cards[0].textContent;
      assert.ok(first.includes('券'), first);
      assert.ok(first.includes('券后'), first);
    });

    await t('比价页展示迷你走势与完整走势入口', async () => {
      click(sh().querySelector('[data-tab="compare"]'));
      await waitFor(() => sh().querySelector('.bl-hist svg'), 6000);
      const more = sh().querySelector('.bl-hist-more');
      assert.ok(more && more.textContent.includes('走势'), '缺少走势入口');
      assert.ok(sh().querySelector('.bl-hist-meta').textContent.includes('史低'));
    });

    await t('比价页提供跨平台同款搜索入口', async () => {
      await waitFor(() => sh().querySelector('[data-act="open"][data-url*="s.taobao.com"]'), 4000);
      const urls = Array.from(sh().querySelectorAll('.bl-chips [data-act="open"]'))
        .map((el) => el.getAttribute('data-url'));
      assert.ok(urls.length >= 3, '平台入口太少: ' + urls.length);
      assert.ok(urls.every((u) => u.startsWith('https://')), urls.join(' | '));
      // 当前平台是京东，不应重复给京东入口
      assert.ok(!urls.some((u) => u.includes('search.jd.com')), urls.join(' | '));
    });

    await t('走势页：拉取历史价并画出 SVG 曲线', async () => {
      click(sh().querySelector('[data-tab="trend"]'));
      await waitFor(() => sh().querySelector('.bl-hero-v'), 8000);
      const svg = sh().querySelector('#bl-chart svg');
      assert.ok(svg, '没有渲染走势图');
      assert.ok(svg.innerHTML.includes('<path'), 'SVG 里没有折线路径');
      assert.ok(sh().querySelectorAll('#bl-chart path').length >= 2, '缺少面积层');
      const hero = sh().querySelector('.bl-hero-v').textContent;
      assert.ok(hero.startsWith('¥'), hero);
    });

    await t('走势页：统计四格与结论齐全', async () => {
      const cells = sh().querySelectorAll('.bl-grid2 .bl-cell');
      assert.strictEqual(cells.length, 4, '统计格数量不对');
      const text = Array.from(cells).map((c) => c.textContent).join(' | ');
      assert.ok(text.includes('历史最低'), text);
      assert.ok(text.includes('历史最高'), text);
      assert.ok(text.includes('区间均价'), text);
      const advice = sh().querySelector('.bl-advice');
      assert.ok(advice, '缺少结论条');
      assert.ok(advice.className.split(' ').some((c) => ['best', 'good', 'normal', 'high', 'sampling', 'unknown'].includes(c)),
        advice.className);
    });

    await t('走势页：数据来源标注含演示数据', async () => {
      const src = sh().querySelector('.bl-src').textContent;
      assert.ok(src.includes('来源'), src);
      assert.ok(src.includes('采样'), src);
      assert.ok(sh().querySelector('.bl-mock-tag'), '没有真实历史源时应标出演示数据');
    });

    await t('走势页：hover 显示日期与价格', async () => {
      const svg = sh().querySelector('#bl-chart svg');
      // jsdom 不做布局，手动给一个尺寸让坐标映射成立
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 158, right: 340, bottom: 158 });
      const wrap = sh().querySelector('#bl-chart');
      wrap.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 170, clientY: 80 }));
      const tip = sh().querySelector('.bl-tip');
      assert.ok(tip.classList.contains('show'), 'tooltip 没显示');
      assert.ok(tip.textContent.includes('¥'), tip.textContent);
      assert.ok(/\d{4}-\d{2}-\d{2}/.test(tip.textContent), tip.textContent);
      wrap.dispatchEvent(new w.MouseEvent('mouseleave', { bubbles: true }));
      assert.strictEqual(tip.classList.contains('show'), false);
    });

    await t('走势页：切 30 天区间重新取数', async () => {
      click(sh().querySelector('[data-act="range"][data-days="30"]'));
      await waitFor(() => {
        const chip = sh().querySelector('[data-act="range"][data-days="30"]');
        return chip && chip.classList.contains('on') && /采样 30 天/.test((sh().querySelector('.bl-src') || {}).textContent || '');
      }, 8000);
      assert.ok(sh().querySelector('#bl-chart svg'));
    });

    await t('关闭后变悬浮标签，点击可恢复', async () => {
      click(sh().querySelector('[data-act="close"]'));
      await waitFor(() => panel().classList.contains('hide'), 3000);
      assert.ok(sh().querySelector('.bl-fab').classList.contains('show'));
      click(sh().querySelector('.bl-fab'));
      await waitFor(() => !panel().classList.contains('hide'), 3000);
    });

    await t('设置页显示后端地址与服务状态', async () => {
      click(sh().querySelector('[data-tab="settings"]'));
      await waitFor(() => sh().querySelector('#bl-api'), 3000);
      assert.strictEqual(sh().querySelector('#bl-api').value, base);
      assert.strictEqual(sh().querySelector('#bl-auto').checked, true);
      await waitFor(() => sh().textContent.includes('服务版本'), 4000);
      assert.ok(sh().textContent.includes('mock') || sh().textContent.includes('模拟'), '缺少服务状态信息');
      sh().querySelector('#bl-auto').checked = false;
      click(sh().querySelector('[data-act="save"]'));
      await waitFor(() => prefs.auto === false, 2000);
    });

    await t('设置页拒绝非本机后端地址', async () => {
      const input = sh().querySelector('#bl-api');
      input.value = 'http://example.com:8787';
      click(sh().querySelector('[data-act="save"]'));
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(prefs.apiBase, base, '远端地址不应被保存');
      assert.ok(sh().querySelector('.bl-toast').textContent.includes('本机'), '缺少地址限制提示');
      input.value = base;
    });

    await t('后端不可用时仍提供各平台同款搜索入口', async () => {
      const input = sh().querySelector('#bl-api');
      input.value = 'http://127.0.0.1:1';
      click(sh().querySelector('[data-act="save"]'));
      await new Promise((r) => setTimeout(r, 200));
      click(sh().querySelector('[data-tab="compare"]'));
      click(sh().querySelector('[data-act="refresh"]'));
      await waitFor(() => sh().querySelector('.bl-err'), 8000);
      const urls = Array.from(sh().querySelectorAll('.bl-chips [data-act="open"]'))
        .map((el) => el.getAttribute('data-url'));
      assert.ok(urls.length >= 3, '离线时缺少平台入口: ' + urls.length);
      click(sh().querySelector('[data-tab="settings"]'));
      await waitFor(() => sh().querySelector('#bl-api'), 3000);
      sh().querySelector('#bl-api').value = base;
      click(sh().querySelector('[data-act="save"]'));
      await new Promise((r) => setTimeout(r, 200));
    });

    await t('上报接口收到页面采集数据', async () => {
      const res = await fetch(base + '/api/stats');
      const json = await res.json();
      assert.ok(json.stats.collected >= 1, JSON.stringify(json.stats));
      assert.ok(json.recent.some((x) => x.platform === 'jd' && x.title.includes('罗技')), JSON.stringify(json.recent));
      assert.strictEqual(json.recent[0].price, 199);
    });

    await t('运行期没有 JS 报错', async () => {
      assert.deepStrictEqual(errors, []);
    });
  } finally {
    w.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nuserscript: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('测试启动失败:', err);
  process.exit(1);
});
