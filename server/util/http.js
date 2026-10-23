'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { URL } = require('node:url');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function decompress(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
    if (enc.includes('deflate')) return zlib.inflateSync(buffer);
  } catch (err) {
    // 头里写了压缩但内容没压：原样返回，别把请求判死
  }
  return buffer;
}

function once(urlStr, opts) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      reject(new Error(`非法 URL: ${urlStr}`));
      return;
    }
    const mod = url.protocol === 'https:' ? https : http;
    const body = opts.body;
    const headers = Object.assign({
      'User-Agent': DEFAULT_UA,
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }, opts.headers || {});

    if (body !== null && body !== undefined && headers['Content-Length'] === undefined) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers,
      timeout: opts.timeout || 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: decompress(raw, res.headers['content-encoding']).toString('utf8')
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy(new Error(`请求超时(${opts.timeout || 8000}ms): ${url.hostname}`));
    });
    req.on('error', reject);
    if (body !== null && body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * 带重定向、重试、JSON 解析的请求封装。
 * 重试只针对网络层错误和 5xx，4xx 直接抛（参数/签名问题重试没意义）。
 */
async function request(urlStr, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 8000,
    retries = 1,
    maxRedirects = 3
  } = opts;

  let current = urlStr;
  let redirects = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(current, { method, headers, body, timeout });
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (redirects >= maxRedirects) throw new Error('重定向次数超限');
        redirects++;
        current = new URL(res.headers.location, current).toString();
        attempt--; // 重定向不消耗重试次数
        continue;
      }
      if (res.status >= 500) throw new Error(`上游 ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError || new Error('请求失败');
}

async function requestJson(urlStr, opts = {}) {
  const res = await request(urlStr, opts);
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 180)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error(`响应不是 JSON: ${res.body.slice(0, 180)}`);
  }
}

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

module.exports = { request, requestJson, qs, DEFAULT_UA };
