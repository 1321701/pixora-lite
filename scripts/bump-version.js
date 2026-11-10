#!/usr/bin/env node
/**
 * 更新页面里静态资源的缓存版本号（?v=xxxx），部署新版本后让浏览器拉取最新文件。
 * 用法：node scripts/bump-version.js [版本号]   不传则使用当前时间戳
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ver = process.argv[2] || String(Math.floor(Date.now() / 1000));
if (!/^[\w.-]+$/.test(ver)) {
    console.error('版本号只能包含字母、数字、点、下划线和短横线');
    process.exit(1);
}
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const file = path.join(ROOT, f);
    const src = fs.readFileSync(file, 'utf8');
    let n = 0;
    const out = src.replace(/(\.(?:js|css|json)\?v=)[\w.-]+/g, (_, p) => { n++; return p + ver; });
    if (n) fs.writeFileSync(file, out);
    console.log(f + '：' + n + ' 处 → ?v=' + ver);
}
