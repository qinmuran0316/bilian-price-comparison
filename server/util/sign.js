'use strict';

const crypto = require('node:crypto');

function md5Upper(str) {
  return crypto.createHash('md5').update(String(str), 'utf8').digest('hex').toUpperCase();
}

/** TOP / 京东联盟 / 多多进宝 都是同一套：secret + 排序后的 k+v 拼接 + secret */
function signParams(params, secret, upper = true) {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const raw = keys.map((k) => k + params[k]).join('');
  const digest = crypto.createHash('md5').update(secret + raw + secret, 'utf8').digest('hex');
  return upper ? digest.toUpperCase() : digest;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nonce(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

module.exports = { md5Upper, signParams, timestamp, nonce };
