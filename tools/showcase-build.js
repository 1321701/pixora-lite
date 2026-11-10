#!/usr/bin/env node
/**
 * 灵感广场 · 静态分片构建脚本
 *
 * 产物（默认写到 ./showcase/，即 config.js 里 showcaseBase 指向的目录）：
 *   showcase/index.json        { version, total, pageSize, pages, files, models:[{name,count}], updatedAt }
 *   showcase/page-N.json       { items:[...] }
 *   showcase/img/<id>.webp     大图（长边 ≤1400）
 *   showcase/img/<id>_t.webp   缩略图（长边 ≤480）
 * 纯静态文件，任何静态托管（nginx / GitHub Pages / 对象存储）都能直接提供，无需后端。
 *
 * 数据来源（二选一）：
 *   A. 开源社区合集（默认）——均为 CC BY 4.0，需保留署名，脚本会写入作者/来源/许可信息：
 *        gpt4o  jamez-bondos/awesome-gpt4o-images
 *        nano   PicoTrex/Awesome-Nano-Banana-images
 *        nbpro  Goku-OpenLab/nano-banana-pro-prompts-datasets（Hugging Face）
 *      需要图片转码库：npm i sharp
 *   B. 已有的作品墙接口（--from-api=<url>）：按接口协议分页拉取并镜像成静态分片，不需要 sharp
 *
 * 用法：
 *   node tools/showcase-build.js                          # 每个源最多新增 120 条
 *   node tools/showcase-build.js --source=nbpro --limit=1000 --max-new=1000
 *   node tools/showcase-build.js --from-api=https://example.com/api/showcase --max-new=300
 *   node tools/showcase-build.js --rebuild                # 只按现有数据重新分片
 *   参数：--out=showcase  --page-size=60  --sort=new|curated|random（仅 --from-api）  --dry
 *
 * 内容安全：只收录源标记为安全（SFW）的作品，并做关键词兜底过滤；部署者仍需按所在地法规自行审核展示内容。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ARG = {};
process.argv.slice(2).forEach((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) ARG[m[1]] = m[2] === undefined ? true : m[2];
});
const OUT = path.resolve(ROOT, typeof ARG.out === 'string' ? ARG.out : 'showcase');
const IMG_DIR = path.join(OUT, 'img');
const CACHE_DIR = path.join(ROOT, '.cache', 'showcase');
const PAGE_SIZE = Math.max(10, Math.min(500, Number(ARG['page-size']) || 60));
const PER_SOURCE_LIMIT = Math.max(1, Math.min(30000, Number(ARG.limit) || 120));
const MAX_NEW = Math.max(1, Math.min(30000, Number(ARG['max-new']) || 360));
const DRY = !!ARG.dry;
const ONLY = typeof ARG.source === 'string' ? ARG.source : '';
const FROM_API = typeof ARG['from-api'] === 'string' ? ARG['from-api'] : '';
const UA = 'PixoraLiteShowcaseBuilder/1.0';

const SOURCES = [
    {
        key: 'gpt4o', name: 'awesome-gpt4o-images', repo: 'https://github.com/jamez-bondos/awesome-gpt4o-images',
        readme: 'https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main/README.md',
        raw: 'https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main/',
        license: 'CC BY 4.0', model: 'GPT Image', modelRaw: 'GPT-4o / gpt-image-1'
    },
    {
        key: 'nano', name: 'Awesome-Nano-Banana-images', repo: 'https://github.com/PicoTrex/Awesome-Nano-Banana-images',
        readme: 'https://raw.githubusercontent.com/PicoTrex/Awesome-Nano-Banana-images/main/README.md',
        raw: 'https://raw.githubusercontent.com/PicoTrex/Awesome-Nano-Banana-images/main/',
        license: 'CC BY 4.0', model: 'Nano Banana', modelRaw: 'Nano Banana'
    },
    {
        key: 'nbpro', name: 'Nano Banana Pro Prompts', repo: 'https://huggingface.co/datasets/Goku-OpenLab/nano-banana-pro-prompts-datasets',
        meta: 'https://huggingface.co/datasets/Goku-OpenLab/nano-banana-pro-prompts-datasets/resolve/main/metadata.jsonl',
        raw: 'https://huggingface.co/datasets/Goku-OpenLab/nano-banana-pro-prompts-datasets/resolve/main/',
        license: 'CC BY 4.0', model: 'Nano Banana Pro', modelRaw: 'Nano Banana Pro', concurrent: 5
    }
];

// 文字/图表/多格类案例不适合做作品墙
const BLOCK_TITLE = /流程图|流程|PPT|演示文稿|幻灯片|表格|坐标|地图|识字|小报|文档|说明书|菜单|简历|名片|日历|天气预报|信息图|界面|UI|网页|代码|二维码|思维导图|图表|教程|步骤|公式|拆解|示意图|排版|文字排版|九宫格|分镜|拼图|网格|对比图|前后对比|证件照/i;
// 安全兜底（源本身是 SFW 合集）：色情、暴力血腥、政治敏感人物/事件等关键词一律跳过
const UNSAFE_RE = /(nsfw|nude|naked|hentai|porn|lingerie|sexual|erotic|gore|bloody|corpse|swastika)\b|裸体|裸照|色情|情色|性感内衣|血腥|尸体|暴恐|恐怖袭击|纳粹|国家领导人|领导人|主席像|天安门|台独|藏独|疆独|邪教|毒品|赌博|枪支/i;
const ART_RE = /摄影|电影|人像|肖像|海报|插画|角色|场景|概念|写实|风景|建筑|产品|动漫|幻想|科幻|神话|古风|时尚|质感|光影|油画|水彩|水墨|3D|毛绒|手办|封面|视觉|广告|品牌|设计/i;
const LOW_ART_RE = /产品图|信息卡|成分|营养价值|使用说明|介绍|科普|知识|参数|规格|卖点|测评|指南|教程|说明|步骤|模板|卡片|清单|排版|字体|表格|图表|数据|界面|UI|菜单|包装|标志|Logo|logo|电商|详情页|说明书|思维导图|流程图/i;

const log = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (uid) => 'sc_' + crypto.createHash('sha1').update(uid).digest('hex').slice(0, 12);

async function fetchRetry(url, kind, timeoutMs) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs || 90000) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (kind === 'json') return await res.json();
            if (kind === 'text') return await res.text();
            const buf = Buffer.from(await res.arrayBuffer());
            if (!buf.length) throw new Error('空文件');
            return buf;
        } catch (e) {
            lastErr = e;
            await sleep(1500 * (i + 1));
        }
    }
    throw lastErr;
}

function cleanText(s) {
    return String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function str(v, max) {
    return v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
function httpUrl(v) {
    const s = str(v, 2000);
    return /^https?:\/\//i.test(s) ? s : '';
}

// ===== 现有数据（增量构建） =====
function readExisting() {
    const items = [];
    try {
        const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
        const files = idx.files || Array.from({ length: idx.pages || 0 }, (_, i) => 'page-' + (i + 1) + '.json');
        for (const f of files) {
            try {
                const p = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
                (Array.isArray(p) ? p : p.items || []).forEach((it) => items.push(it));
            } catch (e) { log('读取分片失败，跳过', f, e.message); }
        }
    } catch (e) { /* 首次构建 */ }
    return items;
}

function writeShards(items) {
    // 图片缺失的条目不发布
    const ok = items.filter((it) => fs.existsSync(path.join(OUT, it.img)) && fs.existsSync(path.join(OUT, it.thumb)));
    const pages = Math.max(1, Math.ceil(ok.length / PAGE_SIZE));
    const files = [];
    fs.readdirSync(OUT).filter((f) => /^page-\d+\.json$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
    for (let i = 0; i < pages; i++) {
        const f = 'page-' + (i + 1) + '.json';
        files.push(f);
        fs.writeFileSync(path.join(OUT, f), JSON.stringify({ items: ok.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE) }));
    }
    const count = {};
    ok.forEach((it) => { if (it.model) count[it.model] = (count[it.model] || 0) + 1; });
    const models = Object.keys(count).sort((a, b) => count[b] - count[a]).map((name) => ({ name, count: count[name] }));
    const index = { version: 1, total: ok.length, pageSize: PAGE_SIZE, pages, files, models, updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
    writeCredits(ok);
    log('已写入', ok.length, '条 /', pages, '个分片 →', path.relative(ROOT, OUT) || '.');
}

// 署名清单（CC BY 要求注明作者、来源与许可）
function writeCredits(items) {
    const bySrc = {};
    items.forEach((it) => {
        const k = it.source || '未知来源';
        (bySrc[k] = bySrc[k] || { repo: it.sourceRepo || '', license: it.license || '', authors: new Set(), n: 0 }).n++;
        if (it.author) bySrc[k].authors.add(it.author);
    });
    let md = '# 灵感广场作品署名\n\n本目录中的图片与提示词转载自以下开源合集，按其许可证分发；图片经过缩放与 WebP 转码。版权归原作者所有。\n\n';
    Object.keys(bySrc).forEach((k) => {
        const s = bySrc[k];
        md += '## ' + k + '\n\n- 来源：' + (s.repo || '-') + '\n- 许可：' + (s.license || '-') + '\n- 收录：' + s.n + ' 件\n';
        if (s.authors.size) md += '- 作者：' + Array.from(s.authors).sort().map((a) => '@' + a).join('、') + '\n';
        md += '\n';
    });
    md += '每件作品的作者、原帖链接与许可信息见 page-N.json 中对应条目的 author / sourceUrl / license 字段，并在作品详情弹窗中展示。\n';
    fs.writeFileSync(path.join(OUT, 'CREDITS.md'), md);
}

function makeItem(base) {
    return {
        id: base.id,
        title: str(base.title, 110),
        prompt: str(base.prompt, 4000),
        model: str(base.model, 40),
        modelRaw: str(base.modelRaw, 60),
        author: base.author === 'i' ? '' : str(base.author, 60),   // x.com/i/... 不是用户名
        authorUrl: httpUrl(base.authorUrl),
        license: str(base.license, 40),
        licenseUrl: httpUrl(base.licenseUrl),
        source: str(base.source, 80),
        sourceRepo: httpUrl(base.sourceRepo),
        sourceUrl: httpUrl(base.sourceUrl),
        img: 'img/' + base.id + '.webp',
        thumb: 'img/' + base.id + '_t.webp',
        width: Number(base.width) || 0,
        height: Number(base.height) || 0,
        tags: Array.isArray(base.tags) ? base.tags.slice(0, 8).map((t) => str(t, 20)).filter(Boolean) : [],
        createdAt: base.createdAt || new Date().toISOString()
    };
}

// ===== 来源 B：镜像已有接口 =====
async function buildFromApi(existing) {
    const have = new Set(existing.map((it) => it.id));
    const added = [];
    let offset = 0;
    const limit = 60;
    while (added.length < MAX_NEW) {
        const sep = FROM_API.includes('?') ? '&' : '?';
        const j = await fetchRetry(FROM_API + sep + 'limit=' + limit + '&offset=' + offset + '&sort=' + encodeURIComponent(typeof ARG.sort === 'string' ? ARG.sort : 'new') + '&seed=build', 'json');
        const d = (j && j.data) || {};
        const list = Array.isArray(d.items) ? d.items : [];
        if (!list.length) break;
        offset += list.length;
        for (const raw of list) {
            if (added.length >= MAX_NEW) break;
            if (!raw || raw.sfw === false || !raw.img) continue;
            if (UNSAFE_RE.test((raw.title || '') + ' ' + (raw.prompt || ''))) continue;
            const id = /^sc_[A-Za-z0-9_-]{4,32}$/.test(raw.id) ? raw.id : idOf(String(raw.uid || raw.id || raw.img));
            if (have.has(id)) continue;
            if (DRY) { added.push({ id }); continue; }
            try {
                const big = await fetchRetry(new URL(raw.img, FROM_API).href, 'buf');
                const small = raw.thumb ? await fetchRetry(new URL(raw.thumb, FROM_API).href, 'buf') : big;
                fs.writeFileSync(path.join(IMG_DIR, id + '.webp'), big);
                fs.writeFileSync(path.join(IMG_DIR, id + '_t.webp'), small);
            } catch (e) { log('  图片下载失败', raw.img, e.message); continue; }
            const it = makeItem(Object.assign({}, raw, { id, sourceRepo: raw.sourceRepo || repoOf(raw.source) }));
            added.push(it);
            have.add(id);
            if (added.length % 50 === 0) log('  已镜像', added.length, '条');
        }
        if (d.total && offset >= d.total) break;
    }
    return added;
}
function repoOf(name) {
    const s = SOURCES.find((x) => x.name === name);
    return s ? s.repo : '';
}

// ===== 来源 A：开源合集 =====
function extractPrompt(chunk) {
    const m = /\*\*提示词[^\n]*\*\*[^\n]*\n+```[^\n]*\n([\s\S]*?)```/.exec(chunk);
    return m ? m[1].trim().replace(/^\uFEFF/, '').replace(/\r/g, '').slice(0, 4000) : '';
}
function extractAuthor(chunk, heading) {
    let m = /Prompt by\s*<a[^>]*>([^<]+)<\/a>/i.exec(chunk);
    if (m) return m[1].replace(/^@/, '').trim();
    m = /（by\s+[@\[]?([^）\]\s]+)/.exec(heading) || /\(by\s+[@\[]?([^)\]\s]+)/.exec(heading);
    if (m) return m[1].replace(/^@/, '').replace(/\]$/, '').trim();
    m = /<sub>[\s\S]*?@([A-Za-z0-9_]+)/.exec(chunk);
    return m ? m[1] : '';
}
function parseGpt(readme) {
    const out = [];
    const parts = readme.split(/<a id="cases-(\d+)"><\/a>/);
    for (let i = 1; i < parts.length; i += 2) {
        const no = parts[i];
        const body = parts[i + 1] || '';
        const h = /^###\s*案例\s*\d+[：:]\s*(.+)$/m.exec(body);
        if (!h) continue;
        const heading = h[1].trim();
        const title = cleanText(heading.replace(/\s*\(by\s+[\s\S]*$/i, '')).slice(0, 110);
        const img = (/<img\s+src="(cases\/[^"]+\.(?:png|jpg|jpeg|webp))"/i.exec(body) || [])[1];
        const prompt = extractPrompt(body);
        if (!title || !img || !prompt) continue;
        out.push({
            uid: 'gpt4o:case' + no + ':' + img, title, prompt, imgPath: img,
            sourceUrl: (/\[原文链接\]\((https?:\/\/[^)]+)\)/.exec(body) || [])[1] || '',
            author: extractAuthor(body, heading)
        });
    }
    return out;
}
function parseNano(readme) {
    const out = [];
    const stdStart = readme.indexOf('## 🖼️ Nano Banana 例子');
    const ackAt = readme.indexOf('## 🙏 Acknowledge');
    const re = /<!--\s*例\s*(\d+)[：:][^\n]*-->/g;
    const marks = [];
    let m;
    while ((m = re.exec(readme))) marks.push({ no: m[1], start: m.index, end: re.lastIndex });
    for (let i = 0; i < marks.length; i++) {
        const mk = marks[i];
        if (ackAt !== -1 && mk.start >= ackAt) break;
        const body = readme.slice(mk.end, marks[i + 1] ? marks[i + 1].start : readme.length);
        const h = /^\s*###\s*例\s*\d+[：:]\s*(.+)$/m.exec(body);
        if (!h) continue;
        const heading = h[1].trim();
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(heading);
        const title = (link ? cleanText(link[1]) : cleanText(heading.replace(/（by[\s\S]*$/, '').replace(/\(by[\s\S]*$/, ''))).slice(0, 110);
        const srcMatch = /\[([^\]]+)\]\((https?:\/\/x\.com\/[^)]+)\)/.exec(heading);
        const imgs = Array.from(body.matchAll(/<img\s+src="(images\/[^"]+\.(?:png|jpg|jpeg|webp))"/gi)).map((x) => x[1]);
        const img = imgs.find((u) => /\/output\d*\.(?:png|jpg|jpeg|webp)$/i.test(u)) || imgs.find((u) => /\/case\.(?:png|jpg|jpeg|webp)$/i.test(u)) || '';
        const prompt = extractPrompt(body);
        if (!title || !img || !prompt) continue;
        const pro = stdStart !== -1 && mk.start < stdStart;
        out.push({
            uid: 'nano:' + (pro ? 'pro_case' : 'case') + mk.no + ':' + img, title, prompt, imgPath: img,
            sourceUrl: srcMatch ? srcMatch[2] : '', author: extractAuthor(body, heading), pro
        });
    }
    return out;
}
async function parseNbPro(source) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, 'nbpro-metadata.jsonl');
    let fresh = false;
    try { fresh = (Date.now() - fs.statSync(cacheFile).mtimeMs) < 7 * 864e5; } catch (e) { fresh = false; }
    if (!fresh) {
        log('  拉取 metadata.jsonl（约 130MB，缓存 7 天）…');
        fs.writeFileSync(cacheFile, await fetchRetry(source.meta, 'text', 300000));
    }
    const out = [];
    for (const line of fs.readFileSync(cacheFile, 'utf8').split('\n')) {
        if (!line) continue;
        let r;
        try { r = JSON.parse(line); } catch (e) { continue; }
        if (!r || !r.media || !Array.isArray(r.media.images) || !r.media.images.length) continue;
        const safety = (r.spec && r.spec.safety_rating) || '';
        if (safety && !/safe/i.test(safety)) continue;
        const zh = r.i18n && r.i18n.zh;
        const en = r.i18n && r.i18n.en;
        const title = cleanText((zh && zh.t) || (en && en.t) || '');
        const prompt = cleanText((zh && zh.p) || (en && en.p) || r.raw_p || '');
        if (!title || !prompt || BLOCK_TITLE.test(title) || UNSAFE_RE.test(title + ' ' + prompt)) continue;
        const imgPath = r.media.images[0];
        if (!/\.(jpg|jpeg|png|webp)$/i.test(imgPath)) continue;
        const ratio = Number(r.spec && r.spec.ratio) || 1;
        if (ratio < 0.45 || ratio > 2.2) continue;
        const handle = ((/x\.com\/([A-Za-z0-9_]+)\//.exec(r.sourceLink || '') || [])[1] || '').replace(/^i$/, '');
        let score = 0;
        if (r.is_featured) score += 10;
        if (ART_RE.test(title)) score += 8;
        if (ratio >= 0.6 && ratio <= 0.85) score += 4;
        if (r.media.images.length === 1) score += 3;
        if (prompt.length >= 120) score += 2;
        if (LOW_ART_RE.test(title)) score -= 20;
        out.push({
            uid: 'nbpro:' + r.id, title, prompt, imgPath, sourceUrl: r.sourceLink || '', author: handle, pro: true, score,
            tags: ((zh && zh.tags) || (en && en.tags) || []).slice(0, 6)
        });
    }
    out.sort((a, b) => (b.score - a.score) || a.uid.localeCompare(b.uid));
    return out;
}

async function buildFromSources(existing) {
    let sharp;
    try { sharp = require('sharp'); } catch (e) {
        console.error('缺少图片转码库 sharp：请先执行 npm i sharp（或改用 --from-api 镜像已有接口）');
        process.exit(1);
    }
    const have = new Set(existing.map((it) => it.id));
    const hashes = new Set(existing.map((it) => it.hash).filter(Boolean));
    const added = [];
    const list = ONLY ? SOURCES.filter((s) => s.key === ONLY) : SOURCES;
    for (const source of list) {
        log('=== 源:', source.name, '===');
        let entries;
        try {
            entries = source.key === 'nbpro' ? await parseNbPro(source)
                : (source.key === 'gpt4o' ? parseGpt : parseNano)(await fetchRetry(source.readme, 'text'));
        } catch (e) { log('  解析失败:', e.message); continue; }
        const queue = entries.filter((e) => !have.has(idOf(e.uid)) && !BLOCK_TITLE.test(e.title) && !UNSAFE_RE.test(e.title + ' ' + e.prompt)).slice(0, PER_SOURCE_LIMIT);
        log('  解析', entries.length, '条，待处理', queue.length, '条');
        let idx = 0;
        const worker = async () => {
            while (added.length < MAX_NEW) {
                const entry = queue[idx++];
                if (!entry) return;
                const id = idOf(entry.uid);
                if (DRY) { added.push({ id }); continue; }
                let buf, meta;
                try {
                    buf = await fetchRetry(source.raw + entry.imgPath.split('/').map(encodeURIComponent).join('/'), 'buf');
                    meta = await sharp(buf).metadata();
                } catch (e) { log('  下载/解析失败', entry.imgPath, e.message); continue; }
                const ar = meta.width / meta.height;
                if (!meta.width || Math.min(meta.width, meta.height) < 560 || ar < 0.48 || ar > 2.15 || buf.length < 50000) continue;
                const hash = crypto.createHash('sha1').update(buf).digest('hex');
                if (hashes.has(hash)) continue;
                try {
                    const img = sharp(buf).rotate();
                    await img.clone().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(IMG_DIR, id + '.webp'));
                    await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toFile(path.join(IMG_DIR, id + '_t.webp'));
                } catch (e) { log('  转码失败', entry.imgPath, e.message); continue; }
                const it = makeItem({
                    id, title: entry.title, prompt: entry.prompt,
                    model: entry.pro ? 'Nano Banana Pro' : source.model, modelRaw: entry.pro ? 'Nano Banana Pro' : source.modelRaw,
                    author: entry.author, authorUrl: entry.author ? 'https://x.com/' + entry.author : '',
                    license: source.license, source: source.name, sourceRepo: source.repo, sourceUrl: entry.sourceUrl,
                    width: meta.width, height: meta.height, tags: entry.tags
                });
                it.hash = hash;
                added.push(it);
                have.add(id);
                hashes.add(hash);
                log('  +', it.title.slice(0, 28), '[' + it.model + ']');
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, source.concurrent || 1) }, worker));
        if (added.length >= MAX_NEW) break;
    }
    return added;
}

async function main() {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    const existing = readExisting();
    log('现有', existing.length, '条');
    if (ARG.rebuild) return writeShards(existing);
    const added = FROM_API ? await buildFromApi(existing) : await buildFromSources(existing);
    log('新增', added.length, '条' + (DRY ? '（dry run，未写入）' : ''));
    if (!DRY) writeShards(existing.concat(added));
}

main().catch((e) => {
    console.error('[showcase-build] 失败:', (e && e.stack) || e);
    process.exitCode = 1;
});
