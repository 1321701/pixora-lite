/**
 * Pixora 自部署版 —— Service Worker
 * Copyright (c) 2026 Pixora (https://pixoraai.cc)
 *
 * 只做一件事：让 <img>/<video>/<audio>/CSS 背景等直接引用的本地媒体（pxl-media/<id>）
 * 从 IndexedDB 读取；/v1/image/proxy?url= 对本地媒体同样处理，外部地址原样转发。
 * 其余请求一律不拦截。
 */
'use strict';

const DB_NAME = 'pixora-local';
const STORES = ['media', 'tasks', 'history', 'canvases', 'kv'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function openDb() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => STORES.forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function getMedia(id) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const g = db.transaction('media', 'readonly').objectStore('media').get(id);
            g.onsuccess = () => resolve(g.result || null);
            g.onerror = () => reject(g.error);
        });
    } finally { db.close(); }
}
function mediaIdOf(u) {
    const i = u.indexOf('pxl-media/');
    return i < 0 ? '' : u.slice(i + 10).split(/[?#&]/)[0];
}
async function serve(id, request) {
    const rec = await getMedia(decodeURIComponent(id)).catch(() => null);
    if (!rec || !rec.blob) return new Response('Not Found', { status: 404 });
    const blob = rec.blob;
    const type = blob.type || rec.type || 'application/octet-stream';
    const range = request.headers.get('range');
    if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
            const size = blob.size;
            const start = m[1] === '' ? Math.max(0, size - Number(m[2] || 0)) : Number(m[1]);
            const end = Math.min(m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1, size - 1);
            if (start <= end) {
                return new Response(blob.slice(start, end + 1, type), {
                    status: 206,
                    headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' }
                });
            }
        }
    }
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' } });
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (_) { return; }
    const id = mediaIdOf(url.pathname);
    if (id) { e.respondWith(serve(id, req)); return; }
    if (url.pathname.endsWith('/v1/image/proxy')) {
        const target = url.searchParams.get('url') || '';
        const tid = mediaIdOf(target);
        if (tid) { e.respondWith(serve(tid, req)); return; }
        if (/^https?:\/\//.test(target)) {
            e.respondWith(fetch(target, { mode: 'cors' }).catch(() => fetch(target, { mode: 'no-cors' })));
        }
    }
});
