'use strict';

/**
 * 打包：把 src 下的模块按依赖顺序拼成一个 .user.js。
 * 顺序不能乱：core -> platform -> extract -> store -> api -> ui -> main。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));

const FILES = ['core.js', 'platform.js', 'extract.js', 'store.js', 'api.js', 'ui.js', 'main.js'];

const MATCHES = [
  '*://*.taobao.com/*',
  '*://*.tmall.com/*',
  '*://*.tmall.hk/*',
  '*://*.ju.taobao.com/*',
  '*://*.jd.com/*',
  '*://*.jd.hk/*',
  '*://*.yiyaojd.com/*',
  '*://*.jkcsjd.com/*',
  '*://*.jingdonghealth.cn/*',
  '*://*.vip.com/*',
  '*://*.vipglobal.hk/*',
  '*://*.pinduoduo.com/*',
  '*://*.yangkeduo.com/*'
];

const EXCLUDES = [
  '*://login.taobao.com/*',
  '*://uland.taobao.com/*',
  '*://login.tmall.com/*',
  '*://pages.tmall.com/*',
  '*://cart.taobao.com/*',
  '*://cart.jd.com/*',
  '*://order.jd.com/*',
  '*://trade.jd.com/*',
  '*://wq.jd.com/*',
  '*://union.jd.com/*',
  '*://pay.jd.com/*'
];

function header() {
  const lines = [
    '// ==UserScript==',
    '// @name               全网比价助手',
    '// @name:zh            全网比价助手',
    '// @namespace          https://github.com/qinmuran0316/bilian-price-comparison',
    `// @version            ${pkg.version}`,
    '// @author             qinmuran',
    '// @description        在商品详情页显示比价面板：本机服务启动时查看同款价格、隐藏券和历史价，未启动时跳转各平台搜索同款。数据只发送到本机 127.0.0.1，不上传。',
    '// @description:zh     在商品详情页显示比价面板：本机服务启动时查看同款价格、隐藏券和历史价，未启动时跳转各平台搜索同款。数据只发送到本机 127.0.0.1，不上传。',
    '// @license            MIT',
    '// @homepageURL        https://github.com/qinmuran0316/bilian-price-comparison',
    '// @supportURL         https://github.com/qinmuran0316/bilian-price-comparison/issues',
    '// @tag                比价',
    '// @tag                购物',
    '// @tag                优惠券',
    '// @tag                历史价格',
    ...MATCHES.map((m) => `// @match              ${m}`),
    ...EXCLUDES.map((m) => `// @exclude            ${m}`),
    '// @grant              GM_xmlhttpRequest',
    '// @grant              GM_getValue',
    '// @grant              GM_setValue',
    '// @grant              GM_openInTab',
    '// @grant              GM_setClipboard',
    '// @grant              unsafeWindow',
    '// @connect            127.0.0.1',
    '// @connect            localhost',
    '// @run-at             document-idle',
    '// @noframes',
    '// ==/UserScript==',
    ''
  ];
  return lines.join('\n');
}

function build() {
  const chunks = [];
  for (const file of FILES) {
    const full = path.join(SRC, file);
    if (!fs.existsSync(full)) throw new Error(`缺少源文件: ${file}`);
    const code = fs.readFileSync(full, 'utf8');
    if (/\bTODO\b|\bFIXME\b/.test(code)) {
      throw new Error(`${file} 里还有 TODO/FIXME，先补完再打包`);
    }
    chunks.push(`/* ==================== ${file} ==================== */\n${code.trim()}\n`);
  }

  const out = header() + '\n' + chunks.join('\n');
  // 语法检查在打包阶段做，别等用户装进去才报错
  new vm.Script(out, { filename: 'bilian.user.js' });

  fs.mkdirSync(DIST, { recursive: true });
  const target = path.join(DIST, 'bilian.user.js');
  fs.writeFileSync(target, out, 'utf8');

  const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  console.log(`已生成 ${path.relative(ROOT, target)}  ${kb} KB`);
  console.log(`模块 ${FILES.length} 个 · 站点规则 ${MATCHES.length} 条 · 版本 ${pkg.version}`);
  return target;
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error('打包失败:', err.message);
    process.exit(1);
  }
}

module.exports = { build, FILES, header };
