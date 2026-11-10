/**
 * canvas-main.js
 * 主编排：初始化各模块、工具栏、右键菜单、拖拽上传、删除快捷键
 * 浮层提示词输入区：选中节点时在其下方显示，复用通用模块 PromptBar（与主页完全一致的逻辑与样式）
 *   - 参考图节点点击「生成」→ 自动新建图片节点并连入，再生成
 *   - 图片节点点击「生成」→ 直接生成
 *   - 连线变化时自动同步上游图片到 PromptBar 的参考图列表
 */
(function (global) {
    'use strict';

    // 右键菜单图标（线性 24px 网格）
    const CTX_ICONS = {
        video: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M10.2 9.3l5 2.7-5 2.7z"/>',
        audio: '<path d="M4.5 9.5v5h3.5l4.5 3.5v-12L8 9.5H4.5z"/><path d="M16 9a4.2 4.2 0 010 6"/>',
        gen: '<path d="M12 3c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6z"/><path d="M18.5 15.5v4M16.5 17.5h4"/>',
        pano: '<path d="M3.5 12a8.5 4.2 0 0 0 17 0"/><path d="M20.5 12a8.5 4.2 0 0 0-17 0" stroke-dasharray="2 2.6"/><path d="m17.5 15.6 3-3.4 1.3 3.9"/>',
        stage: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>',
        text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
        image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L6.5 19.5"/>',
        paste: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.5h5v1M9.5 10h5M9.5 14h3"/>',
        check: '<path d="m5.5 12.5 4.2 4 8.8-9"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
        play: '<path d="M8 5.5v13l10.5-6.5z"/>',
        link: '<rect x="3" y="8" width="6" height="8" rx="1.5"/><rect x="15" y="8" width="6" height="8" rx="1.5"/><path d="M9 12h6"/>',
        download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
        copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
        dup: '<rect x="4.5" y="4.5" width="11" height="11" rx="2"/><path d="M19.5 9v8.5a2 2 0 0 1-2 2H9M14 17.5h0"/>',
        trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v5.5M14 11v5.5"/>'
    };
    const CanvasMain = {
        _lastMenuWorld: null,
        _activeNodeId: null,   // 与提示词栏绑定的生成节点（仅单选 gen 节点时）
        _toolNodeId: null,     // 显示顶部工具栏的节点（单选任意节点）
        _inDock: true,         // 提示词栏是否处于底部停靠模式
        _draftPrompt: '',      // 停靠模式下的草稿提示词
        _dockUploads: [],      // 停靠模式下上传的参考图节点 id
        _floatEl: null,
        _toolbarFloatEl: null,

        async init() {
            CanvasCore.init();
            global.CanvasBlocks.init();
            global.CanvasSelection.init();
            global.CanvasEdges.init();
            global.CanvasGenerate.init();
            global.CanvasHistory.init();
            global.CanvasStore.init();
            // 画布历史记录/收藏弹窗
            if (global.CanvasHistoryUI) global.CanvasHistoryUI.init();
            // 角色库（左侧导航入口 + 右侧抽屉；角色数据跨画布共享）
            if (global.CharacterLib) global.CharacterLib.init();

            this._floatEl = document.getElementById('canvasPromptFloat');

            // 节点顶部工具栏：移到屏幕空间，避免随画布缩放
            this._toolbarFloatEl = document.getElementById('nodeToolbarFloat');
            if (!this._toolbarFloatEl) {
                this._toolbarFloatEl = document.createElement('div');
                this._toolbarFloatEl.id = 'nodeToolbarFloat';
                this._toolbarFloatEl.className = 'node-toolbar-float hidden';
                const appEl = document.querySelector('.canvas-app');
                if (appEl) appEl.appendChild(this._toolbarFloatEl);
            }
            this._bindToolbarFloatEvents();

            // 初始化通用提示词栏（复用主页完整逻辑）
            global.PromptBar.init();
            // 接管生成行为
            global.PromptBar.onGenerate = (params) => this._onGenerate(params);
            // 参考图变化时同步到当前节点
            global.PromptBar.onRefsChange = () => this._onRefsChange();
            // 不在画布内打开图片编辑器（可后续接入）
            global.PromptBar.onOpenImageEditor = (imageUrl, displayIndex, fileId) => this._onOpenImageEditor(imageUrl, displayIndex, fileId);
            // 图片编辑器保存回调
            window.imageEditorOnSave = (payload) => this._onImageEditorSave(payload);
            // 编辑器可能调用的主页全局函数存根
            if (!window.getBackendUrl) window.getBackendUrl = () => global.API_CONFIG.baseUrl;
            // 接管「添加参考图」按钮：上传到画布并连接当前节点
            global.PromptBar.onAddRefImage = (file) => this._onAddRefImage(file);
            // 比例选择变化：实时更新当前生成节点的框比例
            global.PromptBar.onAspectChange = (aspect) => this._onAspectChange(aspect);
            // 模型/分辨率变化时立即保存到当前节点（每节点独立）
            global.PromptBar.onParamChange = (type, value) => this._onParamChange(type, value);

            this._bindToolbar();
            if (global.CanvasUI) global.CanvasUI.init();
            // 360 全景 / 角色多视角（提示词栏全景开关、工具坞入口、查看器快捷键）
            if (global.CanvasPano) global.CanvasPano.init();
            // 3D 片场（工具坞入口、节点、懒加载编辑器）
            if (global.CanvasStage3D) global.CanvasStage3D.init();
            this._bindTopbar();
            this._bindCtxMenu();
            this._bindDelete();
            this._bindCopyPaste();
            this._bindDropUpload();
            this._bindRefFileInput();
            this._bindFloatDismiss();
            this._bindMediaUpload();
            this._bindPlayPress();
            this._bindVideoTrim();
            this._bindAudioTrim();
            this._bindExpandFloat();
            this._bindPaste();
            this._initFullscreenViewer();

            // 平移/缩放时工具栏跟随 + 提示词浮层跟随 + 小地图视口框更新 + 节点显示级别刷新
            CanvasCore.onTransform(() => {
                this._positionToolbar();
                this._positionFloat();
                if (global.CanvasMinimap) global.CanvasMinimap.scheduleRender();
                // 缩放变化时按级别切换节点显示图（小缩略/中缩略/原图）
                // 拖动平移时跳过：平移不改变缩放级别，无需切换图片 URL
                if (global.CanvasBlocks && !global.CanvasEdges._dragging) global.CanvasBlocks.refreshDisplayLevel();
            });

            // 初始化小地图
            if (global.CanvasMinimap) global.CanvasMinimap.init();

            try {
                await global.CanvasStore.load();
            } finally {
                // 云端数据就绪（或失败）后撤掉启动加载层（淡出），避免先闪空画布引导
                requestAnimationFrame(() => document.body.classList.remove('canvas-booting'));
            }
            // 加载完成后同步画布总标题到输入框（避免刷新后仍显示"未命名画布"）
            const titleEl2 = document.getElementById('canvasTitle');
            if (titleEl2) titleEl2.value = global.CanvasStore.document.name || '未命名画布';
            global.CanvasHistory.reset();
            // 角色节点：按角色库缓存刷新封面 / 名称（角色库可能已在其他画布更新）
            if (global.CharacterLib) global.CharacterLib.refreshNodes();
            // 加载完成后刷新小地图
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
            // 恢复上次的提示词栏隐藏/显示状态，再重置选中状态
            this._restorePromptFloatHidden();
            // 恢复上次的连线隐藏状态
            this._hookEdgeAddForTemp();
            this._restoreEdgesHidden();
            // 加载完成后重置选中状态：收起工具栏，提示词栏进入底部停靠模式
            this._resetSelectionToDock();
            // Lite 专属版「在画布中继续编辑」带来的素材/提示词（同源 localStorage 交接）
            this._consumeLitePending();
            // 恢复画布任务（页面刷新后重新轮询 + 重新关联生成中节点）
            await this._resumeCanvasTasks();
            // 兜底：本地活跃任务列表/内存映射失效的节点（如放置很久、清缓存），
            // 用节点自身持久化的 taskId 直接向后端查询真实状态
            if (global.CanvasGenerate && global.CanvasGenerate.recoverStuckNodes) {
                global.CanvasGenerate.recoverStuckNodes();
            }
            // 老数据补齐：扫描缺预览版的视频节点依次入队（稍后执行，避开首屏加载高峰）
            setTimeout(() => { if (global.VideoProxy) global.VideoProxy.scanAll(); }, 3000);
        },

        // Lite 专属版交接，两种来源：
        //  1) 托管版（同域）：IndexedDB pixora-handoff/pending['lite'] = { kind:'media'|'prompt', mediaType, blob?, url?, prompt, ts }
        //  2) 自部署 / 开源版（跨域）：URL 参数 ?lite_import=<https 素材>&lite_type=image|video&lite_prompt=...（读后从地址栏抹掉）
        // 只有地址没有字节时，经 /v1/media/import-url 由服务端代取（画布 CSP 不允许直连中转站）
        _consumeLitePending() {
            const sp = new URLSearchParams(location.search);
            if (sp.has('lite_import') || sp.has('lite_prompt')) {
                const u = String(sp.get('lite_import') || '');
                const p = {
                    kind: /^https:\/\//.test(u) ? 'media' : 'prompt',
                    mediaType: sp.get('lite_type') === 'video' ? 'video' : 'image',
                    url: u, prompt: sp.get('lite_prompt') || '', ts: Date.now()
                };
                ['lite_import', 'lite_type', 'lite_prompt', 'invite', 'from'].forEach((k) => sp.delete(k));
                const rest = sp.toString();
                // 注意：画布页某个全局脚本声明了顶层 history 数组，必须显式用 window.history
                window.history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
                this._applyLitePending(p);
                return;
            }
            if (!window.indexedDB) return;
            const take = () => new Promise((resolve) => {
                let req;
                try { req = indexedDB.open('pixora-handoff', 1); } catch (_) { resolve(null); return; }
                req.onupgradeneeded = () => { try { req.result.createObjectStore('pending'); } catch (_) {} };
                req.onerror = () => resolve(null);
                req.onsuccess = () => {
                    const db = req.result;
                    try {
                        const tx = db.transaction('pending', 'readwrite');
                        const st = tx.objectStore('pending');
                        const g = st.get('lite');
                        g.onsuccess = () => { st.delete('lite'); resolve(g.result || null); };
                        g.onerror = () => resolve(null);
                        tx.oncomplete = () => db.close();
                    } catch (_) { db.close(); resolve(null); }
                };
            });
            take().then((p) => this._applyLitePending(p));
        },

        async _applyLitePending(p) {
            try {
                if (!p || !p.ts || Date.now() - p.ts > 30 * 60 * 1000) return;
                const CB = global.CanvasBlocks;
                const prompt = String(p.prompt || '').slice(0, 4000);
                if (prompt && global.PromptBar && global.PromptBar.setPromptText) {
                    try { global.PromptBar.setPromptText(prompt); } catch (_) {}
                    if (this._inDock) this._draftPrompt = prompt;
                }
                if (p.kind !== 'media') return;
                const isVid = p.mediaType === 'video';
                const c = CB.viewportCenterWorld();
                let blob = (p.blob instanceof Blob && p.blob.size) ? p.blob : null;
                const url = /^https:\/\//.test(String(p.url || '')) ? p.url : '';
                if (!blob && url) {
                    try {
                        const r = await fetch(`${global.API_CONFIG.baseUrl}/v1/media/import-url`, {
                            method: 'POST',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                            body: JSON.stringify({ url })
                        });
                        if (r.ok && /^(image|video)\//.test(r.headers.get('content-type') || '')) blob = await r.blob();
                    } catch (_) {}
                }
                if (blob) {
                    const type = /^(image|video)\//.test(blob.type || '') ? blob.type : (isVid ? 'video/mp4' : 'image/png');
                    const vid = /^video\//.test(type);
                    const ext = vid ? (type === 'video/quicktime' ? '.mov' : '.mp4') : ('.' + (type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
                    await this._createRefNode(new File([blob], 'lite-' + Date.now() + ext, { type }), c.x - 110, c.y - 110);
                    return;
                }
                // 服务端也取不到：退回外链节点（外链可能过期）
                if (!url) return;
                const node = CB.addRef(isVid
                    ? { x: c.x - 150, y: c.y - 85, w: 300, h: 169, name: '来自专属版的视频', mediaType: 'video', mediaUrl: url, videoUrl: url, status: 'idle' }
                    : { x: c.x - 110, y: c.y - 110, name: '来自专属版的图片', imageUrl: url, previewUrl: url, status: 'idle' });
                CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            } catch (e) {
                console.warn('[Lite 交接] 导入素材失败:', e && e.message);
            }
        },

        // 恢复画布任务：刷新后把生成中节点重新关联到任务，已完成的直接回填结果
        async _resumeCanvasTasks() {
            if (typeof TaskClient === 'undefined') return;
            try {
                const tasks = await TaskClient.resumeTasks();
                if (!tasks || tasks.length === 0) return;
                // 仅处理画布来源的任务
                const canvasTasks = tasks.filter(t => t.source === 'canvas');
                canvasTasks.forEach(task => {
                    const nodeId = task.params && task.params.nodeId;
                    if (!nodeId) return;
                    const node = global.CanvasBlocks.getById(nodeId);
                    if (!node) return;
                    // 节点已发起新一轮生成（taskId 变更）：旧任务结果不回写
                    if (node.taskId && node.taskId !== task.id) return;

                    if (task.status === 'completed') {
                        // 任务已完成但节点还显示生成中 → 直接回填结果（图片 / 视频 / 音频，与实时回填共用同一函数）
                        const kind = global.CanvasGenerate && global.CanvasGenerate.applyTaskResult
                            ? global.CanvasGenerate.applyTaskResult(nodeId, task.result) : '';
                        if (kind) {
                            if (global.CanvasHistory) global.CanvasHistory.snapshot();
                            if (global.CanvasStore) global.CanvasStore.saveNow();
                        } else {
                            // completed 但无 url：视为失败
                            global.CanvasBlocks.update(nodeId, { status: 'failed', taskId: '' });
                            if (global.CanvasStore) global.CanvasStore.saveNow();
                        }
                    } else if (task.status === 'failed') {
                        global.CanvasBlocks.update(nodeId, { status: 'failed', taskId: '' });
                        if (global.CanvasStore) global.CanvasStore.saveNow();
                    } else {
                        // 运行中：重建映射，后续轮询通过 taskStatusUpdated 通知
                        if (global.CanvasGenerate) {
                            global.CanvasGenerate._taskNodeMap[task.id] = nodeId;
                        }
                    }
                });
            } catch (e) {
                console.warn('[画布] 恢复任务失败:', e);
            }
        },

        _bindToolbar() {
            // 绑定底部悬浮胶囊内的工具按钮
            document.querySelectorAll('#toolDock .capsule-btn[data-tool]').forEach(btn => {
                btn.addEventListener('click', () => CanvasCore.setTool(btn.dataset.tool));
            });
            // 隐藏/显示底部固定提示词输入区
            const hideBtn = document.getElementById('togglePromptFloatBtn');
            if (hideBtn) {
                hideBtn.addEventListener('click', () => this._togglePromptFloatHidden());
            }
            // 快捷键帮助弹窗（只读）
            const helpBtn = document.getElementById('shortcutHelpBtn');
            if (helpBtn) helpBtn.addEventListener('click', () => this._showShortcutHelp());
            // 连线显隐切换
            const edgesBtn = document.getElementById('toggleEdgesBtn');
            if (edgesBtn) edgesBtn.addEventListener('click', () => this._toggleEdgesHidden());
        },

        // 隐藏/显示底部固定提示词输入区：隐藏后工具栏自动居中
        _togglePromptFloatHidden() {
            const appEl = document.querySelector('.canvas-app');
            const hidden = appEl && appEl.classList.toggle('prompt-float-hidden');
            if (!appEl) return;
            const isHidden = appEl.classList.contains('prompt-float-hidden');
            const btn = document.getElementById('togglePromptFloatBtn');
            if (btn) {
                btn.classList.toggle('active', isHidden);
                btn.dataset.tip = isHidden ? '显示固定提示词输入区（当前：跟随节点）' : '隐藏提示词输入区（当前：固定底部）';
            }
            // 持久化到浏览器：刷新后保持隐藏/显示状态
            try { localStorage.setItem('nano_prompt_float_hidden', isHidden ? '1' : '0'); } catch (e) { /* 忽略 */ }
            // 切换后立即重新应用提示词栏模式（固定 ↔ 跟随）
            this.onSelectionChange();
        },
        // 初始化时恢复上次隐藏/显示状态（localStorage 持久化）
        _restorePromptFloatHidden() {
            try {
                if (localStorage.getItem('nano_prompt_float_hidden') === '1') {
                    const appEl = document.querySelector('.canvas-app');
                    if (appEl) appEl.classList.add('prompt-float-hidden');
                    const btn = document.getElementById('togglePromptFloatBtn');
                    if (btn) {
                        btn.classList.add('active');
                        btn.dataset.tip = '显示固定提示词输入区（当前：跟随节点）';
                    }
                }
            } catch (e) { /* 忽略 */ }
        },
        // 固定模式判定：底部固定提示词输入区可见时为固定模式（默认），隐藏时为跟随模式
        _isPromptFixed() {
            const appEl = document.querySelector('.canvas-app');
            return !appEl || !appEl.classList.contains('prompt-float-hidden');
        },

        // ===== 连线显隐：隐藏全部连线；隐藏时单选节点临时显示其连线；拖线中临时全部显示 =====
        _edgesHidden: false,

        _toggleEdgesHidden() {
            const appEl = document.querySelector('.canvas-app');
            this._edgesHidden = !this._edgesHidden;
            if (appEl) appEl.classList.toggle('edges-hidden', this._edgesHidden);
            const btn = document.getElementById('toggleEdgesBtn');
            if (btn) {
                btn.classList.toggle('active', this._edgesHidden);
                btn.dataset.tip = this._edgesHidden ? '显示全部连接线（当前：隐藏，选中节点临时显示其连线）' : '隐藏连接线（选中节点临时显示其连线）';
            }
            try { localStorage.setItem('nano_canvas_edges_hidden', this._edgesHidden ? '1' : '0'); } catch (e) { /* 忽略 */ }
            if (this._edgesHidden) {
                const sel = global.CanvasSelection && global.CanvasSelection.getSelectedIds ? global.CanvasSelection.getSelectedIds() : [];
                this._applyEdgeTempShow(sel.length === 1 ? global.CanvasBlocks.getById(sel[0]) : null);
            } else {
                this._clearEdgeTempShow();
            }
        },
        // 初始化时恢复上次的连线显隐状态（localStorage 持久化）
        _restoreEdgesHidden() {
            try {
                if (localStorage.getItem('nano_canvas_edges_hidden') === '1') {
                    this._edgesHidden = false; // 从未隐藏态切入隐藏态，复用 toggle 逻辑
                    this._toggleEdgesHidden();
                }
            } catch (e) { /* 忽略 */ }
        },
        // 隐藏模式下：单选节点时临时显示该节点的全部连线；其他情况全部恢复隐藏
        _recentEdgeIds: null,
        // 隐藏模式下新建的连线也临时显示：包装 CanvasEdges.add，直到点空白取消选择才恢复隐藏
        _hookEdgeAddForTemp() {
            const CE = global.CanvasEdges;
            if (!CE || CE._tempHooked) return;
            CE._tempHooked = true;
            const orig = CE.add.bind(CE);
            CE.add = (...args) => {
                const edge = orig(...args);
                if (edge && this._edgesHidden) {
                    (this._recentEdgeIds || (this._recentEdgeIds = new Set())).add(edge.id);
                    // 边分组在 rAF 渲染中才创建，等两帧后再打临时显示标记
                    requestAnimationFrame(() => requestAnimationFrame(() => this._markRecentEdges()));
                }
                return edge;
            };
        },
        _markRecentEdges() {
            const layer = global.CanvasEdges && global.CanvasEdges.layerEl;
            if (!layer || !this._edgesHidden || !this._recentEdgeIds) return;
            this._recentEdgeIds.forEach(id => {
                const g = layer.querySelector(`[data-edge-group="${id}"]`);
                if (g) g.classList.add('edge-temp');
            });
        },
        _applyEdgeTempShow(single) {
            const layer = global.CanvasEdges && global.CanvasEdges.layerEl;
            if (!layer) return;
            layer.querySelectorAll('.edge-temp').forEach(g => g.classList.remove('edge-temp'));
            if (!single) this._recentEdgeIds = null;
            if (!this._edgesHidden || !global.CanvasEdges || !global.CanvasEdges.edges) return;
            const recent = this._recentEdgeIds;
            global.CanvasEdges.edges.forEach(e => {
                if ((single && (e.from === single.id || e.to === single.id)) || (recent && recent.has(e.id))) {
                    const g = layer.querySelector(`[data-edge-group="${e.id}"]`);
                    if (g) g.classList.add('edge-temp');
                }
            });
        },
        _clearEdgeTempShow() {
            const layer = global.CanvasEdges && global.CanvasEdges.layerEl;
            if (layer) layer.querySelectorAll('.edge-temp').forEach(g => g.classList.remove('edge-temp'));
        },

        // ===== 快捷键帮助弹窗（只读展示，不可更改） =====
        _showShortcutHelp() {
            let mask = document.getElementById('shortcutHelpMask');
            if (!mask) {
                const items = [
                    ['选择工具', 'V'], ['抓手工具', 'H'], ['临时抓手（按住）', 'Space'], ['缩放适应全部', 'Shift+1'],
                    ['新建图片生成', 'G'], ['新建文本', 'T'], ['上传图片', 'U'],
                    ['复制选中', 'Ctrl+C'], ['粘贴', 'Ctrl+V'],
                    ['撤销', 'Ctrl+Z'], ['重做', 'Ctrl+Y'], ['删除选中', 'Del'], ['关闭弹窗 / 查看器', 'Esc']
                ];
                mask = document.createElement('div');
                mask.id = 'shortcutHelpMask';
                mask.className = 'shortcut-help-mask hidden';
                const card = document.createElement('div');
                card.className = 'shortcut-help-card';
                card.innerHTML = '<div class="shortcut-help-head"><span>快捷键</span>'
                    + '<button class="capsule-btn" id="shortcutHelpClose"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
                    + '<div class="shortcut-help-grid">' + items.map(it => '<div class="shortcut-help-item"><span>' + it[0] + '</span><kbd>' + it[1] + '</kbd></div>').join('') + '</div>';
                mask.appendChild(card);
                document.body.appendChild(mask);
                mask.addEventListener('click', (e) => { if (e.target === mask) mask.classList.add('hidden'); });
                card.querySelector('#shortcutHelpClose').addEventListener('click', () => mask.classList.add('hidden'));
            }
            mask.classList.remove('hidden');
        },

        _bindTopbar() {
            // 适应全部
            document.getElementById('zoomFitBtn').addEventListener('click', () => {
                CanvasCore.zoomToFit(global.CanvasBlocks.getBounds());
            });
            // 保存按钮
            document.getElementById('saveBtn').addEventListener('click', () => global.CanvasStore.saveCloud());
            // 文档名编辑
            const titleEl = document.getElementById('canvasTitle');
            titleEl.addEventListener('change', () => global.CanvasStore.setName(titleEl.value.trim()));
            // 独立画布切换下拉
            this._bindDocumentSwitcher();
        },

        // 独立画布列表：此前服务端已有列表接口，但前端未使用，刷新后只能看到最后打开的一张。
        _bindDocumentSwitcher() {
            const btn = document.getElementById('canvasDocumentBtn');
            const dropdown = document.getElementById('canvasDocumentDropdown');
            if (!btn || !dropdown) return;

            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const willOpen = dropdown.classList.contains('hidden');
                dropdown.classList.toggle('hidden', !willOpen);
                if (willOpen) await this._renderDocumentDropdown();
            });

            document.addEventListener('mousedown', (e) => {
                if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
                    dropdown.classList.add('hidden');
                }
            }, true);
        },

        async _renderDocumentDropdown() {
            const dropdown = document.getElementById('canvasDocumentDropdown');
            if (!dropdown) return;
            dropdown.innerHTML = '<div class="page-dropdown-item canvas-document-loading">正在加载画布…</div>';
            const docs = await global.CanvasStore.listDocuments();
            const activeId = global.CanvasStore.document.canvasId;

            const delIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            let html = docs.map(doc => {
                const active = doc.canvasId === activeId ? ' active' : '';
                const name = this._esc(doc.name || '未命名画布');
                const blocks = Number(doc.blockCount) || 0;
                const id = this._esc(doc.canvasId || '');
                return '<div class="page-dropdown-item canvas-document-item' + active + '" data-canvas-id="' + id + '">' +
                    '<span class="page-dropdown-item-name">' + name + '</span>' +
                    '<span class="canvas-document-meta">' + blocks + ' 节点</span>' +
                    '<span class="page-dropdown-item-action canvas-document-del" data-canvas-id="' + id + '" title="删除该画布">' + delIcon + '</span>' +
                    '</div>';
            }).join('');

            if (!html) html = '<div class="page-dropdown-item canvas-document-loading">暂无已保存画布</div>';
            // 列表区可滚动，新建按钮固定在底部
            dropdown.innerHTML = '<div class="canvas-document-list">' + html + '</div>' +
                '<div class="page-dropdown-footer"><button id="createDocumentBtn">＋ 新建画布</button></div>';

            dropdown.querySelectorAll('.canvas-document-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const canvasId = item.dataset.canvasId;
                    if (!canvasId || canvasId === activeId) {
                        dropdown.classList.add('hidden');
                        return;
                    }
                    item.classList.add('active');
                    await global.CanvasStore.saveNow();
                    global.CanvasStore.openDocument(canvasId);
                });
            });

            // 删除按钮：二次确认后删除；删除当前打开的画布时跳到新建页
            dropdown.querySelectorAll('.canvas-document-del').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const canvasId = btn.dataset.canvasId;
                    const doc = docs.find(d => d.canvasId === canvasId);
                    if (!confirm('确定删除画布「' + (doc && doc.name ? doc.name : '未命名画布') + '」？删除后不可恢复。')) return;
                    const ok = await global.CanvasStore.deleteDocument(canvasId);
                    if (!ok) { alert('删除失败，请稍后重试'); return; }
                    if (canvasId === activeId) {
                        global.CanvasStore.createDocument();
                    } else {
                        this._renderDocumentDropdown();
                    }
                });
            });

            const createBtn = dropdown.querySelector('#createDocumentBtn');
            if (createBtn) createBtn.addEventListener('click', async () => {
                createBtn.disabled = true;
                createBtn.textContent = '正在保存当前画布…';
                await global.CanvasStore.saveNow();
                global.CanvasStore.createDocument();
            });
        },

        // 重置选中状态：收起工具栏，提示词栏回到底部停靠
        _resetSelectionToDock() {
            this._activeNodeId = null;
            this._toolNodeId = null;
            this._dockUploads = [];
            this._hideToolbar();
            this._enterDock([]);
        },

        // 点击浮层外部（空白/节点以外）时收起节点工具栏浮层
        // 提示词浮层（#canvasPromptFloat）由选中/取消选中节点逻辑控制显隐，不由这里管理
        _bindFloatDismiss() {
            document.addEventListener('mousedown', (e) => {
                // 右键菜单与拖线提示：点击非菜单区域时自动关闭并清理拖线虚线
                if (this.ctxMenu && !this.ctxMenu.classList.contains('hidden')) {
                    if (!e.target.closest || !e.target.closest('.ctx-menu')) {
                        this.ctxMenu.classList.add('hidden');
                        this._discardPendingMenuEdge();
                    }
                }
                const toolbarVisible = this._toolbarFloatEl && !this._toolbarFloatEl.classList.contains('hidden');
                if (!toolbarVisible) return;
                // 点在胶囊工具栏内 → 不处理
                if (this._toolbarFloatEl.contains(e.target)) return;
                // 点在提示词浮层内 → 不处理（避免点击提示词输入区误触发收起工具栏）
                if (this._floatEl && this._floatEl.contains(e.target)) return;
                // 点在节点上 → 不处理（节点点击逻辑会自行管理工具栏）
                if (e.target.closest && e.target.closest('.canvas-node')) return;
                // 点在悬浮胶囊/小地图/右键菜单 → 不处理
                if (e.target.closest && (e.target.closest('.float-capsule') || e.target.closest('.canvas-minimap') || e.target.closest('.ctx-menu'))) return;
                // 其余（画布空白平移等）→ 收起胶囊工具栏
                this._hideToolbar();
            }, true);  // 捕获阶段，确保先于其他逻辑执行
        },

        // ===== 选择变化 → 浮层显隐 =====
        onSelectionChange() {
            const ids = global.CanvasSelection.getSelectedIds();
            // 同步连线激活态（选中节点关联的连线高亮）
            if (global.CanvasEdges) global.CanvasEdges._syncActiveState();
            const isHeavy = ids.length > 15;
            const isMulti = ids.length > 1;
            const vp = global.CanvasCore && global.CanvasCore.viewportEl;
            if (vp) {
                vp.classList.toggle("sel-heavy", isHeavy);
                vp.classList.toggle("multi-select", isMulti);
            }
            const selLayer = global.CanvasBlocks && global.CanvasBlocks.layerEl;
            if (selLayer) {
                selLayer.classList.toggle("sel-heavy", isHeavy);
                selLayer.classList.toggle("multi-select", isMulti);
            }
            if (global.CanvasEdges && global.CanvasEdges.layerEl) {
                global.CanvasEdges.layerEl.classList.toggle("comets-heavy", isHeavy);
                global.CanvasEdges.layerEl.classList.toggle("multi-select", isMulti);
            // 框选完成后立即刷新连线，确保彗星不必等到下一次拖动才出现。
            if (global.CanvasEdges) global.CanvasEdges.refresh();
            }
            const single = ids.length === 1 ? global.CanvasBlocks.getById(ids[0]) : null;
            // 顶部工具栏：单选任意节点时显示
            this._toolNodeId = single ? single.id : null;
            // 选中别的节点 / 取消选中：关闭视频修剪面板（导出中保持，避免误中断）
            if (this._vtrim && !this._vtrim.exporting && (!single || single.id !== this._vtrim.nodeId)) this._closeVideoTrim();
            if (this._atrim && !this._atrim.exporting && (!single || single.id !== this._atrim.nodeId)) this._closeAudioTrim();
            if (single) this._showToolbar(); else this._hideToolbar();
            if (single && single.nodeType === 'gen') {
                // 单选生成节点：编辑该节点自己的提示词与参数
                if (this._activeNodeId !== single.id) {
                    if (this._activeNodeId) this._savePromptBarToNode(this._activeNodeId);
                    else if (this._inDock) this._draftPrompt = global.PromptBar.getPromptText();
                    this._inDock = false;
                    this._activeNodeId = single.id;
                    this._loadNodeToPromptBar(this._activeNodeId);
                }
                if (this._isPromptFixed()) {
                    // 固定模式：提示词栏始终停靠底部，不出现节点下方浮层
                    this._dockFloatEl();
                    this._floatEl.classList.remove('force-show');
                } else {
                    // 跟随模式：浮层跟随节点
                    this._showFloat();
                }
            } else if (single && single.nodeType === 'ref' && single.mediaType !== 'audio' && !this._isPromptFixed()) {
                // 跟随模式：单选参考图节点，提示词栏跟随节点（极简模式，隐藏上传按钮），与生成节点跟随行为一致
                if (this._activeNodeId !== single.id) {
                    if (this._activeNodeId) this._savePromptBarToNode(this._activeNodeId);
                    else if (this._inDock) this._draftPrompt = global.PromptBar.getPromptText();
                    this._inDock = false;
                    this._activeNodeId = single.id;
                    this._loadNodeToPromptBar(this._activeNodeId);
                }
                this._showFloat();
            } else {
                // 其余情况（未选中 / 多选 / 单选参考图或文本）：提示词栏停靠底部，选中内容作为生成上下文
                if (this._activeNodeId) this._savePromptBarToNode(this._activeNodeId);
                this._activeNodeId = null;
                // 停靠（固定）模式下单选参考图/素材节点：面板模式同样跟随节点类型
                if (single && single.nodeType === 'ref') global.PromptBar._syncModeForNode(single);
                this._enterDock(ids);
            }
            // 连线隐藏模式下：单选节点临时显示其全部连线，其余情况恢复隐藏
            this._applyEdgeTempShow(single);
            // 生成节点提示词栏下方「已关联角色」提示
            if (global.CharacterLib) global.CharacterLib.updateLinkedHint(this._activeNodeId);
        },

        // ===== 底部停靠模式 =====
        // 选中的图片节点（参考图 / 已出图的生成节点）+ 停靠模式下上传的图片 → 参考图
        _dockRefsFor(ids) {
            const CB = global.CanvasBlocks;
            const seen = new Set();
            const refs = [];
            const push = (b) => {
                if (!b || seen.has(b.id) || b.nodeType === 'text' || b.status === 'loading' || b.mediaType === 'video') return;
                const hi = b.imageUrl || b.previewUrl;
                if (!hi) return;
                seen.add(b.id);
                refs.push({ highUrl: hi, previewUrl: b.mediumUrl || b.previewUrl || hi, fileId: 'node_' + b.id, srcId: b.id });
            };
            (ids || []).forEach(id => push(CB.getById(id)));
            this._dockUploads = this._dockUploads.filter(id => CB.getById(id));
            this._dockUploads.forEach(id => push(CB.getById(id)));
            return refs.slice(0, 8);
        },

        _enterDock(ids) {
            const pb = global.PromptBar;
            if (!pb || !this._floatEl) return;
            const entering = !this._inDock;
            this._inDock = true;
            pb.setMode('full');
            const addImgBtn = document.getElementById('addImgBtn');
            if (addImgBtn) { addImgBtn.classList.remove('hidden', 'disabled'); addImgBtn.disabled = false; }
            // 固定模式：单选参考图节点时禁止上传（隐藏上传按钮，节点本身就是图）
            if (this._isPromptFixed() && ids && ids.length === 1) {
                const b = global.CanvasBlocks.getById(ids[0]);
                if (b && b.nodeType === 'ref' && addImgBtn) {
                    addImgBtn.classList.add('hidden');
                    addImgBtn.disabled = true;
                }
            }
            pb.setReferenceImages(this._dockRefsFor(ids));
            // 先注入参考图再恢复草稿，确保 [图片N] 标签能正确解析
            if (entering) pb.setPromptText(this._draftPrompt || '');
            pb._activeNodeGenerating = false;
            pb.updateGenerateButtonState();
            this._dockFloatEl();
            // 跟随模式下停靠分支只会由 多选框选 / 文本 / 音频 / 空选 触发，均不显示提示词栏
            //（单选生成/图片/视频节点走跟随浮层分支，不经过这里）
            this._floatEl.classList.remove('force-show');
            if (global.CanvasUI) global.CanvasUI.refreshEmpty();
        },
        // 仅应用底部停靠样式（不清空绑定节点与参考图）
        _dockFloatEl() {
            if (!this._floatEl) return;
            this._floatEl.classList.remove('hidden');
            this._floatEl.classList.add('docked');
            this._floatEl.style.left = '';
            this._floatEl.style.top = '';
            this._floatEl.style.width = '';
        },

        _refreshDockRefs() {
            if (!this._inDock || !global.PromptBar) return;
            const ids = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            global.PromptBar.setReferenceImages(this._dockRefsFor(ids));
        },

        // 停靠模式生成：新建生成节点，选中的图片/文本节点连入作为上下文
        _generateFromDock(params) {
            const CB = global.CanvasBlocks;
            const pb = global.PromptBar;
            const imgIds = (pb.uploadedImages || []).filter(Boolean).map(im => im.srcId).filter(id => id && CB.getById(id));
            const selIds = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            const textIds = selIds.filter(id => { const b = CB.getById(id); return b && b.nodeType === 'text' && (b.text || '').trim(); });
            const srcIds = imgIds.concat(textIds);
            const srcs = srcIds.map(id => CB.getById(id));
            const ratio = this._aspectToRatio(params.aspectRatio);
            const gen = CB.addGen({
                x: 0, y: 0,
                prompt: params.prompt,
                model: params.model,
                aspectRatio: params.aspectRatio,
                size: params.imageSize,
                duration: params.duration,
                resolution: params.quality,
                ratio: ratio || undefined
            });
            let x, y;
            if (srcs.length) {
                // 放在上下文节点右侧，纵向与其顶部对齐
                x = Math.max(...srcs.map(b => b.x + b.w)) + 120;
                y = Math.min(...srcs.map(b => b.y));
            } else {
                const c = CB.viewportCenterWorld();
                x = c.x - gen.w / 2;
                y = c.y - gen.h / 2;
            }
            const spot = CB._findFreeSpot(x, y, gen.w, gen.h, gen.id);
            CB.update(gen.id, { x: spot.x, y: spot.y });
            srcIds.forEach(id => global.CanvasEdges.add(id, gen.id));
            params.imageUrls = imgIds.length ? global.CanvasEdges.getUpstreamImages(gen.id) : [];
            params.api = 'auto';
            this._dockUploads = [];
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            this._ensureVisible(gen);
            const el = gen._el;
            if (el) { el.classList.add('just-created'); setTimeout(() => el.classList.remove('just-created'), 1400); }
            global.CanvasGenerate.runNode(gen.id, params);
            this._refreshDockRefs();
            return gen;
        },

        // 节点不在可视区时平移过去
        _ensureVisible(node) {
            const vp = CanvasCore.viewport;
            const rect = CanvasCore._vpRect || CanvasCore.viewportEl.getBoundingClientRect();
            const sx = node.x * vp.scale + vp.x, sy = node.y * vp.scale + vp.y;
            const sw = node.w * vp.scale, sh = node.h * vp.scale;
            const margin = 60;
            const bottomReserve = (this._floatEl && this._floatEl.classList.contains('docked')) ? this._floatEl.offsetHeight + 24 : 0;
            if (sx < margin || sy < margin || sx + sw > rect.width - margin || sy + sh > rect.height - margin - bottomReserve) {
                CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2 + bottomReserve / 2 / vp.scale);
            }
        },

        // 多选工具栏操作（pos：按钮点击的屏幕坐标，用于弹出排列菜单）
        _onSelectionToolAction(action, ids, pos) {
            if (!ids || ids.length < 2) return;
            if (action === 'arrange') {
                // 弹出排列方式选择（与参考产品一致：自动/水平/垂直）
                this._renderMenu([
                    { label: '自动排列', act: () => this._arrangeNodes(ids, 'auto') },
                    { label: '水平排列', act: () => this._arrangeNodes(ids, 'horizontal') },
                    { label: '垂直排列', act: () => this._arrangeNodes(ids, 'vertical') }
                ], pos ? pos.x : 0, pos ? pos.y : 0);
            }
            else if (action === 'group') this._groupNodes(ids);
            else if (action === 'download') this._batchDownload(ids);
            else if (action === 'save-char' && global.CharacterLib) global.CharacterLib.openCreateFromNodes(ids);
        },

        // 排列：按节点实际宽高计算布局，固定间隙，互不重叠
        // mode: 'auto'(货架式宫格) | 'horizontal'(单行) | 'vertical'(单列)
        _arrangeNodes(ids, mode) {
            const blocks = ids.map(id => global.CanvasBlocks.getById(id)).filter(Boolean);
            if (blocks.length === 0) return;
            const gap = 12; // 水平固定间隙（世界像素）
            // 垂直间隙额外加上名字栏高度：名字栏悬浮在节点上方 24px（canvas.css .node-name top:-24px），
            // 否则上一行节点底边会压住下一行节点的名字
            const NAME_BAR_H = 24;
            const gapY = gap + NAME_BAR_H;
            // 阅读顺序：先上后下、先左后右
            blocks.sort((a, b) => (a.y - b.y) || (a.x - b.x));
            // 以当前包围框左上角为锚点
            let minX = Infinity, minY = Infinity;
            blocks.forEach(b => { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); });
            const CB = global.CanvasBlocks;
            // 记录排列前各分组成员：排列后节点可能移出旧范围，需按原成员重置打组框
            const preGroupMembers = {};
            Object.keys(CB.groups).forEach(gid => { preGroupMembers[gid] = CB._nodesInGroup(gid).map(b => b.id); });
            if (mode === 'horizontal') {
                // 单行：垂直方向居中对齐
                const maxH = Math.max(...blocks.map(b => b.h));
                let x = minX;
                blocks.forEach(b => {
                    CB.update(b.id, { x, y: minY + (maxH - b.h) / 2 });
                    x += b.w + gap;
                });
            } else if (mode === 'vertical') {
                // 单列：水平方向居中对齐
                const maxW = Math.max(...blocks.map(b => b.w));
                let y = minY;
                blocks.forEach(b => {
                    CB.update(b.id, { x: minX + (maxW - b.w) / 2, y });
                    y += b.h + gapY;
                });
            } else {
                // 自动排列：固定列数（列数=ceil(sqrt(n))，整体接近方形），
                // 每列独立从顶部向下紧凑堆叠——行高不再对齐，矮节点下方的空洞被后续节点向上填掉
                const n = blocks.length;
                const cols = Math.ceil(Math.sqrt(n));
                const colW = new Array(cols).fill(0);
                for (let i = 0; i < n; i++) colW[i % cols] = Math.max(colW[i % cols], blocks[i].w);
                const colX = [minX];
                for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + colW[c - 1] + gap;
                const colY = new Array(cols).fill(minY);
                for (let i = 0; i < n; i++) {
                    const b = blocks[i];
                    const c = i % cols;
                    CB.update(b.id, { x: colX[c], y: colY[c] });
                    colY[c] += b.h + gapY;
                }
            }
            // 按排列前成员重置打组框范围（自动跟随新布局），再清理空分组
            Object.keys(preGroupMembers).forEach(gid => CB._refitGroupToIds(gid, preGroupMembers[gid]));
            if (CB._cleanupEmptyGroups) CB._cleanupEmptyGroups();
            // 多选包围框跟随节点新位置重算
            if (global.CanvasSelection) global.CanvasSelection._renderBounds();
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        // 打组/解组：选中节点已全部在同一分组 → 解组（删除分组范围）；否则按包围盒新建几何分组
        // 分组以容器框呈现（CanvasBlocks._syncGroupFrames），可整体拖动、四角调整范围
        _groupNodes(ids) {
            const CB = global.CanvasBlocks;
            const blocks = ids.map(id => CB.getById(id)).filter(Boolean);
            if (!blocks.length) return;
            // 选中节点全部属于同一分组 → 解组
            const sameGid = Object.keys(CB.groups).find(gid => {
                const members = CB._nodesInGroup(gid);
                return members.length > 0 && blocks.every(b => members.some(m => m.id === b.id));
            });
            if (sameGid) {
                delete CB.groups[sameGid];
                if (CB._activeGroupId === sameGid) CB._activeGroupId = null;
            } else {
                // 新建分组：范围 = 选中节点包围盒 + 内边距（GROUP_PAD 已覆盖悬浮在节点上方的名字栏）
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                blocks.forEach(b => {
                    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
                });
                const PAD = CB.GROUP_PAD || 26;
                const gid = 'grp_' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
                CB.groups[gid] = { x: minX - PAD, y: minY - PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + PAD * 2 };
                CB._activeGroupId = gid;  // 新建后立即激活，显示四角手柄
            }
            CB._syncGroupFrames();
            // 打组/解组后清空多选：点击组只操作分组框，不再出现多选框
            if (global.CanvasSelection) global.CanvasSelection.clear();
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        // 批量下载：图片、视频、音频下载原文件，文本节点本地生成 txt
        _batchDownload(ids) {
            const items = [];
            ids.map(id => global.CanvasBlocks.getById(id)).forEach(b => {
                if (!b) return;
                const name = (b.name || 'node') + '_' + (items.length + 1);
                if (b.nodeType === 'text') {
                    if ((b.text || '').trim()) items.push({ text: b.text, name });
                    return;
                }
                const url = (b.mediaType === 'video' && (b.videoUrl || b.mediaUrl)) || (b.mediaType === 'audio' && b.mediaUrl) || b.videoUrl || b.imageUrl || b.previewUrl;
                if (url) items.push({ url, name });
            });
            if (items.length === 0) { alert('选中的节点中没有可下载的内容'); return; }
            window.pxDownload(items);
        },

        onNodeMouseDown(id) { /* 选中由 CanvasSelection 处理 */ },

        onNodeDragStart() {
            // 拖动开始：只保存输入内容到节点。
            // 不再隐藏提示词浮层——拖动过程中 onNodeMoved 每帧调用 _positionFloat() 实时跟随，
            // 避免旧逻辑"拖动开始隐藏 → 拖动结束重新显示"造成的浮层闪烁与位置跳跃
            if (this._activeNodeId) this._savePromptBarToNode(this._activeNodeId);
        },

        onNodeClick(id) {
            // 鼠标松开且未拖动 → 视为点击：按当前选中状态刷新工具栏与提示词栏
            this.onSelectionChange();
        },

        onNodeDragEnd(moved) {
            // 拖动结束：浮层在拖动期间一直跟随显示，这里只需最终校正一次位置
            if (this._activeNodeId) this._positionFloat();
        },
        onNodeMoved() {
            this._positionToolbar();
            this._positionFloat();
            if (global.CanvasMinimap) global.CanvasMinimap.scheduleRender();
        },
        onNodeUpdated(block) {
            if (this._toolNodeId === block.id) {
                // 状态变化时重新渲染工具栏（启用/禁用按钮）
                this._renderToolbarFloat();
                this._positionToolbar();
            }
            if (this._activeNodeId === block.id) {
                this._positionFloat();
                // 同步生成中状态到 PromptBar，控制生成按钮禁用
                global.PromptBar._activeNodeGenerating = (block.status === 'generating');
                global.PromptBar.updateGenerateButtonState();
            }
            // 停靠模式下选中的图片节点上传完成/出图后，刷新参考图
            if (this._inDock && global.CanvasSelection && global.CanvasSelection.isSelected(block.id)) {
                clearTimeout(this._dockRefsTimer);
                this._dockRefsTimer = setTimeout(() => this._refreshDockRefs(), 50);
            }
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
        },
        onNodeRemoved(id) {
            if (this._toolNodeId === id) {
                this._toolNodeId = null;
                this._hideToolbar();
            }
            if (this._activeNodeId === id) {
                this._activeNodeId = null;
                this._enterDock([]);
            }
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
        },
        onEdgesChange() {
            if (global.CanvasMinimap) global.CanvasMinimap.markDirty();
            // 连入/断开视频音频时刷新参考条里的媒体缩略
            if (global.PromptBar && global.PromptBar._renderMediaRefs) setTimeout(() => global.PromptBar._renderMediaRefs(), 0);
            if (global.CharacterLib) global.CharacterLib.updateLinkedHint(this._activeNodeId);
            if (!this._activeNodeId) return;
            const node = global.CanvasBlocks.getById(this._activeNodeId);
            if (!node || node.nodeType !== 'gen') return;
            const upstream = global.CanvasEdges.getUpstreamImages(this._activeNodeId);
            // 仅在列表确实变化时更新，避免重置提示词光标
            if (this._upstreamSig(upstream) !== this._lastUpstreamSig) {
                this._syncUpstreamToPromptBar(upstream);
                this._lastUpstreamSig = this._upstreamSig(upstream);
            }
            // 角色连入 / 断开：提示词里的角色 chip 同步有效 / 失效态
            if (global.PromptBar.refreshCharacterTags) global.PromptBar.refreshCharacterTags();
        },

        _upstreamSig(list) {
            return (list || []).map(u => u.highUrl).join('|');
        },

        _syncUpstreamToPromptBar(upstream) {
            // 把连线带来的上游图片设为参考图（覆盖式）
            const images = upstream.map(u => ({ highUrl: u.highUrl, previewUrl: u.previewUrl, fileId: 'edge_' + u.highUrl, srcId: u.srcId, charId: u.charId || null }));
            global.PromptBar.setReferenceImages(images);
        },

        // ===== 浮层显隐 / 定位 =====
        // 提示词输入区浮层：跟随选中节点显示在节点下方，取消选中时隐藏
        _showFloat() {
            if (!this._floatEl) return;
            this._floatEl.classList.remove('hidden', 'docked');
            this._positionFloat();
        },
        _hideFloat() {
            // 提示词栏不再隐藏：没有绑定节点时停靠到底部
            this._enterDock(global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : []);
        },
        _positionFloat() {
            if (!this._activeNodeId || !this._floatEl || this._floatEl.classList.contains('hidden')) return;
            // 固定模式：提示词栏停靠底部，不跟随节点定位
            if (this._floatEl.classList.contains('docked')) return;
            // 放大状态下由 CSS .expanded 控制定位，不跟随节点
            if (this._floatEl.classList.contains('expanded')) return;
            const node = global.CanvasBlocks.getById(this._activeNodeId);
            if (!node) { this._activeNodeId = null; this._hideFloat(); return; }

            const scale = CanvasCore.viewport.scale;
            const vpRect = CanvasCore._vpRect || CanvasCore.viewportEl.getBoundingClientRect();
            const appEl = document.querySelector('.canvas-app');
            const appRect = appEl.getBoundingClientRect();
            const offsetX = vpRect.left - appRect.left;
            const offsetY = vpRect.top - appRect.top;

            const sx = node.x * scale + CanvasCore.viewport.x;
            const sy = node.y * scale + CanvasCore.viewport.y;
            const nodeScreenW = node.w * scale;
            const nodeScreenH = node.h * scale;

            // 浮层宽度：固定值，不再随视口变化；确保模型按钮、分辨率按钮等有足够空间显示完整文本
            // 乘以 --s：1K/2K/4K 屏幕下与其他界面元素统一缩放
            const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
            const width = Math.round(680 * uiScale);
            this._floatEl.style.width = width + 'px';

            // 固定在节点正下方：允许超出画布边界，不做边界钳制与控件避让
            // （节点移动时浮层与节点保持固定相对位置，不再乱跳）
            let left = offsetX + sx + nodeScreenW / 2 - width / 2;
            let top = offsetY + sy + nodeScreenH + 12 * uiScale;
            left = Math.round(left);
            top = Math.round(top);

            this._floatEl.style.left = left + 'px';
            this._floatEl.style.top = top + 'px';
        },

        // ===== 放大/缩小提示词浮层 =====
        // 放大时固定在屏幕中间，提高宽高，防止文本过多看不完全；点击外部或再次点击缩回
        _toggleExpandFloat(forceExpand) {
            if (!this._floatEl) return;
            const isExpanded = this._floatEl.classList.contains('expanded');
            const shouldExpand = forceExpand !== undefined ? forceExpand : !isExpanded;
            if (shouldExpand) {
                this._floatEl.classList.add('expanded');
            } else {
                this._floatEl.classList.remove('expanded');
                // 恢复跟随节点定位
                this._positionFloat();
            }
        },

        _bindExpandFloat() {
            if (!this._floatEl) return;
            // 放大按钮点击：切换放大/缩小（按钮已移入功能栏区域，用 ID 选择器获取）
            const expandBtn = document.getElementById('promptFloatExpandBtn');
            if (expandBtn) {
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._toggleExpandFloat();
                });
            }
            // 点击放大状态外部时缩回
            document.addEventListener('mousedown', (e) => {
                if (!this._floatEl || !this._floatEl.classList.contains('expanded')) return;
                // 点在浮层内 → 不处理
                if (this._floatEl.contains(e.target)) return;
                // 点在节点上 → 不处理（由选中逻辑管理）
                if (e.target.closest && e.target.closest('.canvas-node')) return;
                // 其余（画布空白、悬浮胶囊等）→ 缩回
                this._toggleExpandFloat(false);
            }, true);
        },

        // 转义 HTML（防止画布页名称中的特殊字符破坏 DOM）
        _esc(s) {
            if (!s) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        // ===== 节点顶部工具栏屏幕浮层（固定大小，不随画布缩放） =====
        _showToolbar() {
            if (!this._toolbarFloatEl) return;
            const node = this._toolNodeId && global.CanvasBlocks.getById(this._toolNodeId);
            if (!node) { this._hideToolbar(); return; }
            this._renderToolbarFloat();
            this._toolbarFloatEl.classList.remove('hidden');
            this._positionToolbar();
        },

        _hideToolbar() {
            if (this._toolbarFloatEl) this._toolbarFloatEl.classList.add('hidden');
        },

        _renderToolbarFloat() {
            if (!this._toolbarFloatEl) return;
            const node = this._toolNodeId && global.CanvasBlocks.getById(this._toolNodeId);
            if (!node) { this._toolbarFloatEl.innerHTML = ''; return; }
            this._toolbarFloatEl.innerHTML = global.CanvasBlocks._renderToolbar(node);
        },

        _positionToolbar() {
            // 视频修剪面板跟随节点（平移/缩放/拖动节点时均经由此处）
            if (this._vtrim) this._positionVideoTrim();
            if (this._atrim) this._positionAudioTrim();
            if (global.GenHistory) global.GenHistory.reposition();
            if (!this._toolNodeId || !this._toolbarFloatEl) return;
            const node = global.CanvasBlocks.getById(this._toolNodeId);
            if (!node) { this._hideToolbar(); return; }

            const scale = CanvasCore.viewport.scale;
            const vpRect = CanvasCore._vpRect || CanvasCore.viewportEl.getBoundingClientRect();
            const appEl = document.querySelector('.canvas-app');
            const appRect = appEl ? appEl.getBoundingClientRect() : { left: 0, top: 0 };
            const offsetX = vpRect.left - appRect.left;
            const offsetY = vpRect.top - appRect.top;

            const sx = node.x * scale + CanvasCore.viewport.x;
            const sy = node.y * scale + CanvasCore.viewport.y;
            const nodeScreenW = node.w * scale;

            // 节点上方居中，固定像素大小，不随 scale 变化
            // 上移 32px 避开节点上方的名字栏（.node-name 位于节点外 top:-24px），防止遮挡
            // left/top 取整避免亚像素渲染模糊
            const left = Math.round(offsetX + sx + nodeScreenW / 2);
            // 节点顶部滚出屏幕时工具栏贴住顶部可视区，不跟着消失
            const tbH = this._toolbarFloatEl.offsetHeight || 36;
            const top = Math.round(Math.max(offsetY + sy - 32, tbH + 64));
            this._toolbarFloatEl.style.left = left + 'px';
            this._toolbarFloatEl.style.top = top + 'px';
            this._toolbarFloatEl.style.transform = 'translate(-50%, -100%)';
        },

        _bindToolbarFloatEvents() {
            if (!this._toolbarFloatEl) return;
            // 阻止工具栏事件穿透到画布
            this._toolbarFloatEl.addEventListener('mousedown', (e) => e.stopPropagation());
            // 文本节点背景色：透明取色器覆盖按钮（与打组背景色完全一致的实现）
            // 拖动取色实时预览；松手（change）确认并记一次历史
            this._toolbarFloatEl.addEventListener('input', (e) => {
                if (!e.target.classList.contains('node-color-input')) return;
                const nodeId = this._toolNodeId;
                const node = nodeId && global.CanvasBlocks.getById(nodeId);
                if (!node) return;
                node.bgColor = e.target.value;
                const el = global.CanvasBlocks.layerEl.querySelector(`[data-block-id="${nodeId}"]`);
                if (el) el.style.background = global.CanvasBlocks._hexToRgba(node.bgColor, 0.5);
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            });
            this._toolbarFloatEl.addEventListener('change', (e) => {
                if (!e.target.classList.contains('node-color-input')) return;
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
            });
            // 工具栏下拉（截取帧）：点外面收起
            document.addEventListener('mousedown', (e) => {
                if (e.target.closest && e.target.closest('.node-tool-dd')) return;
                this._toolbarFloatEl.querySelectorAll('.node-tool-dd.open').forEach(d => d.classList.remove('open'));
            }, true);
            this._toolbarFloatEl.addEventListener('click', (e) => {
                const fItem = e.target.closest('.node-tool-menu .ctx-item[data-frame]');
                if (fItem) {
                    e.stopPropagation();
                    fItem.closest('.node-tool-dd').classList.remove('open');
                    if (global.CanvasMain) global.CanvasMain._onToolAction('video-frame-' + fItem.dataset.frame, this._toolNodeId, e);
                    return;
                }
                const actionEl = e.target.closest('.node-tool-icon[data-action], .node-tool-link[data-action], .node-tool-text[data-action]');
                if (!actionEl) return;
                e.stopPropagation();
                const action = actionEl.dataset.action;
                if (action === 'frame-menu') {
                    if (!actionEl.classList.contains('disabled')) actionEl.closest('.node-tool-dd').classList.toggle('open');
                    return;
                }
                if (action === 'pos') return; // pos 单独处理
                if (actionEl.classList.contains('disabled')) return;
                if (global.CanvasMain && typeof global.CanvasMain._onToolAction === 'function') {
                    global.CanvasMain._onToolAction(action, this._toolNodeId, e);
                }
            });

            // 文本节点：位置切换
            this._toolbarFloatEl.addEventListener('click', (e) => {
                const posBtn = e.target.closest('.node-text-pos');
                if (!posBtn) return;
                e.stopPropagation();
                const nodeId = this._toolNodeId;
                const node = nodeId && global.CanvasBlocks.getById(nodeId);
                if (!node) return;
                const newPos = (node.insertPos === 'tail') ? 'head' : 'tail';
                global.CanvasBlocks.update(nodeId, { insertPos: newPos });
                if (global.CanvasHistory) global.CanvasHistory.snapshot();
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            });
        },

        // ===== 节点 ↔ PromptBar 同步 =====
        _loadNodeToPromptBar(nodeId) {
            // 加载期间禁止回存：loadFromNode 内视频模式切换会先 renderRefs 触发 _onRefsChange→回存，
            // 此时输入框里还是上一个节点的提示词，会把它覆盖到当前节点（视频节点提示词"不见了"的根因）
            this._loadingPromptBar = true;
            try { this._loadNodeToPromptBarInner(nodeId); } finally { this._loadingPromptBar = false; }
        },
        _loadNodeToPromptBarInner(nodeId) {
            const node = global.CanvasBlocks.getById(nodeId);
            if (!node) return;
            // 生成节点：完整模式 + 连线上游图作为参考图
            // 参考图节点 / 编辑图片节点：极简模式（无 +按钮 无参考图预览，因为节点本身就是图）
            // 注意：先注入参考图再 loadFromNode，确保提示词中的 [图片N] 标签按当前节点的参考图解析
            if (node.nodeType === 'gen') {
                global.PromptBar.setMode('full');
                const upstream = global.CanvasEdges.getUpstreamImages(nodeId);
                this._lastUpstreamSig = this._upstreamSig(upstream);
                this._syncUpstreamToPromptBar(upstream);
            } else {
                global.PromptBar.setMode('minimal');
                global.PromptBar.setReferenceImages([]);
            }

            // 画布浮层功能栏"参考图"按钮：生成节点（gen）可点击上传参考图；
            // 其他节点（参考图节点/编辑图片节点）不支持上传参考图，按钮灰色不可点击
            // 注意：setMode('minimal') 会给 #addImgBtn 添加 .hidden 类隐藏按钮，
            //       画布浮层中需要移除 .hidden 让按钮始终可见，用 .disabled 类控制灰色不可点击
            const addImgBtn = document.getElementById('addImgBtn');
            if (addImgBtn) {
                if (node.nodeType === 'gen') {
                    addImgBtn.classList.remove('hidden', 'disabled');
                    addImgBtn.disabled = false;
                } else {
                    // 参考图节点：隐藏上传按钮（节点本身就是图，不能添加参考图）
                    addImgBtn.classList.add('hidden');
                    addImgBtn.disabled = true;
                }
            }
            global.PromptBar.loadFromNode(node);
            if (node.nodeType === 'gen') {
                // 若生成节点尚无结果（图片/视频都没有），按所选比例调整节点框（保持视觉一致）
                // 视频结果可能只有 videoUrl 没有 imageUrl（如副本），不能当成空节点，否则每次点击比例在所选比例与视频真实比例间来回跳、节点被挤走
                if (!node.imageUrl && !node.previewUrl && !node.videoUrl && !node.mediaUrl) {
                    const ratio = this._aspectToRatio(node.aspectRatio);
                    if (ratio && Math.abs((node.ratio || 1) - ratio) >= 0.01) {
                        global.CanvasBlocks.update(node.id, { ratio });
                    }
                }
            }
            // 同步生成中状态到 PromptBar，控制生成按钮禁用
            global.PromptBar._activeNodeGenerating = (node.status === 'generating');
            global.PromptBar.updateGenerateButtonState();
        },

        _savePromptBarToNode(nodeId) {
            if (this._loadingPromptBar) return;
            const node = global.CanvasBlocks.getById(nodeId);
            if (!node) return;
            global.PromptBar.snapshotToNode(node);
            global.CanvasStore.scheduleSave();
        },

        _onRefsChange() {
            // 停靠模式：只同步上传列表（用户删掉的参考图不再带入）
            if (!this._activeNodeId) {
                const keep = new Set((global.PromptBar.uploadedImages || []).filter(Boolean).map(im => im.srcId));
                this._dockUploads = this._dockUploads.filter(id => keep.has(id));
                return;
            }
            // 参考图列表变化（用户增删/排序）→ 持久化到节点，并同步断开已删除参考图对应的连线
            if (this._activeNodeId) {
                const node = global.CanvasBlocks.getById(this._activeNodeId);
                // 拖拽排序后把顺序记到节点上（加载期间不回存）：否则重新选中会按连线顺序重建，顺序被还原
                if (node && node.nodeType === 'gen' && !this._loadingPromptBar) {
                    node.refOrder = (global.PromptBar.uploadedImages || []).filter(Boolean)
                        .map(im => im.srcId ? (im.srcId + '|' + (im.highUrl || im.previewUrl || '')) : (im.fileId || im.highUrl || ''))
                        .filter(Boolean);
                }
                this._savePromptBarToNode(this._activeNodeId);
                this._syncEdgesToPromptBarRefs();
            }
        },

        _syncEdgesToPromptBarRefs() {
            const node = this._activeNodeId && global.CanvasBlocks.getById(this._activeNodeId);
            if (!node || node.nodeType !== 'gen') return;
            const keepIds = new Set();
            (global.PromptBar.uploadedImages || []).forEach(im => {
                if (im && im.srcId) keepIds.add(im.srcId);
            });
            const edges = global.CanvasEdges.edges || [];
            // 正在上传中的文件对应的节点 id（上传占位本身在清单里但有 srcId，清理占位时绝不能连带断开它的连线）
            const pendingIds = new Set();
            (global.PromptBar.uploadedImages || []).forEach(im => {
                if (im && im.loading && im.srcId) pendingIds.add(im.srcId);
            });
            // 保护上传中/生成中的节点：其图片尚未就绪、尚未进入参考图清单，绝不能误判为『已删除』而断开连线
            // 文字节点是提示词上下文而非参考图，不在参考图清单中，同样绝不能被清理断链
            // 角色节点被模型上限截断到 0 张时不在参考图清单里（无聚合项可删），不能视为「已删除」而断开
            const upIds = new Set(global.CanvasEdges.getUpstreamImages(node.id).map(u => u.srcId));
            const toRemove = edges.filter(e => {
                if (e.to !== node.id || keepIds.has(e.from)) return false;
                if (pendingIds.has(e.from)) return false;
                const src = global.CanvasBlocks.getById(e.from);
                if (src && src.nodeType === 'text') return false;
                if (src && src.subType === 'character' && !upIds.has(e.from)) return false;
                if (src && (src.status === 'loading' || src.status === 'generating')) return false;
                return true;
            });
            if (toRemove.length === 0) return;
            toRemove.forEach(e => global.CanvasEdges.remove(e.id));
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        /** 比例字符串 → 数值比例（宽/高）。auto / 无法解析 → null（不调整）*/
        _aspectToRatio(aspect) {
            if (!aspect || aspect === 'auto') return null;
            const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspect);
            if (!m) return null;
            const w = parseFloat(m[1]), h = parseFloat(m[2]);
            if (!h) return null;
            return w / h;
        },

        _onAspectChange(aspect) {
            if (!this._activeNodeId) return;
            const node = global.CanvasBlocks.getById(this._activeNodeId);
            if (!node || node.nodeType !== 'gen') return;
            // 保存比例到节点
            node.aspectRatio = aspect;
            // 已有生成结果图片的节点不再强行改框（避免覆盖图片自适应比例）
            if (node.imageUrl || node.previewUrl) return;
            const ratio = this._aspectToRatio(aspect);
            if (!ratio) return;  // auto 或解析失败 → 不调整
            // 仅当比例确实变化时更新（触发动画）
            if (Math.abs((node.ratio || 1) - ratio) < 0.01) return;
            global.CanvasBlocks.update(node.id, { ratio });
        },

        // 模型/分辨率变化时立即保存到当前节点（确保每节点独立）
        _onParamChange(type, value) {
            if (!this._activeNodeId) return;
            const node = global.CanvasBlocks.getById(this._activeNodeId);
            if (!node) return;
            if (type === 'model') node.model = value;
            else if (type === 'res') node.size = value;
            else if (type === 'quality' && node.nodeType === 'gen') node.quality = value;
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        // ===== 图片编辑器接入 =====
        _editContext: null,  // { activeNodeId, sourceNodeId, originalUrl, fromGenNode }

        _onOpenImageEditor(imageUrl, displayIndex, fileId, nodeId) {
            if (!imageUrl) return;
            const nid = nodeId || this._activeNodeId;
            const activeNode = nid && global.CanvasBlocks.getById(nid);
            if (!activeNode) { alert('请先选中一个节点'); return; }

            let sourceNodeId = null;
            if (activeNode.nodeType === 'gen' && !nodeId) {
                // 生成节点：参考图来自上游连入的节点。
                // 按 displayIndex 定位可能因历史编辑操作（source→edited→gen）导致顺序错位，
                // 改为按图片 URL 精确匹配上游节点的源参考图（edited 节点的原图字段即其编辑结果，
                // 也能正确指向 edited 节点本身）。
                const upstream = global.CanvasEdges.getUpstreamImages(activeNode.id);
                // 先尝试用 imageUrl 匹配上游节点的高清图
                let matched = upstream.find(u => u.highUrl === imageUrl || u.previewUrl === imageUrl);
                if (!matched && displayIndex >= 0 && displayIndex < upstream.length) {
                    // 退回到 displayIndex 定位（0 基，与 PromptBar 传出一致）
                    matched = upstream[displayIndex];
                }
                sourceNodeId = matched && matched.srcId;
                this._editContext = { activeNodeId: activeNode.id, sourceNodeId, originalUrl: imageUrl, fromGenNode: true };
            } else {
                // 参考图节点：编辑的是自身图
                this._editContext = { activeNodeId: activeNode.id, sourceNodeId: activeNode.id, originalUrl: imageUrl, fromGenNode: false };
            }
            // 打开图片编辑器（image-editor.js 暴露的全局函数）
            // 通过后端代理加载图片以避免 CORS 跨域读取像素
            if (typeof window.openImageEditor === 'function') {
                const proxyUrl = this._proxyImageUrl(imageUrl);
                window.openImageEditor(proxyUrl, displayIndex);
            } else {
                alert('图片编辑器未加载');
            }
        },

        /** 将 TOS / 外部图片 URL 转为后端代理 URL，规避 canvas 跨域读取限制 */
        _proxyImageUrl(url) {
            if (!url) return url;
            // 已经是相对代理地址则直接返回
            if (url.startsWith('/v1/image/proxy')) return url;
            return `${global.API_CONFIG.baseUrl}/v1/image/proxy?url=${encodeURIComponent(url)}`;
        },

        // ===== 节点工具栏动作处理 =====
        _onToolAction(action, nodeId, ev) {
            // 空媒体节点：点击上传按钮填充视频/音频
            if (action === 'media-upload') {
                const mnode = global.CanvasBlocks.getById(nodeId);
                if (!mnode || !mnode.mediaType) return;
                const isVid = mnode.mediaType === 'video';
                this._pickRefFile(async (f) => {
                    try {
                        if (isVid && !/^video\//.test(f.type || '')) { alert('请选择视频文件（MP4 / MOV）'); return; }
                        if (!isVid && !/^audio\//.test(f.type || '')) { alert('请选择音频文件（MP3 / WAV）'); return; }
                        const m = await global.CanvasGenerate.uploadMediaRef(f);
                        global.CanvasBlocks.update(nodeId, {
                            mediaType: m.mediaType, mediaUrl: m.url,
                            videoUrl: m.mediaType === 'video' ? m.url : '',
                            mediaSize: m.size || 0, mediaDuration: m.duration || 0,
                            tempKey: m.tempKey || ''
                        });
                        // 视频素材：用本地文件入队生成预览版（免再次下载）
                        if (m.mediaType === 'video' && global.VideoProxy) global.VideoProxy.enqueue(nodeId, f);
                        // 若当前选中/激活的是生成节点，自动连一条参考边（已连则跳过）
                        const an = this._activeNodeId && global.CanvasBlocks.getById(this._activeNodeId);
                        if (an && an.nodeType === 'gen' && an.id !== nodeId && global.CanvasEdges && !global.CanvasEdges.edges.some(e => e.from === nodeId && e.to === an.id)) {
                            global.CanvasEdges.add(nodeId, an.id);
                        }
                        global.CanvasHistory.snapshot();
                        global.CanvasStore.scheduleSave();
                    } catch (err) { alert('上传失败：' + (err.message || '')); }
                }, isVid ? 'video/mp4,video/quicktime' : 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.m4a,.aac');
                return;
            }
            const node = global.CanvasBlocks.getById(nodeId);
            if (!node) return;
            const mediaUrl = (node.mediaType === 'video' && (node.videoUrl || node.mediaUrl)) || (node.mediaType === 'audio' && node.mediaUrl) || '';
            const imageUrl = mediaUrl || node.imageUrl || node.previewUrl;
            if (action === 'view') {
                if (imageUrl) this._openFullscreenViewer(imageUrl, node);
            } else if (action === 'download') {
                if (imageUrl) this._downloadImage(imageUrl, node.name || 'nano-image');
            } else if (action === 'edit') {
                if (imageUrl) this._onOpenImageEditor(imageUrl, 1, null, node.id);
            } else if (action === 'ref-gen') {
                this._refGenerate(node);
            } else if (action === 'regen') {
                this._regenerate(node);
            } else if (action === 'retry') {
                global.CanvasGenerate.runNode(node.id);
            } else if (action === 'asset') {
                this._toggleAssetRef(node);
            } else if (action === 'save-char') {
                if (global.CharacterLib) global.CharacterLib.openCreateFromNodes([node.id]);
            } else if (action === 'char-wardrobe') {
                if (global.CharacterLib) global.CharacterLib.showWardrobeMenu(node, ev);
            } else if (action === 'char-open') {
                if (global.CharacterLib) global.CharacterLib.openCharacter(node.characterId, node);
            } else if (action === 'video-frame-first' || action === 'video-frame-last') {
                if (node.mediaType === 'video' && mediaUrl) this._quickFrame(node, action === 'video-frame-last' ? 'last' : 'first');
            } else if (action === 'video-frame' || action === 'video-frame-custom' || action === 'video-trim') {
                if (node.mediaType === 'video' && mediaUrl) this._openVideoTrim(node, action === 'video-trim' ? 'trim' : 'frame');
            } else if (action === 'audio-trim') {
                if (node.mediaType === 'audio' && mediaUrl) this._openAudioTrim(node);
            } else if (/^(pano|turn)-/.test(action)) {
                if (global.CanvasPano) global.CanvasPano.onToolAction(action, node, ev);
            } else if (/^stage-/.test(action)) {
                if (global.CanvasStage3D) global.CanvasStage3D.onToolAction(action, node, ev);
            } else if (/^draft-/.test(action)) {
                if (global.CanvasDraft) {
                    if (action === 'draft-upgrade') {
                        // 提示词输入区就地换成「生成 1080」区域，不弹窗
                        if (typeof global.CanvasDraft.openUpgradePanel === 'function') global.CanvasDraft.openUpgradePanel(node.id);
                        else global.CanvasDraft.openConfirm(node.id);
                    }
                    else global.CanvasDraft.onToolAction && global.CanvasDraft.onToolAction(action, node, ev);
                }
            }
        },

        // 设为/移除角色素材（入库素材库；生成时以 asset:// 引用，保持人物一致性）
        async _toggleAssetRef(node) {
            const CB = global.CanvasBlocks;
            const CG = global.CanvasGenerate;
            if (!CB || !CG) return;
            if (node.assetStatus === 'ingesting') return;
            if (node.assetId) {
                CB.update(node.id, { assetId: '', assetStatus: '' });
                return;
            }
            try {
                CB.update(node.id, { assetStatus: 'ingesting' });
                const r = await CG.ingestAsset(node);
                if (!CB.getById(node.id)) return;
                CB.update(node.id, { assetId: r.assetId, assetStatus: 'processing' });
                const t0 = Date.now();
                const timer = setInterval(async () => {
                    try {
                        if (!CB.getById(node.id)) { clearInterval(timer); return; }
                        const s = await CG.pollAssetStatus(r.assetId);
                        if (s.status === 'Active') {
                            clearInterval(timer);
                            CB.update(node.id, { assetStatus: 'active' });
                        } else if (s.status === 'Failed' || Date.now() - t0 > 90000) {
                            clearInterval(timer);
                            CB.update(node.id, { assetId: '', assetStatus: '' });
                            alert(s.status === 'Failed' ? '素材入库失败：图片可能不符合要求（格式/比例 0.4-2.5/边长 300-6000px/小于30MB）' : '素材入库超时，请稍后重试');
                        }
                    } catch (e) {
                        clearInterval(timer);
                        CB.update(node.id, { assetId: '', assetStatus: '' });
                        alert('素材状态查询失败: ' + e.message);
                    }
                }, 3000);
            } catch (e) {
                CB.update(node.id, { assetStatus: '' });
                alert('素材入库失败: ' + e.message);
            }
        },

        // 以该图为参考生成：右侧新建生成节点并连入，聚焦提示词
        _refGenerate(node) {
            const gen = this._createGenNode(node.x + node.w + 80, node.y);
            global.CanvasEdges.add(node.id, gen.id);
            this.onEdgesChange();
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            setTimeout(() => { const ip = document.getElementById('promptInput'); if (ip) ip.focus(); }, 60);
        },

        // 再来一张：复制生成参数和上游连线，在旁边新建节点并立即生成，原图保留
        _regenerate(node) {
            const CB = global.CanvasBlocks;
            const copy = CB.addGen({
                x: node.x + node.w + 40, y: node.y,
                name: (node.name || '图片节点'),
                prompt: node.prompt, model: node.model, aspectRatio: node.aspectRatio, size: node.size,
                duration: node.duration, resolution: node.resolution,
                videoMode: node.videoMode, genCategory: CB._genCategoryOf(node),
                panorama: node.panorama || undefined, turnaround: node.turnaround ? Object.assign({}, node.turnaround) : undefined,
                ratio: node.ratio
            });
            const spot = CB._findFreeSpot(copy.x, copy.y, copy.w, copy.h, copy.id);
            CB.update(copy.id, { x: spot.x, y: spot.y });
            global.CanvasEdges.edges.filter(e => e.to === node.id).forEach(e => global.CanvasEdges.add(e.from, copy.id));
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            this._ensureVisible(copy);
            global.CanvasGenerate.runNode(copy.id);
        },

        // 下载图片
        _downloadImage(url, name) {
            window.pxDownload(url, name);
        },

        // ===== 全屏图片查看器（复刻自主页）=====
        _initFullscreenViewer() {
            this._viewerEl = document.getElementById('fullscreenViewer');
            this._viewerImage = this._viewerEl && this._viewerEl.querySelector('.viewer-image');
            this._viewerClose = this._viewerEl && this._viewerEl.querySelector('.viewer-close');
            this._viewerParams = this._viewerEl && this._viewerEl.querySelector('.viewer-params');
            if (!this._viewerEl) return;
            // 点击关闭按钮
            if (this._viewerClose) {
                this._viewerClose.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._closeFullscreenViewer();
                });
            }
            // 点击背景关闭
            this._viewerEl.addEventListener('click', () => {
                this._closeFullscreenViewer();
            });
            // 点击图片/参数面板不关闭（阻止冒泡）
            if (this._viewerImage) {
                this._viewerImage.addEventListener('click', (e) => e.stopPropagation());
            }
            const _vv = this._viewerEl.querySelector('.viewer-video'); // _VWVIDEO_1027 视频点击不冒泡（防误关）
            if (_vv) _vv.addEventListener('click', (e) => e.stopPropagation());
            if (this._viewerParams) {
                this._viewerParams.addEventListener('click', (e) => e.stopPropagation());
            }
            // Esc 关闭
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this._viewerEl && !this._viewerEl.classList.contains('hidden')) {
                    this._closeFullscreenViewer();
                }
                const helpMask = document.getElementById('shortcutHelpMask');
                if (e.key === 'Escape' && helpMask && !helpMask.classList.contains('hidden')) {
                    helpMask.classList.add('hidden');
                }
            });
            // 复制提示词按钮
            const copyBtn = this._viewerEl.querySelector('#copyPromptBtn');
            if (copyBtn) {
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const text = (this._viewerEl.querySelector('#viewerPrompt') || {}).textContent || '';
                    if (!text) return;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(() => {
                            copyBtn.querySelector('span').textContent = '已复制';
                            setTimeout(() => { copyBtn.querySelector('span').textContent = '复制'; }, 1500);
                        });
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = text; document.body.appendChild(ta); ta.select();
                        try { document.execCommand('copy'); copyBtn.querySelector('span').textContent = '已复制';
                            setTimeout(() => { copyBtn.querySelector('span').textContent = '复制'; }, 1500);
                        } catch (_) {}
                        document.body.removeChild(ta);
                    }
                });
            }
        },
        /**
         * 打开全屏查看器
         * @param {string} url 图片地址
         * @param {object} [node] 关联节点（生成节点会显示生成参数面板；ref/text 节点不显示）
         */
        _openFullscreenViewer(url, node, video) { // _VWVIDEO_1027 video=true 视频模式（url 为视频地址）
            if (!this._viewerEl || !this._viewerImage) return;
            const vEl = this._viewerEl.querySelector('.viewer-video');
            this._viewerImage.classList.toggle('hidden', !!video);
            if (vEl) vEl.classList.toggle('hidden', !video);
            if (video) {
                if (vEl) { vEl.src = url; try { vEl.play(); } catch (_) {} }
            } else {
                this._viewerImage.src = url;
                if (vEl) { try { vEl.pause(); } catch (_) {} }
            }
            // 填充生成参数面板（仅生成节点显示，参考图/编辑图节点按用户要求不带）
            this._fillViewerParams(node);
            this._viewerEl.classList.remove('hidden');
        },
        // 填充查看器参数面板：仅生成节点显示
        _fillViewerParams(node) {
            if (!this._viewerParams) return;
            const showParams = node && node.nodeType === 'gen';
            if (!showParams) {
                this._viewerParams.classList.add('hidden');
                return;
            }
            // 模型名统一使用脱敏组名（与主页 script.js 的 MODEL_DISPLAY_NAME 保持一致）
            const MODEL_DISPLAY_NAME = {
                'nano-banana-2': 'Nano Banana 2.0',
                'gemini-nano-banana-2.1': 'Nano Banana 2.1',
                'nano-banana-lite': 'Nano Banana 2.0 快速',
                'nano-banana-pro': 'Nano Banana Pro',
                'gpt-image-2': 'GPT Image 2 标准',
                'gpt-image-2-vip': 'GPT Image 2 Pro',
                'gpt-image-2.5-flare': 'GPT Image 2.5 快速',
                'gpt-image-2.5-flare-vip': 'GPT Image 2.5 快速 Pro',
                'gpt-image-2.5-sunburst': 'GPT Image 2.5',
                'gpt-image-2.5-sunburst-vip': 'GPT Image 2.5 Pro',
                'gpt-image-2.5': 'GPT Image 2.5',
                'seedream-5-0-pro-260628': 'Seedream 5.0',
                'seedream-5-0-260128': 'Seedream 5.0 快速'
            };
            let modelName = node.model || '';
            if (MODEL_DISPLAY_NAME[modelName]) {
                modelName = MODEL_DISPLAY_NAME[modelName];
            } else if (modelName.startsWith('mj-')) {
                modelName = 'Midjourney';
            } else {
                const models = (global.CanvasGenerate && global.CanvasGenerate.models) || [];
                const cfg = models.find(m => m.id === node.model);
                if (cfg && cfg.name) modelName = cfg.name;
                else if (global.PromptBar && global.PromptBar.modelConfigMap && global.PromptBar.modelConfigMap[node.model]) {
                    modelName = global.PromptBar.modelConfigMap[node.model].name || node.model;
                }
            }
            const aspect = node.aspectRatio || '1:1';
            const size = node.size || '4K';
            const prompt = node.prompt || '';
            const set = (id, v) => { const el = this._viewerEl.querySelector('#' + id); if (el) el.textContent = v; };
            set('viewerModel', modelName || '—');
            set('viewerAspect', aspect);
            set('viewerSize', size);
            set('viewerPrompt', prompt || '—');
            this._viewerParams.classList.remove('hidden');
        },
        _closeFullscreenViewer() {
            if (!this._viewerEl) return;
            this._viewerEl.classList.add('hidden');
            // _VWVIDEO_1027 关闭时停止并释放视频
            const vEl = this._viewerEl.querySelector('.viewer-video');
            if (vEl) { try { vEl.pause(); } catch (_) {} setTimeout(() => { vEl.removeAttribute('src'); try { vEl.load(); } catch (_) {} }, 300); }
            // 延迟清空 src 释放内存
            setTimeout(() => { if (this._viewerImage) this._viewerImage.src = ''; }, 300);
        },

        async _onImageEditorSave(payload) {
            if (!payload || !payload.blob || !this._editContext) return;
            const ctx = this._editContext;
            this._editContext = null;
            const { blob } = payload;

            const activeNode = global.CanvasBlocks.getById(ctx.activeNodeId);
            if (!activeNode) return;

            // 确定插入策略：
            //   Case A (fromGenNode)：从生成节点编辑上游参考图 → 断 source→active，建 source→edited→active
            //   Case B (!fromGenNode)：从参考图/编辑节点编辑自身 → 断 active→下游gen，建 active→edited→下游gen
            let sourceNode = null;           // Case A 的上游源节点
            let downstreamGens = [];          // Case B 的下游生成节点 [{edge, genNode}]
            if (ctx.fromGenNode && ctx.sourceNodeId) {
                sourceNode = global.CanvasBlocks.getById(ctx.sourceNodeId);
            } else {
                // 查找 activeNode 的所有下游 gen 节点
                const edges = global.CanvasEdges.edges || [];
                edges.forEach(e => {
                    if (e.from === activeNode.id) {
                        const target = global.CanvasBlocks.getById(e.to);
                        if (target && target.nodeType === 'gen') {
                            downstreamGens.push({ edge: e, genNode: target });
                        }
                    }
                });
            }
            const hasInsertion = !!sourceNode || downstreamGens.length > 0;

            // 1. 创建占位节点（loading 状态）
            const baseName = sourceNode
                ? (sourceNode.name || '参考节点')
                : (activeNode.name || '参考节点');
            let phX, phY;
            if (sourceNode) {
                phX = (sourceNode.x + activeNode.x) / 2;
                phY = (sourceNode.y + activeNode.y) / 2 + 60;
            } else if (downstreamGens.length > 0) {
                const g = downstreamGens[0].genNode;
                phX = (activeNode.x + g.x) / 2;
                phY = (activeNode.y + g.y) / 2 + 60;
            } else {
                phX = activeNode.x + activeNode.w + 80;
                phY = activeNode.y;
            }
            const placeholderNode = global.CanvasBlocks.addRef({
                x: phX, y: phY,
                name: baseName + '-编辑',
                subType: 'edited',
                status: 'loading'
            });
            global.CanvasBlocks.setLocalPreview(placeholderNode.id, blob);

            // 2. 重连边
            if (sourceNode) {
                // Case A：断 source→active，建 source→edited→active
                const edges = global.CanvasEdges.edges || [];
                const oldEdge = edges.find(e => e.from === sourceNode.id && e.to === activeNode.id);
                // 记录原连线在数组中的下标：参考图顺序由连线顺序决定，新连线需回填原位，避免编辑后排到最后
                let restoreIdx = -1;
                if (oldEdge) {
                    restoreIdx = edges.indexOf(oldEdge);
                    global.CanvasEdges.remove(oldEdge.id);
                }
                global.CanvasEdges.add(sourceNode.id, placeholderNode.id, true);
                const newEdge = global.CanvasEdges.add(placeholderNode.id, activeNode.id);
                if (restoreIdx >= 0 && newEdge) {
                    const arr = global.CanvasEdges.edges;
                    const cur = arr.indexOf(newEdge);
                    if (cur > restoreIdx) {
                        arr.splice(cur, 1);
                        arr.splice(Math.min(restoreIdx, arr.length), 0, newEdge);
                        global.CanvasEdges.refresh();
                    }
                }
                placeholderNode.subType = 'edited';  // remove 可能降级，重新设置
            } else if (downstreamGens.length > 0) {
                // Case B：断 active→gen，建 active→edited→gen
                // 先记录各原连线数组下标并收集要删除的边（避免遍历时修改）
                const edgeIdxMap = new Map();
                downstreamGens.forEach(dg => { edgeIdxMap.set(dg.edge.id, (global.CanvasEdges.edges || []).indexOf(dg.edge)); });
                const edgesToRemove = downstreamGens.map(dg => dg.edge.id);
                edgesToRemove.forEach(id => global.CanvasEdges.remove(id));
                global.CanvasEdges.add(activeNode.id, placeholderNode.id, true);
                downstreamGens.forEach(dg => {
                    const newEdge = global.CanvasEdges.add(placeholderNode.id, dg.genNode.id);
                    // 回填原连线位置，保持参考图原位
                    const restoreIdx = edgeIdxMap.get(dg.edge.id);
                    if (typeof restoreIdx === 'number' && restoreIdx >= 0 && newEdge) {
                        const arr = global.CanvasEdges.edges;
                        const cur = arr.indexOf(newEdge);
                        if (cur > restoreIdx) {
                            arr.splice(cur, 1);
                            arr.splice(Math.min(restoreIdx, arr.length), 0, newEdge);
                            global.CanvasEdges.refresh();
                        }
                    }
                });
                placeholderNode.subType = 'edited';  // remove 可能降级，重新设置
            }

            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            if (hasInsertion) this.onEdgesChange();

            // 2. 异步上传编辑后的图片到 TOS
            let highUrl, previewUrl, mediumUrl;
            try {
                const formData = new FormData();
                formData.append('file', blob, 'edited_image.jpg');
                if (window.PxThumb) await window.PxThumb.attach(formData, blob);
                const res = await fetch(`${global.API_CONFIG.baseUrl}/v1/image/upload-edited-reference`, { method: 'POST', headers: authHeaders(), body: formData });
                if (!res.ok) throw new Error('上传失败: ' + res.status);
                const result = await res.json();
                if (result.code !== 0 || !result.data || !result.data.fullUrl) throw new Error(result.msg || '上传失败');
                highUrl = result.data.fullUrl;
                previewUrl = result.data.previewUrl || highUrl;
                mediumUrl = result.data.mediumUrl || previewUrl;
                if (window.PxThumb) await window.PxThumb.preload([previewUrl, mediumUrl]);
            } catch (e) {
                console.error('[画布] 编辑图片上传失败:', e);
                alert('编辑图片上传失败: ' + e.message);
                // 上传失败：移除占位节点
                global.CanvasBlocks.remove(placeholderNode.id);
                return;
            }

            // 3. 上传完成：更新节点图片，loading → idle
            global.CanvasBlocks.update(placeholderNode.id, {
                imageUrl: highUrl,
                previewUrl,
                mediumUrl,
                status: 'idle'
            });
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            // 4. 图片就绪后立即同步提示词栏参考图：
            //    连线重建时节点尚在 loading 被保护逻辑跳过，此处必须补一次同步，
            //    否则提示词区域看不到编辑后的参考图，生成也不会传入
            if (this._activeNodeId) {
                const bound = global.CanvasBlocks.getById(this._activeNodeId);
                if (bound && bound.nodeType === 'gen') {
                    const upstream = global.CanvasEdges.getUpstreamImages(this._activeNodeId);
                    this._lastUpstreamSig = this._upstreamSig(upstream);
                    this._syncUpstreamToPromptBar(upstream);
                }
            } else if (this._inDock) {
                this._refreshDockRefs();
            }
        },

        // ===== 添加参考图按钮：上传到画布并连接当前节点 =====
        _onAddRefImage(file) {
            // 视频/音频素材：直接建媒体节点（可连线到生成节点），不进提示词占位流程
            if (/^(video|audio)\//.test(file.type || '')) {
                const an = this._activeNodeId && global.CanvasBlocks.getById(this._activeNodeId);
                const targetGen = (an && an.nodeType === 'gen') ? an : null;
                const c = global.CanvasBlocks.viewportCenterWorld();
                (async () => {
                    const x = targetGen ? targetGen.x - 260 : c.x - 110;
                    const y = targetGen ? targetGen.y : c.y - 110;
                    const node = await this._createRefNode(file, x, y, { noPan: !!targetGen });
                    if (node && targetGen && global.CanvasBlocks.getById(node.id)) {
                        global.CanvasEdges.add(node.id, targetGen.id);
                        global.CanvasHistory.snapshot();
                        global.CanvasStore.scheduleSave();
                        this.onEdgesChange();
                    }
                })();
                return true;
            }

            // 固定模式：单选参考图节点时禁止上传（按钮已隐藏，拖拽/粘贴路径一并拦截）
            if (this._isPromptFixed()) {
                const selIds = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
                if (selIds.length === 1) {
                    const b = global.CanvasBlocks.getById(selIds[0]);
                    if (b && b.nodeType === 'ref') {
                        if (typeof this.toast === 'function') this.toast('参考节点不能再添加参考素材');
                        else alert('参考节点不能再添加参考素材');
                        return true;
                    }
                }
            }
            const activeNode = this._activeNodeId && global.CanvasBlocks.getById(this._activeNodeId);
            if (!activeNode) {
                // 停靠模式：先在提示词预览区插入上传中占位，再在画布上创建参考图节点，完成后预览自动刷新
                const pb = global.PromptBar;
                if (pb && Array.isArray(pb.uploadedImages)) {
                    const idx = pb.uploadedImages.findIndex(v => !v);
                    if (idx !== -1) {
                        pb.uploadedImages[idx] = { loading: true, file: file };
                        pb.loadingImagesCount = (pb.loadingImagesCount || 0) + 1;
                        if (typeof pb.renderRefs === 'function') pb.renderRefs();
                        if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                    }
                }
                const c = global.CanvasBlocks.viewportCenterWorld();
                (async () => {
                    const node = await this._createRefNode(file, c.x - 110, c.y - 110, { noPan: true });
                    if (node && global.CanvasBlocks.getById(node.id) && this._inDock) {
                        this._dockUploads.push(node.id);
                        // 上传完成：显式清除占位插槽并复位计数，再刷新预览（真实缩略图即时显示）
                        if (pb && Array.isArray(pb.uploadedImages)) {
                            const li = pb.uploadedImages.findIndex(v => v && v.loading && v.file === file);
                            if (li !== -1) pb.uploadedImages[li] = null;
                            pb.loadingImagesCount = Math.max(0, (pb.loadingImagesCount || 0) - 1);
                            // 不在此处调 renderRefs：占位清空会触发 _onRefsChange 剪掉未入列的 _dockUploads，
                            // 预览刷新交给下方 _refreshDockRefs；这里只补按钮状态复位
                            if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                        }
                        this._refreshDockRefs();
                    } else if (pb && Array.isArray(pb.uploadedImages)) {
                        // 创建失败：清除占位
                        const li = pb.uploadedImages.findIndex(v => v && v.loading && v.file === file);
                        if (li !== -1) pb.uploadedImages[li] = null;
                        pb.loadingImagesCount = Math.max(0, (pb.loadingImagesCount || 0) - 1);
                        if (typeof pb.renderRefs === 'function') pb.renderRefs();
                        if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                    }
                })();
                return true;
            }
            if (activeNode.nodeType !== 'gen') {
                alert('请先选中一个生成节点，再添加参考素材进行连接');
                return true;
            }
            // 先校验参考图数量上限：连线会被静默拒绝时提前提示，避免占位节点与预览占位残留
            const maxRefs = global.CanvasEdges._getMaxImagesForNode(activeNode);
            if (global.CanvasEdges._countImageInputs(activeNode.id) >= maxRefs) {
                alert('该生成节点最多支持 ' + maxRefs + ' 张参考图');
                return true;
            }
            // 立即创建占位节点并连线（上传中即显示连线）
            // 节点宽 220：左侧预留 260（220 + 40 间距），避免与生成节点重叠遮挡连线；再自动避让空位
            const refNode = global.CanvasBlocks.addRef({ x: activeNode.x - 260, y: activeNode.y, name: file.name, status: 'loading' });
            global.CanvasBlocks.setLocalPreview(refNode.id, file);
            const refSpot = global.CanvasBlocks._findFreeSpot(activeNode.x - 260, activeNode.y, refNode.w, refNode.h, refNode.id);
            if (refSpot.x !== activeNode.x - 260 || refSpot.y !== activeNode.y) {
                global.CanvasBlocks.update(refNode.id, { x: refSpot.x, y: refSpot.y });
            }
            const newEdge = global.CanvasEdges.add(refNode.id, activeNode.id);
            if (!newEdge) {
                global.CanvasBlocks.remove(refNode.id);
                alert('无法将参考素材连接到该节点');
                return true;
            }
            // 大画布下 rAF 节流的全量刷新会被延迟：强制立即同步渲染这条新连线
            if (global.CanvasEdges && typeof global.CanvasEdges._doRefresh === 'function') {
                global.CanvasEdges._doRefresh([refNode.id, activeNode.id]);
            }
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            this.onEdgesChange();
            // 在提示词预览区插入上传中占位（在初次同步上游之后插入，避免被覆盖式同步清掉）
            const pb = global.PromptBar;
            let hasPlaceholder = false;
            if (pb && Array.isArray(pb.uploadedImages)) {
                const idx = pb.uploadedImages.findIndex(v => !v);
                if (idx !== -1) {
                    // 占位插槽记录节点 id：即使上游同步未执行，连线清理也能凭保留清单保护这条连线
                    pb.uploadedImages[idx] = { loading: true, file: file, srcId: refNode.id };
                    pb.loadingImagesCount = (pb.loadingImagesCount || 0) + 1;
                    hasPlaceholder = true;
                    if (typeof pb.renderRefs === 'function') pb.renderRefs();
                    if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                }
            }
            // 异步上传，完成后更新节点图片并重新同步参考图（占位自动被真实缩略图替换）
            (async () => {
                try {
                    const r = await global.CanvasGenerate.uploadRef(file);
                    global.CanvasBlocks.update(refNode.id, {
                        imageUrl: r.highUrl, previewUrl: r.previewUrl, mediumUrl: r.mediumUrl, tempKey: r.tempKey, status: 'idle'
                    });
                    global.CanvasHistory.snapshot();
                    global.CanvasStore.scheduleSave();
                    // 先把上游真实图片同步进参考图清单（覆盖式同步自带抑制通知），
                    // 让本节点以 srcId 进入保留集合，避免随后清理占位时连线被误判为已删除而断开
                    this.onEdgesChange();
                    if (hasPlaceholder && pb) {
                        // 覆盖式同步已清掉占位插槽，只需复位上传计数与按钮状态
                        pb.loadingImagesCount = Math.max(0, (pb.loadingImagesCount || 0) - 1);
                        if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                    }
                    // 节点图片就绪后尺寸可能因图片比例变化，再次强制渲染连线保证显示正确
                    if (global.CanvasEdges && typeof global.CanvasEdges._doRefresh === 'function') {
                        global.CanvasEdges._doRefresh([refNode.id, activeNode.id]);
                    }
                } catch (e) {
                    console.error('[画布] 参考图上传失败:', e);
                    global.CanvasBlocks.remove(refNode.id);
                    if (hasPlaceholder && pb && Array.isArray(pb.uploadedImages)) {
                        const li = pb.uploadedImages.findIndex(v => v && v.loading && v.file === file);
                        if (li !== -1) pb.uploadedImages[li] = null;
                        pb.loadingImagesCount = Math.max(0, (pb.loadingImagesCount || 0) - 1);
                        if (typeof pb.renderRefs === 'function') pb.renderRefs();
                        if (typeof pb.updateGenerateButtonState === 'function') pb.updateGenerateButtonState();
                    }
                    alert('参考素材上传失败：' + (e.message || ''));
                }
            })();
            return true;  // 已接管
        },

        // ===== 生成 =====
        _onGenerate(params) {
            if (!this._activeNodeId) { this._generateFromDock(params); return; }
            const node = global.CanvasBlocks.getById(this._activeNodeId);
            if (!node) return;
            this._savePromptBarToNode(this._activeNodeId);
            // 生成前从当前生成节点再次取快照，防止异步配置/节点切换造成模型、比例或分辨率串值。
            if (node.nodeType === 'gen') {
                params = {
                    ...params,
                    model: node.model,
                    aspectRatio: node.aspectRatio,
                    imageSize: node.size
                };
                // 视频节点：带保存的时长/分辨率（节点值为准，防止串值）
                if (global.PromptBar && global.PromptBar._isVideoModel && global.PromptBar._isVideoModel(node.model)) {
                    params.duration = node.duration || params.duration || 5;
                    params.quality = node.resolution || params.quality || '720p';
                    params.videoMode = node.videoMode || params.videoMode || 'reference';
                }
            }

            // 画布始终按模型自动路由 API，避免复用主界面缓存的 api 导致模型与端口不匹配
            params.api = 'auto';

            if (node.nodeType === 'ref') {
                // 参考图节点：新建图片节点、连入、复制参数、切换选中、生成
                const ratio = this._aspectToRatio(params.aspectRatio);
                const gen = global.CanvasBlocks.addGen({
                    x: node.x + node.w + 80,
                    y: node.y,
                    prompt: params.prompt,
                    model: params.model,
                    aspectRatio: params.aspectRatio,
                    size: params.imageSize,
                    ratio: ratio || undefined
                });
                global.CanvasEdges.add(node.id, gen.id);
                // 从连线上游收集参考图（含刚连入的本节点图片）作为生成参数
                params.imageUrls = global.CanvasEdges.getUpstreamImages(gen.id);
                global.CanvasSelection.select(gen.id, false);
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
                global.CanvasGenerate.runNode(gen.id, params);
            } else {
                // 图片节点：直接生成
                global.CanvasGenerate.runNode(node.id, params);
            }
        },

        // ===== 创建节点 =====
        _createGenNode(x, y, category) {
            // 新建生成节点时继承 PromptBar 当前的模型/分辨率/比例选择（用户在底栏选好的设置）
            // category：'image' | 'video'（右键菜单指定类型创建；缺省跟随提示词栏当前模式）
            const pb = global.PromptBar;
            const cat = category || ((pb && pb.currentGenMode === 'video') ? 'video' : 'image');
            let genModel = pb && pb.currentModel;
            // 视频/图片节点分别取对应类别模型；记忆为空时取模型列表中该类别第一个
            if (cat === 'video') {
                if (!(genModel && pb._isVideoModel && pb._isVideoModel(genModel))) genModel = pb && pb.lastVideoModel;
                if (!genModel && pb && pb.modelConfigMap) genModel = Object.keys(pb.modelConfigMap).find(k => pb._isVideoModel(k)) || '';
                if (!genModel && typeof global.pxToast === 'function') { global.pxToast('当前没有可用的视频模型：请在「接口设置」的模型类型标记里把支持视频的模型标记为「视频」后重试', { type: 'error', duration: 6000 }); }
            } else if (!genModel || (pb._isVideoModel && pb._isVideoModel(genModel))) {
                genModel = (pb && pb.lastImageModel) || (pb && pb.modelConfigMap ? Object.keys(pb.modelConfigMap).find(k => !pb._isVideoModel(k)) : '') || genModel;
            }
            // 先创建节点获得真实尺寸（根据 aspectRatio 计算，如 9:16 竖图会更高）
            const isVideoSel = cat === 'video';
            const node = global.CanvasBlocks.addGen({
                x, y,
                model: genModel,
                genCategory: cat,
                size: pb && pb.currentRes,
                aspectRatio: pb && pb.currentAspect,
                duration: isVideoSel ? (pb.currentDuration || 5) : undefined,
                resolution: isVideoSel ? (pb.currentVideoRes || '') : undefined,
                videoMode: isVideoSel ? (pb.videoMode || 'reference') : undefined
            });
            // 用真实尺寸找空位，排除自身
            const spot = global.CanvasBlocks._findFreeSpot(x, y, node.w, node.h, node.id);
            if (spot.x !== x || spot.y !== y) {
                global.CanvasBlocks.update(node.id, { x: spot.x, y: spot.y });
            }
            global.CanvasSelection.select(node.id, false);
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            // 动画移动到新节点位置（节点中心）
            global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            return node;
        },

        _createTextNode(x, y) {
            // 先创建节点获得真实尺寸（文本节点固定 220x110）
            const node = global.CanvasBlocks.addText({ x: x - 110, y: y - 55 });
            // 用真实尺寸找空位，排除自身
            const spot = global.CanvasBlocks._findFreeSpot(x - 110, y - 55, node.w, node.h, node.id);
            if (spot.x !== x - 110 || spot.y !== y - 55) {
                global.CanvasBlocks.update(node.id, { x: spot.x, y: spot.y });
            }
            global.CanvasSelection.select(node.id, false);
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            // 动画移动到新节点位置（节点中心）
            global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            // 创建后直接进入编辑（等调用方可能的位置调整完成后再聚焦）
            setTimeout(() => global.CanvasBlocks.beginTextEdit(node.id), 0);
            return node;
        },

        // _PASTE_FIX_1028 粘贴落点：视口中心即节点中心；比例变化时底边锚定会让竖图中心上移，上传完成后回正
        async _pasteRefAtCenter(file, c) {
            const x = c.x - 110, y = c.y - 110;
            const node = await this._createRefNode(file, x, y);
            if (node && !node._spotMoved && (node.w !== 220 || node.h !== 220)) {
                global.CanvasBlocks.update(node.id, { x: Math.round(c.x - node.w / 2), y: Math.round(c.y - node.h / 2) });
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
            }
            return node;
        },

        async _createRefNode(file, x, y, opts) {
            // 先创建节点获得真实尺寸（参考图节点初始 220x220，上传后根据图片比例更新）
            const node = global.CanvasBlocks.addRef({ x, y, name: file.name, status: 'loading' });
            global.CanvasBlocks.setLocalPreview(node.id, file);
            // 批量上传时 opts.skipFindSpot=true（位置已预先横排算好），单个上传时自动找空位
            if (!opts || !opts.skipFindSpot) {
                const spot = global.CanvasBlocks._findFreeSpot(x, y, node.w, node.h, node.id);
                if (spot.x !== x || spot.y !== y) {
                    global.CanvasBlocks.update(node.id, { x: spot.x, y: spot.y });
                    node._spotMoved = true; /* _PASTE_FIX_1028 防重叠挪过位则不再回正中心 */
                }
            }
            // 动画移动到新节点位置（节点中心）
            if (!opts || !opts.noPan) global.CanvasCore.panTo(node.x + node.w / 2, node.y + node.h / 2);
            try {
                // 视频/音频素材：走媒体上传（MP4/MOV≤200MB、MP3/WAV≤15MB），建媒体节点
                if (/^(video|audio)\//.test(file.type || '')) {
                    const m = await global.CanvasGenerate.uploadMediaRef(file);
                    global.CanvasBlocks.update(node.id, {
                        mediaType: m.mediaType, mediaUrl: m.url,
                        videoUrl: m.mediaType === 'video' ? m.url : '',
                        mediaSize: m.size || 0, mediaDuration: m.duration || 0,
                        tempKey: m.tempKey || '', w: 300, h: m.mediaType === 'video' ? 169 : 90, status: 'idle'
                    });
                    global.CanvasHistory.snapshot();
                    global.CanvasStore.scheduleSave();
                    // 视频素材：用本地文件入队生成预览版
                    if (m.mediaType === 'video' && global.VideoProxy) global.VideoProxy.enqueue(node.id, file);
                    return node;
                }
                const r = await global.CanvasGenerate.uploadRef(file);
                global.CanvasBlocks.update(node.id, {
                    imageUrl: r.highUrl, previewUrl: r.previewUrl, mediumUrl: r.mediumUrl, tempKey: r.tempKey, status: 'idle'
                });
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            } catch (e) {
                console.error('[画布] 参考图上传失败:', e);
                global.CanvasBlocks.remove(node.id);
                alert('参考素材上传失败：' + (e.message || ''));
            }
            return node;
        },

        // 端口拖线落空白：弹出可创建节点选择（只列出当前支持的节点类型），选择后创建并自动连线
        // opts: { mode: 'generate'(输出端口→下游) | 'context'(输入端口→上游), fromId, toId, clientX, clientY, tempPath }
        // 菜单弹出期间虚线（tempPath）保留：选择节点后移除并连接，点击其他地方时随菜单关闭一并移除
        showNodeCreateMenu(opts) {
            const w = CanvasCore.screenToWorld(opts.clientX, opts.clientY);
            const connect = (a, b) => {
                global.CanvasEdges.add(a, b);
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            };
            // 包装动作：消费掉待连虚线
            const wrap = (fn) => () => {
                this._discardPendingMenuEdge();
                fn();
            };
            let title, items;
            if (opts.mode === 'context') {
                // 输入端口（gen 左侧）：为该生成节点添加上游；新节点右边缘中点对齐松手点，与最终连线端点一致
                title = '添加上下文';
                items = [
                    { label: '参考素材…', act: wrap(() => this._pickRefFile(async (f) => {
                        const node = await this._createRefNode(f, w.x - 300, w.y - 150);
                        // 上传失败时节点已被移除，仅在其仍存在时连线；按实际上传后尺寸右对齐松手点
                        if (node && global.CanvasBlocks.getById(node.id)) {
                            global.CanvasBlocks.update(node.id, { x: w.x - node.w, y: w.y - node.h / 2 });
                            connect(node.id, opts.toId);
                        }
                    }))},
                    { label: '文本', act: wrap(() => {
                        const node = this._createTextNode(w.x, w.y);
                        global.CanvasBlocks.update(node.id, { x: w.x - node.w, y: w.y - node.h / 2 });
                        connect(node.id, opts.toId);
                    })},
                    { label: '图片', act: wrap(() => {
                        const node = this._createGenNode(w.x, w.y - 30);
                        global.CanvasBlocks.update(node.id, { x: w.x - node.w, y: w.y - node.h / 2 });
                        connect(node.id, opts.toId);
                    })}
                ];
            } else {
                // 输出端口（右侧）：引用该节点生成（只有 gen 节点可接收连线）；新节点左边缘中点对齐松手点
                title = '引用该节点生成';
                items = [
                    { label: '图片', act: wrap(() => {
                        const node = this._createGenNode(w.x, w.y - 30, 'image');
                        global.CanvasBlocks.update(node.id, { x: w.x, y: w.y - node.h / 2 });
                        connect(opts.fromId, node.id);
                    })},
                    { label: '视频', act: wrap(() => {
                        const node = this._createGenNode(w.x, w.y - 30, 'video');
                        global.CanvasBlocks.update(node.id, { x: w.x, y: w.y - node.h / 2 });
                        connect(opts.fromId, node.id);
                    })}
                ];
            }
            // 拖线结束的 mouseup 之后浏览器还会派发一次 click，会触发全局隐藏菜单：吞掉这一次
            this._suppressMenuHideOnce = true;
            this._renderMenu(items, opts.clientX, opts.clientY, title);
            // 虚线终点对准菜单侧边中点：输出端口拖出对左边中点，输入端口拖出对右边中点
            this._alignMenuEdgeMid(opts.clientX, opts.clientY, opts.mode === 'generate' ? 'left' : 'right');
            // 在 _renderMenu 之后登记虚线（_renderMenu 会清理上一条遗留虚线）
            this._pendingMenuEdge = opts.tempPath || null;
        },

        // 移除菜单待连的虚线（若有）
        _discardPendingMenuEdge() {
            const t = this._pendingMenuEdge;
            this._pendingMenuEdge = null;
            if (t) t.remove();
        },

        // 弹出文件选择器挑选一张参考图
        _pickRefFile(cb, accept) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept || 'image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.m4a,.aac';
            input.onchange = () => { const f = input.files && input.files[0]; if (f) cb(f); };
            input.click();
        },

        // 新建空媒体节点（右键菜单），节点内点击上传按钮填充
        _createEmptyMediaNode(mediaType, x, y) {
            const h = mediaType === 'video' ? 169 : 90;
            const node = global.CanvasBlocks.addRef({ x: x - 150, y: y - h / 2, w: 300, h, mediaType, name: mediaType === 'video' ? '视频素材' : '音频素材' });
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
            this._ensureVisible(node);
            return node;
        },

        // 视频播放键：click 在节点 mousedown 置顶移动（_bringToFront）后可能不被浏览器派发，
        // 改用 mousedown+mouseup 捕获阶段 + 位移判定触发（拖拽移动节点不触发播放）
        _bindPlayPress() {
            document.addEventListener('mousedown', (e) => {
                const pb = e.target.closest && e.target.closest('.node-video-play[data-action]');
                this._playDown = pb ? { x: e.clientX, y: e.clientY } : null;
            }, true);
            document.addEventListener('mouseup', (e) => {
                if (!this._playDown) return;
                const pb = e.target.closest && e.target.closest('.node-video-play[data-action]');
                const dist = Math.abs(e.clientX - this._playDown.x) + Math.abs(e.clientY - this._playDown.y);
                this._playDown = null;
                if (!pb || dist > 6) return;
                const holder = pb.closest('[data-block-id]');
                if (holder && holder.dataset.blockId) this._playNodeVideo(holder);
            }, true);
        },

        // 空媒体节点「点击上传」按钮 + 视频节点播放键（均在节点体内，工具栏委托覆盖不到，绑 document 委托）
        _bindMediaUpload() {
            document.addEventListener('click', (e) => {
                const playBtn = e.target.closest('.node-video-play[data-action]');
                if (playBtn) {
                    const ph = playBtn.closest('[data-block-id]');
                    if (ph && ph.dataset.blockId) {
                        e.stopPropagation();
                        this._playNodeVideo(ph);
                    }
                    return;
                }
                const btn = e.target.closest('.node-media-upload[data-action]');
                if (!btn) {
                    // 点击播放中节点以外的区域（空白/其他节点）：退出播放，恢复首帧海报
                    document.querySelectorAll('video.node-video.is-playing').forEach(v => {
                        const within = e.target.closest && e.target.closest('.node-video-wrap.is-playing');
                        if (!within) this._resetNodeVideo(v);
                    });
                    return;
                }
                const holder = btn.closest('[data-block-id]');
                const nodeId = holder && holder.dataset.blockId;
                if (!nodeId) return;
                e.stopPropagation();
                this._onToolAction('media-upload', nodeId, e);
            });
        },

        // ===== 视频修剪 / 截取帧：节点下方时间轴面板（全部在浏览器本地完成，不经服务器计算） =====
        _vtrim: null,
        // 最短选区：上传接口 uploadMediaRef 要求视频素材 ≥2 秒，低于此值上传会被拒
        _VTRIM_MIN: 2,

        // 选择本地录制可用的编码：服务端媒体上传白名单仅 MP4/MOV（不含 webm），故只接受 MP4
        _vtrimPickMime() {
            if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
            if (typeof HTMLMediaElement.prototype.captureStream !== 'function') return '';
            const list = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'];
            for (const m of list) {
                try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
            }
            return '';
        },

        _vtrimFmt(t, dec) {
            t = Math.max(0, t || 0);
            const m = Math.floor(t / 60);
            const s = t - m * 60;
            const ss = dec ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
            return String(m).padStart(2, '0') + ':' + ss;
        },

        // 创建跨域可读的 video（/api/img 302 到 TOS，TOS 返回 ACAO:*，drawImage/captureStream 不会污染画布）
        _vtrimMakeVideo(url, preload) {
            const VP = global.VideoProxy;
            if (VP && VP.sameOrigin) url = VP.sameOrigin(url);   // 绝对站内地址转同源，避免跨域 CORS 失败
            const v = document.createElement('video');
            const internal = !VP || !VP.isInternalMedia || VP.isInternalMedia(url);
            // 仅站内地址设 crossOrigin：第三方外链不带 ACAO，设了反而加载失败
            if (internal) v.crossOrigin = 'anonymous';
            v.preload = preload || 'auto';
            v.playsInline = true;
            v.muted = true;
            // 追加一次性参数：避免复用节点 <video> 非 CORS 加载的同一资源缓存（会导致 CORS 校验失败、画布被污染）
            v.src = internal ? (url + (url.indexOf('?') >= 0 ? '&' : '?') + '_vtcors=' + Date.now()) : url;
            return v;
        },

        _vtrimWait(el, evName, ms) {
            return new Promise((resolve, reject) => {
                let timer = null;
                const cleanup = () => { el.removeEventListener(evName, ok); el.removeEventListener('error', bad); clearTimeout(timer); };
                const ok = () => { cleanup(); resolve(); };
                const bad = () => { cleanup(); reject(new Error('视频加载失败')); };
                el.addEventListener(evName, ok);
                el.addEventListener('error', bad);
                timer = setTimeout(() => { cleanup(); reject(new Error('视频加载超时')); }, ms || 15000);
            });
        },

        // seek 并等待 seeked（目标时刻与当前一致时不会触发 seeked，直接返回）
        _vtrimSeek(v, t) {
            if (!v.seeking && Math.abs(v.currentTime - t) < 0.001) return Promise.resolve();
            const p = this._vtrimWait(v, 'seeked', 10000);
            v.currentTime = t;
            return p;
        },

        // 节点内的视频预览元素（节点重渲染会重建，每次现取）
        _vtrimNodeVideo(st) {
            const L = global.CanvasBlocks && global.CanvasBlocks.layerEl;
            return L ? L.querySelector(`video.node-video[data-block-id="${st.nodeId}"]`) : null;
        },
        _vtrimSeekNode(st, t) {
            const v = this._vtrimNodeVideo(st);
            if (v) { try { v.currentTime = t; } catch (_) {} }
        },

        _bindVideoTrim() {
            // 点击面板外关闭（工具栏内点击由按钮自身切换；导出中不关闭，需点「取消」）
            document.addEventListener('mousedown', (e) => {
                const st = this._vtrim;
                if (!st || st.exporting) return;
                if (st.el.contains(e.target)) return;
                if (this._toolbarFloatEl && this._toolbarFloatEl.contains(e.target)) return;
                this._closeVideoTrim();
            }, true);
            // Esc：导出中则取消导出，否则关闭面板
            window.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !this._vtrim) return;
                if (this._vtrim.exporting) { this._vtrim.cancel = true; return; }
                this._closeVideoTrim();
            }, true);
        },

        _openVideoTrim(node, mode) {
            const url = node.videoUrl || node.mediaUrl;
            if (!url) return;
            const cur = this._vtrim;
            if (cur && cur.exporting) { alert('正在导出视频，请稍候或先取消'); return; }
            if (cur && cur.nodeId === node.id && cur.mode === mode) { this._closeVideoTrim(); return; }
            if (mode === 'trim' && !this._vtrimPickMime()) { alert('当前浏览器不支持本地视频导出，请使用最新版 Chrome/Edge'); return; }
            this._closeVideoTrim();
            const appEl = document.querySelector('.canvas-app');
            if (!appEl) return;
            const playSvg = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
            const isTrim = mode === 'trim';
            const el = document.createElement('div');
            el.className = 'vtrim-panel mode-' + mode;
            el.innerHTML = `
                <div class="vtrim-strip">
                    <div class="vtrim-thumbs"></div>
                    ${isTrim ? `<div class="vtrim-mask vtrim-mask-l"></div><div class="vtrim-mask vtrim-mask-r"></div>
                    <div class="vtrim-sel"><div class="vtrim-handle vtrim-handle-l"></div><div class="vtrim-handle vtrim-handle-r"></div><span class="vtrim-dur">0.0s</span></div>` : ''}
                    <div class="vtrim-playhead"></div>
                </div>
                <div class="vtrim-bar">
                    ${isTrim ? `<button type="button" class="capsule-btn vtrim-play" title="在选区内循环播放">${playSvg}</button>` : ''}
                    <span class="vtrim-time">00:00 / 00:00</span>
                    <span class="vtrim-status">加载中…</span>
                    <button type="button" class="capsule-btn vtrim-cancel" style="display:none">取消</button>
                    <button type="button" class="vtrim-confirm" disabled>确认</button>
                </div>`;
            appEl.appendChild(el);
            const st = {
                nodeId: node.id, mode, url, el,
                // 预览版地址（仅用于胶片缩略图；导出/截帧仍用原视频保证质量）
                purl: (() => { const p = global.VideoProxy ? global.VideoProxy.validPreviewOf(node) : ''; return p && p !== url ? p : ''; })(),
                dur: 0, s: 0, e: 0, cur: 0, vw: 0, vh: 0,
                playing: false, raf: 0, exporting: false, cancel: false, busy: false,
                tv: null, pv: null
            };
            this._vtrim = st;
            // 跟随模式的提示词浮层同样在节点下方，面板打开期间临时隐藏
            if (this._floatEl && !this._floatEl.classList.contains('docked')) this._floatEl.classList.add('vtrim-hide');
            this._vtrimBindPanel(st);
            this._positionVideoTrim();
            this._vtrimLoad(st);
        },

        _closeVideoTrim() {
            const st = this._vtrim;
            if (!st) return;
            this._vtrim = null;
            st.cancel = true;
            st.playing = false;
            cancelAnimationFrame(st.raf);
            // 节点视频恢复首帧海报（用户自己点了播放的不动）
            const v = this._vtrimNodeVideo(st);
            if (v && !v.classList.contains('is-playing')) this._resetNodeVideo(v);
            [st.tv, st.pv, st.tvp].forEach(x => {
                if (!x) return;
                try { x.pause(); x.removeAttribute('src'); x.load(); } catch (_) {}
            });
            if (st.el && st.el.parentNode) st.el.parentNode.removeChild(st.el);
            if (this._floatEl) this._floatEl.classList.remove('vtrim-hide');
        },

        // 定位：固定在节点正下方（与提示词浮层 _positionFloat 同算法）
        _positionVideoTrim() {
            const st = this._vtrim;
            if (!st) return;
            const node = global.CanvasBlocks.getById(st.nodeId);
            if (!node) {
                if (st.exporting) st.el.style.display = 'none';
                else this._closeVideoTrim();
                return;
            }
            const scale = CanvasCore.viewport.scale;
            const vpRect = CanvasCore._vpRect || CanvasCore.viewportEl.getBoundingClientRect();
            const appEl = document.querySelector('.canvas-app');
            const appRect = appEl.getBoundingClientRect();
            const offsetX = vpRect.left - appRect.left;
            const offsetY = vpRect.top - appRect.top;
            const sx = node.x * scale + CanvasCore.viewport.x;
            const sy = node.y * scale + CanvasCore.viewport.y;
            const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
            const width = Math.round(560 * uiScale);
            st.el.style.width = width + 'px';
            st.el.style.left = Math.round(offsetX + sx + node.w * scale / 2 - width / 2) + 'px';
            st.el.style.top = Math.round(offsetY + sy + node.h * scale + 12 * uiScale) + 'px';
        },

        _vtrimStatus(st, txt) {
            const s = st.el.querySelector('.vtrim-status');
            if (s) s.textContent = txt || '';
        },

        async _vtrimLoad(st) {
            // 有预览版时原视频只读元数据（时长/分辨率），缩略图走预览版，避免整段下载原视频
            const tv = this._vtrimMakeVideo(st.url, st.purl ? 'metadata' : '');
            st.tv = tv;
            try {
                await this._vtrimWait(tv, 'loadedmetadata', 20000);
                if (this._vtrim !== st) return;
                st.dur = isFinite(tv.duration) ? tv.duration : 0;
                st.vw = tv.videoWidth;
                st.vh = tv.videoHeight;
                if (!st.dur || !st.vw || !st.vh) throw new Error('无法读取视频信息');
                if (st.mode === 'trim' && st.dur < this._VTRIM_MIN) {
                    alert('视频时长不足 ' + this._VTRIM_MIN + ' 秒，无法修剪');
                    this._closeVideoTrim();
                    return;
                }
                st.s = 0; st.e = st.dur; st.cur = 0;
                if (st.mode === 'frame') {
                    // 截帧大预览：直接展示跨域可读的 video，确认时从它按原始分辨率取帧
                    const pv = this._vtrimMakeVideo(st.url);
                    pv.className = 'vtrim-preview';
                    pv.style.aspectRatio = st.vw + ' / ' + st.vh;
                    st.pv = pv;
                    st.el.insertBefore(pv, st.el.firstChild);
                }
                this._vtrimRender(st);
                this._vtrimStatus(st, '');
                st.el.querySelector('.vtrim-confirm').disabled = false;
                await this._vtrimThumbs(st);
            } catch (err) {
                if (this._vtrim === st) this._vtrimStatus(st, '视频加载失败：' + (err.message || ''));
            }
        },

        // 胶片缩略图条：均匀取 10 帧，按 cover 方式裁切绘制
        async _vtrimThumbs(st) {
            const box = st.el.querySelector('.vtrim-thumbs');
            const N = 10;
            const dpr = window.devicePixelRatio || 1;
            const rect = box.getBoundingClientRect();
            const cw = Math.max(16, Math.round(rect.width / N * dpr));
            const ch = Math.max(16, Math.round(rect.height * dpr));
            const cvs = [];
            for (let i = 0; i < N; i++) {
                const c = document.createElement('canvas');
                c.width = cw; c.height = ch;
                box.appendChild(c);
                cvs.push(c);
            }
            // 胶片缩略优先用预览版（体积小、seek 快）；加载失败回退原视频；时间按时长比例映射
            let tv = st.tv, vw = st.vw, vh = st.vh, tScale = 1;
            if (st.purl) {
                const ptv = this._vtrimMakeVideo(st.purl);
                st.tvp = ptv;
                try {
                    await this._vtrimWait(ptv, 'loadedmetadata', 15000);
                    if (ptv.videoWidth && ptv.videoHeight) {
                        tv = ptv; vw = ptv.videoWidth; vh = ptv.videoHeight;
                        if (isFinite(ptv.duration) && ptv.duration > 0) tScale = ptv.duration / st.dur;
                    }
                } catch (_) {}
                if (this._vtrim !== st) return;
            }
            const sr = vw / vh, dr = cw / ch;
            let sw = vw, sh = vh, sx = 0, sy = 0;
            if (sr > dr) { sw = vh * dr; sx = (vw - sw) / 2; } else { sh = vw / dr; sy = (vh - sh) / 2; }
            for (let i = 0; i < N; i++) {
                if (this._vtrim !== st) return;
                const t = Math.max(0, Math.min(st.dur - 0.05, (i + 0.5) * st.dur / N)) * tScale;
                try { await this._vtrimSeek(tv, t); } catch (_) { continue; }
                if (this._vtrim !== st) return;
                try { cvs[i].getContext('2d').drawImage(tv, sx, sy, sw, sh, 0, 0, cw, ch); } catch (_) {}
            }
        },

        _vtrimRender(st) {
            const el = st.el;
            const d = st.dur || 1;
            const pct = (t) => (t / d * 100) + '%';
            if (st.mode === 'trim') {
                const sel = el.querySelector('.vtrim-sel');
                sel.style.left = pct(st.s);
                sel.style.width = pct(st.e - st.s);
                el.querySelector('.vtrim-mask-l').style.width = pct(st.s);
                el.querySelector('.vtrim-mask-r').style.width = pct(d - st.e);
                el.querySelector('.vtrim-dur').textContent = (st.e - st.s).toFixed(1) + 's';
            }
            el.querySelector('.vtrim-playhead').style.left = pct(st.cur);
            el.querySelector('.vtrim-time').textContent = this._vtrimFmt(st.cur, st.mode === 'frame') + ' / ' + this._vtrimFmt(st.dur);
        },

        _vtrimBindPanel(st) {
            const el = st.el;
            // 阻止事件穿透到画布（与工具栏浮层一致）
            el.addEventListener('mousedown', (e) => e.stopPropagation());
            const strip = el.querySelector('.vtrim-strip');
            const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
            const timeAt = (clientX) => {
                const r = strip.getBoundingClientRect();
                return clamp((clientX - r.left) / (r.width || 1), 0, 1) * st.dur;
            };
            const drag = (onMove) => {
                const mm = (ev) => { ev.preventDefault(); onMove(ev); };
                const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
                document.addEventListener('mousemove', mm);
                document.addEventListener('mouseup', mu);
            };
            strip.addEventListener('mousedown', (e) => {
                if (!st.dur || st.exporting || st.busy || e.button !== 0) return;
                e.preventDefault();
                if (st.mode === 'frame') {
                    // 截帧：拖动播放头，大预览实时 seek
                    const go = (ev) => {
                        st.cur = timeAt(ev.clientX);
                        this._vtrimRender(st);
                        if (st.pv) { try { st.pv.currentTime = st.cur; } catch (_) {} }
                    };
                    go(e);
                    drag(go);
                    return;
                }
                this._vtrimPause(st);
                const MIN = Math.min(this._VTRIM_MIN, st.dur);
                const h = e.target.closest('.vtrim-handle');
                const apply = (t) => { st.cur = t; this._vtrimRender(st); this._vtrimSeekNode(st, t); };
                if (h && h.classList.contains('vtrim-handle-l')) {
                    drag((ev) => { st.s = clamp(timeAt(ev.clientX), 0, st.e - MIN); apply(st.s); });
                } else if (h) {
                    drag((ev) => { st.e = clamp(timeAt(ev.clientX), st.s + MIN, st.dur); apply(st.e); });
                } else if (e.target.closest('.vtrim-sel')) {
                    // 拖动选区整体平移（时长不变）
                    const t0 = timeAt(e.clientX), s0 = st.s, len = st.e - st.s;
                    drag((ev) => {
                        st.s = clamp(s0 + timeAt(ev.clientX) - t0, 0, st.dur - len);
                        st.e = st.s + len;
                        apply(st.s);
                    });
                } else {
                    // 点击选区外：播放头定位到选区内最近处
                    apply(clamp(timeAt(e.clientX), st.s, st.e));
                }
            });
            const playBtn = el.querySelector('.vtrim-play');
            if (playBtn) playBtn.addEventListener('click', () => { if (st.playing) this._vtrimPause(st); else this._vtrimPlay(st); });
            el.querySelector('.vtrim-confirm').addEventListener('click', () => {
                if (st.mode === 'trim') this._vtrimExport(st); else this._vtrimCapture(st);
            });
            el.querySelector('.vtrim-cancel').addEventListener('click', () => {
                if (st.exporting) st.cancel = true; else this._closeVideoTrim();
            });
        },

        _vtrimSetPlayIcon(st) {
            const b = st.el.querySelector('.vtrim-play');
            if (!b) return;
            b.innerHTML = st.playing
                ? '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
            b.title = st.playing ? '暂停' : '在选区内循环播放';
        },

        // 修剪模式播放：节点内视频只在选区内循环
        _vtrimPlay(st) {
            const v = this._vtrimNodeVideo(st);
            if (!v || !st.dur) return;
            if (!(st.cur >= st.s && st.cur < st.e - 0.05)) st.cur = st.s;
            try { v.currentTime = st.cur; } catch (_) {}
            const pr = v.play();
            if (pr && pr.catch) pr.catch(() => {});
            st.playing = true;
            this._vtrimSetPlayIcon(st);
            const tick = () => {
                if (this._vtrim !== st || !st.playing) return;
                const nv = this._vtrimNodeVideo(st);
                if (!nv) { this._vtrimPause(st); return; }
                if (!nv.seeking && (nv.currentTime >= st.e || nv.ended)) {
                    nv.currentTime = st.s;
                    if (nv.paused) { const p2 = nv.play(); if (p2 && p2.catch) p2.catch(() => {}); }
                }
                st.cur = Math.max(st.s, Math.min(st.e, nv.currentTime));
                this._vtrimRender(st);
                st.raf = requestAnimationFrame(tick);
            };
            st.raf = requestAnimationFrame(tick);
        },

        _vtrimPause(st) {
            if (!st.playing) return;
            st.playing = false;
            cancelAnimationFrame(st.raf);
            const v = this._vtrimNodeVideo(st);
            if (v) { try { v.pause(); } catch (_) {} }
            this._vtrimSetPlayIcon(st);
        },

        _vtrimSafeName(s) {
            return String(s || 'video').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'video';
        },

        // 首帧/尾帧：不打开时间轴面板，直接按原始分辨率截取 → 新建图片节点
        async _quickFrame(node, which) {
            if (this._qfBusy) return;
            const url = node.videoUrl || node.mediaUrl;
            if (!url) return;
            this._qfBusy = true;
            const label = which === 'last' ? '尾帧' : '首帧';
            const dismiss = window.pxToast ? window.pxToast('正在截取' + label + '…', { type: 'info', duration: 60000 }) : null;
            const v = this._vtrimMakeVideo(url);
            try {
                await this._vtrimWait(v, 'loadedmetadata', 20000);
                const dur = isFinite(v.duration) ? v.duration : 0;
                // 尾帧取结尾前 0.08s：正好落在最后一帧上，避免 seek 到末尾解码不出画面
                const t = which === 'last' ? Math.max(0, dur - 0.08) : 0;
                if (t > 0) await this._vtrimSeek(v, t);
                if (v.readyState < 2) await this._vtrimWait(v, 'loadeddata', 15000);
                const w = v.videoWidth, h = v.videoHeight;
                if (!w || !h) throw new Error('无法读取视频画面');
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(v, 0, 0, w, h);
                let type = 'image/png', ext = 'png';
                let blob = await new Promise((r) => c.toBlob(r, 'image/png'));
                if (blob && blob.size > 19.5 * 1024 * 1024) {
                    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
                    type = 'image/jpeg'; ext = 'jpg';
                }
                if (!blob) throw new Error('无法生成图片');
                const src = global.CanvasBlocks.getById(node.id);
                if (!src) throw new Error('源节点已删除');
                const baseName = src.name || '视频';
                const file = new File([blob], this._vtrimSafeName(baseName) + '_' + (which === 'last' ? 'last' : 'first') + '.' + ext, { type });
                if (typeof dismiss === 'function') dismiss();
                await this._vtrimCreateNode(src, file, { kind: 'image', name: baseName + ' ' + label, ratio: w / h });
            } catch (err) {
                if (typeof dismiss === 'function') dismiss();
                const msg = (err && err.name === 'SecurityError') ? '视频跨域受限，无法读取画面' : ((err && err.message) || '');
                alert('截取' + label + '失败：' + msg);
            } finally {
                this._qfBusy = false;
                try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
            }
        },

        // 截取帧：按视频原始分辨率绘制当前帧 → PNG → 走图片上传 → 新建图片节点
        async _vtrimCapture(st) {
            if (st.busy || !st.pv) return;
            const pv = st.pv;
            const btn = st.el.querySelector('.vtrim-confirm');
            st.busy = true;
            btn.disabled = true;
            this._vtrimStatus(st, '截取中…');
            try {
                if (pv.readyState < 1) await this._vtrimWait(pv, 'loadedmetadata', 20000);
                await this._vtrimSeek(pv, st.cur);
                if (pv.readyState < 2) await this._vtrimWait(pv, 'loadeddata', 15000);
                const w = pv.videoWidth, h = pv.videoHeight;
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(pv, 0, 0, w, h);
                let type = 'image/png', ext = 'png';
                let blob = await new Promise((r) => c.toBlob(r, 'image/png'));
                // 图片上传上限 20MB：超大分辨率 PNG 超限时退回高质量 JPEG
                if (blob && blob.size > 19.5 * 1024 * 1024) {
                    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
                    type = 'image/jpeg'; ext = 'jpg';
                }
                if (!blob) throw new Error('无法生成图片');
                const src = global.CanvasBlocks.getById(st.nodeId);
                if (!src) throw new Error('源节点已删除');
                const baseName = src.name || '视频';
                const file = new File([blob], this._vtrimSafeName(baseName) + '_frame_' + st.cur.toFixed(2) + 's.' + ext, { type });
                this._closeVideoTrim();
                await this._vtrimCreateNode(src, file, { kind: 'image', name: baseName + ' 截帧', ratio: w / h });
            } catch (err) {
                const msg = (err && err.name === 'SecurityError') ? '视频跨域受限，无法读取画面' : ((err && err.message) || '');
                if (this._vtrim === st) {
                    st.busy = false;
                    btn.disabled = false;
                    this._vtrimStatus(st, '');
                }
                alert('截取帧失败：' + msg);
            }
        },

        // 视频修剪：隐藏 video 实时播放选区 → captureStream + MediaRecorder 录制为 MP4 → 上传 → 新建视频节点
        async _vtrimExport(st) {
            if (st.exporting || !st.dur) return;
            const mime = this._vtrimPickMime();
            if (!mime) { alert('当前浏览器不支持本地视频导出，请使用最新版 Chrome/Edge'); return; }
            this._vtrimPause(st);
            st.exporting = true;
            st.cancel = false;
            const el = st.el;
            const btn = el.querySelector('.vtrim-confirm');
            const cancelBtn = el.querySelector('.vtrim-cancel');
            btn.disabled = true;
            btn.textContent = '导出中 0%';
            cancelBtn.style.display = '';
            this._vtrimStatus(st, '本地实时录制中，请勿关闭页面');
            const s = st.s, e = st.e, len = e - s;
            const ev = this._vtrimMakeVideo(st.url);
            ev.muted = false;
            ev.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
            document.body.appendChild(ev);
            let actx = null, rec = null, stream = null, timer = 0;
            try {
                await this._vtrimWait(ev, 'loadedmetadata', 20000);
                await this._vtrimSeek(ev, s);
                if (st.cancel) throw new Error('__cancel');
                const vTracks = ev.captureStream().getVideoTracks();
                if (!vTracks.length) throw new Error('无法读取视频画面');
                // 音轨经 WebAudio 导出（不接扬声器，录制期间不外放）；失败时退回 captureStream 自带音轨
                let aTracks = [];
                try {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    actx = new AC();
                    const srcNode = actx.createMediaElementSource(ev);
                    const dest = actx.createMediaStreamDestination();
                    srcNode.connect(dest);
                    if (actx.state === 'suspended') await actx.resume();
                    aTracks = dest.stream.getAudioTracks();
                } catch (_) {
                    aTracks = ev.captureStream().getAudioTracks();
                }
                stream = new MediaStream(vTracks.concat(aTracks));
                const chunks = [];
                rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
                rec.ondataavailable = (x) => { if (x.data && x.data.size) chunks.push(x.data); };
                const stopped = new Promise((r) => { rec.onstop = r; });
                rec.start(500);
                await ev.play();
                // 用 setInterval 轮询（后台标签页 rAF 不触发），到达终点即停
                await new Promise((resolve, reject) => {
                    let lastT = -1, lastMove = Date.now();
                    timer = setInterval(() => {
                        if (st.cancel) { reject(new Error('__cancel')); return; }
                        const t = ev.currentTime;
                        if (t !== lastT) { lastT = t; lastMove = Date.now(); }
                        else if (Date.now() - lastMove > 20000) { reject(new Error('视频播放卡住')); return; }
                        if (this._vtrim === st) btn.textContent = '导出中 ' + Math.round(Math.max(0, Math.min(1, (t - s) / len)) * 100) + '%';
                        if (t >= e - 0.02 || ev.ended) resolve();
                    }, 30);
                });
                clearInterval(timer);
                ev.pause();
                if (rec.state !== 'inactive') rec.stop();
                await stopped;
                const blob = new Blob(chunks, { type: 'video/mp4' });
                if (!blob.size) throw new Error('录制结果为空');
                const src = global.CanvasBlocks.getById(st.nodeId);
                if (!src) throw new Error('源节点已删除');
                const baseName = src.name || '视频';
                const file = new File([blob], this._vtrimSafeName(baseName) + '_trim.mp4', { type: 'video/mp4' });
                const ratio = (ev.videoWidth && ev.videoHeight) ? ev.videoWidth / ev.videoHeight : (st.vw / st.vh);
                st.exporting = false;
                if (this._vtrim === st) this._closeVideoTrim();
                await this._vtrimCreateNode(src, file, { kind: 'video', name: baseName + ' 视频修剪', ratio, duration: Math.round(len * 10) / 10 });
            } catch (err) {
                const msg = (err && err.message) || '';
                if (msg === '__cancel') {
                    if (this._vtrim === st) this._vtrimStatus(st, '已取消导出');
                } else {
                    if (this._vtrim === st) this._vtrimStatus(st, '');
                    alert('视频导出失败：' + ((err && err.name === 'SecurityError') ? '视频跨域受限' : msg));
                }
            } finally {
                clearInterval(timer);
                try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) {}
                if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
                try { ev.pause(); ev.removeAttribute('src'); ev.load(); ev.remove(); } catch (_) {}
                if (actx) { try { actx.close(); } catch (_) {} }
                st.exporting = false;
                st.cancel = false;
                if (this._vtrim === st) {
                    btn.disabled = false;
                    btn.textContent = '确认';
                    cancelBtn.style.display = 'none';
                }
            }
        },

        // 在源节点右侧新建结果节点（subType:'edited'，从源节点 force 连线），上传完成后填充
        async _vtrimCreateNode(src, file, opt) {
            const CB = global.CanvasBlocks;
            const node = CB.addRef({
                x: src.x + src.w + 60, y: src.y,
                name: opt.name,
                ratio: opt.ratio > 0 ? opt.ratio : 16 / 9,
                mediaType: opt.kind === 'video' ? 'video' : '',
                subType: 'edited',
                status: 'loading'
            });
            const spot = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            if (spot.x !== node.x || spot.y !== node.y) CB.update(node.id, { x: spot.x, y: spot.y });
            if (opt.kind !== 'video') CB.setLocalPreview(node.id, file);
            global.CanvasEdges.add(src.id, node.id, true);
            try {
                if (opt.kind === 'video') {
                    const m = await global.CanvasGenerate.uploadMediaRef(file);
                    if (!CB.getById(node.id)) return;
                    CB.update(node.id, {
                        mediaType: 'video', mediaUrl: m.url, videoUrl: m.url,
                        mediaSize: m.size || file.size, mediaDuration: opt.duration || m.duration || 0,
                        tempKey: m.tempKey || '', status: 'idle'
                    });
                    // 修剪结果：用本地文件入队生成预览版
                    if (global.VideoProxy) global.VideoProxy.enqueue(node.id, file);
                } else {
                    const r = await global.CanvasGenerate.uploadRef(file);
                    if (!CB.getById(node.id)) return;
                    CB.update(node.id, {
                        imageUrl: r.highUrl, previewUrl: r.previewUrl, mediumUrl: r.mediumUrl, tempKey: r.tempKey, status: 'idle'
                    });
                }
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            } catch (err) {
                console.error('[画布] 视频修剪/截帧上传失败:', err);
                CB.remove(node.id);
                alert('上传失败：' + ((err && err.message) || ''));
            }
        },

        // ===== 音频修剪：节点下方波形面板（波形本地绘制，裁剪交给服务端 ffmpeg 输出 MP3） =====
        _atrim: null,
        // 与媒体上传/参考素材约束一致：裁剪结果至少 2 秒
        _ATRIM_MIN: 2,

        // 提交给服务端裁剪的地址：绝对站内地址转相对路径（/v1/media/trim 只接受站内相对路径）
        _atrimApiUrl(raw) {
            let s = String(raw || '');
            if (/^https?:\/\//i.test(s)) {
                try {
                    const u = new URL(s, location.origin);
                    if (u.origin === location.origin) s = u.pathname + u.search;
                } catch (_) {}
            }
            return s;
        },

        _atrimMakeAudio(url) {
            const VP = global.VideoProxy;
            if (VP && VP.sameOrigin) url = VP.sameOrigin(url);
            const a = new Audio();
            a.preload = 'auto';
            a.src = url;
            return a;
        },

        _atrimWaitAudio(a, evName, ms) {
            return new Promise((resolve, reject) => {
                let timer = null;
                const cleanup = () => { a.removeEventListener(evName, ok); a.removeEventListener('error', bad); clearTimeout(timer); };
                const ok = () => { cleanup(); resolve(); };
                const bad = () => { cleanup(); reject(new Error('音频加载失败')); };
                a.addEventListener(evName, ok);
                a.addEventListener('error', bad);
                timer = setTimeout(() => { cleanup(); reject(new Error('音频加载超时')); }, ms || 20000);
            });
        },

        _atrimStatus(st, txt) {
            const s = st.el.querySelector('.vtrim-status');
            if (s) s.textContent = txt || '';
        },

        _bindAudioTrim() {
            // 点击面板外关闭（工具栏内点击由按钮自身切换；裁剪中不关闭，需点「取消」）
            document.addEventListener('mousedown', (e) => {
                const st = this._atrim;
                if (!st || st.exporting) return;
                if (st.el.contains(e.target)) return;
                if (this._toolbarFloatEl && this._toolbarFloatEl.contains(e.target)) return;
                this._closeAudioTrim();
            }, true);
            window.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || !this._atrim) return;
                if (this._atrim.exporting) {
                    this._atrim.cancel = true;
                    try { if (this._atrim.abort) this._atrim.abort.abort(); } catch (_) {}
                    return;
                }
                this._closeAudioTrim();
            }, true);
        },

        _openAudioTrim(node) {
            const rawUrl = node.mediaUrl;
            if (!rawUrl) return;
            const cur = this._atrim;
            if (cur && cur.exporting) { alert('正在裁剪音频，请稍候或先取消'); return; }
            if (cur && cur.nodeId === node.id) { this._closeAudioTrim(); return; }
            this._closeAudioTrim();
            // 节点内播放中的音频先暂停，避免与面板试听重复出声
            const layer = global.CanvasBlocks && global.CanvasBlocks.layerEl;
            const nodeAudio = layer ? layer.querySelector(`audio.node-audio[data-block-id="${node.id}"]`) : null;
            if (nodeAudio) { try { nodeAudio.pause(); } catch (_) {} }
            const appEl = document.querySelector('.canvas-app');
            if (!appEl) return;
            const playSvg = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
            const el = document.createElement('div');
            el.className = 'vtrim-panel mode-trim atrim-panel';
            el.innerHTML = `
                <div class="vtrim-strip">
                    <div class="atrim-wave-wrap is-loading">
                        <canvas class="atrim-wave"></canvas>
                        <span class="atrim-wave-tip">波形加载中…</span>
                    </div>
                    <div class="vtrim-mask vtrim-mask-l"></div><div class="vtrim-mask vtrim-mask-r"></div>
                    <div class="vtrim-sel"><div class="vtrim-handle vtrim-handle-l"></div><div class="vtrim-handle vtrim-handle-r"></div><span class="vtrim-dur">0.0s</span></div>
                    <div class="vtrim-playhead"></div>
                </div>
                <div class="vtrim-bar">
                    <button type="button" class="capsule-btn vtrim-play" title="在选区内循环试听">${playSvg}</button>
                    <span class="vtrim-time">00:00.0 / 00:00.0</span>
                    <span class="vtrim-status">加载中…</span>
                    <button type="button" class="capsule-btn vtrim-cancel" style="display:none">取消</button>
                    <button type="button" class="vtrim-confirm" disabled>裁剪</button>
                </div>`;
            appEl.appendChild(el);
            const st = {
                nodeId: node.id, rawUrl, url: rawUrl, el,
                dur: 0, s: 0, e: 0, cur: 0,
                playing: false, raf: 0, exporting: false, cancel: false, busy: false,
                audio: null, abort: null
            };
            const VP = global.VideoProxy;
            if (VP && VP.sameOrigin) st.url = VP.sameOrigin(rawUrl);
            // 波形/试听用独立参数的站内音频 URL（服务端 wx=1 走同源流式，不进北京镜像 302）：
            // 节点 <audio> 已把原 URL 以非 CORS 方式缓存，且跨域镜像直链无 ACAO，fetch 读波形会被 CORS 拦截
            if (st.url.indexOf('/api/img') >= 0) st.url += (st.url.indexOf('?') >= 0 ? '&' : '?') + 'wx=1';
            this._atrim = st;
            // 跟随模式的提示词浮层同样在节点下方，面板打开期间临时隐藏
            if (this._floatEl && !this._floatEl.classList.contains('docked')) this._floatEl.classList.add('vtrim-hide');
            this._atrimBindPanel(st);
            this._positionAudioTrim();
            this._atrimLoad(st);
        },

        _closeAudioTrim() {
            const st = this._atrim;
            if (!st) return;
            this._atrim = null;
            st.cancel = true;
            st.playing = false;
            cancelAnimationFrame(st.raf);
            try { if (st.abort) st.abort.abort(); } catch (_) {}
            if (st.audio) {
                try { st.audio.pause(); st.audio.removeAttribute('src'); st.audio.load(); } catch (_) {}
            }
            if (st.el && st.el.parentNode) st.el.parentNode.removeChild(st.el);
            if (this._floatEl) this._floatEl.classList.remove('vtrim-hide');
        },

        // 定位：固定在节点正下方（与视频修剪面板同一算法）
        _positionAudioTrim() {
            const st = this._atrim;
            if (!st) return;
            const node = global.CanvasBlocks.getById(st.nodeId);
            if (!node) {
                if (st.exporting) st.el.style.display = 'none';
                else this._closeAudioTrim();
                return;
            }
            const scale = CanvasCore.viewport.scale;
            const vpRect = CanvasCore._vpRect || CanvasCore.viewportEl.getBoundingClientRect();
            const appEl = document.querySelector('.canvas-app');
            const appRect = appEl.getBoundingClientRect();
            const offsetX = vpRect.left - appRect.left;
            const offsetY = vpRect.top - appRect.top;
            const sx = node.x * scale + CanvasCore.viewport.x;
            const sy = node.y * scale + CanvasCore.viewport.y;
            const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
            const width = Math.round(560 * uiScale);
            st.el.style.width = width + 'px';
            st.el.style.left = Math.round(offsetX + sx + node.w * scale / 2 - width / 2) + 'px';
            st.el.style.top = Math.round(offsetY + sy + node.h * scale + 12 * uiScale) + 'px';
        },

        async _atrimLoad(st) {
            try {
                const a = this._atrimMakeAudio(st.url);
                st.audio = a;
                await this._atrimWaitAudio(a, 'loadedmetadata', 20000);
                if (this._atrim !== st) return;
                st.dur = isFinite(a.duration) ? a.duration : 0;
                if (!st.dur) throw new Error('无法读取音频时长');
                if (st.dur < this._ATRIM_MIN) {
                    alert('音频时长不足 ' + this._ATRIM_MIN + ' 秒，无法修剪');
                    this._closeAudioTrim();
                    return;
                }
                st.s = 0; st.e = st.dur; st.cur = 0;
                this._atrimRender(st);
                this._atrimStatus(st, '');
                st.el.querySelector('.vtrim-confirm').disabled = false;
                this._atrimDrawWave(st);
            } catch (err) {
                if (this._atrim === st) this._atrimStatus(st, '音频加载失败：' + (err.message || ''));
            }
        },

        // 波形：fetch 音频字节 → Web Audio 解码 → 逐像素列绘制峰值（不引第三方库）
        async _atrimDrawWave(st) {
            const wrap = st.el.querySelector('.atrim-wave-wrap');
            const cvs = st.el.querySelector('.atrim-wave');
            const tip = wrap.querySelector('.atrim-wave-tip');
            const fail = (msg) => {
                wrap.classList.remove('is-loading');
                wrap.classList.add('no-wave');
                if (tip) tip.textContent = msg || '波形不可用，仍可拖动选区裁剪';
            };
            // 超长音频完整解码会占用大量内存，跳过波形只保留裁剪
            if (st.dur > 600) { fail('音频较长，已省略波形'); return; }
            try {
                // st.url 已带 wx=1（见 _openAudioTrim）：同源 200 流式，避开镜像 302 的 CORS 限制
                const res = await fetch(st.url, { credentials: 'same-origin' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const bufLen = Number(res.headers.get('content-length') || 0);
                if (bufLen > 12 * 1024 * 1024) { fail('音频较大，已省略波形'); return; }
                const ab = await res.arrayBuffer();
                if (this._atrim !== st) return;
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) throw new Error('浏览器不支持 WebAudio');
                const ac = new AC();
                let audioBuf = null;
                try {
                    audioBuf = await new Promise((resolve, reject) => {
                        const p = ac.decodeAudioData(ab, resolve, reject);
                        if (p && p.then) p.then(resolve, reject);
                    });
                } finally {
                    try { ac.close(); } catch (_) {}
                }
                if (this._atrim !== st || !audioBuf) return;
                const dpr = window.devicePixelRatio || 1;
                const rect = cvs.getBoundingClientRect();
                const w = Math.max(64, Math.round(rect.width * dpr));
                const h = Math.max(32, Math.round(rect.height * dpr));
                cvs.width = w; cvs.height = h;
                const g = cvs.getContext('2d');
                if (!g) throw new Error('画布不可用');
                g.clearRect(0, 0, w, h);
                const chs = audioBuf.numberOfChannels;
                const chData = [];
                for (let c = 0; c < chs; c++) chData.push(audioBuf.getChannelData(c));
                const total = audioBuf.length;
                const step = Math.max(1, Math.floor(total / w));
                const mid = h / 2;
                const amp = mid * 0.92;
                g.fillStyle = 'rgba(255,255,255,0.12)';
                g.fillRect(0, Math.round(mid) - 1, w, 2);
                g.fillStyle = 'rgba(196,241,123,0.85)';
                for (let x = 0; x < w; x++) {
                    const s0 = x * step, s1 = Math.min(total, s0 + step);
                    let mn = 0, mx = 0;
                    for (let i = s0; i < s1; i++) {
                        let v = 0;
                        for (let c = 0; c < chs; c++) v += chData[c][i];
                        v /= chs;
                        if (v < mn) mn = v;
                        if (v > mx) mx = v;
                    }
                    const y1 = mid + mn * amp, y2 = mid + mx * amp;
                    g.fillRect(x, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)));
                }
                wrap.classList.remove('is-loading');
                wrap.classList.add('has-wave');
            } catch (_) {
                if (this._atrim === st) fail('');
            }
        },

        _atrimRender(st) {
            const el = st.el;
            const d = st.dur || 1;
            const pct = (t) => (t / d * 100) + '%';
            const sel = el.querySelector('.vtrim-sel');
            sel.style.left = pct(st.s);
            sel.style.width = pct(st.e - st.s);
            el.querySelector('.vtrim-mask-l').style.width = pct(st.s);
            el.querySelector('.vtrim-mask-r').style.width = pct(d - st.e);
            el.querySelector('.vtrim-dur').textContent = (st.e - st.s).toFixed(1) + 's';
            el.querySelector('.vtrim-playhead').style.left = pct(st.cur);
            el.querySelector('.vtrim-time').textContent = this._vtrimFmt(st.cur, true) + ' / ' + this._vtrimFmt(st.dur, true);
        },

        _atrimBindPanel(st) {
            const el = st.el;
            el.addEventListener('mousedown', (e) => e.stopPropagation());
            const strip = el.querySelector('.vtrim-strip');
            const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
            const timeAt = (clientX) => {
                const r = strip.getBoundingClientRect();
                return clamp((clientX - r.left) / (r.width || 1), 0, 1) * st.dur;
            };
            const drag = (onMove) => {
                const mm = (ev) => { ev.preventDefault(); onMove(ev); };
                const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
                document.addEventListener('mousemove', mm);
                document.addEventListener('mouseup', mu);
            };
            strip.addEventListener('mousedown', (e) => {
                if (!st.dur || st.exporting || st.busy || e.button !== 0) return;
                e.preventDefault();
                this._atrimPause(st);
                const MIN = Math.min(this._ATRIM_MIN, st.dur);
                const h = e.target.closest('.vtrim-handle');
                const apply = (t) => { st.cur = t; this._atrimRender(st); this._atrimSeek(st, t); };
                if (h && h.classList.contains('vtrim-handle-l')) {
                    drag((ev) => { st.s = clamp(timeAt(ev.clientX), 0, st.e - MIN); apply(st.s); });
                } else if (h) {
                    drag((ev) => { st.e = clamp(timeAt(ev.clientX), st.s + MIN, st.dur); apply(st.e); });
                } else if (e.target.closest('.vtrim-sel')) {
                    // 拖动选区整体平移（时长不变）
                    const t0 = timeAt(e.clientX), s0 = st.s, len = st.e - st.s;
                    drag((ev) => {
                        st.s = clamp(s0 + timeAt(ev.clientX) - t0, 0, st.dur - len);
                        st.e = st.s + len;
                        apply(st.s);
                    });
                } else {
                    apply(clamp(timeAt(e.clientX), st.s, st.e));
                }
            });
            el.querySelector('.vtrim-play').addEventListener('click', () => {
                if (st.playing) this._atrimPause(st); else this._atrimPlay(st);
            });
            el.querySelector('.vtrim-confirm').addEventListener('click', () => this._atrimExport(st));
            el.querySelector('.vtrim-cancel').addEventListener('click', () => {
                if (st.exporting) {
                    st.cancel = true;
                    try { if (st.abort) st.abort.abort(); } catch (_) {}
                } else {
                    this._closeAudioTrim();
                }
            });
        },

        _atrimSetPlayIcon(st) {
            const b = st.el.querySelector('.vtrim-play');
            if (!b) return;
            b.innerHTML = st.playing
                ? '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
            b.title = st.playing ? '暂停' : '在选区内循环试听';
        },

        _atrimSeek(st, t) {
            if (!st.audio) return;
            try { st.audio.currentTime = t; } catch (_) {}
        },

        _atrimPlay(st) {
            const a = st.audio;
            if (!a || !st.dur) return;
            if (!(st.cur >= st.s && st.cur < st.e - 0.05)) st.cur = st.s;
            try { a.currentTime = st.cur; } catch (_) {}
            const pr = a.play();
            if (pr && pr.catch) pr.catch(() => {});
            st.playing = true;
            this._atrimSetPlayIcon(st);
            const tick = () => {
                if (this._atrim !== st || !st.playing) return;
                if (!a.seeking && (a.currentTime >= st.e || a.ended)) {
                    try { a.currentTime = st.s; } catch (_) {}
                    if (a.paused) { const p2 = a.play(); if (p2 && p2.catch) p2.catch(() => {}); }
                }
                st.cur = Math.max(st.s, Math.min(st.e, a.currentTime));
                this._atrimRender(st);
                st.raf = requestAnimationFrame(tick);
            };
            st.raf = requestAnimationFrame(tick);
        },

        _atrimPause(st) {
            if (!st.playing) return;
            st.playing = false;
            cancelAnimationFrame(st.raf);
            if (st.audio) { try { st.audio.pause(); } catch (_) {} }
            this._atrimSetPlayIcon(st);
        },

        // 确认裁剪：服务端 ffmpeg 截取 → 源节点右侧新建「音频修剪」节点并连线
        async _atrimExport(st) {
            if (st.exporting || !st.dur) return;
            this._atrimPause(st);
            const el = st.el;
            const btn = el.querySelector('.vtrim-confirm');
            const cancelBtn = el.querySelector('.vtrim-cancel');
            const src = global.CanvasBlocks.getById(st.nodeId);
            if (!src) { alert('源节点已删除'); this._closeAudioTrim(); return; }
            st.exporting = true;
            st.cancel = false;
            st.busy = true;
            btn.disabled = true;
            btn.textContent = '裁剪中…';
            cancelBtn.style.display = '';
            this._atrimStatus(st, '正在裁剪音频…');
            st.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const start = Math.round(st.s * 100) / 100;
            const end = Math.round(st.e * 100) / 100;
            const baseName = src.name || '音频';
            try {
                const res = await fetch(`${global.CanvasGenerate.backendUrl()}/v1/media/trim`, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                    body: JSON.stringify({ url: this._atrimApiUrl(st.rawUrl), start, end }),
                    signal: st.abort ? st.abort.signal : undefined
                });
                const text = await res.text();
                let data = {};
                try { data = JSON.parse(text); } catch (_) {}
                if (!res.ok || data.code !== 0 || !data.data) throw new Error(data.msg || ('裁剪失败: ' + res.status));
                const out = data.data;
                if (st.cancel || this._atrim !== st) return;
                st.exporting = false;
                this._closeAudioTrim();
                this._atrimCreateNode(src, baseName + ' 音频修剪', out);
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    if (this._atrim === st) this._atrimStatus(st, '已取消裁剪');
                } else {
                    if (this._atrim === st) this._atrimStatus(st, '');
                    alert('音频裁剪失败：' + ((err && err.message) || ''));
                }
            } finally {
                st.exporting = false;
                st.busy = false;
                st.abort = null;
                if (this._atrim === st) {
                    btn.disabled = false;
                    btn.textContent = '裁剪';
                    cancelBtn.style.display = 'none';
                }
            }
        },

        _atrimCreateNode(src, name, data) {
            const CB = global.CanvasBlocks;
            const node = CB.addRef({
                x: src.x + src.w + 60, y: src.y,
                name, mediaType: 'audio', subType: 'edited', status: 'idle'
            });
            CB.update(node.id, {
                mediaType: 'audio', mediaUrl: data.url,
                mediaSize: data.size || 0, mediaDuration: data.duration || 0,
                tempKey: data.tempKey || '', w: 300, h: 90
            });
            const spot = CB._findFreeSpot(node.x, node.y, node.w, node.h, node.id);
            if (spot.x !== node.x || spot.y !== node.y) CB.update(node.id, { x: spot.x, y: spot.y });
            global.CanvasEdges.add(src.id, node.id, true);
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
        },

        // 视频节点：从首帧海报切换为可播放（加载完整视频 + 控制条）
        _playNodeVideo(holder) {
            const v = holder && holder.querySelector('video.node-video');
            if (!v) return;
            // 幂等：已在播放态直接返回（mousedown/up 已触发过，click 兜底再触发时避免视频重载）
            if (v.classList.contains('is-playing')) return;
            const src = v.dataset.src || '';
            if (!src) return;
            v.src = src;
            v.controls = true;
            v.classList.add('is-playing');
            const wrap = v.closest('.node-video-wrap');
            if (wrap) wrap.classList.add('is-playing');
            const pr = v.play();
            if (pr && pr.catch) pr.catch(() => {});
        },

        // 视频节点：停止播放并恢复首帧海报
        _resetNodeVideo(v) {
            try { v.pause(); v.currentTime = 0; } catch (_) {}
            v.removeAttribute('controls');
            v.classList.remove('is-playing');
            const wrap = v.closest('.node-video-wrap');
            if (wrap) wrap.classList.remove('is-playing');
            const src = v.dataset.src || '';
            if (src) v.src = v.getAttribute('poster') ? src : src + '#t=0.1';
        },

        // ===== 拖拽上传 =====
        _bindDropUpload() {
            const vp = CanvasCore.viewportEl;
            ['dragenter', 'dragover'].forEach(ev => {
                vp.addEventListener(ev, (e) => {
                    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                        e.preventDefault();
                        vp.classList.add('drag-over');
                    }
                });
            });
            vp.addEventListener('dragleave', (e) => { if (e.target === vp) vp.classList.remove('drag-over'); });
            vp.addEventListener('drop', (e) => {
                e.preventDefault();
                vp.classList.remove('drag-over');
                const files = Array.from(e.dataTransfer.files || []).filter(f => /^(image|video|audio)\//.test(f.type || ''));
                if (!files.length) return;
                const base = CanvasCore.screenToWorld(e.clientX, e.clientY);
                // 优先取拖放落点下的节点；若落空但当前选中了某个生成节点，则视为给该节点添加参考图
                const dropTargetEl = e.target && e.target.closest ? e.target.closest('.canvas-node') : null;
                let targetGen = null;
                if (dropTargetEl) {
                    const t = global.CanvasBlocks.getById(dropTargetEl.dataset.blockId);
                    if (t && t.nodeType === 'gen') targetGen = t;
                }
                if (!targetGen && this._activeNodeId) {
                    const a = global.CanvasBlocks.getById(this._activeNodeId);
                    if (a && a.nodeType === 'gen') targetGen = a;
                }
                // 批量上传：横排排列，间距=节点宽220+间隙12；有目标生成节点时逐张连线
                files.forEach((f, i) => {
                    (async () => {
                        const node = await this._createRefNode(f, base.x - 110 + i * 232, base.y - 110, { skipFindSpot: true });
                        if (targetGen && node && global.CanvasBlocks.getById(node.id)) {
                            // 校验上限后连线，避免静默失败
                            const maxRefs = global.CanvasEdges._getMaxImagesForNode(targetGen);
                            if (global.CanvasEdges._countImageInputs(targetGen.id) < maxRefs) {
                                global.CanvasEdges.add(node.id, targetGen.id);
                                global.CanvasHistory.snapshot();
                                global.CanvasStore.scheduleSave();
                                this.onEdgesChange();
                            } else if (!this._fullToastAt || Date.now() - this._fullToastAt > 1500) {
                                // 素材已满：节点已创建但不连线，提示一次（批量时去重）
                                this._fullToastAt = Date.now();
                                alert('素材已满：该节点最多 ' + maxRefs + ' 张参考图，其余图片仅添加到画布'); // 画布内 alert 已被 pixora-ui 替换为 toast
                            }
                        }
                    })();
                });
            });
        },

        _bindRefFileInput() {
            const input = document.getElementById('refFileInput');
            input.addEventListener('change', (e) => {
                const files = Array.from(e.target.files || []);
                const c = global.CanvasBlocks.viewportCenterWorld();
                // 批量上传：横排排列，间距=节点宽220+间隙12
                files.forEach((f, i) => this._createRefNode(f, c.x - 110 + i * 232, c.y - 110, { skipFindSpot: true }));
                input.value = '';
            });
        },

        // ===== 右键菜单 =====
        _bindCtxMenu() {
            this.ctxMenu = document.getElementById('ctxMenu');
            document.addEventListener('click', () => {
                // 端口拖线松手后的那次 click 由 showNodeCreateMenu 标记吞掉，避免菜单刚弹出即被隐藏
                if (this._suppressMenuHideOnce) { this._suppressMenuHideOnce = false; return; }
                this.ctxMenu.classList.add('hidden');
                // 菜单关闭时若还有未消费的拖线虚线，一并移除
                this._discardPendingMenuEdge();
            });
            CanvasCore.viewportEl.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.canvas-node') || e.target.closest('.edge-path')) return;
                e.preventDefault();
                this._lastMenuWorld = CanvasCore.screenToWorld(e.clientX, e.clientY);
                const snapOn = global.CanvasSnap && global.CanvasSnap.enabled;
                const items = [
                    { icon: 'image', label: '新建图片生成节点', act: () => this._createGenNode(this._lastMenuWorld.x, this._lastMenuWorld.y, 'image') },
                    { icon: 'video', label: '新建视频生成节点', act: () => this._createGenNode(this._lastMenuWorld.x, this._lastMenuWorld.y, 'video') },
                    ...(global.CanvasPano ? [{ icon: 'pano', label: '新建 360 全景', act: () => global.CanvasPano.createPanoNode({ x: this._lastMenuWorld.x - 200, y: this._lastMenuWorld.y - 100, focusPrompt: true }) }] : []),
                    ...(global.CanvasStage3D ? [{ icon: 'stage', label: '新建 3D 片场', act: () => global.CanvasStage3D.createStageNode({ x: this._lastMenuWorld.x - 196, y: this._lastMenuWorld.y - 110, pan: false }) }] : []),
                    { icon: 'text', label: '新建文本节点', act: () => this._createTextNode(this._lastMenuWorld.x, this._lastMenuWorld.y) },
                    { icon: 'video', label: '新建视频素材节点', act: () => this._createEmptyMediaNode('video', this._lastMenuWorld.x, this._lastMenuWorld.y) },
                    { icon: 'audio', label: '新建音频素材节点', act: () => this._createEmptyMediaNode('audio', this._lastMenuWorld.x, this._lastMenuWorld.y) },
                    { icon: 'image', label: '添加参考素材…', act: () => document.getElementById('refFileInput').click() },
                    { icon: 'paste', label: '粘贴节点', hint: 'Ctrl V', act: () => this.pasteClipboard() },
                    { sep: true },
                    { icon: snapOn ? 'check' : '', label: '吸附对齐', hint: (global.CanvasSnap ? global.CanvasSnap.threshold : '') + 'px', act: () => {
                        if (global.CanvasSnap) global.CanvasSnap.toggle();
                    }},
                    { icon: 'gear', label: '设置吸附容差…', act: () => this._setSnapThreshold() }
                ];
                this._renderMenu(items, e.clientX, e.clientY);
            });
        },

        // 设置吸附容差（弹窗输入）
        _setSnapThreshold() {
            if (!global.CanvasSnap) return;
            const cur = global.CanvasSnap.threshold;
            const input = prompt('吸附容差（px，1~30，越小越精准）', cur);
            if (input === null) return;
            const v = parseInt(input);
            if (isNaN(v) || v < 1 || v > 30) {
                alert('请输入 1~30 之间的整数');
                return;
            }
            global.CanvasSnap.threshold = v;
        },

        showBlockMenu(blockId, x, y) {
            const block = global.CanvasBlocks.getById(blockId);
            if (!block) return;
            global.CanvasSelection.select(blockId, false);
            const items = [];
            if (block.nodeType === 'gen') {
                items.push({ icon: 'play', label: '生成', act: () => global.CanvasGenerate.runNode(blockId) });
            }
            items.push({ icon: 'link', label: '新建生成节点并连入', act: () => {
                // 视频素材/音频/视频生成节点来源：新建视频生成节点（连线规则只允许视频类接入媒体源）
                const srcCat = (block.nodeType === 'gen' && global.CanvasBlocks._genCategoryOf(block) === 'video') || block.mediaType === 'video' || block.mediaType === 'audio' ? 'video' : undefined;
                const node = this._createGenNode(block.x + block.w + 80, block.y, srcCat);
                global.CanvasEdges.add(blockId, node.id);
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            }});
            const mediaDl = (block.mediaType === 'video' && (block.videoUrl || block.mediaUrl)) || (block.mediaType === 'audio' && block.mediaUrl) || '';
            if (mediaDl || block.imageUrl) {
                items.push({ sep: true });
                items.push({ icon: 'download', label: mediaDl ? '下载媒体' : '下载图片', act: () => this._downloadImage(mediaDl || block.imageUrl, block.name || 'nano-image') });
            }
            // 复制：多选时复制全部选中（含连线/分组），单选等同复制该节点
            items.push({ icon: 'copy', label: '复制', hint: 'Ctrl C', act: () => {
                const sel = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
                if (sel.length > 1) {
                    this.copySelection();
                } else {
                    global.CanvasSelection.select(blockId, false);
                    this.copySelection();
                }
            }});
            // 内部剪贴板有内容时提供原位副本（保留生成结果的快速复制）
            items.push({ icon: 'dup', label: '创建副本', act: () => this._duplicate(block) });
            items.push({ sep: true });
            items.push({ icon: 'trash', label: '删除', hint: 'Del', danger: true, act: () => {
                global.CanvasBlocks.remove(blockId);
                global.CanvasSelection.clear();
                global.CanvasHistory.snapshot();
                global.CanvasStore.scheduleSave();
            }});
            this._renderMenu(items, x, y);
        },

        showEdgeMenu(edgeId, x, y) {
            this._renderMenu([
                { icon: 'trash', label: '删除连线', danger: true, act: () => {
                    global.CanvasEdges.remove(edgeId);
                    global.CanvasHistory.snapshot();
                    global.CanvasStore.scheduleSave();
                    this.onEdgesChange();
                }}
            ], x, y);
        },

        _renderMenu(items, x, y, title) {
            // 打开新菜单前清理上一条未消费的拖线虚线
            this._discardPendingMenuEdge();
            const ic = (k) => {
                const p = CTX_ICONS[k];
                return p ? `<svg class="ctx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` : '<i class="ctx-ic"></i>';
            };
            const hasIcon = items.some(it => it.icon);
            this.ctxMenu.innerHTML = (title ? `<div class="ctx-title">${title}</div>` : '') + items.map((it, i) =>
                it.sep ? '<div class="ctx-sep"></div>'
                       : `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-i="${i}">${hasIcon ? ic(it.icon) : ''}<span class="ctx-label">${it.label}</span>${it.hint ? `<span class="ctx-hint">${it.hint}</span>` : ''}</div>`
            ).join('');
            this.ctxMenu.querySelectorAll('.ctx-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(el.dataset.i);
                    this.ctxMenu.classList.add('hidden');
                    if (items[idx] && items[idx].act) items[idx].act();
                });
            });
            // 传入的是 client 坐标；菜单定位在 .canvas-app 内，需扣掉其偏移（左侧导航栏）
            const app = this.ctxMenu.offsetParent || document.querySelector('.canvas-app');
            const ar = app ? app.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
            this.ctxMenu.classList.remove('hidden');
            const mw = this.ctxMenu.offsetWidth, mh = this.ctxMenu.offsetHeight;
            let lx = x - ar.left, ly = y - ar.top;
            if (lx + mw > ar.width - 8) lx = Math.max(8, lx - mw);
            if (ly + mh > ar.height - 8) ly = Math.max(8, ar.height - 8 - mh);
            this.ctxMenu.style.left = lx + 'px';
            this.ctxMenu.style.top = ly + 'px';
        },

        // 将已显示的菜单定位为：指定侧边的垂直中点落在 (x, y)，超出画布时夹紧
        _alignMenuEdgeMid(x, y, side) {
            const menu = this.ctxMenu;
            if (!menu || menu.classList.contains('hidden')) return;
            const app = menu.offsetParent || document.querySelector('.canvas-app');
            const ar = app ? app.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
            const mw = menu.offsetWidth, mh = menu.offsetHeight;
            let lx = (side === 'right' ? x - mw : x) - ar.left;
            let ly = y - ar.top - mh / 2;
            lx = Math.min(Math.max(8, lx), ar.width - 8 - mw);
            ly = Math.min(Math.max(8, ly), ar.height - 8 - mh);
            menu.style.left = Math.round(lx) + 'px';
            menu.style.top = Math.round(ly) + 'px';
        },

        _duplicate(block) {
            // 加 _副本后缀
            const copyName = (block.name || '节点') + '_副本';
            // 复制生成节点时回退到未生成状态：丢弃 imageUrl/previewUrl/status，不携带原任务结果
            // 复制位置：在原节点右下偏移，并自动找空位避免重叠
            // 源节点不排除在避让外：起点与源节点重叠，若排除会导致副本盖在源节点上（视觉上原节点"消失"）
            const spot = global.CanvasBlocks._findFreeSpot(block.x + 30, block.y + 30, block.w, block.h, null);
            const cleanFields = { id: undefined, name: copyName, x: spot.x, y: spot.y };
            // 3D 片场：场景 JSON 深拷贝，避免副本与原节点共享同一对象
            if (block.stage3d) cleanFields.stage3d = JSON.parse(JSON.stringify(block.stage3d));
            if (block.nodeType === 'gen') {
                cleanFields.status = 'idle';
                cleanFields.imageUrl = '';
                cleanFields.previewUrl = '';
                cleanFields.mediumUrl = '';
                cleanFields.tempKey = '';
                cleanFields.taskId = '';
                cleanFields._imgW = 0;
                cleanFields._imgH = 0;
                // 结果级状态跟随结果走：副本没有结果，就不继承样片标记与生成历史（历史数组也不能与原节点共享引用）
                Object.assign(cleanFields, { draft: false, draftAt: 0, draftTaskId: '', draftUpstreamId: '', draftBillSec: 0,
                    genHistory: [], genHistoryActive: '', genStartedAt: 0 });
            }
            const copy = global.CanvasBlocks.add(Object.assign({}, block, cleanFields));
            // 复制上游参考图连线（原节点作为 to 的所有连入边）
            const upstreams = global.CanvasEdges.edges.filter(e => e.to === block.id);
            upstreams.forEach(e => global.CanvasEdges.add(e.from, copy.id));
            global.CanvasSelection.select(copy.id, false);
            global.CanvasHistory.snapshot();
            global.CanvasStore.scheduleSave();
        },

        // ===== 复制粘贴体系 =====
        // 内部剪贴板：{ blocks: [...], edges: [{from,to}], groups: [{x,y,w,h}], pasted: 次数 }
        _clipboard: null,

        _bindCopyPaste() {
            window.addEventListener('keydown', (e) => {
                const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
                if (typing) return;
                if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                    this.copySelection();
                }
                /* _PASTE_FIX_1028 Ctrl+V 不再在 keydown 拦截：内部剪贴板常驻 localStorage 会吞掉系统
                   paste 事件，导致外部复制的图片永远贴不进来。统一交给 paste 事件分流：
                   图片 > 新鲜内部节点(60s) > 文本 > 旧内部节点 */
            });
        },

        // 复制当前选中节点（含选中节点之间的连线、覆盖选中节点的分组框）
        copySelection() {
            const ids = global.CanvasSelection ? global.CanvasSelection.getSelectedIds() : [];
            if (!ids.length) return;
            const idSet = new Set(ids);
            const blocks = global.CanvasBlocks.blocks
                .filter(b => idSet.has(b.id))
                .map(b => JSON.parse(JSON.stringify(b)));
            if (!blocks.length) return;
            // 连线复制：至少一端在选中集内的边都保留——两端都在集内整体复制；
            // 仅一端在集内（如单节点复制时的上游参考图连线）也保留，粘贴后副本仍连向原上下文节点
            const edges = global.CanvasEdges.edges
                .filter(e => idSet.has(e.from) || idSet.has(e.to))
                .map(e => ({ from: e.from, to: e.to }));
            // 覆盖任一选中节点的分组框（几何范围模型：粘贴后按偏移重建，成员自然恢复）
            const groups = [];
            const CB = global.CanvasBlocks;
            Object.keys(CB.groups || {}).forEach(gid => {
                const g = CB.groups[gid];
                const hit = blocks.some(b =>
                    b.x >= g.x && b.y >= g.y && b.x + b.w <= g.x + g.w && b.y + b.h <= g.y + g.h);
                if (hit) groups.push({ x: g.x, y: g.y, w: g.w, h: g.h });
            });
            blocks.forEach(b => { delete b._el; });
            const ts = Date.now();
            const src = global.CanvasStore ? global.CanvasStore.canvasId : null;
            this._clipboard = { blocks, edges, groups, pasted: 0, ts, src };
            // 写入 localStorage：切换画布（整页跳转）或在其他标签页也能粘贴
            try { localStorage.setItem('px_canvas_clipboard', JSON.stringify({ blocks, edges, groups, ts, src })); } catch (err) {}
        },

        // 读取剪贴板：以 localStorage 为准（可能来自其他画布/标签页），同一份复制沿用内存中的连续粘贴计数
        _loadClipboard() {
            try {
                const raw = localStorage.getItem('px_canvas_clipboard');
                if (raw) {
                    const c = JSON.parse(raw);
                    if (c && Array.isArray(c.blocks)) {
                        if (!this._clipboard || this._clipboard.ts !== c.ts) {
                            this._clipboard = Object.assign({ edges: [], groups: [] }, c, { pasted: 0 });
                        }
                    }
                }
            } catch (err) {}
            return this._clipboard;
        },

        // 粘贴内部剪贴板：整体偏移（每次连续粘贴阶梯 +40px），重建节点/连线/分组，选中新节点
        pasteClipboard() {
            const clip = this._loadClipboard();
            if (!clip || !clip.blocks.length) return;
            clip.pasted = (clip.pasted || 0) + 1;
            const CB = global.CanvasBlocks;
            const curId = global.CanvasStore ? global.CanvasStore.canvasId : null;
            const cross = (clip.src || null) !== (curId || null);
            let offX = 30 + (clip.pasted - 1) * 40; // 首次 +30，连续粘贴阶梯递增，避免重叠
            let offY = offX;
            if (cross) {
                // 跨画布：原坐标在新画布里没有意义，整体平移到当前视口中心（连续粘贴仍阶梯错开）
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                clip.blocks.forEach(b => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + (b.w || 0)); y1 = Math.max(y1, b.y + (b.h || 0)); });
                const vr = CanvasCore.viewportEl.getBoundingClientRect();
                const c = CanvasCore.screenToWorld(vr.left + vr.width / 2, vr.top + vr.height / 2);
                const step = (clip.pasted - 1) * 40;
                offX = Math.round(c.x - (x0 + x1) / 2) + step;
                offY = Math.round(c.y - (y0 + y1) / 2) + step;
            }
            const idMap = new Map();
            const newIds = [];
            clip.blocks.forEach(src => {
                const copy = JSON.parse(JSON.stringify(src));
                const oldId = copy.id;
                copy.id = undefined;
                copy.x = src.x + offX;
                copy.y = src.y + offY;
                delete copy._el;
                if (copy.status === 'generating') copy.status = 'idle'; // 没有任务归属，不能停在生成中
                copy.name = (src.name || '节点') + '_副本';
                copy.taskId = ''; // 任务归属原节点，副本不继承轮询
                const node = CB.add(copy);
                if (node) {
                    idMap.set(oldId, node.id);
                    newIds.push(node.id);
                }
            });
            // 重建连线：选中集内的端点映射到新节点，集外端点保持原节点（保留与上下文的连接）
            clip.edges.forEach(e => {
                const from = idMap.get(e.from) || e.from;
                const to = idMap.get(e.to) || e.to;
                // 端点必须都在当前画布（跨画布时集外上下文节点不存在，跳过）
                const has = id => CB.blocks.some(b => b.id === id);
                if (from && to && has(from) && has(to)) global.CanvasEdges.add(from, to);
            });
            // 重建分组框（几何模型：偏移后的节点自然落入）
            clip.groups.forEach(g => {
                const gid = 'grp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                CB.groups[gid] = { x: g.x + offX, y: g.y + offY, w: g.w, h: g.h };
            });
            CB._syncGroupFrames();
            // 选中新节点，方便继续移动
            if (global.CanvasSelection) {
                global.CanvasSelection.clear();
                newIds.forEach(id => global.CanvasSelection.select(id, true));
            }
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        _bindDelete() {
            window.addEventListener('keydown', (e) => {
                const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
                if (typing) return;
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    const CB = global.CanvasBlocks;
                    // 有激活分组时优先处理：弹出提示「是否删除组和组内节点」
                    const gid = CB && CB._activeGroupId;
                    if (gid && CB.groups[gid]) {
                        e.preventDefault();
                        const g = CB.groups[gid];
                        const count = CB._nodesInGroup(gid).length;
                        // 菜单显示在组框顶边中点处（左移半个菜单宽大致居中）
                        const pt = CanvasCore.worldToScreen(g.x + g.w / 2, g.y);
                        const vr = CanvasCore.viewportEl.getBoundingClientRect();
                        pt.x += vr.left; pt.y += vr.top;
                        this._renderMenu([
                            { label: '确认删除', danger: true, act: () => {
                                CB.removeGroup(gid, true);
                                global.CanvasHistory.snapshot();
                                global.CanvasStore.scheduleSave();
                            }},
                            { label: '保留节点', act: () => {
                                CB.removeGroup(gid, false);
                                global.CanvasHistory.snapshot();
                                global.CanvasStore.scheduleSave();
                            }}
                        ], pt.x - 85, pt.y - 16, `是否删除组和组内 ${count} 个节点？`);
                        return;
                    }
                    const ids = global.CanvasSelection.getSelectedIds();
                    if (ids.length) {
                        e.preventDefault();
                        ids.forEach(id => global.CanvasBlocks.remove(id));
                        global.CanvasSelection.clear();
                        global.CanvasHistory.snapshot();
                        global.CanvasStore.scheduleSave();
                    }
                }
            });
        },

        // 画布空白处粘贴：图片→参考图节点，文本→文本节点
        _bindPaste() {
            window.addEventListener('paste', (e) => {
                // 输入框/文本域/contenteditable 内的粘贴交给 PromptBar 处理
                const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
                if (typing) return;
                // _PASTE_FIX_1028 全屏层（生成历史/大图查看器）打开时不落节点，避免节点被盖住造成"粘贴失效"错觉
                if (document.querySelector('.gh-full')) return;
                const viewerEl = document.getElementById('fullscreenViewer');
                if (viewerEl && !viewerEl.classList.contains('hidden')) return;
                const items = e.clipboardData && e.clipboardData.items;
                if (!items) return;
                const c = global.CanvasBlocks.viewportCenterWorld();
                // 1) 系统剪贴板图片最优先：外部复制的图片必须能贴进来
                for (const it of items) {
                    if (it.type.startsWith('image/')) {
                        const file = it.getAsFile();
                        if (file) {
                            e.preventDefault();
                            this._pasteRefAtCenter(file, c);
                        }
                        return;
                    }
                }
                // 2) 60s 内复制过的内部节点优先于系统文本；3) 文本节点
                const clip = this._loadClipboard();
                const clipFresh = !!(clip && clip.blocks.length && (Date.now() - (clip.ts || 0) < 60000));
                const text = e.clipboardData.getData('text/plain');
                if (clipFresh) {
                    e.preventDefault();
                    this.pasteClipboard();
                    return;
                }
                if (text && text.trim()) {
                    e.preventDefault();
                    const node = global.CanvasBlocks.addText({
                        x: c.x - 110, y: c.y - 55,
                        text: text.trim().slice(0, 2000)  // 限制长度避免超大文本
                    });
                    if (global.CanvasHistory) global.CanvasHistory.snapshot();
                    if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    return;
                }
                // 4) 系统剪贴板无内容 → 回落内部节点
                if (clip && clip.blocks.length) {
                    e.preventDefault();
                    this.pasteClipboard();
                }
            });
        }
    };

    global.CanvasMain = CanvasMain;
    document.addEventListener('DOMContentLoaded', () => CanvasMain.init());
})(window);
