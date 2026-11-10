/**
 * character-lib.js —— 无限画布 · 角色库（第一期）
 *   - 左侧导航「角色」入口 → 右侧抽屉：搜索 / 新建 / 角色卡网格 / 详情编辑
 *   - 角色数据属于用户、跨画布共享：GET/POST/PUT/DELETE /api/characters
 *   - 角色节点：nodeType:'ref' + subType:'character'（复用 ref 节点的输出端口与连线），
 *     字段 characterId / wardrobeId / charSnapshot（离线兜底快照，角色被删后仍可用）
 *   - 连到生成节点时展开为角色全部参考图（CanvasEdges.getUpstreamImages 调用 expandRefs），
 *     提交任务时在提示词前注入角色描述（buildPromptInjection，不写回节点 prompt）
 * 所有用户内容（名称/描述/特征）渲染到 DOM 时一律转义
 */
(function (global) {
    'use strict';

    const ROLE_ORDER = { face: 0, turnaround: 1, fullbody: 2, expression: 3, other: 4 };
    const ROLE_LABEL = { face: '面部', turnaround: '三视图', fullbody: '全身', expression: '表情', other: '其他' };
    const LIM = { name: 40, alias: 40, aliases: 10, description: 500, anchor: 40, anchors: 5, styleTag: 40, refs: 8, note: 100, wardrobe: 10, wdName: 40, wdDesc: 300 };
    const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>';
    const svg = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const IC = {
        user: ICON_USER,
        userBold: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>', 2.4),
        search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
        plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
        x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
        back: svg('<path d="m15 18-6-6 6-6"/>', 2.2),
        image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
        images: svg('<rect x="7" y="7" width="14" height="14" rx="2.5"/><path d="M3 15V5a2 2 0 0 1 2-2h10"/>'),
        edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
        insert: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>'),
        more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
        trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'),
        star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
        upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
        cursor: svg('<path d="M4 4l7 17 2.5-7.5L21 11Z"/>'),
        hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>'),
        shirt: svg('<path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0Z"/>'),
        tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
        card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4M14 14h3"/>'),
        sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
        warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
        spark: svg('<path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/>')
    };
    // 空状态插画：两张叠放的人像卡 + lime 星点
    const EMPTY_ART = `<svg viewBox="0 0 120 100" fill="none" aria-hidden="true">
        <rect x="18" y="16" width="46" height="62" rx="9" transform="rotate(-10 41 47)" fill="#1b1d21" stroke="rgba(255,255,255,0.12)"/>
        <rect x="50" y="12" width="50" height="68" rx="10" fill="#202227" stroke="rgba(196,241,123,0.45)"/>
        <circle cx="75" cy="38" r="9" stroke="#c4f17b" stroke-width="2.2"/>
        <path d="M60 68v-2a15 15 0 0 1 30 0v2" stroke="#c4f17b" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M104 20l1.6 3.4 3.4 1.6-3.4 1.6L104 30l-1.6-3.4L99 25l3.4-1.6Z" fill="#c4f17b"/>
        <circle cx="14" cy="80" r="2" fill="rgba(196,241,123,0.5)"/><circle cx="108" cy="86" r="1.5" fill="rgba(255,255,255,0.25)"/>
    </svg>`;
    function toast(msg, type) {
        if (typeof global.pxToast === 'function') global.pxToast(msg, type ? { type } : undefined);
        else alert(msg);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    // 仅允许站内图片代理地址 / https 图片地址进入 src（服务端已白名单校验，这里纵深防御）
    function safeUrl(u) {
        u = String(u || '');
        return (/^\/api\/img[/?]/.test(u) || /^https:\/\//.test(u)) ? u : '';
    }
    function uniq(arr) { const s = new Set(); return arr.filter(x => (s.has(x) ? false : (s.add(x), true))); }

    const ASSET_KINDS = {
        char: { api: '/api/characters', label: '角色', icon: IC.user },
        scene: { api: '/api/scenes', label: '场景', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="8" cy="9" r="1.6"/></svg>' },
        prop: { api: '/api/props', label: '道具', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>' }
    };

    const CharacterLib = {
        chars: [],
        _byId: new Map(),
        _loaded: false,
        _loadingP: null,
        _q: '',
        _view: 'list',     // list | edit
        _draft: null,      // 编辑中的角色草稿（含 _ingest 勾选）
        _ingestTimers: {},
        _tab: 'char',      // char | scene | prop
        scenes: null,
        props: null,
        _kLoaded: {},
        _kLoading: {},

        init() {
            if (this._inited) return;
            this._inited = true;
            this._buildRailButton();
            this._buildDrawer();
            this._buildHint();
            this.load();
        },

        // ================= 数据 =================
        _base() { return (global.API_CONFIG && global.API_CONFIG.baseUrl) || ''; },
        async _api(method, path, body) {
            const headers = Object.assign({ 'Content-Type': 'application/json' }, typeof global.authHeaders === 'function' ? global.authHeaders() : {});
            const res = await fetch(this._base() + '/api/characters' + (path || ''), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            let j = null;
            try { j = await res.json(); } catch (_) { /* 非 JSON */ }
            if (!res.ok || !j || j.code !== 0) throw new Error((j && j.msg) || ('请求失败: ' + res.status));
            return j.data;
        },
        _setAll(list) {
            this.chars = Array.isArray(list) ? list : [];
            this._byId = new Map(this.chars.map(c => [c.id, c]));
        },
        _upsert(c) {
            if (!c || !c.id) return;
            const i = this.chars.findIndex(x => x.id === c.id);
            if (i === -1) this.chars.unshift(c); else this.chars[i] = c;
            this._byId.set(c.id, c);
        },
        _isLoggedIn() {
            try { return !!(JSON.parse(localStorage.getItem('nano_user') || '{}') || {}).token; } catch (_) { return false; }
        },
        load(force) {
            if (this._loadingP && !force) return this._loadingP;
            if (!this._isLoggedIn()) { this._loaded = true; return Promise.resolve(this.chars); }
            this._loadingP = this._api('GET', '')
                .then(list => { this._setAll(list); this._loaded = true; this.refreshNodes(); this._renderIfOpen(); this.chars.forEach(c => { if (this._assetSum(c).pending) this._watchAsset(c.id); }); return this.chars; })
                .catch(e => { console.warn('[角色库] 加载失败:', e.message); this._loaded = true; this._renderIfOpen(); return this.chars; })
                .finally(() => { this._loadingP = null; });
            return this._loadingP;
        },
        get(id) { return this._byId.get(id) || null; },

        // ================= 角色节点：展开 / 快照 / 刷新 =================
        _sortRefs(refs) {
            return (refs || []).map((r, i) => ({ r, i }))
                .sort((a, b) => ((ROLE_ORDER[a.r.role] ?? 4) - (ROLE_ORDER[b.r.role] ?? 4)) || (a.i - b.i))
                .map(x => x.r);
        },
        _wardrobeOf(node, c) {
            if (!node || !node.wardrobeId) return null;
            if (c) return (c.wardrobe || []).find(w => w.id === node.wardrobeId) || null;
            const s = node.charSnapshot || {};
            return (s.wd && s.wd.id === node.wardrobeId) ? s.wd : null;
        },
        // 角色节点 → 参考图列表 [{url, previewUrl, role}]：造型图优先，其后按 role 优先级 face > turnaround > fullbody > expression > other
        expandRefs(node) {
            if (!node) return [];
            const c = this.get(node.characterId);
            const base = c ? c.refs : ((node.charSnapshot && node.charSnapshot.refs) || []);
            const wd = this._wardrobeOf(node, c);
            const list = this._sortRefs(wd ? wd.refs : []).concat(this._sortRefs(base));
            const seen = new Set();
            const out = list.filter(r => r && r.url && !seen.has(r.url) && seen.add(r.url));
            if (!out.length && node.imageUrl) out.push({ url: node.imageUrl, previewUrl: node.previewUrl || node.imageUrl, role: 'other' });
            return out;
        },
        // 已入库素材库（active）时返回 { assetId, url }：封面那张（兼容旧调用；生成链路改用 assetIdFor 逐张取）
        assetFor(node) {
            const c = node && this.get(node.characterId);
            if (!c || !c.assetId || c.assetStatus !== 'active') return null;
            return { assetId: c.assetId, url: c.assetUrl || ((c.refs || [])[0] || {}).url || '' };
        },
        // 某张参考图（含造型图）自己的素材 ID：Seedance 生成时每张图各自以 asset:// 引用；未入库返回 ''
        assetIdFor(node, url) {
            const c = node && this.get(node.characterId);
            if (!c || !url) return '';
            const all = (c.refs || []).concat(...(c.wardrobe || []).map(w => (w && w.refs) || []));
            const r = all.find(x => x && x.url === url && x.assetId && x.assetStatus === 'active');
            if (r) return r.assetId;
            return (c.assetId && c.assetStatus === 'active' && c.assetUrl === url) ? c.assetId : '';
        },
        // 逐张入库状态汇总（主参考图 + 造型参考图）
        _assetSum(c) {
            const s = { total: 0, active: 0, pending: 0, failed: 0 };
            const all = ((c && c.refs) || []).concat(...((c && c.wardrobe) || []).map(w => (w && w.refs) || []));
            all.forEach(r => {
                if (!r || !r.url) return;
                s.total++;
                if (r.assetId && r.assetStatus === 'active') s.active++;
                else if (r.assetStatus === 'ingesting' || (r.assetId && r.assetStatus === 'processing')) s.pending++;
                else if (r.assetStatus === 'failed') s.failed++;
            });
            if (c && c.assetId && c.assetStatus === 'active' && !all.some(r => r && r.assetId)) s.active = Math.min(s.total, 1); // 未迁移的老数据（仅封面）
            return s;
        },
        wardrobeName(node) {
            const wd = this._wardrobeOf(node, this.get(node && node.characterId));
            return wd ? wd.name : '';
        },
        _info(node) {
            const c = this.get(node.characterId);
            const s = node.charSnapshot || {};
            return {
                name: (c ? c.name : s.name) || node.name || '',
                description: (c ? c.description : s.description) || '',
                anchors: (c ? c.anchors : s.anchors) || [],
                wd: this._wardrobeOf(node, c)
            };
        },
        // 离线兜底快照（体积小：描述截 200 字、参考图最多 8 个 URL，仅存当前造型）
        _snapshot(c, wardrobeId) {
            const wd = wardrobeId ? (c.wardrobe || []).find(w => w.id === wardrobeId) : null;
            const slim = (refs) => (refs || []).slice(0, LIM.refs).map(r => ({ url: r.url, previewUrl: r.previewUrl || r.url, role: r.role || 'other' }));
            return {
                name: c.name,
                description: String(c.description || '').slice(0, 200),
                anchors: (c.anchors || []).slice(0, LIM.anchors),
                refs: slim(c.refs),
                wd: wd ? { id: wd.id, name: wd.name, description: String(wd.description || '').slice(0, 120), refs: slim(wd.refs) } : null
            };
        },
        _coverOf(c, wardrobeId) {
            const wd = wardrobeId ? (c.wardrobe || []).find(w => w.id === wardrobeId) : null;
            return (wd && wd.refs && wd.refs[0]) || (c.refs || [])[0] || null;
        },
        _nodePatch(node, c) {
            const cover = this._coverOf(c, node.wardrobeId);
            const patch = {};
            if (node.name !== c.name) patch.name = c.name;
            if (cover && node.imageUrl !== cover.url) {
                patch.imageUrl = cover.url;
                patch.previewUrl = cover.previewUrl || cover.url;
                patch.mediumUrl = cover.previewUrl || cover.url;
            }
            if (node.wardrobeId && !(c.wardrobe || []).some(w => w.id === node.wardrobeId)) patch.wardrobeId = '';
            const snap = this._snapshot(c, patch.wardrobeId !== undefined ? patch.wardrobeId : node.wardrobeId);
            if (JSON.stringify(snap) !== JSON.stringify(node.charSnapshot || null)) patch.charSnapshot = snap;
            return Object.keys(patch).length ? patch : null;
        },
        refreshNode(id) {
            const CB = global.CanvasBlocks;
            const node = CB && CB.getById(id);
            if (!node || node.subType !== 'character') return false;
            const c = this.get(node.characterId);
            if (!c) return false;
            const patch = this._nodePatch(node, c);
            if (patch) CB.update(node.id, patch);
            return !!patch;
        },
        // 角色卡更新后：画布中引用它的角色节点刷新封面 / 名称 / 快照（角色已删除的节点保留快照）
        refreshNodes() {
            const CB = global.CanvasBlocks;
            if (!CB || !Array.isArray(CB.blocks) || !this._loaded) return;
            let changed = false;
            CB.blocks.filter(b => b.subType === 'character').forEach(b => { if (this.refreshNode(b.id)) changed = true; });
            if (changed) {
                if (global.CanvasMain && global.CanvasMain.onEdgesChange) global.CanvasMain.onEdgesChange();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            }
        },

        // 在画布世界坐标处创建角色节点（center=true 时以该点为中心）
        insertToCanvas(charId, wx, wy, opts) {
            opts = opts || {};
            const CB = global.CanvasBlocks;
            const c = this.get(charId);
            if (!CB || !c) return null;
            const cover = this._coverOf(c, '');
            const node = CB.addRef({
                subType: 'character', characterId: c.id, wardrobeId: '', name: c.name,
                x: wx, y: wy,
                imageUrl: cover ? cover.url : '', previewUrl: cover ? (cover.previewUrl || cover.url) : '', mediumUrl: cover ? (cover.previewUrl || cover.url) : '',
                charSnapshot: this._snapshot(c, '')
            });
            let x = wx, y = wy;
            if (opts.center !== false) { x = wx - node.w / 2; y = wy - node.h / 2; }
            if (opts.findSpot) { const sp = CB._findFreeSpot(x, y, node.w, node.h, node.id); x = sp.x; y = sp.y; }
            CB.update(node.id, { x, y });
            if (!opts.noSelect && global.CanvasSelection) global.CanvasSelection.select(node.id, false);
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            return node;
        },
        insertAtViewportCenter(charId) {
            const CB = global.CanvasBlocks;
            if (!CB) return null;
            const c = CB.viewportCenterWorld();
            return this.insertToCanvas(charId, c.x, c.y, { center: true, findSpot: true });
        },

        // ================= 生成：提示词注入 / 使用计数 =================
        truncMsg(n) { return '已按上限选取前 ' + n + ' 张角色参考图'; },
        // charOf[i] = 第 i 张参考图所属的角色节点 id（非角色图为 ''）
        buildPromptInjection(genId, charOf) {
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            if (!CB || !CE) return '';
            const nodes = CE.edges.filter(e => e.to === genId).map(e => CB.getById(e.from)).filter(n => n && n.subType === 'character');
            if (!nodes.length) return '';
            (CE._charTrunc && CE._charTrunc[genId] || []).forEach(t => alert(this.truncMsg(t.used)));
            const parts = [];
            nodes.forEach(n => {
                const info = this._info(n);
                const idx = [];
                (charOf || []).forEach((cid, i) => { if (cid === n.id) idx.push(i + 1); });
                let range = '';
                if (idx.length === 1) range = `[图片${idx[0]}]`;
                else if (idx.length > 1) {
                    const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
                    range = contiguous ? `[图片${idx[0]}]-[图片${idx[idx.length - 1]}]` : idx.map(i => `[图片${i}]`).join('');
                }
                let s = range ? `请严格以${range}中的人物作为角色【${info.name}】的外观参考（面部五官、发型、身材保持一致；服装未另行说明时也保持一致）。` : '';
                const seg = [];
                if (info.description) seg.push(info.description);
                if (info.anchors && info.anchors.length) seg.push('辨识特征：' + info.anchors.join('、'));
                if (info.wd) seg.push('造型：' + info.wd.name + (info.wd.description ? '（' + info.wd.description + '）' : ''));
                if (seg.length) s += `角色【${info.name}】：${seg.join('；')}。`;
                if (s) parts.push(s);
            });
            return parts.join('\n').slice(0, 1800);
        },
        markUsed(charOf) {
            const CB = global.CanvasBlocks;
            if (!CB) return;
            const ids = uniq((charOf || []).filter(Boolean).map(nid => (CB.getById(nid) || {}).characterId).filter(id => id && this.get(id)));
            ids.forEach(id => this._api('POST', '/' + encodeURIComponent(id) + '/use').then(d => {
                const c = this.get(id); if (c && d) c.usedCount = d.usedCount;
            }).catch(() => {}));
        },

        // ================= @角色 =================
        // 提示词中的角色引用存储为 token「[角色:名称#characterId]」（显示为角色 chip，只显示名称）；
        // 还原时以连入该生成节点的角色节点为准：先按 characterId 匹配，再按名称匹配
        CHAR_TOKEN_SRC: '\\[角色:([^\\]#\\n]{1,40})(?:#(ch_[A-Za-z0-9_]{1,60}))?\\]',
        charToken(name, cid) {
            const nm = String(name || '').replace(/[\[\]#\n\r]/g, '').trim().slice(0, 40) || '角色';
            return '[角色:' + nm + (cid && /^ch_[A-Za-z0-9_]{1,60}$/.test(cid) ? '#' + cid : '') + ']';
        },
        // 连入生成节点的角色节点（默认当前激活的生成节点）
        linkedCharNodes(genId) {
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            if (!genId) { const g = this._activeGen(); genId = g && g.id; }
            if (!genId || !CB || !CE || !Array.isArray(CE.edges)) return [];
            const seen = new Set();
            return CE.edges.filter(e => e.to === genId).map(e => CB.getById(e.from))
                .filter(n => n && n.subType === 'character' && !seen.has(n.id) && seen.add(n.id));
        },
        charNameOf(node) { return node ? this._info(node).name : ''; },
        matchLinked(list, name, cid) {
            list = list || [];
            return (cid && list.find(n => n.characterId === cid)) || (name && list.find(n => this.charNameOf(n) === name)) || null;
        },
        coverOfNode(node) {
            if (!node) return '';
            const r = this.expandRefs(node)[0];
            return safeUrl((r && (r.previewUrl || r.url)) || node.previewUrl || node.imageUrl || '');
        },
        // 按已连入角色名（最长优先）切分文本中的「@名称」：返回 [{text}|{node,name}]
        splitAtMentions(text, list) {
            const s = String(text || '');
            const names = (list || []).map(n => ({ n, name: this.charNameOf(n) })).filter(x => x.name).sort((a, b) => b.name.length - a.name.length);
            if (!names.length || s.indexOf('@') === -1) return [{ text: s }];
            const out = [];
            let buf = '', i = 0;
            while (i < s.length) {
                if (s[i] === '@') {
                    const hit = names.find(x => s.startsWith(x.name, i + 1));
                    if (hit) {
                        if (buf) { out.push({ text: buf }); buf = ''; }
                        out.push({ node: hit.n, name: hit.name });
                        i += 1 + hit.name.length;
                        continue;
                    }
                }
                buf += s[i++];
            }
            if (buf) out.push({ text: buf });
            return out;
        },
        // 提交给模型前：角色 token / 旧格式「@名称」→「角色【名称】」（与注入文本称呼一致）；未连入的退化为纯名称
        resolvePromptTokens(text, genId) {
            const list = this.linkedCharNodes(genId);
            let s = String(text || '').replace(new RegExp(this.CHAR_TOKEN_SRC, 'g'), (m, name, cid) => {
                const n = this.matchLinked(list, name, cid);
                return n ? `角色【${this.charNameOf(n)}】` : name;
            });
            s = this.splitAtMentions(s, list).map(p => (p.node ? `角色【${p.name}】` : p.text)).join('');
            return s;
        },
        _activeGen() {
            const CM = global.CanvasMain, CB = global.CanvasBlocks;
            const id = CM && CM._activeNodeId;
            const n = id && CB && CB.getById(id);
            return n && n.nodeType === 'gen' ? n : null;
        },
        getMentionCandidates() {
            const gen = this._activeGen();
            if (!gen || !this.chars.length) return [];
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            const linked = new Set(CE.edges.filter(e => e.to === gen.id).map(e => CB.getById(e.from)).filter(n => n && n.subType === 'character').map(n => n.characterId));
            // 已连入角色本次计入的参考图张数（与提示词栏聚合项一致）
            const cnt = {};
            const PB = global.PromptBar;
            ((PB && PB.uploadedImages) || []).forEach(im => {
                const n = im && im.charId && CB.getById(im.charId);
                if (n && n.characterId) cnt[n.characterId] = (cnt[n.characterId] || 0) + 1;
            });
            return this.chars.slice(0, 30).map(c => ({ id: c.id, name: c.name, cover: safeUrl(((c.refs || [])[0] || {}).previewUrl || ((c.refs || [])[0] || {}).url), linked: linked.has(c.id), count: cnt[c.id] || 0 }))
                .sort((a, b) => (b.linked - a.linked));
        },
        // 生成节点尚无该角色的角色节点连入：在其左侧创建角色节点并连线
        mentionCharacter(charId) {
            const gen = this._activeGen();
            const c = this.get(charId);
            if (!gen || !c) return null;
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            const exist = CE.edges.filter(e => e.to === gen.id).map(e => CB.getById(e.from)).find(n => n && n.subType === 'character' && n.characterId === charId);
            if (exist) return exist;
            const node = this.insertToCanvas(charId, gen.x - 300, gen.y, { center: false, findSpot: true, noSelect: true });
            if (!node) return null;
            CB.update(node.id, { x: gen.x - node.w - 80 });
            const sp = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            CB.update(node.id, { x: sp.x, y: sp.y });
            if (!CE.add(node.id, gen.id)) {
                // 连不上（素材已满等，已 toast）：撤掉刚建的节点
                CB.remove(node.id);
                return null;
            }
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            return node;
        },

        // 生成节点提示词栏下方浅色小字「已关联角色：A、B」
        updateLinkedHint(activeId) {
            if (this._pop && this._popGenId !== activeId) this.closeRefPopover();
            const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            if (sel.length === 1) this.refreshNode(sel[0]);
            const el = this._hintEl;
            if (!el) return;
            const CB = global.CanvasBlocks, CE = global.CanvasEdges;
            const gen = activeId && CB && CB.getById(activeId);
            let names = [];
            if (gen && gen.nodeType === 'gen' && CE) {
                names = uniq(CE.edges.filter(e => e.to === gen.id).map(e => CB.getById(e.from)).filter(n => n && n.subType === 'character').map(n => this._info(n).name).filter(Boolean));
            }
            el.classList.toggle('hidden', !names.length);
            el.querySelector('.char-linked-names').textContent = names.join('、');
        },

        // ================= 提示词栏：角色聚合参考项 =================
        // 角色节点 → 聚合项展示信息（名称 / 展开总张数 / 封面 / 当前造型）
        slotInfo(nodeId) {
            const CB = global.CanvasBlocks;
            const node = CB && CB.getById(nodeId);
            if (!node || node.subType !== 'character') return null;
            const info = this._info(node);
            const refs = this.expandRefs(node);
            const cv = refs[0];
            return { name: info.name, total: refs.length, cover: cv ? safeUrl(cv.previewUrl || cv.url) : '', wd: info.wd ? info.wd.name : '' };
        },
        // 点击聚合项：浮层网格列出该角色本次计入的参考图（序号 = 提交顺序编号），被模型上限截断的置灰
        openRefPopover(nodeId, start, used, anchorEl) {
            this.closeRefPopover();
            const CB = global.CanvasBlocks, CM = global.CanvasMain;
            const node = CB && CB.getById(nodeId);
            if (!node) return;
            const info = this._info(node);
            const refs = this.expandRefs(node);
            const total = refs.length;
            used = Math.max(0, Math.min(used | 0, total));
            const cv = refs[0];
            const range = used > 1 ? `${start}-${start + used - 1}` : (used === 1 ? String(start) : '');
            const items = refs.map((r, i) => {
                const on = i < used;
                return `<button type="button" class="char-refpop-item${on ? '' : ' off'}" data-i="${i}" title="${on ? '点击查看大图' : '未计入（超出模型上限）'}">
                    <span class="char-refpop-thumb"><img src="${esc(safeUrl(r.previewUrl || r.url))}" alt="" draggable="false">
                        ${on ? `<span class="char-refpop-no">${start + i}</span>` : '<span class="char-refpop-off">未计入</span>'}</span>
                    <span class="char-refpop-role">${ROLE_LABEL[r.role] || ROLE_LABEL.other}</span>
                </button>`;
            }).join('');
            const pop = document.createElement('div');
            pop.className = 'char-refpop';
            pop.setAttribute('role', 'dialog');
            pop.innerHTML = `
                <div class="char-refpop-head">
                    <span class="char-refpop-avatar">${cv ? `<img src="${esc(safeUrl(cv.previewUrl || cv.url))}" alt="">` : ''}</span>
                    <div class="char-refpop-ttl">
                        <div class="char-refpop-name"><span class="node-char-pill">${IC.userBold}<span>角色</span></span><span class="nm px-no-i18n">${esc(info.name)}</span></div>
                        <div class="char-refpop-sub"><span>${used < total ? `已计入 ${used}/${total} 张` : `共 ${total} 张参考图`}</span>${range ? `<span>·</span><span>图片 ${range}</span>` : ''}${info.wd ? `<span class="char-refpop-wd px-no-i18n" title="当前造型">${esc(info.wd.name)}</span>` : ''}</div>
                    </div>
                    <button type="button" class="char-icon-btn" data-act="pop-close" title="关闭" aria-label="关闭">${IC.x}</button>
                </div>
                <div class="char-refpop-grid">${items}</div>
                ${used < total ? `<div class="char-refpop-note">${IC.warn}<span>模型上限：仅计入前 ${used} 张，其余 ${total - used} 张未计入</span></div>` : ''}
                <div class="char-refpop-foot">
                    <button type="button" class="char-btn small" data-act="pop-open">${IC.edit}<span>打开角色卡</span></button>
                    <button type="button" class="char-btn small" data-act="pop-wd">${IC.shirt}<span>切换造型</span></button>
                </div>`;
            document.body.appendChild(pop);
            this._pop = pop;
            this._popGenId = CM ? CM._activeNodeId : null;
            this._popAnchor = anchorEl || null;
            ['mousedown', 'wheel', 'contextmenu', 'dblclick'].forEach(t => pop.addEventListener(t, (e) => e.stopPropagation()));
            pop.addEventListener('click', (e) => {
                e.stopPropagation();
                const it = e.target.closest('.char-refpop-item');
                const b = e.target.closest('[data-act]');
                if (it) {
                    const r = refs[parseInt(it.dataset.i, 10)];
                    this.closeRefPopover();
                    if (r && CM && CM._openFullscreenViewer) CM._openFullscreenViewer(r.url, null);
                    return;
                }
                if (!b) return;
                if (b.dataset.act === 'pop-close') return this.closeRefPopover();
                if (b.dataset.act === 'pop-open') { this.closeRefPopover(); return this.openCharacter(node.characterId, node); }
                if (b.dataset.act === 'pop-wd') {
                    const br = b.getBoundingClientRect();
                    this.closeRefPopover();
                    this.showWardrobeMenu(node, { clientX: br.left, clientY: br.top });
                }
            });
            // 定位：优先在聚合项上方，空间不足放下方；水平夹在视口内
            const ar = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : { left: 100, top: 300, bottom: 300 };
            const pr = pop.getBoundingClientRect();
            let top = ar.top - pr.height - 10;
            if (top < 10) top = Math.min(window.innerHeight - pr.height - 10, ar.bottom + 10);
            const left = Math.max(10, Math.min(ar.left - 12, window.innerWidth - pr.width - 10));
            pop.style.left = Math.round(left) + 'px';
            pop.style.top = Math.round(Math.max(10, top)) + 'px';
            this._popOutside = (e) => {
                if (!this._pop || this._pop.contains(e.target)) return;
                if (this._popAnchor && this._popAnchor.contains(e.target)) return;
                this.closeRefPopover();
            };
            this._popKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeRefPopover(); } };
            document.addEventListener('mousedown', this._popOutside, true);
            document.addEventListener('keydown', this._popKey, true);
        },
        closeRefPopover() {
            if (this._pop) { this._pop.remove(); this._pop = null; }
            this._popAnchor = null;
            if (this._popOutside) document.removeEventListener('mousedown', this._popOutside, true);
            if (this._popKey) document.removeEventListener('keydown', this._popKey, true);
            this._popOutside = this._popKey = null;
        },
        isRefPopoverOpen() { return !!this._pop; },

        // ================= 存为角色（来自画布节点）=================
        _imageOfNode(b) {
            if (!b || b.nodeType === 'text' || b.subType === 'character') return null;
            if (b.mediaType === 'video' || b.mediaType === 'audio' || b.status === 'loading' || b.status === 'generating') return null;
            if (!b.imageUrl) return null;
            return { url: b.imageUrl, previewUrl: b.mediumUrl || b.previewUrl || b.imageUrl };
        },
        openCreateFromNodes(ids) {
            const CB = global.CanvasBlocks;
            const imgs = uniq((ids || []).map(id => this._imageOfNode(CB.getById(id))).filter(Boolean).map(x => JSON.stringify(x))).map(s => JSON.parse(s));
            if (!imgs.length) { alert('所选节点中没有可用的图片'); return; }
            if (imgs.length > LIM.refs) alert('一个角色最多 8 张参考图，已取前 8 张');
            const refs = imgs.slice(0, LIM.refs).map((im, i) => ({ url: im.url, previewUrl: im.previewUrl, role: i === 0 ? 'face' : 'other', note: '' }));
            this.open();
            this._editDraft({ id: '', name: '', aliases: [], description: '', anchors: [], styleTag: '', refs, wardrobe: [], _ingest: true });
        },
        openCharacter(charId, node) {
            const c = this.get(charId);
            this.open();
            if (!c) {
                alert('该角色已从角色库删除，节点保留离线快照');
                this._showList();
                return;
            }
            this._editDraft(JSON.parse(JSON.stringify(c)));
        },
        showWardrobeMenu(node, ev) {
            const CM = global.CanvasMain;
            const c = this.get(node.characterId);
            const wds = c ? (c.wardrobe || []) : ((node.charSnapshot && node.charSnapshot.wd) ? [node.charSnapshot.wd] : []);
            const r = ev && ev.target && ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : null;
            const x = r ? r.left : (ev ? ev.clientX : 200), y = r ? r.bottom + 4 : (ev ? ev.clientY : 200);
            const pick = (wid) => {
                const CB = global.CanvasBlocks;
                const patch = { wardrobeId: wid };
                if (c) {
                    const cover = this._coverOf(c, wid);
                    if (cover) Object.assign(patch, { imageUrl: cover.url, previewUrl: cover.previewUrl || cover.url, mediumUrl: cover.previewUrl || cover.url });
                    patch.charSnapshot = this._snapshot(c, wid);
                }
                CB.update(node.id, patch);
                if (CM && CM.onEdgesChange) CM.onEdgesChange();
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            };
            const items = [{ icon: node.wardrobeId ? '' : 'check', label: '默认造型', act: () => pick('') }];
            wds.forEach(w => items.push({ icon: node.wardrobeId === w.id ? 'check' : '', label: esc(w.name), act: () => pick(w.id) }));
            if (!wds.length) items.push({ label: '该角色还没有造型变体', act: () => this.openCharacter(node.characterId, node) });
            if (CM && CM._renderMenu) CM._renderMenu(items, x, y, '切换造型');
        },

        // ================= DOM：导航按钮 / 抽屉 / 提示 =================
        _buildRailButton() {
            const group = document.querySelector('.px-rail .px-rail-group');
            if (!group || document.getElementById('charLibRailBtn')) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'charLibRailBtn';
            btn.className = 'px-rail-item';
            btn.title = '主体库';
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg><span>主体</span>';
            btn.addEventListener('click', () => this.toggle());
            group.appendChild(btn);
        },
        _buildHint() {
            const upper = document.querySelector('#canvasPromptFloat .bottom-upper');
            if (!upper || document.getElementById('charLinkedHint')) return;
            const el = document.createElement('div');
            el.id = 'charLinkedHint';
            el.className = 'char-linked-hint hidden';
            el.innerHTML = '<span class="char-linked-label">已关联角色：</span><span class="char-linked-names px-no-i18n"></span>';
            upper.insertAdjacentElement('afterend', el);
            this._hintEl = el;
        },
        _buildDrawer() {
            const host = document.querySelector('.canvas-app') || document.body;
            const d = document.createElement('aside');
            d.id = 'charDrawer';
            d.className = 'char-drawer hidden';
            d.setAttribute('role', 'dialog');
            d.setAttribute('aria-label', '主体库');
            d.innerHTML = `<div class="char-drawer-head"></div><div class="char-drawer-body"></div><div class="char-drawer-foot"></div>`;
            host.appendChild(d);
            this._drawer = d;
            this._head = d.querySelector('.char-drawer-head');
            this._body = d.querySelector('.char-drawer-body');
            this._foot = d.querySelector('.char-drawer-foot');
            const file = document.createElement('input');
            file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp,image/gif,image/bmp'; file.multiple = true; file.hidden = true; file.id = 'charFileInput';
            d.appendChild(file);
            this._file = file;
            // 抽屉内事件不冒泡到画布（避免触发平移/框选/快捷键删除节点）
            ['mousedown', 'wheel', 'keydown', 'keyup', 'contextmenu', 'dblclick', 'paste', 'copy', 'cut'].forEach(t => d.addEventListener(t, (e) => {
                e.stopPropagation();
                if (t === 'contextmenu') e.preventDefault();
            }));
            d.addEventListener('click', (e) => this._onClick(e));
            d.addEventListener('input', (e) => this._onInput(e));
            d.addEventListener('change', (e) => this._onChange(e));
            d.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.classList.contains('char-anchor-input')) { e.preventDefault(); this._addAnchor(); }
                else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('char-card')) { e.preventDefault(); this.openCharacter(e.target.dataset.id); }
                else if (e.key === 'Escape' && this._view === 'list') this.close();
            });
            d.addEventListener('mousedown', (e) => this._onCardMouseDown(e));
            file.addEventListener('change', () => this._onFiles());
        },
        isOpen() { return !!(this._drawer && !this._drawer.classList.contains('hidden')); },
        open() {
            if (!this._drawer) return;
            this._drawer.classList.remove('hidden');
            const rb = document.getElementById('charLibRailBtn');
            if (rb) rb.classList.add('active-tool');
            if (this._view === 'list') this._showList();
            if (!this._loaded) this.load();
        },
        close() {
            if (!this._drawer) return;
            this._drawer.classList.add('hidden');
            const rb = document.getElementById('charLibRailBtn');
            if (rb) rb.classList.remove('active-tool');
        },
        toggle() { if (this.isOpen()) this.close(); else { this._view = 'list'; this.open(); } },
        _renderIfOpen() { if (this.isOpen() && this._view === 'list') this._showList(); },

        // ---------- 列表 ----------
        _filtered() {
            const q = this._q.trim().toLowerCase();
            if (!q) return this.chars;
            return this.chars.filter(c => String(c.name || '').toLowerCase().includes(q) || (c.aliases || []).some(a => String(a).toLowerCase().includes(q)));
        },
        _assetBadge(c) {
            const s = this._assetSum(c);
            if (!s.total || (!s.active && !s.pending && !s.failed)) return '';
            if (s.pending) return '<span class="char-asset pending" title="入库中…"><i></i></span>';
            if (s.failed) return '<span class="char-asset bad" title="入库失败"><i></i></span>';
            if (s.active >= s.total) return '<span class="char-asset ok" title="已入库素材库：Seedance 视频生成以素材 ID 引用，保持人物一致"><i></i></span>';
            return '<span class="char-asset part" title="部分参考图未入库"><i></i></span>';
        },
        // 编辑页每张参考图的入库状态点（轮询时 _afterAssetChange 就地刷新）
        _refAssetDot(r) {
            let cls = '', tip = '未入库';
            if (r && r.assetId && r.assetStatus === 'active') { cls = 'ok'; tip = '已入库素材库'; }
            else if (r && (r.assetStatus === 'ingesting' || (r.assetId && r.assetStatus === 'processing'))) { cls = 'pending'; tip = '入库中…'; }
            else if (r && r.assetStatus === 'failed') { cls = 'bad'; tip = '入库失败'; }
            else cls = 'none';
            return `<span class="char-asset char-ref-asset ${cls}" title="${tip}"><i></i></span>`;
        },
        _closeBtn() { return `<button type="button" class="char-icon-btn" data-act="close" title="关闭" aria-label="关闭">${IC.x}</button>`; },
        _renderListHead() {
            if (!this._head) return;
            this._head.innerHTML = `<div class="char-head-main"><span class="char-head-icon">${IC.user}</span><span class="char-drawer-title">主体库</span>${this._loaded ? `<span class="char-count-pill" title="角色数量">${this.chars.length}</span>` : ''}</div>${this._closeBtn()}`;
        },
        _cardHtml(c, i) {
            const cv = (c.refs || [])[0];
            const src = cv ? safeUrl(cv.previewUrl || cv.url) : '';
            const nRef = (c.refs || []).length, nWd = (c.wardrobe || []).length;
            return `<div class="char-card" data-id="${esc(c.id)}" tabindex="0" style="--ci:${Math.min(i, 12)}" title="点击编辑；拖到画布创建角色节点">
                <div class="char-card-cover">${src ? `<img src="${esc(src)}" alt="" draggable="false" loading="lazy">` : `<span class="char-card-ph">${IC.user}</span>`}
                    ${this._assetBadge(c)}
                    <span class="char-card-count" title="${nRef} 张参考图">${IC.images}${nRef}</span>
                    <div class="char-card-ops">
                        <button type="button" data-act="card-insert" title="插入画布" aria-label="插入画布">${IC.insert}</button>
                        <button type="button" data-act="card-edit" title="编辑" aria-label="编辑">${IC.edit}</button>
                        <button type="button" data-act="card-menu" title="更多" aria-label="更多">${IC.more}</button>
                    </div>
                    <div class="char-card-info">
                        <span class="char-card-name px-no-i18n">${esc(c.name)}</span>
                        <span class="char-card-meta"><span>${nRef} 张参考图</span>${nWd ? `<i class="char-sep"></i><span>${nWd} 个造型</span>` : ''}</span>
                    </div>
                </div>
            </div>`;
        },
        _listAreaHtml() {
            if (!this._loaded) {
                return `<div class="char-grid" aria-busy="true">${'<div class="char-skel"><div class="char-skel-cover"></div></div>'.repeat(4)}</div>`;
            }
            if (!this.chars.length) {
                return `<div class="char-empty"><div class="char-empty-art">${EMPTY_ART}</div>
                    <div class="char-empty-title">还没有角色</div>
                    <div class="char-empty-desc">把参考图存为角色，在多个镜头中保持人物一致</div>
                    <button type="button" class="char-btn primary" data-act="new">${IC.plus}<span>新建角色</span></button></div>`;
            }
            const list = this._filtered();
            if (!list.length) return `<div class="char-empty small">${IC.search}<div>没有匹配的角色</div></div>`;
            return `<div class="char-grid">${list.map((c, i) => this._cardHtml(c, i)).join('')}</div>`;
        },
        _showList() {
            this._view = 'list';
            this._draft = null;
            if (!this._tab) this._tab = 'char';
            if (this._tab !== 'char') return this._showAssetList();
            this._renderListHead();
            if (this._foot) this._foot.innerHTML = '';
            this._body.innerHTML = `
                ${this._tabsHtml()}
                <div class="char-toolbar">
                    <label class="char-search-wrap">${IC.search}<input type="text" class="char-search" placeholder="搜索角色名称或别名" maxlength="40" value="${esc(this._q)}"></label>
                    <button type="button" class="char-btn primary" data-act="new">${IC.plus}<span>新建角色</span></button>
                </div>
                <div class="char-tip">${IC.hand}<span>拖拽卡片到画布即可创建角色节点</span></div>
                <div class="char-list-area">${this._listAreaHtml()}</div>`;
        },

        // ---------- 编辑 ----------
        _editDraft(draft) {
            this._view = 'edit';
            // 任意一张参考图（含造型图）还没入库（或上次失败）就默认勾选「同时入库素材库」
            draft._ingest = draft._ingest !== undefined ? draft._ingest : this._needIngest(draft);
            draft.refs = draft.refs || []; draft.wardrobe = draft.wardrobe || []; draft.anchors = draft.anchors || []; draft.aliases = draft.aliases || [];
            this._draft = draft;
            this._renderEditor();
            if (draft.id && this._assetSum(draft).pending) this._watchAsset(draft.id);
            setTimeout(() => { const n = this._body.querySelector('[data-f="name"]'); if (n && !draft.name) n.focus(); }, 30);
        },
        _refsHtml(refs, scope) {
            const roleOpts = (cur) => Object.keys(ROLE_LABEL).map(k => `<option value="${k}"${cur === k ? ' selected' : ''}>${ROLE_LABEL[k]}</option>`).join('');
            const isMain = scope === 'main';
            const items = refs.map((r, i) => `
                <div class="char-ref${i === 0 && isMain ? ' is-cover' : ''}" data-scope="${scope}" data-i="${i}">
                    <div class="char-ref-thumb">
                        <img src="${esc(safeUrl(r.previewUrl || r.url))}" alt="" draggable="false">
                        ${this._draft && !this._draft._kind ? this._refAssetDot(r) : ''}
                        ${i === 0 && isMain ? '<span class="char-ref-cover">封面</span>' : ''}
                        <div class="char-ref-ops">
                            ${isMain && i > 0 ? `<button type="button" data-act="ref-cover" data-scope="${scope}" data-i="${i}" title="设为封面" aria-label="设为封面">${IC.star}</button>` : ''}
                            <button type="button" data-act="ref-del" data-scope="${scope}" data-i="${i}" title="删除" aria-label="删除">${IC.x}</button>
                        </div>
                    </div>
                    <select class="char-ref-role" data-scope="${scope}" data-i="${i}" title="参考图类型">${roleOpts(r.role || 'other')}</select>
                </div>`).join('');
            const full = refs.length >= LIM.refs;
            return `<div class="char-refs">${items || `<div class="char-refs-empty">${isMain ? '还没有参考图，从画布选中或本地上传' : '可选：为该造型添加专属参考图'}</div>`}</div>
                <div class="char-ref-actions">
                    <button type="button" class="char-btn small" data-act="ref-add-sel" data-scope="${scope}"${full ? ' disabled' : ''}>${IC.cursor}<span>从画布选中添加</span></button>
                    <button type="button" class="char-btn small" data-act="ref-upload" data-scope="${scope}"${full ? ' disabled' : ''}>${IC.upload}<span>本地上传</span></button>
                </div>`;
        },
        _renderEditHead() {
            const d = this._draft;
            if (!d || !this._head) return;
            const nm = String(d.name || '').trim();
            this._head.innerHTML = `<button type="button" class="char-icon-btn char-back" data-act="back" title="返回角色列表" aria-label="返回角色列表">${IC.back}</button>
                <div class="char-head-main">${nm ? `<span class="char-drawer-title px-no-i18n">${esc(nm)}</span>` : `<span class="char-drawer-title">${d.id ? '编辑角色' : '新建角色'}</span>`}</div>${this._closeBtn()}`;
        },
        _renderFoot() {
            const d = this._draft;
            if (!d || !this._foot) return;
            this._foot.innerHTML = `${d.id ? `<button type="button" class="char-btn danger" data-act="delete" title="删除角色">${IC.trash}<span>删除</span></button>
                <button type="button" class="char-btn" data-act="insert">${IC.insert}<span>插入画布</span></button>` : ''}
                <button type="button" class="char-btn primary${this._saving ? ' loading' : ''}" data-act="save"><span>${this._saving ? '保存中…' : '保存'}</span></button>`;
        },
        _sec(icon, title, sub, inner, extra) {
            return `<section class="char-sec"${extra || ''}><div class="char-sec-head">${icon}<span class="char-sec-title">${title}</span>${sub ? `<span class="char-sub">${sub}</span>` : ''}</div>${inner}</section>`;
        },
        _assetStatusOf(d) {
            const s = this._assetSum(d);
            if (!s.total || (!s.active && !s.pending && !s.failed)) return { cls: '', txt: '' };
            if (s.pending) return { cls: '', txt: `入库中… ${s.active}/${s.total} 张已完成` };
            if (s.failed) return { cls: 'bad', txt: `${s.failed} 张入库失败`, retry: true };
            if (s.active >= s.total) return { cls: 'ok', txt: `已入库素材库 ${s.active}/${s.total} 张` };
            return { cls: '', txt: `已入库素材库 ${s.active}/${s.total} 张`, retry: true };
        },
        _assetStatusHtml(d) {
            const st = this._assetStatusOf(d);
            return `<div class="char-asset-row"><div class="char-asset-status ${st.cls}">${st.txt}</div>${st.retry && d.id ? '<button type="button" class="char-btn small" data-act="asset-retry">重试入库</button>' : ''}</div>`;
        },
        _needIngest(c) {
            const s = this._assetSum(c);
            return s.total > s.active + s.pending;
        },
        _renderEditor() {
            const d = this._draft;
            if (!d) return;
            if (d._kind) return this._renderAssetEditor();
            const anchors = d.anchors.map((a, i) => `<span class="char-chip"><span class="px-no-i18n">${esc(a)}</span><button type="button" data-act="anchor-del" data-i="${i}" title="删除" aria-label="删除">${IC.x}</button></span>`).join('');
            const wds = d.wardrobe.map((w, wi) => `
                <div class="char-wd" data-wi="${wi}">
                    <div class="char-wd-head">
                        <input type="text" class="char-input" data-wf="name" data-wi="${wi}" maxlength="${LIM.wdName}" placeholder="造型名称，如：校服" value="${esc(w.name)}">
                        <button type="button" class="char-icon-btn danger" data-act="wd-del" data-wi="${wi}" title="删除造型" aria-label="删除造型">${IC.trash}</button>
                    </div>
                    <input type="text" class="char-input" data-wf="description" data-wi="${wi}" maxlength="${LIM.wdDesc}" placeholder="造型描述，如：蓝白水手服、红色领结" value="${esc(w.description)}">
                    ${this._refsHtml(w.refs || [], 'wd' + wi)}
                </div>`).join('');
            const top = this._body.scrollTop;
            this._renderEditHead();
            this._renderFoot();
            this._body.innerHTML = `
                <div class="char-edit">
                    ${this._sec(IC.card, '基本信息', '', `
                        <label class="char-label">名称<span class="char-req">*</span></label>
                        <input type="text" class="char-input" data-f="name" maxlength="${LIM.name}" placeholder="角色名称（必填）" value="${esc(d.name)}">
                        <label class="char-label">别名（逗号分隔）</label>
                        <input type="text" class="char-input" data-f="aliases" maxlength="300" placeholder="如：小银，Silver" value="${esc((d.aliases || []).join('，'))}">
                        <div class="char-label-row"><label class="char-label">描述</label><button type="button" class="char-btn small lime-soft" data-act="ai-desc" title="根据参考图生成人物设定描述并追加">${IC.spark}<span>AI 添加描述</span></button></div>
                        <textarea class="char-input char-textarea" data-f="description" maxlength="${LIM.description}" placeholder="外观 / 性格简述（最多 500 字）">${esc(d.description)}</textarea>
                        <label class="char-label">画风标签</label>
                        <input type="text" class="char-input" data-f="styleTag" maxlength="${LIM.styleTag}" placeholder="如：日系动漫 / 写实摄影（可空）" value="${esc(d.styleTag)}">`)}
                    ${this._sec(IC.tag, '辨识特征', '2-5 个跨角度可辨识的特征', `
                        <div class="char-chips">${anchors || '<span class="char-chips-empty">输入特征后按回车添加</span>'}</div>
                        ${d.anchors.length < LIM.anchors ? `<div class="char-anchor-row"><input type="text" class="char-anchor-input" maxlength="${LIM.anchor}" placeholder="如：左眉有疤"><button type="button" class="char-btn small" data-act="anchor-add">${IC.plus}<span>添加</span></button></div>` : ''}`)}
                    ${this._sec(IC.image, '参考图', '最多 8 张，第一张为封面', this._refsHtml(d.refs, 'main') + this._turnHtml(d))}
                    ${this._sec(IC.shirt, '造型变体', '最多 10 个，可有自己的参考图', `
                        ${wds ? `<div class="char-wds">${wds}</div>` : ''}
                        ${d.wardrobe.length < LIM.wardrobe ? `<button type="button" class="char-btn dashed" data-act="wd-add">${IC.plus}<span>添加造型</span></button>` : ''}`)}
                    ${this._sec(IC.sliders, '高级', '', `
                        <label class="char-check"><input type="checkbox" data-f="_ingest"${d._ingest ? ' checked' : ''}><span class="char-switch"></span><span>同时入库素材库（视频模型角色一致性）</span></label>
                        ${this._assetStatusHtml(d)}`)}
                </div>`;
            this._body.scrollTop = top;
        },
        // 多视角（第四期）：生成转身设定图 / 8 视角序列；已有 ≥4 张带角度的序列帧时可 360° 拖拽查看
        _turnHtml(d) {
            if (!global.CanvasPano) return '';
            const fr = (d.turnaround || []).filter(f => f && f.url);
            const TURN_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="6.5" r="2.6"/><path d="M8.5 21v-5.5a3.5 3.5 0 0 1 7 0V21"/><path d="M3 13.5c0 2.6 4 4.6 9 4.6s9-2 9-4.6"/><path d="m18.6 16.4 2.4 1.2-1.1 2.4"/></svg>';
            return `<div class="char-turn">
                ${fr.length ? `<div class="char-turn-row">${fr.map(f => `<img src="${esc(safeUrl(f.previewUrl || f.url))}" alt="" title="${esc(f.note || '')}" draggable="false">`).join('')}</div>` : ''}
                <div class="char-turn-actions">
                    <button type="button" class="char-btn small lime-soft" data-act="turn-gen">${TURN_IC}<span>生成多视角</span></button>
                    ${fr.length >= 4 ? `<button type="button" class="char-btn small" data-act="turn-view">${IC.images}<span>360° 查看</span></button><button type="button" class="char-btn small" data-act="turn-clear" title="清除多视角序列（保存后生效）">${IC.trash}<span>清除</span></button>` : ''}
                </div></div>`;
        },
        _refsOf(scope) {
            const d = this._draft;
            if (scope === 'main') return d.refs;
            const wi = parseInt(String(scope).slice(2), 10);
            const w = d.wardrobe[wi];
            if (!w) return null;
            w.refs = w.refs || [];
            return w.refs;
        },
        _addAnchor() {
            const inp = this._body.querySelector('.char-anchor-input');
            if (!inp || !this._draft) return;
            const v = inp.value.trim().slice(0, LIM.anchor);
            if (!v) return;
            if (!this._draft.anchors.includes(v) && this._draft.anchors.length < LIM.anchors) this._draft.anchors.push(v);
            this._renderEditor();
            const ni = this._body.querySelector('.char-anchor-input');
            if (ni) ni.focus();
        },
        // 「AI 添加描述」：把角色参考图交给服务端，由 Gemini vision 生成人物设定描述并追加
        async _aiDescribe(btn) {
            const d = this._draft;
            if (!d || this._aiDescBusy) return;
            const refs = (d.refs || []).filter(r => r && (r.url || r.previewUrl));
            if (!refs.length) return toast('请先在「参考图」里添加至少一张角色图', 'warn');
            this._aiDescBusy = true;
            const old = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span>AI 生成中…</span>';
            try {
                const urls = refs.slice(0, 3).map(r => r.url || r.previewUrl);
                const lang = (typeof global.getCurrentLang === 'function' ? global.getCurrentLang() : (localStorage.getItem('nano_lang') === 'en' ? 'en' : 'zh'));
                const base = (global.API_CONFIG && global.API_CONFIG.baseUrl) || '';
                const res = await fetch(base + '/api/director/describe-character', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, typeof global.authHeaders === 'function' ? global.authHeaders() : {}),
                    body: JSON.stringify({ name: d.name, styleTag: d.styleTag, anchors: d.anchors, images: urls, lang: lang })
                });
                const j = await res.json().catch(() => null);
                if (!res.ok || !j || j.code !== 0 || !(j.data && j.data.description)) {
                    throw new Error((j && j.msg) || 'AI 生成描述失败，请稍后重试');
                }
                const gen = String(j.data.description).trim();
                const cur = String(d.description || '').trim();
                d.description = (cur ? cur + '\n' + gen : gen).slice(0, LIM.description);
                const ta = this._body.querySelector('textarea[data-f="description"]');
                if (ta) ta.value = d.description;
                toast(cur ? '已根据参考图追加描述' : '已根据参考图生成描述', 'ok');
            } catch (e) {
                toast((e && e.message) || 'AI 生成描述失败，请稍后重试', 'warn');
            } finally {
                this._aiDescBusy = false;
                if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; }
            }
        },
        _onInput(e) {
            const t = e.target;
            if (t.classList.contains('char-search')) {
                this._q = t.value;
                clearTimeout(this._qTimer);
                this._qTimer = setTimeout(() => {
                    const area = this._body.querySelector('.char-list-area');
                    if (area) area.innerHTML = this._tab === 'char' ? this._listAreaHtml() : this._alListHtml(); else this._showList();
                }, 160);
                return;
            }
            const d = this._draft;
            if (!d) return;
            if (t.dataset.af) {
                if (t.dataset.af === 'tags') d.tags = t.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
                else d[t.dataset.af] = t.value;
                if (t.dataset.af === 'name') this._renderAssetHead();
                return;
            }
            if (t.dataset.f && t.dataset.f !== '_ingest') {
                if (t.dataset.f === 'aliases') d.aliases = t.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, LIM.aliases);
                else d[t.dataset.f] = t.value;
                if (t.dataset.f === 'name') this._renderEditHead();
            } else if (t.dataset.wf) {
                const w = d.wardrobe[parseInt(t.dataset.wi, 10)];
                if (w) w[t.dataset.wf] = t.value;
            }
        },
        _onChange(e) {
            const t = e.target, d = this._draft;
            if (!d) return;
            if (t.dataset.f === '_ingest') d._ingest = t.checked;
            if (t.classList.contains('char-ref-role')) {
                const refs = this._refsOf(t.dataset.scope);
                const r = refs && refs[parseInt(t.dataset.i, 10)];
                if (r) r.role = t.value;
            }
        },
        _onClick(e) {
            const btn = e.target.closest('[data-act]');
            if (!btn) {
                const card = e.target.closest('.char-card');
                if (card && !this._dragMoved) {
                    if (card.dataset.kind && card.dataset.kind !== 'char') this._openAsset(card.dataset.id);
                    else this.openCharacter(card.dataset.id);
                }
                return;
            }
            const act = btn.dataset.act;
            const d = this._draft;
            if (act === 'tab') return this._switchTab(btn.dataset.v);
            if (act && act.indexOf('al-') === 0) return this._alClick(act, btn, e);
            if (act === 'close') return this.close();
            if (act === 'new') return this._editDraft({ id: '', name: '', aliases: [], description: '', anchors: [], styleTag: '', refs: [], wardrobe: [], _ingest: true });
            if (act === 'back') return this._showList();
            if (act === 'card-insert' || act === 'card-edit') {
                e.stopPropagation();
                const id = btn.closest('.char-card').dataset.id;
                if (act === 'card-edit') return this.openCharacter(id);
                if (this.insertAtViewportCenter(id)) toast('已插入画布', 'ok');
                return;
            }
            if (act === 'card-menu') {
                e.stopPropagation();
                const id = btn.closest('.char-card').dataset.id;
                const r = btn.getBoundingClientRect();
                const CM = global.CanvasMain;
                const items = [
                    { icon: 'image', label: '插入画布', act: () => this.insertAtViewportCenter(id) },
                    { icon: 'gear', label: '编辑', act: () => this.openCharacter(id) },
                    { sep: true },
                    { icon: 'trash', label: '删除', danger: true, act: () => this._delete(id) }
                ];
                if (CM && CM._renderMenu) {
                    CM._renderMenu(items, r.left - 120, r.bottom + 4);
                    // 本次 click 冒泡到 document 时不要立即关闭刚弹出的菜单
                    CM._suppressMenuHideOnce = true;
                }
                return;
            }
            if (!d) return;
            if (act === 'asset-retry') { if (d.id) this._ingest(d.id); return; }
            if (act === 'ai-desc') return this._aiDescribe(btn);
            if (act === 'anchor-add') return this._addAnchor();
            if (act === 'anchor-del') { d.anchors.splice(parseInt(btn.dataset.i, 10), 1); return this._renderEditor(); }
            if (act === 'ref-del' || act === 'ref-cover') {
                const refs = this._refsOf(btn.dataset.scope);
                const i = parseInt(btn.dataset.i, 10);
                if (!refs || !refs[i]) return;
                const [r] = refs.splice(i, 1);
                if (act === 'ref-cover') refs.unshift(r);
                return this._renderEditor();
            }
            if (act === 'ref-add-sel') {
                const refs = this._refsOf(btn.dataset.scope);
                const CB = global.CanvasBlocks;
                const ids = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
                const imgs = ids.map(id => this._imageOfNode(CB.getById(id))).filter(Boolean);
                if (!imgs.length) { alert('请先在画布上选中图片节点'); return; }
                let added = 0;
                imgs.forEach(im => {
                    if (refs.length >= LIM.refs || refs.some(r => r.url === im.url)) return;
                    refs.push({ url: im.url, previewUrl: im.previewUrl, role: refs.length === 0 && btn.dataset.scope === 'main' ? 'face' : 'other', note: '' });
                    added++;
                });
                if (!added) alert('所选图片已在参考图中或已达 8 张上限');
                return this._renderEditor();
            }
            if (act === 'ref-upload') { this._uploadScope = btn.dataset.scope; this._file.value = ''; this._file.click(); return; }
            if (act === 'wd-add') {
                if (d.wardrobe.length >= LIM.wardrobe) return;
                d.wardrobe.push({ id: '', name: '', description: '', refs: [] });
                this._renderEditor();
                const ins = this._body.querySelectorAll('[data-wf="name"]');
                if (ins.length) ins[ins.length - 1].focus();
                return;
            }
            if (act === 'wd-del') { d.wardrobe.splice(parseInt(btn.dataset.wi, 10), 1); return this._renderEditor(); }
            if (act === 'save') return this._save();
            if (act === 'turn-gen') {
                if (!d.id || !this.get(d.id)) { alert('请先保存角色，再生成多视角'); return; }
                if (global.CanvasPano) global.CanvasPano.turnaroundDialog(d.id);
                return;
            }
            if (act === 'turn-view') { if (global.CanvasPano) global.CanvasPano.openSequenceViewer(d.turnaround || [], d.name); return; }
            if (act === 'turn-clear') { d.turnaround = []; return this._renderEditor(); }
            if (act === 'insert') { if (d.id) this.insertAtViewportCenter(d.id); return; }
            if (act === 'delete') { if (d.id) this._delete(d.id); return; }
        },
        async _onFiles() {
            const files = Array.from(this._file.files || []);
            const scope = this._uploadScope;
            if (!files.length || !this._draft) return;
            const CG = global.CanvasGenerate;
            if (!CG || !CG.uploadRef) return;
            for (const f of files) {
                const refs = this._refsOf(scope);
                if (!refs || refs.length >= LIM.refs) { alert('一个角色最多 8 张参考图'); break; }
                try {
                    this._setBusy(true);
                    const r = await CG.uploadRef(f);
                    refs.push({ url: r.highUrl, previewUrl: r.mediumUrl || r.previewUrl || r.highUrl, role: refs.length === 0 && scope === 'main' && !(this._draft && this._draft._kind) ? 'face' : 'other', note: '' });
                    this._renderEditor();
                } catch (err) {
                    alert('上传失败：' + (err.message || ''));
                } finally { this._setBusy(false); }
            }
        },
        _setBusy(b) { if (this._drawer) this._drawer.classList.toggle('busy', !!b); },
        _payload(d) {
            return {
                name: String(d.name || '').trim(),
                aliases: (d.aliases || []).slice(0, LIM.aliases),
                description: String(d.description || '').trim(),
                anchors: (d.anchors || []).slice(0, LIM.anchors),
                styleTag: String(d.styleTag || '').trim(),
                refs: (d.refs || []).slice(0, LIM.refs).map(r => ({ url: r.url, previewUrl: r.previewUrl || r.url, role: r.role || 'other', note: r.note || '', assetId: r.assetId || '', assetStatus: r.assetStatus || '' })),
                turnaround: (d.turnaround || []).filter(f => f && f.url).slice(0, 8).map(f => ({ url: f.url, previewUrl: f.previewUrl || f.url, note: f.note || '' })),
                wardrobe: (d.wardrobe || []).filter(w => String(w.name || '').trim()).slice(0, LIM.wardrobe).map(w => ({
                    id: w.id || undefined, name: String(w.name).trim(), description: String(w.description || '').trim(),
                    refs: (w.refs || []).slice(0, LIM.refs).map(r => ({ url: r.url, previewUrl: r.previewUrl || r.url, role: r.role || 'other', note: r.note || '', assetId: r.assetId || '', assetStatus: r.assetStatus || '' }))
                }))
            };
        },
        async _save() {
            const d = this._draft;
            if (!d || this._saving) return;
            const p = this._payload(d);
            if (!p.name) { alert('请填写角色名称'); return; }
            if ((d.wardrobe || []).some(w => !String(w.name || '').trim() && ((w.refs || []).length || String(w.description || '').trim()))) { alert('请填写造型名称'); return; }
            this._saving = true;
            this._setBusy(true);
            this._renderFoot();
            try {
                const saved = d.id ? await this._api('PUT', '/' + encodeURIComponent(d.id), p) : await this._api('POST', '', p);
                this._upsert(saved);
                const wantIngest = !!d._ingest && this._needIngest(saved);
                toast(d.id ? '角色已保存' : '角色已创建', 'ok');
                this.refreshNodes();
                this._saving = false;
                // 保留用户的「同时入库」选择：留在编辑页继续加图再保存时，新图也会入库
                this._editDraft(Object.assign(JSON.parse(JSON.stringify(saved)), { _ingest: !!d._ingest }));
                if (wantIngest) this._ingest(saved.id);
            } catch (e) {
                toast('保存失败：' + (e.message || ''), 'warn');
            } finally {
                this._saving = false;
                this._setBusy(false);
                if (this._view === 'edit') this._renderFoot();
            }
        },
        async _delete(id) {
            const c = this.get(id);
            if (!c) return;
            if (!confirm('确定删除角色「' + c.name + '」？画布中已有的角色节点会保留快照。')) return;
            try {
                await this._api('DELETE', '/' + encodeURIComponent(id));
                this.chars = this.chars.filter(x => x.id !== id);
                this._byId.delete(id);
                alert('角色已删除');
                this._showList();
                if (global.CanvasMain && global.CanvasMain.onEdgesChange) global.CanvasMain.onEdgesChange();
            } catch (e) {
                alert('删除失败：' + (e.message || ''));
            }
        },
        // 入库素材库：由服务端逐张入库（含造型参考图），每张图的 assetId/assetStatus 按 url 写回各自的图；
        // 前端只触发 + 轮询读取（不再用本地快照 PUT 整个 refs，避免与用户编辑互相覆盖）；失败不影响角色使用
        async _ingest(id) {
            const c = this.get(id);
            if (!c || !this._assetSum(c).total) return;
            try {
                const s = await this._api('POST', '/' + encodeURIComponent(id) + '/ingest', {});
                if (s) { this._upsert(s); this._afterAssetChange(id); }
            } catch (e) {
                toast('素材入库失败：' + (e.message || ''), 'warn');
                return;
            }
            this._watchAsset(id);
        },
        // 轮询角色直到没有「入库中 / 处理中」的图（最长 15 分钟；关闭页面后服务端仍会继续）
        _watchAsset(id) {
            if (this._ingestTimers[id]) return;
            const t0 = Date.now();
            const tick = async () => {
                let c = null;
                try { c = await this._api('GET', '/' + encodeURIComponent(id)); } catch (e) { if (/不存在|404/.test(e.message || '')) c = null; else c = this.get(id); }
                if (!c) { clearInterval(this._ingestTimers[id]); delete this._ingestTimers[id]; return; }
                this._upsert(c);
                this._afterAssetChange(id);
                const s = this._assetSum(c);
                if (!s.pending || Date.now() - t0 > 15 * 60 * 1000) {
                    clearInterval(this._ingestTimers[id]); delete this._ingestTimers[id];
                    this.refreshNodes();
                    if (s.failed) toast('部分参考图素材入库失败，可点「重试入库」', 'warn');
                }
            };
            this._ingestTimers[id] = setInterval(tick, 4000);
        },
        _afterAssetChange(id) {
            if (this._view === 'list') {
                // 列表只就地刷新该卡片的入库角标（不整页重绘，避免打断搜索输入）
                const card = this._body && Array.from(this._body.querySelectorAll('.char-card[data-id]')).find(el => el.dataset.id === id && !el.dataset.kind);
                const c = this.get(id);
                if (!card || !c) return;
                const old = card.querySelector('.char-asset');
                const html = this._assetBadge(c);
                if (old) old.outerHTML = html;
                else if (html) { const cv = card.querySelector('.char-card-cover'); if (cv) cv.insertAdjacentHTML('afterbegin', html); }
            }
            else if (this._draft && this._draft.id === id) {
                const c = this.get(id);
                if (!c) return;
                this._draft.assetId = c.assetId; this._draft.assetStatus = c.assetStatus; this._draft.assetUrl = c.assetUrl;
                // 只同步入库字段（按 url 对应），不动用户正在编辑的其它内容
                const srv = new Map();
                (c.refs || []).concat(...(c.wardrobe || []).map(w => (w && w.refs) || [])).forEach(x => { if (x && x.url && !srv.has(x.url)) srv.set(x.url, x); });
                const sync = (r) => { const m = r && srv.get(r.url); if (m) { r.assetId = m.assetId || ''; r.assetStatus = m.assetStatus || ''; } };
                (this._draft.refs || []).forEach(sync);
                (this._draft.wardrobe || []).forEach(w => (w.refs || []).forEach(sync));
                if (!this._body) return;
                this._body.querySelectorAll('.char-ref[data-scope]').forEach(el => {
                    const refs = this._refsOf(el.dataset.scope);
                    const r = refs && refs[parseInt(el.dataset.i, 10)];
                    const dot = el.querySelector('.char-ref-asset');
                    if (r && dot) dot.outerHTML = this._refAssetDot(r);
                });
                const row = this._body.querySelector('.char-asset-row');
                if (row) row.outerHTML = this._assetStatusHtml(this._draft);
            }
        },

        // ================= 主体库：场景 / 道具（通用资源） =================
        _kindConf(tab) { return ASSET_KINDS[tab] || ASSET_KINDS.char; },
        _itemsOf(tab) { return tab === 'scene' ? (this.scenes || []) : (tab === 'prop' ? (this.props || []) : (this.chars || [])); },
        _tabsHtml() {
            const cur = this._tab || 'char';
            return `<div class="char-tabs">${Object.keys(ASSET_KINDS).map(k => `<button type="button" class="char-tab${k === cur ? ' on' : ''}" data-act="tab" data-v="${k}">${ASSET_KINDS[k].label}</button>`).join('')}</div>`;
        },
        _switchTab(tab) {
            if (!ASSET_KINDS[tab]) tab = 'char';
            if (this._tab === tab) return;
            this._tab = tab; this._q = ''; this._showList();
        },
        async _apiKind(api, method, path, body) {
            const headers = Object.assign({ 'Content-Type': 'application/json' }, typeof global.authHeaders === 'function' ? global.authHeaders() : {});
            const res = await fetch(this._base() + api + (path || ''), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            let j = null;
            try { j = await res.json(); } catch (_) { /* 非 JSON */ }
            if (!res.ok || !j || j.code !== 0) throw new Error((j && j.msg) || ('请求失败: ' + res.status));
            return j.data;
        },
        _loadTab(tab) {
            if (tab === 'char') return this.load();
            if (this._kLoaded[tab]) return Promise.resolve(this._itemsOf(tab));
            if (this._kLoading[tab]) return this._kLoading[tab];
            this._kLoading[tab] = this._apiKind(this._kindConf(tab).api, 'GET', '')
                .then(list => { if (tab === 'scene') this.scenes = Array.isArray(list) ? list : []; else this.props = Array.isArray(list) ? list : []; this._kLoaded[tab] = true; })
                .catch(e => { console.warn('[主体库] 加载失败:', e.message); this._kLoaded[tab] = true; if (tab === 'scene') this.scenes = this.scenes || []; else this.props = this.props || []; })
                .finally(() => { delete this._kLoading[tab]; });
            return this._kLoading[tab];
        },
        _showAssetList() {
            this._view = 'list';
            this._draft = null;
            const tab = this._tab, conf = this._kindConf(tab);
            this._head.innerHTML = `<div class="char-head-main"><span class="char-head-icon">${conf.icon}</span><span class="char-drawer-title">主体库</span>${this._kLoaded[tab] ? `<span class="char-count-pill" title="${conf.label}数量">${this._itemsOf(tab).length}</span>` : ''}</div>${this._closeBtn()}`;
            if (this._foot) this._foot.innerHTML = '';
            this._body.innerHTML = `${this._tabsHtml()}<div class="char-toolbar"><label class="char-search-wrap">${IC.search}<input type="text" class="char-search" placeholder="搜索${conf.label}名称" maxlength="40" value="${esc(this._q)}"></label><button type="button" class="char-btn primary" data-act="al-new">${IC.plus}<span>新建${conf.label}</span></button></div><div class="char-tip">${IC.hand}<span>点击卡片编辑；插入画布后可连到生成节点作参考图</span></div><div class="char-list-area">${this._alListHtml()}</div>`;
            if (!this._kLoaded[tab] && !this._kLoading[tab]) this._loadTab(tab).then(() => { if (this._view === 'list' && this._tab === tab) this._showAssetList(); });
        },
        _alListHtml() {
            const tab = this._tab, list = this._itemsOf(tab), conf = this._kindConf(tab);
            if (!this._kLoaded[tab]) return `<div class="char-grid" aria-busy="true">${'<div class="char-skel"><div class="char-skel-cover"></div></div>'.repeat(4)}</div>`;
            if (!list.length) return `<div class="char-empty"><div class="char-empty-art">${EMPTY_ART}</div><div class="char-empty-title">还没有${conf.label}</div><div class="char-empty-desc">保存${conf.label}参考图，在多个分镜中保持${conf.label}一致</div><button type="button" class="char-btn primary" data-act="al-new">${IC.plus}<span>新建${conf.label}</span></button></div>`;
            const q = this._q.trim().toLowerCase();
            const f = q ? list.filter(x => String(x.name || '').toLowerCase().includes(q) || (x.tags || []).some(t => String(t).toLowerCase().includes(q))) : list;
            if (!f.length) return `<div class="char-empty small">${IC.search}<div>没有匹配的${conf.label}</div></div>`;
            return `<div class="char-grid">${f.map((x, i) => this._alCard(x, i)).join('')}</div>`;
        },
        _alCard(c, i) {
            const cv = (c.refs || [])[0];
            const src = cv ? safeUrl(cv.previewUrl || cv.url) : '';
            const nRef = (c.refs || []).length;
            return `<div class="char-card" data-id="${esc(c.id)}" data-kind="${this._tab}" tabindex="0" style="--ci:${Math.min(i, 12)}" title="点击编辑">
                <div class="char-card-cover">${src ? `<img src="${esc(src)}" alt="" draggable="false" loading="lazy">` : `<span class="char-card-ph">${this._kindConf(this._tab).icon}</span>`}
                    <span class="char-card-count" title="${nRef} 张参考图">${IC.images}${nRef}</span>
                    <div class="char-card-ops"><button type="button" data-act="al-card-insert" title="插入画布" aria-label="插入画布">${IC.insert}</button><button type="button" data-act="al-card-edit" title="编辑" aria-label="编辑">${IC.edit}</button></div>
                    <div class="char-card-info"><span class="char-card-name px-no-i18n">${esc(c.name)}</span><span class="char-card-meta"><span>${nRef} 张参考图</span></span></div>
                </div></div>`;
        },
        _openAsset(id) {
            const item = this._itemsOf(this._tab).find(x => x.id === id);
            if (!item) return;
            this._editAssetDraft(Object.assign(JSON.parse(JSON.stringify(item)), { _kind: this._tab }));
        },
        _editAssetDraft(draft) {
            this._view = 'edit';
            draft.refs = draft.refs || []; draft.tags = draft.tags || [];
            this._draft = draft;
            this._renderAssetEditor();
            setTimeout(() => { const n = this._body.querySelector('[data-af="name"]'); if (n && !draft.name) n.focus(); }, 30);
        },
        _renderAssetHead() {
            const d = this._draft;
            if (!d || !this._head) return;
            const conf = this._kindConf(d._kind), nm = String(d.name || '').trim();
            this._head.innerHTML = `<button type="button" class="char-icon-btn char-back" data-act="al-back" title="返回主体库" aria-label="返回主体库">${IC.back}</button><div class="char-head-main">${nm ? `<span class="char-drawer-title px-no-i18n">${esc(nm)}</span>` : `<span class="char-drawer-title">${d.id ? '编辑' : '新建'}${conf.label}</span>`}</div>${this._closeBtn()}`;
        },
        _renderAssetFoot() {
            const d = this._draft;
            if (!d || !this._foot) return;
            this._foot.innerHTML = `${d.id ? `<button type="button" class="char-btn danger" data-act="al-delete" title="删除">${IC.trash}<span>删除</span></button><button type="button" class="char-btn" data-act="al-insert">${IC.insert}<span>插入画布</span></button>` : ''}<button type="button" class="char-btn primary${this._saving ? ' loading' : ''}" data-act="al-save"><span>${this._saving ? '保存中…' : '保存'}</span></button>`;
        },
        _alRefsHtml(refs) {
            const items = refs.map((r, i) => `<div class="char-ref${i === 0 ? ' is-cover' : ''}" data-i="${i}"><div class="char-ref-thumb"><img src="${esc(safeUrl(r.previewUrl || r.url))}" alt="" draggable="false">${i === 0 ? '<span class="char-ref-cover">封面</span>' : ''}<div class="char-ref-ops"><button type="button" data-act="al-ref-del" data-i="${i}" title="删除" aria-label="删除">${IC.x}</button></div></div></div>`).join('');
            const full = refs.length >= LIM.refs;
            return `<div class="char-refs">${items || '<div class="char-refs-empty">还没有参考图，从画布选中或本地上传</div>'}</div><div class="char-ref-actions"><button type="button" class="char-btn small" data-act="al-ref-add-sel"${full ? ' disabled' : ''}>${IC.cursor}<span>从画布选中添加</span></button><button type="button" class="char-btn small" data-act="al-ref-upload"${full ? ' disabled' : ''}>${IC.upload}<span>本地上传</span></button></div>`;
        },
        _renderAssetEditor() {
            const d = this._draft;
            if (!d) return;
            const conf = this._kindConf(d._kind);
            const top = this._body.scrollTop;
            this._renderAssetHead();
            this._renderAssetFoot();
            const extra = d._kind === 'scene' ? `<label class="char-label">时代 / 年代</label><input type="text" class="char-input" data-af="era" maxlength="40" placeholder="如：民国 / 未来都市" value="${esc(d.era || '')}">
                <label class="char-label">空间类型</label><input type="text" class="char-input" data-af="location" maxlength="40" placeholder="如：室内 / 街道 / 山野" value="${esc(d.location || '')}">
                <div class="char-grid2"><div><label class="char-label">时间</label><input type="text" class="char-input" data-af="timeOfDay" maxlength="20" placeholder="白天 / 黄昏" value="${esc(d.timeOfDay || '')}"></div><div><label class="char-label">天气</label><input type="text" class="char-input" data-af="weather" maxlength="20" placeholder="晴 / 雨" value="${esc(d.weather || '')}"></div></div>` : '';
            this._body.innerHTML = `<div class="char-edit">
                ${this._sec(IC.card, '基本信息', '', `<label class="char-label">名称<span class="char-req">*</span></label><input type="text" class="char-input" data-af="name" maxlength="${LIM.name}" placeholder="${conf.label}名称（必填）" value="${esc(d.name)}"><label class="char-label">描述</label><textarea class="char-input char-textarea" data-af="description" maxlength="${LIM.description}" placeholder="外观 / 氛围 / 材质等（最多 500 字）">${esc(d.description || '')}</textarea>${extra}`)}
                ${this._sec(IC.tag, '标签', '逗号分隔，便于检索', `<input type="text" class="char-input" data-af="tags" maxlength="200" placeholder="如：古董店，木质，暖光" value="${esc((d.tags || []).join('，'))}">`)}
                ${this._sec(IC.image, '参考图', '最多 8 张，第一张为封面', this._alRefsHtml(d.refs || []))}
            </div>`;
            this._body.scrollTop = top;
        },
        async _saveAsset() {
            const d = this._draft;
            if (!d || this._saving) return;
            if (!String(d.name || '').trim()) { alert('请填写名称'); return; }
            const conf = this._kindConf(d._kind);
            const p = {
                name: String(d.name).trim(), description: String(d.description || '').trim(),
                era: String(d.era || '').trim(), location: String(d.location || '').trim(),
                timeOfDay: String(d.timeOfDay || '').trim(), weather: String(d.weather || '').trim(),
                tags: (d.tags || []).slice(0, 10),
                refs: (d.refs || []).slice(0, LIM.refs).map(r => ({ url: r.url, previewUrl: r.previewUrl || r.url, role: 'other', note: r.note || '' }))
            };
            this._saving = true; this._setBusy(true); this._renderAssetFoot();
            try {
                const saved = d.id ? await this._apiKind(conf.api, 'PUT', '/' + encodeURIComponent(d.id), p) : await this._apiKind(conf.api, 'POST', '', p);
                const arr = d._kind === 'scene' ? (this.scenes = this.scenes || []) : (this.props = this.props || []);
                const i = arr.findIndex(x => x.id === saved.id);
                if (i === -1) arr.unshift(saved); else arr[i] = saved;
                this._kLoaded[d._kind] = true;
                toast(d.id ? conf.label + '已保存' : conf.label + '已创建', 'ok');
                this._saving = false;
                this._editAssetDraft(Object.assign(JSON.parse(JSON.stringify(saved)), { _kind: d._kind }));
            } catch (e) {
                toast('保存失败：' + (e.message || ''), 'warn');
            } finally {
                this._saving = false; this._setBusy(false);
                if (this._view === 'edit' && this._draft && this._draft._kind) this._renderAssetFoot();
            }
        },
        async _deleteAsset(id) {
            const d = this._draft;
            const kind = d ? d._kind : this._tab;
            const item = this._itemsOf(kind).find(x => x.id === id);
            if (!item) return;
            if (!confirm('确定删除' + this._kindConf(kind).label + '「' + item.name + '」？')) return;
            try {
                await this._apiKind(this._kindConf(kind).api, 'DELETE', '/' + encodeURIComponent(id));
                if (kind === 'scene') this.scenes = (this.scenes || []).filter(x => x.id !== id);
                else this.props = (this.props || []).filter(x => x.id !== id);
                alert(this._kindConf(kind).label + '已删除');
                this._showAssetList();
            } catch (e) { alert('删除失败：' + (e.message || '')); }
        },
        _insertAsset(id) {
            const CB = global.CanvasBlocks;
            const tab = this._tab, item = this._itemsOf(tab).find(x => x.id === id);
            if (!CB || !item) return null;
            const c = CB.viewportCenterWorld();
            return this._insertAssetAt(id, c.x, c.y);
        },
        _insertAssetAt(id, wx, wy) {
            const CB = global.CanvasBlocks;
            const tab = this._tab, item = this._itemsOf(tab).find(x => x.id === id);
            if (!CB || !item) return null;
            const cover = (item.refs || [])[0];
            const node = CB.addRef({
                subType: tab === 'scene' ? 'scene' : 'prop', name: item.name, x: wx, y: wy,
                imageUrl: cover ? cover.url : '', previewUrl: cover ? (cover.previewUrl || cover.url) : '', mediumUrl: cover ? (cover.previewUrl || cover.url) : '',
                assetSnapshot: { kind: tab, name: item.name, description: item.description || '' }
            });
            const sp = CB._findFreeSpot(wx - node.w / 2, wy - node.h / 2, node.w, node.h, node.id);
            CB.update(node.id, { x: sp.x, y: sp.y });
            if (global.CanvasSelection) global.CanvasSelection.select(node.id, false);
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            toast('已插入画布', 'ok');
            return node;
        },
        _alClick(act, btn, e) {
            if (act === 'al-new') return this._editAssetDraft({ id: '', name: '', description: '', era: '', location: '', timeOfDay: '', weather: '', tags: [], refs: [], _kind: this._tab });
            if (act === 'al-back') return this._showAssetList();
            if (act === 'al-card-insert') { e.stopPropagation(); this._insertAsset(btn.closest('.char-card').dataset.id); return; }
            if (act === 'al-card-edit') { e.stopPropagation(); this._openAsset(btn.closest('.char-card').dataset.id); return; }
            const d = this._draft;
            if (!d) return;
            if (act === 'al-ref-upload') { this._uploadScope = 'main'; this._file.value = ''; this._file.click(); return; }
            if (act === 'al-ref-del') { d.refs.splice(parseInt(btn.dataset.i, 10), 1); return this._renderAssetEditor(); }
            if (act === 'al-ref-add-sel') {
                const CB = global.CanvasBlocks;
                const ids = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
                const imgs = ids.map(id => this._imageOfNode(CB.getById(id))).filter(Boolean);
                if (!imgs.length) { alert('请先在画布上选中图片节点'); return; }
                let added = 0;
                imgs.forEach(im => {
                    if (d.refs.length >= LIM.refs || d.refs.some(r => r.url === im.url)) return;
                    d.refs.push({ url: im.url, previewUrl: im.previewUrl, role: 'other', note: '' }); added++;
                });
                if (!added) alert('所选图片已在参考图中或已达 8 张上限');
                return this._renderAssetEditor();
            }
            if (act === 'al-save') return this._saveAsset();
            if (act === 'al-delete') { if (d.id) this._deleteAsset(d.id); return; }
            if (act === 'al-insert') { if (d.id) this._insertAsset(d.id); return; }
        },

        // ---------- 卡片拖拽到画布（指针拖拽，松手处创建角色节点）----------
        _onCardMouseDown(e) {
            if (e.button !== 0) return;
            const card = e.target.closest('.char-card');
            if (!card || e.target.closest('[data-act]')) return;
            if (card.dataset.kind && card.dataset.kind !== 'char') return;
            const id = card.dataset.id;
            const sx = e.clientX, sy = e.clientY;
            let ghost = null;
            this._dragMoved = false;
            const onMove = (ev) => {
                if (!ghost) {
                    if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
                    this._dragMoved = true;
                    ghost = document.createElement('div');
                    ghost.className = 'char-drag-ghost';
                    const img = card.querySelector('.char-card-cover img');
                    ghost.innerHTML = (img ? `<img src="${esc(img.getAttribute('src'))}" alt="">` : ICON_USER);
                    document.body.appendChild(ghost);
                    document.body.classList.add('char-dragging');
                }
                ghost.style.left = ev.clientX + 'px';
                ghost.style.top = ev.clientY + 'px';
                ev.preventDefault();
            };
            const onUp = (ev) => {
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
                if (!ghost) return;
                ghost.remove();
                document.body.classList.remove('char-dragging');
                setTimeout(() => { this._dragMoved = false; }, 0);
                const vp = global.CanvasCore && global.CanvasCore.viewportEl;
                if (!vp) return;
                const vr = vp.getBoundingClientRect();
                const dr = this._drawer.getBoundingClientRect();
                const inDrawer = ev.clientX >= dr.left && ev.clientX <= dr.right && ev.clientY >= dr.top && ev.clientY <= dr.bottom;
                if (inDrawer || ev.clientX < vr.left || ev.clientX > vr.right || ev.clientY < vr.top || ev.clientY > vr.bottom) return;
                const w = global.CanvasCore.screenToWorld(ev.clientX, ev.clientY);
                this.insertToCanvas(id, w.x, w.y, { center: true });
            };
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
        }
    };

    global.CharacterLib = CharacterLib;
})(window);
