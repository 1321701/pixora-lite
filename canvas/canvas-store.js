/**
 * canvas-store.js
 * 画布文档持久化：localStorage 即时存 + 防抖同步云端
 * 支持多页（pages）：一个文档下管理多个画布页
 */
(function (global) {
    'use strict';

    const LS_KEY = 'nano_canvas_current';
    const SAVE_DELAY = 2000;

    const CanvasStore = {
        // 文档状态：扁平结构，画布直接承载内容（不再有子画布/多页层级）
        document: {
            canvasId: null,
            name: '未命名画布',
            viewport: { x: 0, y: 0, scale: 1 },
            blocks: [],
            edges: [],
            groups: {}
        },
        _saveTimer: null,
        _saving: false,
        // 云端文档版本号：保存成功/加载云端时同步，用于多标签保存冲突检测
        _cloudVersion: 0,
        _forceNextSave: false,
        // 标记本次请求是否为保存期间排队的补保存（其版本号以服务端响应为准，409 不应弹窗）
        _isPendingRetry: false,
        // 409 后已自动静默重试过一次（防止死循环），仍失败才提示用户
        _autoRetried409: false,

        // 兼容旧代码的代理属性
        get canvasId() { return this.document.canvasId; },
        get name() { return this.document.name; },

        init() {
            this.statusDotEl = document.getElementById('saveStatusDot');
            this.statusTextEl = document.getElementById('saveStatusText');
            // _VISSAVE_20261029 切后台只做异步保存（且只在有未保存改动时）；同步请求仅保留给真正关闭/刷新页面
            window.addEventListener('beforeunload', () => { if (this._isDirty()) this._flushBeforeUnload(); });
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'hidden' || !this._isDirty()) return;
                clearTimeout(this._saveTimer);
                this.saveCloud();
            });
        },

        // 页面关闭/刷新/切后台时强制刷一次本地存储
        _flushBeforeUnload() {
            try { this._saveLocal(); } catch (e) { /* ignore */ }
            const userId = this.getUserId();
            if (!userId || !this.document.canvasId) return;
            try { this.saveCloud(); } catch (e) { /* ignore */ }
        },

        getUserId() {
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                return user.id;
            } catch { return undefined; }
        },

        _authHeaders(extra) {
            let t;
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                t = user.token;
            } catch { /* ignore */ }
            return Object.assign(t ? { 'Authorization': 'Bearer ' + t } : {}, extra || {});
        },

        backendUrl() {
            return API_CONFIG.baseUrl;
        },

        // 收集完整文档状态（扁平结构）
        snapshot() {
            const doc = this.document;
            const snap = {
                canvasId: doc.canvasId,
                name: doc.name,
                viewport: { ...CanvasCore.viewport },
                blocks: global.CanvasBlocks.serialize(),
                edges: global.CanvasEdges.serialize(),
                groups: global.CanvasBlocks.serializeGroups()
            };
            // 导演台（剧本/分镜/成片记录）：未使用过导演台的画布为 null，服务端据此清空/不存
            snap.director = global.CanvasDirector ? global.CanvasDirector.serialize() : (doc.director || null);
            // AI 助手对话（最近 50 条消息，≤300KB）：没有对话为 null，服务端据此清空/不存
            snap.agent = global.CanvasAgent ? global.CanvasAgent.serialize() : (doc.agent || null);
            return this._sanitizeBlocks(snap);
        },

        // 兜底清理：剔除块中内联的 base64 图片数据（data: 开头），
        // 防止超大 base64 写入 localStorage / 云端导致卡顿、保存失败。
        // 只清理保存副本，不影响当前会话内的图片显示。
        _sanitizeBlocks(snap) {
            try {
                const cloned = JSON.parse(JSON.stringify(snap));
                (Array.isArray(cloned.blocks) ? cloned.blocks : []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    ['imageUrl', 'previewUrl', 'mediumUrl'].forEach(k => {
                        if (typeof b[k] === 'string' && b[k].indexOf('data:') === 0) b[k] = '';
                    });
                });
                return cloned;
            } catch (e) {
                return snap;
            }
        },

        // 防抖保存（本地立即 + 云端延迟）
        _rev: 0,
        _savedRev: 0,
        _isDirty() { return this._rev !== this._savedRev; },

        scheduleSave() {
            this._rev++;
            this._saveLocal();
            this._setStatus('saving');
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.saveCloud(), SAVE_DELAY);
        },

        _saveLocal() {
            try {
                localStorage.setItem(LS_KEY, JSON.stringify(this.snapshot()));
            } catch (e) { /* 容量超限忽略 */ }
        },

        saveNow() {
            this._saveLocal();
            clearTimeout(this._saveTimer);
            return this.saveCloud();
        },

        async saveCloud() {
            const userId = this.getUserId();
            if (!userId) {
                this._setStatus('local');
                return;
            }
            if (this._saving) {
                this._pendingSave = true;
                return;
            }
            this._saving = true;
            this._setStatus('saving');
            const rev = this._rev;
            try {
                const force = this._forceNextSave === true;
                const res = await fetch(`${this.backendUrl()}/api/canvas/save`, {
                    method: 'POST',
                    headers: this._authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ userId, canvas: this.snapshot(), clientVersion: this._cloudVersion, force })
                });
                const data = await res.json();
                if (data.code === 0 && data.data) {
                    this._forceNextSave = false;
                    this._rateLimitRetried = false;
                    this._autoRetried409 = false;
                    this.document.canvasId = data.data.canvasId;
                    if (typeof data.data.version === 'number') this._cloudVersion = data.data.version;
                    this._savedRev = rev;
                    this._syncDocumentUrl(data.data.canvasId);
                    this._saveLocal();
                    this._setStatus('saved');
                } else if (res.status === 429 || data.code === 429) {
                    // 限流退避：15 秒后自动重试一次（携带最新快照），期间保持 saving 状态，避免密集重发加剧限流
                    if (!this._rateLimitRetried) {
                        this._rateLimitRetried = true;
                        this._saving = false;
                        this._pendingSave = false;
                        setTimeout(() => this.saveCloud(), 15000);
                        return;
                    }
                    this._rateLimitRetried = false;
                    this._setStatus('error');
                } else if (data.code === 409) {
                    // 高频编辑下自身补保存造成的版本错位：自动拉取云端版本号后带最新快照静默重试一次
                    if (!this._autoRetried409) {
                        this._autoRetried409 = true;
                        await this._syncVersionFromCloud();
                        this._saving = false;
                        this.saveCloud();
                        return;
                    }
                    this._autoRetried409 = false;
                    this._handleSaveConflict();
                } else {
                    this._setStatus('error');
                }
            } catch (e) {
                console.error('[画布] 云端保存失败:', e);
                this._setStatus('error');
            }
            this._saving = false;
            if (this._pendingSave) {
                this._pendingSave = false;
                this._autoRetried409 = false;
                this.saveCloud();
            }
        },

        // 从云端拉取当前画布的最新版本号（用于 409 后自动对齐，不覆盖本地内容）
        async _syncVersionFromCloud() {
            const userId = this.getUserId();
            if (!userId || !this.document.canvasId) return;
            try {
                const res = await fetch(`${this.backendUrl()}/api/canvas/${this.document.canvasId}?userId=${userId}`, { headers: this._authHeaders() });
                const data = await res.json();
                if (data.code === 0 && data.data && typeof data.data.version === 'number') {
                    this._cloudVersion = data.data.version;
                }
            } catch (e) { /* 忽略，重试仍会按现有版本号进行 */ }
        },
        // 保存版本冲突：提示用户选择覆盖云端或放弃本地并重新加载云端版本
        // （仅在自动静默重试后仍冲突时才会走到这里，即确属他端编辑）
        async _handleSaveConflict() {
            this._setStatus('error');
            const overwrite = confirm('画布在其他窗口或设备上已被修改。\n\n点击「确定」用当前内容覆盖云端；\n点击「取消」放弃本地修改，重新加载云端最新版本。');
            if (overwrite) {
                this._forceNextSave = true;
                this.saveCloud();
            } else {
                const userId = this.getUserId();
                if (!userId || !this.document.canvasId) return;
                try {
                    const res = await fetch(`${this.backendUrl()}/api/canvas/${this.document.canvasId}?userId=${userId}`, { headers: this._authHeaders() });
                    const data = await res.json();
                    if (data.code === 0 && data.data) {
                        this._applyCanvas(data.data);
                        this._setStatus('saved');
                    }
                } catch (e) {
                    console.error('[画布] 冲突后重新加载失败:', e);
                }
            }
        },

        // 加载：优先 URL 指定 canvasId → 云端；否则本地缓存
        async load() {
            const params = new URLSearchParams(location.search);
            const urlId = params.get('id');
            const isNew = params.get('new') === '1';
            const userId = this.getUserId();

            if (urlId && userId) {
                try {
                    const res = await fetch(`${this.backendUrl()}/api/canvas/${urlId}?userId=${userId}`, { headers: this._authHeaders() });
                    const data = await res.json();
                    if (data.code === 0 && data.data) {
                        this._applyCanvas(data.data);
                        return;
                    }
                } catch (e) {
                    console.error('[画布] 云端加载失败:', e);
                }
            }

            // 新建独立画布时不读取上一张画布的本地缓存，避免刷新后看起来被覆盖。
            if (isNew) {
                this._initEmptyDocument();
                return;
            }

            // 本地缓存兜底
            try {
                const cached = localStorage.getItem(LS_KEY);
                if (cached) {
                    this._applyCanvas(JSON.parse(cached));
                    return;
                }
            } catch (e) { /* ignore */ }

            // 全新空文档（单页）
            this._initEmptyDocument();
        },

        // 初始化空文档（扁平结构）
        _initEmptyDocument() {
            this.document = {
                canvasId: null,
                name: '未命名画布',
                viewport: { x: 0, y: 0, scale: 1 },
                blocks: [],
                edges: [],
                groups: {},
                director: null,
                agent: null
            };
        },

        _applyCanvas(canvas) {
            // 旧多页格式（pages 数组）→ 迁移为扁平结构：保留用户最后使用页面的内容
            if (Array.isArray(canvas.pages) && canvas.pages.length > 0) {
                const page = canvas.pages.find(p => p.pageId === canvas.currentPageId) || canvas.pages[0];
                canvas = {
                    canvasId: canvas.canvasId,
                    name: canvas.name,
                    version: canvas.version,
                    viewport: page.viewport || { x: 0, y: 0, scale: 1 },
                    blocks: page.blocks || [],
                    edges: page.edges || [],
                    groups: page.groups || {},
                    director: canvas.director || null,
                    agent: canvas.agent || null
                };
            }

            this.document = {
                canvasId: canvas.canvasId || null,
                name: canvas.name || '未命名画布',
                viewport: Object.assign({ x: 0, y: 0, scale: 1 }, canvas.viewport),
                blocks: Array.isArray(canvas.blocks) ? canvas.blocks : [],
                edges: Array.isArray(canvas.edges) ? canvas.edges : [],
                groups: canvas.groups || {},
                director: (canvas.director && typeof canvas.director === 'object') ? canvas.director : null,
                agent: (canvas.agent && typeof canvas.agent === 'object') ? canvas.agent : null
            };
            // 从云端加载的画布带版本号：记录为保存冲突检测基准（本地缓存无版本号则保持原值）
            if (typeof canvas.version === 'number') this._cloudVersion = canvas.version;
            if (this.document.canvasId) this._syncDocumentUrl(this.document.canvasId);

            // 加载文档内容到画布
            this._loadDocument();
        },

        // 加载文档内容到画布
        _loadDocument() {
            const doc = this.document;
            CanvasCore.viewport = Object.assign({ x: 0, y: 0, scale: 1 }, doc.viewport);
            global.CanvasBlocks.load(doc.blocks);
            global.CanvasBlocks.loadGroups(doc.groups);
            global.CanvasEdges.load(doc.edges);
            if (global.CanvasDirector) global.CanvasDirector.load(doc.director || null);
            if (global.CanvasAgent) global.CanvasAgent.load(doc.agent || null);
            CanvasCore.applyTransform();
        },

        // 首次保存后把独立画布 ID 写入地址；刷新、复制链接和跨设备打开都会定位到同一份画布。
        _syncDocumentUrl(canvasId) {
            if (!canvasId || !global.history || !global.location) return;
            try {
                const url = new URL(global.location.href);
                if (url.searchParams.get('id') === canvasId && !url.searchParams.has('new')) return;
                url.searchParams.set('id', canvasId);
                url.searchParams.delete('new');
                global.history.replaceState(null, '', url.pathname + url.search + url.hash);
            } catch (e) { /* 地址同步失败不影响保存 */ }
        },

        // 获取当前用户的全部独立画布，仅返回元信息，避免列表加载大体积节点数据。
        async listDocuments() {
            const userId = this.getUserId();
            if (!userId) return [];
            try {
                const res = await fetch(`${this.backendUrl()}` + '/api/canvas',
                    { headers: this._authHeaders() }
                );
                const data = await res.json();
                return data.code === 0 && Array.isArray(data.data) ? data.data : [];
            } catch (e) {
                console.warn('[画布] 列表加载失败:', e);
                return [];
            }
        },

        // 切换到指定的独立画布，使用 URL id 确保刷新后仍加载同一份数据。
        openDocument(canvasId) {
            if (!canvasId) return;
            location.href = 'canvas.html?id=' + encodeURIComponent(canvasId);
        },

        // 新建独立画布，不复用当前画布的本地缓存。
        createDocument() {
            location.href = 'canvas.html?new=1';
        },

        // 删除指定的独立画布
        async deleteDocument(canvasId) {
            if (!canvasId) return false;
            try {
                const res = await fetch(`${this.backendUrl()}/api/canvas/${canvasId}`, {
                    method: 'DELETE',
                    headers: this._authHeaders()
                });
                const data = await res.json();
                return data.code === 0;
            } catch (e) {
                console.warn('[画布] 删除失败:', e);
                return false;
            }
        },

        setName(name) {
            this.document.name = name || '未命名画布';
            this.scheduleSave();
        },

        // 保存状态指示灯
        // status: 'saving'(黄) | 'saved'(绿) | 'error'(红) | 'local'(灰) | 'idle'(灰)
        _setStatus(status) {
            if (this.statusDotEl) {
                this.statusDotEl.className = 'save-dot save-dot-' + status;
            }
            if (this.statusTextEl) {
                const labels = { saving: '保存中', saved: '已保存', error: '保存失败', local: '本地保存', idle: '' };
                this.statusTextEl.textContent = labels[status] || '';
            }
        }
    };

    global.CanvasStore = CanvasStore;
})(window);
