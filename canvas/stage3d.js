/**
 * stage3d.js —— 无限画布 · 3D 片场 / 3D 导演台（一期）宿主层（常驻，体积小）
 *   - 画布节点：nodeType 'ref' + subType 'stage3d'，场景 JSON 存在 block.stage3d（随画布保存），缩略图 = 最近一次渲染（imageUrl）
 *   - 入口：右键「新建 3D 片场」、左侧工具坞、全景查看器「3D 片场」、导演台场景卡「为场景搭建 3D 片场」、节点工具栏
 *   - 编辑器 canvas/stage3d-editor.js（ES module）与 three.js（canvas/vendor/three/，MIT）仅在打开时懒加载
 *   - 输出：截图到画布（参考图节点 + 可选连到生成节点）、导出首尾帧 + 创建首尾帧视频节点（不自动生成）、发送到 2D 导演台镜头
 *   - AI 助手工具：stage_create / stage_read / stage_apply_ops（Stage3DCore.applyOps 整批校验）/ stage_snapshot（截图上传，不扣积分）
 * 所有用户内容渲染一律转义；图片统一走同源 /api/img（WebGL 纹理需要 CORS 干净）
 */
(function (global) {
    'use strict';

    const C = global.Stage3DCore;
    const EDITOR_V = '3'; // _FRAMES_20261029
    const svg = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const IC = {
        stage: svg('<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>'),
        open: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
        camera: svg('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>'),
        dup: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
        user: svg('<circle cx="12" cy="7" r="3.2"/><path d="M12 10.5v6M8 13.5l4-2 4 2M9.5 21l2.5-4.5 2.5 4.5"/>'),
        warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>')
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function toast(msg, type) { if (typeof global.pxToast === 'function') global.pxToast(msg, type ? { type } : undefined); else console.log('[3D 片场]', msg); }
    function vErr(msg) { const e = new Error(msg); e.agent = true; return e; }
    const isEn = () => { try { return localStorage.getItem('nano_lang') === 'en'; } catch (_) { return false; } };
    function sameOrigin(u) {
        const s = String(u || '');
        if (!s) return s;
        if (global.VideoProxy && global.VideoProxy.sameOrigin) return global.VideoProxy.sameOrigin(s);
        return s.replace(/^https?:\/\/[^/]+(?=\/api\/img)/i, '');
    }
    function withProc(u, proc) {
        const s = String(u || '');
        if (!s || s.indexOf('x-tos-process') !== -1 || s.indexOf('/api/img') === -1) return s;
        return s + (s.indexOf('?') === -1 ? '?' : '&') + 'x-tos-process=' + encodeURIComponent(proc);
    }
    function stripProc(u) { return String(u || '').replace(/[?&]x-tos-process=[^&#]*/g, '').replace(/\?&/, '?'); }
    const CB = () => global.CanvasBlocks, CE = () => global.CanvasEdges, CH = () => global.CanvasHistory, CS = () => global.CanvasStore;

    let _modP = null;
    function loadEditor() {
        if (_modP) return _modP;
        _modP = import(new URL('canvas/stage3d-editor.js?v=' + EDITOR_V, document.baseURI).href).catch((e) => { _modP = null; throw new Error('3D 片场组件加载失败，请检查网络后重试'); });
        return _modP;
    }
    let _gl = null;
    function hasWebGL() {
        if (global.__pxNoWebGL) return false;
        if (_gl !== null) return _gl;
        try {
            const c = document.createElement('canvas');
            const g = c.getContext('webgl2') || c.getContext('webgl');
            _gl = !!g;
            const ext = g && g.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
        } catch (_) { _gl = false; }
        return _gl;
    }

    const CanvasStage3D = {
        IC, esc, toast, isEn, sameOrigin, withProc, stripProc, hasWebGL,
        _editor: null,

        init() {
            if (this._inited || !C) return;
            this._inited = true;
            this._buildDockBtn();
            this._dockGuard();
            global.addEventListener('beforeunload', (e) => { const ed = this._editor; if (ed && ed.isDirty && ed.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
        },
        isStage(b) { return !!(b && b.nodeType === 'ref' && b.subType === 'stage3d'); },
        stageOf(b) { return this.isStage(b) ? C.normalize(b.stage3d).stage : null; },

        // ================= 节点渲染 =================
        nodeClass(b) { return this.isStage(b) ? ' is-stage3d' : ''; },
        badgeHtml(b) {
            if (!this.isStage(b)) return '';
            const s = C.stats(b.stage3d || {});
            const open = this._editor && this._editor.nodeId === b.id;
            return `<span class="s3-badge" title="3D 片场">${IC.stage}<span>3D 片场</span></span>
                <span class="s3-stats num" aria-hidden="true"><span title="人偶">${IC.user}<b>${s.actors}</b></span><span title="机位">${IC.camera}<b>${s.cameras}</b></span></span>${open ? '<span class="s3-editing">编辑中</span>' : ''}`;
        },
        emptyBodyHtml(b) {
            return `<div class="s3-empty"><span class="s3-empty-ic">${IC.stage}</span><span class="s3-empty-t">双击打开 3D 片场</span><span class="s3-empty-s">摆人偶 · 设机位 · 截图作参考</span></div>`;
        },
        toolbarHtml(b) {
            const T = (act, icon, label, title, dis) => `<button class="node-tool-text${dis ? ' disabled' : ''}" data-action="${act}" title="${esc(title || label)}"${dis ? ' disabled' : ''}>${icon.replace('<svg ', '<svg class="tb-ic" ')}<span class="tb-lb">${label}</span></button>`;
            const hasImg = !!(b.imageUrl || b.previewUrl);
            return `<div class="node-toolbar toolbar-capsule">
                ${T('stage-open', IC.open, '打开片场', '打开 3D 片场编辑器（双击节点也可打开）')}
                ${T('stage-shot', IC.camera, '截图到画布', '按当前机位渲染一张参考图放到画布')}
                ${T('stage-dup', IC.dup, '复制', '复制这个 3D 片场（含人偶、道具与机位）')}
                <span class="node-tool-divider"></span>
                <button class="node-tool-icon has-label${hasImg ? '' : ' disabled'}" data-action="download" title="下载"><svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span class="tb-lb">下载</span></button>
            </div>`;
        },
        onToolAction(action, node) {
            if (!this.isStage(node)) return;
            if (action === 'stage-open') return this.open(node.id);
            if (action === 'stage-shot') return this.quickSnapshot(node.id);
            if (action === 'stage-dup') return this.duplicate(node.id);
        },
        onNodeDblClick(node) { if (this.isStage(node)) this.open(node.id); },

        // ================= 创建 / 复制 =================
        _nextName() {
            let max = 0;
            CB().blocks.forEach(b => { const m = /^3D 片场(\d+)$/.exec(b.name || ''); if (m) max = Math.max(max, +m[1]); });
            return '3D 片场' + (max + 1);
        },
        createStageNode(o) {
            o = o || {};
            const cb = CB();
            let x = o.x, y = o.y;
            if (x == null || y == null) { const c = cb.viewportCenterWorld(); x = c.x - 196; y = c.y - 110; }
            let pano = null;
            if (o.panoNodeId) { pano = cb.getById(o.panoNodeId); if (!this.isPanoReady(pano)) pano = null; }
            const stage = C.createStage({ lang: isEn() ? 'en' : 'zh', panoNodeId: pano ? pano.id : '', panoUrl: pano ? this.panoSrc(pano) : '', preset: o.preset });
            const node = cb.addRef({ x, y, name: o.name || this._nextName(), subType: 'stage3d', ratio: 16 / 9, status: 'idle', stage3d: stage });
            if (o.findSpot !== false) { const sp = cb._findFreeSpot(node.x, node.y, node.w, node.h, node.id); cb.update(node.id, { x: sp.x, y: sp.y }); }
            if (o.select !== false && global.CanvasSelection) { global.CanvasSelection.select(node.id, false); if (global.CanvasMain) global.CanvasMain.onSelectionChange(); }
            if (o.history !== false && CH()) CH().snapshot();
            if (CS()) CS().scheduleSave();
            if (o.pan !== false && global.CanvasCore) global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            return node;
        },
        createFromPano(panoNodeId) {
            const p = CB().getById(panoNodeId);
            if (!this.isPanoReady(p)) { toast('该节点还没有全景图', 'warn'); return null; }
            const node = this.createStageNode({ x: p.x + p.w + 80, y: p.y, panoNodeId, name: (isEn() ? '3D Stage · ' : '3D 片场 · ') + (p.name || ''), pan: false });
            this.open(node.id);
            return node;
        },
        // 导演台场景：复用场景已绑定的片场，否则新建（全景已生成时作为背景）
        openForScene(sc, shot) {
            if (!sc) return;
            const cb = CB();
            let node = sc.stageNodeId && cb.getById(sc.stageNodeId);
            if (!this.isStage(node)) {
                const near = shot && shot.genNodeId && cb.getById(shot.genNodeId);
                node = this.createStageNode({ x: near ? near.x : undefined, y: near ? near.y - 420 : undefined, name: (isEn() ? '3D Stage · ' : '3D 片场 · ') + (sc.name || ''), panoNodeId: sc.panoNodeId || '', select: false, pan: false });
                sc.stageNodeId = node.id;
                const D = global.CanvasDirector;
                if (D && D._commit) D._commit();
            }
            this.open(node.id, { shotId: shot ? shot.id : '' });
        },
        // 导演台场景卡：「为场景搭建 3D 片场」/「打开场景 3D 片场」
        directorRowHtml(sc) {
            if (!sc) return '';
            const ex = sc.stageNodeId && this.isStage(CB().getById(sc.stageNodeId));
            return `<div class="dir-pano-row"><button type="button" class="dir-btn small" data-act="scene-stage" title="${ex ? '打开该场景的 3D 片场，摆人偶、设机位后截图作为场景参考图 / 首尾帧' : '为该场景搭建 3D 片场（已生成场景全景时自动作为背景），摆人偶、设机位后截图发送到镜头'}">${IC.stage}<span class="lb">${ex ? '打开场景 3D 片场' : '为场景搭建 3D 片场'}</span></button></div>`;
        },
        duplicate(nodeId) {
            const src = CB().getById(nodeId);
            if (!this.isStage(src)) return null;
            const cb = CB();
            const sp = cb._findFreeSpot(src.x + 40, src.y + 40, src.w, src.h, null);
            const node = cb.addRef({ x: sp.x, y: sp.y, name: (src.name || '3D 片场') + (isEn() ? ' Copy' : ' 副本'), subType: 'stage3d', ratio: src.ratio || 16 / 9, status: 'idle',
                imageUrl: src.imageUrl || '', previewUrl: src.previewUrl || '', mediumUrl: src.mediumUrl || '', stage3d: C.clone(C.normalize(src.stage3d).stage) });
            if (global.CanvasSelection) { global.CanvasSelection.select(node.id, false); if (global.CanvasMain) global.CanvasMain.onSelectionChange(); }
            if (CH()) CH().snapshot();
            if (CS()) CS().scheduleSave();
            toast('已复制 3D 片场', 'ok');
            return node;
        },
        // 窄屏（如 1366）：底部停靠的提示词栏会盖住左下工具坞右端按钮 → 停靠栏向右让出空间（仅停靠模式，跟随节点模式不受影响）
        _dockGuard() {
            const dock = document.getElementById('toolDock'), pf = document.getElementById('canvasPromptFloat'), app = document.querySelector('.canvas-app');
            if (!dock || !pf || !app) return;
            let raf = 0;
            const run = () => {
                raf = 0;
                app.classList.remove('s3-dock-tight');
                if (!pf.classList.contains('docked') || pf.classList.contains('expanded') || app.classList.contains('prompt-float-hidden') || app.classList.contains('ag-open') || app.classList.contains('dir-open')) return;
                const d = dock.getBoundingClientRect(), p = pf.getBoundingClientRect();
                if (!d.width || !p.width || d.bottom < p.top) return;
                const need = Math.ceil(d.right + 12 - p.left);
                if (need <= 0) return;
                const room = Math.max(0, Math.floor(window.innerWidth - 16 - p.right));
                app.style.setProperty('--s3-dock-shift', Math.min(need, room) + 'px');
                app.classList.add('s3-dock-tight');
            };
            const sched = () => { if (!raf) raf = requestAnimationFrame(run); };
            window.addEventListener('resize', sched);
            if (global.ResizeObserver) { const ro = new ResizeObserver(sched); ro.observe(dock); ro.observe(pf); }
            if (global.MutationObserver) { new MutationObserver(sched).observe(pf, { attributes: true, attributeFilter: ['class'] }); new MutationObserver(sched).observe(app, { attributes: true, attributeFilter: ['class'] }); }
            sched();
        },
        _buildDockBtn() {
            const dock = document.getElementById('toolDock');
            if (!dock || document.getElementById('stageDockBtn')) return;
            const after = document.getElementById('panoDockBtn') || dock.querySelector('[data-add="upload"]');
            const b = document.createElement('button');
            b.className = 'capsule-btn';
            b.id = 'stageDockBtn';
            b.dataset.tip = '3D 片场';
            b.setAttribute('aria-label', '3D 片场');
            b.innerHTML = IC.stage;
            if (after) after.insertAdjacentElement('afterend', b); else dock.appendChild(b);
            b.addEventListener('click', (e) => { e.stopPropagation(); const n = this.createStageNode({}); toast('已新建 3D 片场，双击节点打开编辑器', 'ok'); return n; });
            const tipEl = document.querySelector('.px-ctip');
            if (tipEl) {
                b.addEventListener('mouseenter', () => {
                    tipEl.innerHTML = `<span>${esc(b.dataset.tip)}</span>`;
                    tipEl.classList.remove('hidden');
                    const r = b.getBoundingClientRect();
                    tipEl.style.left = (r.right + 10) + 'px';
                    tipEl.style.top = (r.top + r.height / 2 - tipEl.offsetHeight / 2) + 'px';
                });
                b.addEventListener('mouseleave', () => tipEl.classList.add('hidden'));
            }
        },

        // ================= 编辑器 =================
        async open(nodeId, opts) {
            opts = opts || {};
            const node = CB().getById(nodeId);
            if (!this.isStage(node)) return false;
            if (this._editor) { if (this._editor.nodeId === nodeId) return true; if (!(await this._editor.requestClose())) return false; }
            if (!hasWebGL()) { this._noWebGL(); return false; }
            if (this._opening) return false;
            this._opening = true;
            const t0 = performance.now();
            const veil = document.createElement('div');
            veil.className = 's3-veil';
            veil.innerHTML = `<span class="s3-spin lg"></span><span>正在加载 3D 片场…</span>`;
            document.body.appendChild(veil);
            requestAnimationFrame(() => veil.classList.add('in'));
            try {
                const mod = await loadEditor();
                const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
                const target = sel.map(id => CB().getById(id)).find(b => b && b.nodeType === 'gen' && b.id !== nodeId) || null;
                this._editor = mod.openEditor(this, nodeId, Object.assign({ targetId: target ? target.id : '' }, opts));
                this._openMs = Math.round(performance.now() - t0);
                this._refreshNode(nodeId);
                return true;
            } catch (e) {
                console.warn('[3D 片场]', e);
                toast(e.message || '3D 片场打开失败', 'warn');
                return false;
            } finally {
                this._opening = false;
                veil.classList.remove('in');
                setTimeout(() => veil.remove(), 260);
            }
        },
        _onEditorClosed(nodeId) { this._editor = null; this._refreshNode(nodeId); },
        isOpen() { return !!this._editor; },
        _refreshNode(id) { const n = CB().getById(id); if (n) CB()._render(n); },
        _noWebGL() {
            const m = document.createElement('div');
            m.className = 's3-modal-mask';
            m.innerHTML = `<div class="s3-modal" role="alertdialog" aria-modal="true"><div class="s3-modal-h"><span class="s3-modal-ic warn">${IC.warn}</span><b>无法打开 3D 片场</b></div>
                <div class="s3-modal-b">当前浏览器或设备不支持 WebGL，3D 片场需要 WebGL 才能运行。请开启浏览器硬件加速，或使用最新版 Chrome / Edge 打开。</div>
                <div class="s3-modal-f"><button type="button" class="s3-btn primary" data-m="x">知道了</button></div></div>`;
            document.body.appendChild(m);
            const close = () => m.remove();
            m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-m="x"]')) close(); });
            m.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
            const b = m.querySelector('[data-m="x"]');
            if (b) b.focus();
        },

        // ================= 写回节点（一次编辑会话 = 一次画布撤销步骤） =================
        writeBack(nodeId, stage, session) {
            const node = CB().getById(nodeId);
            if (!node) return false;
            const st = C.normalize(stage).stage;
            node.stage3d = st;
            CB()._render(node);
            const h = CH();
            if (h && !h._suspended) {
                if (session && session.histIndex != null && h._index === session.histIndex && h._stack.length - 1 === h._index && session.histSnap === h._stack[h._index]) {
                    h._stack[h._index] = h._capture();
                } else {
                    h.snapshot();
                }
                if (session) { session.histIndex = h._index; session.histSnap = h._stack[h._index]; }
            }
            if (CS()) CS().scheduleSave();
            return true;
        },
        // 缩略图：上传后写到节点 imageUrl（同一会话内替换撤销栈顶，不额外产生撤销步骤）
        async updateThumb(nodeId, blob, session) {
            if (!blob) return;
            try {
                const r = await global.CanvasGenerate.uploadRef(new File([blob], 'stage3d_thumb.jpg', { type: 'image/jpeg' }));
                const node = CB().getById(nodeId);
                if (!node) return;
                CB().update(nodeId, { imageUrl: r.highUrl, previewUrl: r.previewUrl || r.highUrl, mediumUrl: r.mediumUrl || r.highUrl, status: 'idle', ratio: node.ratio || 16 / 9 });
                const h = CH();
                if (h && session && session.histIndex === h._index && session.histSnap === h._stack[h._index]) { h._stack[h._index] = h._capture(); session.histSnap = h._stack[h._index]; }
                if (CS()) CS().scheduleSave();
            } catch (e) { console.warn('[3D 片场] 缩略图上传失败', e); }
        },

        // ================= 背景：全景节点 =================
        isPanoReady(n) { const P = global.CanvasPano; return !!(n && P && P.hasPanoImage && P.hasPanoImage(n)); },
        panoSrc(n) {
            if (!n) return '';
            let src = sameOrigin(stripProc(n.imageUrl || n.previewUrl));
            if ((n._imgW || 0) > 4096) src = withProc(src, 'image/resize,w_4096');
            return src;
        },
        panoList() {
            return CB().blocks.filter(b => this.isPanoReady(b)).map(b => ({ id: b.id, name: b.name || '', thumb: sameOrigin(b.previewUrl || b.mediumUrl || b.imageUrl), url: this.panoSrc(b) }));
        },
        panoUrlFor(env) {
            if (!env) return '';
            const n = env.panoNodeId && CB().getById(env.panoNodeId);
            if (this.isPanoReady(n)) return this.panoSrc(n);
            return env.panoUrl ? sameOrigin(env.panoUrl) : '';
        },

        // ================= 角色库 =================
        characters() { const CL = global.CharacterLib; return (CL && CL.chars) || []; },
        character(id) { const CL = global.CharacterLib; return CL && CL.get ? CL.get(id) : null; },
        // 8 视角转身序列（0°…315°）→ 图片地址；没有时返回角色首张参考图
        charViews(id) {
            const c = this.character(id);
            if (!c) return null;
            const tr = Array.isArray(c.turnaround) ? c.turnaround : [];
            const views = [];
            ['0°', '45°', '90°', '135°', '180°', '225°', '270°', '315°'].forEach((a, i) => { const f = tr.find(x => x && x.note === a) || tr[i]; if (f && (f.url || f.previewUrl)) views[i] = sameOrigin(f.previewUrl || f.url); });
            const ref = (c.refs || []).find(r => r && r.role === 'fullbody') || (c.refs || [])[0];
            return { views: views.filter(Boolean).length === 8 ? views : null, single: ref ? sameOrigin(ref.previewUrl || ref.url) : '', name: c.name || '' };
        },

        // ================= 输出：截图 / 首尾帧 / 视频节点 / 导演台 =================
        async upload(blob) {
            const r = await global.CanvasGenerate.uploadRef(new File([blob], 'stage3d_shot.jpg', { type: 'image/jpeg' }));
            return { url: r.highUrl, previewUrl: r.previewUrl || r.highUrl, mediumUrl: r.mediumUrl || r.previewUrl || r.highUrl };
        },
        // 渲染结果 → 参考图节点（片场节点右侧，记录来源片场与机位参数）；可选连到生成节点
        placeShot(o) {
            const cb = CB();
            const st = cb.getById(o.stageNodeId);
            const [a, b] = String(o.aspect || '16:9').split(':').map(Number);
            const ratio = a / (b || 1);
            const k = cb.blocks.filter(x => x.stageShot && x.stageShot.srcId === o.stageNodeId).length;
            const node = cb.addRef({
                x: st ? st.x + st.w + 80 : 0, y: st ? st.y + (k % 6) * 40 : 0, name: o.name, ratio,
                imageUrl: o.media.url, previewUrl: o.media.previewUrl, mediumUrl: o.media.mediumUrl, status: 'idle',
                stageShot: Object.assign({ srcId: o.stageNodeId }, o.meta || {})
            });
            const sp = cb._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            cb.update(node.id, { x: sp.x, y: sp.y });
            let linked = false;
            const tgt = o.linkTo && cb.getById(o.linkTo);
            if (tgt && tgt.nodeType === 'gen' && CE() && !CE().edges.some(e => e.from === node.id && e.to === tgt.id)) {
                linked = !!CE().add(node.id, tgt.id);
                if (global.CanvasMain) global.CanvasMain.onEdgesChange();
            }
            if (!o.noHistory && CH()) CH().snapshot();
            if (CS()) CS().scheduleSave();
            return { node, linked };
        },
        _videoModels() {
            const PB = global.PromptBar;
            if (!PB || !PB.modelConfigMap) return [];
            return Object.keys(PB.modelConfigMap).filter(k => PB._isVideoModel && PB._isVideoModel(k));
        },
        _supportsFL(m) { const PB = global.PromptBar; return (PB && PB.videoCaps) ? !!PB.videoCaps(m).firstLast : /seedance-2|minimax-h3/i.test(String(m || '')); },
        pickFLModel() {
            const PB = global.PromptBar;
            const list = this._videoModels();
            const def = PB && ((PB.lastVideoModel && list.indexOf(PB.lastVideoModel) !== -1 && PB.lastVideoModel) || (PB._firstModelOfMode && PB._firstModelOfMode(true)));
            if (def && this._supportsFL(def)) return def;
            return list.find(m => this._supportsFL(m)) || def || '';
        },
        // 首尾帧 → 视频生成节点（videoMode first_last，按顺序连好两帧，提示词 = 运镜描述）。只创建，不生成
        createFLVideo(o) {
            const cb = CB(), PB = global.PromptBar;
            const f = cb.getById(o.firstId), l = cb.getById(o.lastId);
            if (!f || !l) throw new Error('首帧或尾帧节点不存在');
            const model = this.pickFLModel();
            if (!model) throw new Error('没有可用的首尾帧视频模型');
            const cfg = (PB && PB.modelConfigMap[model]) || {};
            const mn = cfg.durationMin || 4, mx = cfg.durationMax || 15;
            const res = Array.isArray(cfg.supportedResolutions) && cfg.supportedResolutions.length ? (cfg.supportedResolutions.find(r => /^(720|768)/i.test(String(r))) || cfg.supportedResolutions[0]) : '';
            const [a, b] = String(o.aspect || '16:9').split(':').map(Number);
            const node = cb.addGen({
                x: Math.max(f.x + f.w, l.x + l.w) + 90, y: f.y, name: o.name || cb._nextGenName('视频节点'), genCategory: 'video', model,
                prompt: String(o.prompt || '').slice(0, 2000), duration: Math.max(mn, Math.min(mx, Math.round(o.duration || 5))), resolution: res,
                aspectRatio: 'auto', videoMode: 'first_last', ratio: a / (b || 1), stageVideo: { srcId: o.stageNodeId || '', cameraId: o.cameraId || '' }
            });
            const sp = cb._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            cb.update(node.id, { x: sp.x, y: sp.y });
            CE().add(f.id, node.id);
            CE().add(l.id, node.id);
            if (global.CanvasMain) global.CanvasMain.onEdgesChange();
            if (CH()) CH().snapshot();
            if (CS()) CS().scheduleSave();
            return node;
        },
        directorShots() {
            const D = global.CanvasDirector;
            if (!D || !D.d || !Array.isArray(D.d.shots)) return [];
            return D.d.shots.map((s, i) => { const sc = (D.d.scenes || []).find(x => x.id === s.sceneId); return { id: s.id, no: i + 1, title: s.title || '', scene: sc ? sc.name : '', mode: s.mode || 'reference' }; });
        },
        sendToDirector(shotId, o) {
            const D = global.CanvasDirector;
            if (!D || !D.bindImages) throw new Error('导演台不可用');
            const ok = D.bindImages(shotId, o);
            if (!ok) throw new Error('镜头不存在');
            return true;
        },

        // ================= 快速截图（未打开编辑器：离屏渲染当前机位） =================
        async quickSnapshot(nodeId, opts) {
            opts = opts || {};
            const node = CB().getById(nodeId);
            if (!this.isStage(node)) return null;
            if (!hasWebGL()) { this._noWebGL(); return null; }
            if (this._editor && this._editor.nodeId === nodeId) return this._editor.snapshot(opts);
            const stage = C.normalize(node.stage3d).stage;
            const cam = stage.cameras.find(c => c.id === (opts.cameraId || stage.activeCameraId)) || stage.cameras[0];
            const size = C.outSize(cam.aspect, opts.res === '1K' ? '1K' : '2K');
            if (!opts.silent) toast('正在渲染机位「' + cam.name + '」…', 'info');
            const mod = await loadEditor();
            const canvas = await mod.renderStage(this, stage, cam.id, { w: size.w, h: size.h, time: opts.time });
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
            const media = await this.upload(blob);
            const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            const link = opts.linkTo !== undefined ? opts.linkTo : (sel.map(id => CB().getById(id)).find(b => b && b.nodeType === 'gen') || {}).id;
            const fr = (opts.frame === 'start' || opts.frame === 'end') && cam.move ? opts.frame : '';
            const r = this.placeShot({ stageNodeId: nodeId, name: (node.name || '3D 片场') + ' · ' + cam.name + (fr ? (fr === 'start' ? ' · 起幅' : ' · 落幅') : ''), aspect: cam.aspect, media, linkTo: link,
                meta: this.shotMeta(stage, cam, fr, size) });
            this._lastSnapshot = { w: size.w, h: size.h, nodeId: r.node.id, cameraId: cam.id };
            if (!opts.silent) toast(r.linked ? '截图已放到画布并连到生成节点' : '截图已放到画布', 'ok');
            return r;
        },
        shotMeta(stage, cam, frame, size) {
            const subj = C.subjectOf(stage, cam);
            const m = { cameraId: cam.id, camName: cam.name, focal: cam.focal, aspect: cam.aspect, shot: cam.shot || (subj ? C.classifyShot(cam, subj) : ''), angle: cam.angle || '', pos: cam.pos, target: cam.target, w: size.w, h: size.h };
            if (frame) { m.frame = frame; const k = frame === 'end' ? cam.move.end : cam.move.start; m.pos = k.pos; m.target = k.target; m.focal = k.focal; m.move = cam.move.preset; m.duration = cam.move.duration; }
            const cast = stage.objects.filter(o => o.type === 'actor' && !o.hidden).map(o => ({ name: o.name, color: o.color, characterId: o.actor.characterId || undefined }));
            if (cast.length) m.cast = cast.slice(0, 12);
            return m;
        },

        // ================= AI 助手工具 =================
        _ctx() {
            return {
                lang: isEn() ? 'en' : 'zh',
                character: (id) => { const c = this.character(id); return c ? { name: c.name } : null; },
                pano: (id) => { const n = CB().getById(id); return this.isPanoReady(n) ? { url: this.panoSrc(n) } : null; }
            };
        },
        _agentNode(id) {
            const n = typeof id === 'string' && CB().getById(id);
            if (!n) throw vErr(`节点「${String(id || '').slice(0, 30)}」不存在`);
            if (!this.isStage(n)) throw vErr(`「${n.name}」不是 3D 片场节点`);
            return n;
        },
        agentCreate(a) {
            a = a || {};
            if (a.panoNodeId !== undefined && a.panoNodeId !== '') {
                const p = CB().getById(a.panoNodeId);
                if (!p) throw vErr(`全景节点「${String(a.panoNodeId).slice(0, 30)}」不存在`);
                if (!this.isPanoReady(p)) throw vErr(`「${p.name}」不是已生成的 360° 全景节点`);
            }
            if (a.preset !== undefined && a.preset !== '' && !C.ENV_PRESETS[a.preset]) throw vErr('preset 只能是 ' + Object.keys(C.ENV_PRESETS).join(' / '));
            if (a.nearNodeId !== undefined && a.nearNodeId !== '' && !CB().getById(a.nearNodeId)) throw vErr(`nearNodeId「${String(a.nearNodeId).slice(0, 30)}」不存在`);
            const near = a.nearNodeId && CB().getById(a.nearNodeId);
            const name = typeof a.name === 'string' ? a.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) : '';
            const node = this.createStageNode({ name: name || undefined, panoNodeId: a.panoNodeId || '', preset: a.preset || undefined, x: near ? near.x + near.w + 90 : undefined, y: near ? near.y : undefined, select: false, pan: false });
            return { ok: true, created: { id: node.id, name: node.name }, stage: C.summary(node.stage3d), conventions: '单位米；地面 y=0；x 左右（默认机位画面中 +x 在右），z 前后（+z 朝向默认机位，-z 为远处）；人偶 rotY=0 面朝 +z（朝向默认机位），rotY=90 面朝 +x', next: '用 stage_apply_ops 摆放人偶/道具/机位，再用 stage_snapshot 截图到画布' };
        },
        agentRead(a) {
            const n = this._agentNode(a && a.nodeId);
            const st = (this._editor && this._editor.nodeId === n.id) ? this._editor.getStage() : C.normalize(n.stage3d).stage;
            return { ok: true, nodeId: n.id, name: n.name, stage: C.summary(st), poses: Object.keys(C.POSES), propKinds: Object.keys(C.PROPS) };
        },
        agentApplyOps(a) {
            a = a || {};
            const n = this._agentNode(a.nodeId);
            const ed = this._editor && this._editor.nodeId === n.id ? this._editor : null;
            const cur = ed ? ed.getStage() : C.normalize(n.stage3d).stage;
            const r = C.applyOps(cur, a.ops, this._ctx());
            if (!r.ok) return { ok: false, errors: r.errors, note: '整批未执行（场景未改变），请按错误修正参数后重试' };
            if (ed) ed.applyExternal(r.stage);
            else this.writeBack(n.id, r.stage);
            this._refreshNode(n.id);
            return { ok: true, applied: r.applied.length, created: r.created, stage: C.summary(r.stage), next: '如需输出参考图请调用 stage_snapshot' };
        },
        async agentSnapshot(a) {
            a = a || {};
            const n = this._agentNode(a.nodeId);
            const st = (this._editor && this._editor.nodeId === n.id) ? this._editor.getStage() : C.normalize(n.stage3d).stage;
            if (a.cameraId !== undefined && !st.cameras.some(c => c.id === a.cameraId)) throw vErr(`机位「${String(a.cameraId).slice(0, 30)}」不存在，可用：${st.cameras.map(c => c.id).join(' / ')}`);
            if (a.resolution !== undefined && a.resolution !== '1K' && a.resolution !== '2K') throw vErr('resolution 只能是 1K / 2K');
            if (a.frame !== undefined && ['current', 'start', 'end'].indexOf(a.frame) === -1) throw vErr('frame 只能是 current / start / end');
            let link = '';
            if (a.connectTo !== undefined && a.connectTo !== '') {
                const g = CB().getById(a.connectTo);
                if (!g || g.nodeType !== 'gen') throw vErr(`connectTo「${String(a.connectTo).slice(0, 30)}」不是生成节点`);
                link = g.id;
            }
            const cam = st.cameras.find(c => c.id === (a.cameraId || st.activeCameraId)) || st.cameras[0];
            if ((a.frame === 'start' || a.frame === 'end') && !cam.move) throw vErr(`机位「${cam.name}」没有设置运镜，无法导出起幅/落幅`);
            if (!hasWebGL()) throw vErr('当前浏览器不支持 WebGL，无法渲染 3D 片场');
            const time = a.frame === 'end' ? cam.move.duration : (a.frame === 'start' ? 0 : undefined);
            let r;
            if (this._editor && this._editor.nodeId === n.id) r = await this._editor.snapshot({ cameraId: cam.id, res: a.resolution || '2K', linkTo: link, silent: true, frame: a.frame === 'current' ? '' : a.frame });
            else r = await this.quickSnapshot(n.id, { cameraId: cam.id, res: a.resolution || '2K', linkTo: link, silent: true, time, frame: a.frame });
            if (!r || !r.node) return { ok: false, error: '截图失败' };
            return { ok: true, created: { id: r.node.id, name: r.node.name, w: r.node.stageShot && r.node.stageShot.w, h: r.node.stageShot && r.node.stageShot.h }, linkedTo: r.linked ? link : undefined, cost: 0, next: '截图已作为参考图节点放到画布；如需据此生成图片/视频，创建或连到生成节点后用 request_generation' };
        }
    };

    global.CanvasStage3D = CanvasStage3D;
})(window);
