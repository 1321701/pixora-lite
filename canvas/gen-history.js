/**
 * 生成节点历史记录：每个生成节点（图片/视频）记录自己生成过的所有结果
 * - 节点右上角角标显示记录数，点开悬浮框缩略图列表，可打开全屏查看
 * - 切换某条记录：设为节点当前结果（主图/主视频），并恢复它的提示词、模型、比例、时长等设置；连线素材不变
 * 数据存于节点：genHistory [{ id, ts, media:{...结果字段}, params:{...生成设置} }]（新→旧），genHistoryActive 为当前记录 id
 */
(function (global) {
    'use strict';

    // 结果相关字段：切换记录时整组替换（含预览版/封面/分辨率等派生字段，避免串到别的结果上）
    // draftDraft*：样片态随记录保存，切回样片历史时按钮/倒计时能准确恢复（不依赖节点级残留）
    const MEDIA_KEYS = ['imageUrl', 'previewUrl', 'mediumUrl', 'videoUrl', 'mediaUrl', 'mediaType',
        'videoPosterUrl', 'videoPosterSrc', 'videoPosterV', 'videoPreviewUrl', 'videoPreviewSrc',
        'videoW', 'videoH', 'videoResUrl', 'ratio',
        'draft', 'draftAt', 'draftTaskId', 'draftUpstreamId', 'draftBillSec'];
    // 生成设置字段：与 PromptBar.snapshotToNode / loadFromNode 一致
    const PARAM_KEYS = ['prompt', 'model', 'aspectRatio', 'size', 'duration', 'resolution', 'videoMode', 'draft'];
    // 样片态字段：只跟随「结果本身」保存，节点级 draft 只是当前展示记录的镜像
    const DRAFT_KEYS = ['draft', 'draftAt', 'draftTaskId', 'draftUpstreamId', 'draftBillSec'];
    const MAX = 40;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
    const EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
    const DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    const STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

    const GenHistory = {
        _popEl: null,
        _popNodeId: null,
        _fullEl: null,
        _fullNodeId: null,

        init() {
            // 角标：捕获阶段拦截，避免触发节点拖拽/选中
            window.addEventListener('mousedown', (e) => {
                const badge = e.target.closest && e.target.closest('.gen-hist-badge');
                if (badge) {
                    e.stopPropagation();
                    e.preventDefault();
                    const nodeEl = badge.closest('[data-block-id]');
                    const id = nodeEl && nodeEl.dataset.blockId;
                    if (id && this._popNodeId === id) this.closePopover();
                    else if (id) this.openPopover(id);
                    return;
                }
                if (this._popEl && !this._popEl.contains(e.target) && !(this._fullEl && this._fullEl.contains(e.target))) this.closePopover();
            }, true);
            // 画布平移/缩放时悬浮框跟随节点（拖动节点经由 CanvasMain._positionToolbar 调 reposition）
            const follow = () => { if (this._popEl) requestAnimationFrame(() => this.reposition()); };
            window.addEventListener('wheel', follow, { passive: true, capture: true });
            window.addEventListener('mousemove', (e) => { if (this._popEl && e.buttons) follow(); }, { passive: true, capture: true });
            window.addEventListener('keydown', (e) => {
                if (this._fullEl) {
                    // _GHVIEWER_1027 大图查看器叠于全屏层之上时，Esc 交给查看器关闭
                    if (e.key === 'Escape') {
                        const vw = document.getElementById('fullscreenViewer');
                        if (vw && !vw.classList.contains('hidden')) return;
                    }
                    // 全屏打开期间屏蔽画布快捷键（删除节点、撤销等）
                    e.stopPropagation();
                    if (e.key === 'Escape') this.closeFull();
                    return;
                }
                if (e.key === 'Escape' && this._popEl) { e.stopPropagation(); this.closePopover(); }
            }, true);
        },

        // ===== 数据 =====
        count(block) {
            if (!block || block.nodeType !== 'gen') return 0;
            const n = Array.isArray(block.genHistory) ? block.genHistory.length : 0;
            return n || (this._mainUrl(block) ? 1 : 0);
        },
        _mainUrl(o) { return (o && (o.videoUrl || o.imageUrl)) || ''; },
        _isVideo(o) { return !!(o && (o.mediaType === 'video' || o.videoUrl)); },
        _snapMedia(b) {
            const m = {};
            MEDIA_KEYS.forEach(k => { if (b[k] !== undefined && b[k] !== null && b[k] !== '') m[k] = b[k]; });
            return m;
        },
        _snapParams(b) {
            const p = {};
            PARAM_KEYS.forEach(k => { if (b[k] !== undefined) p[k] = b[k]; });
            return p;
        },
        _newId() { return 'gh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

        // 一条历史记录是否为样片：只看这条结果本身，与节点当前选择的模型无关
        // draftFix1031：新记录 media.draft 显式 true/false；旧记录回退 params.draft。
        // 之前样片升级 1080 时 beforeRun 会把节点的 draft 标记带进新记录（1080p 记录 params.draft 也是 true），
        // 因此回退时排除非 480p：样片固定 480p，1080 成片/普通视频不可能是样片。
        isDraftEntry(e) {
            if (!e) return false;
            const m = e.media || {}, p = e.params || {};
            if (m.draft === true) return true;
            if (m.draft === false) return false;
            if (!!m.draftTaskId || !!m.draftAt) return true;
            if (p.draft !== true) return false;
            const res = String(p.resolution || '').toLowerCase();
            if (res && res !== '480p') return false;
            // 样片仅 Seedance 2.5 支持：旧记录若被其它模型的历史操作误标 draft，这里一并排除
            return /seedance-2[_-]?5|sd25/i.test(String(p.model || ''));
        },

        _activeEntry(b) {
            if (!b || !Array.isArray(b.genHistory) || !b.genHistory.length) return null;
            return b.genHistory.find(x => x.id === b.genHistoryActive) || b.genHistory[0];
        },

        // 当前展示结果的样片状态（CanvasDraft 用它修复节点级 draft 镜像，避免节点字段与记录不一致）
        // 节点主地址与当前记录不一致 = 结果正在回填 / 记录尚未切换，此时不要修复，
        // 否则「样片升级成片」完成的一瞬间会把刚清掉的样片标记又按旧记录标回去（1080 成片被误标样片）
        currentDraftState(b) {
            if (!b || b.nodeType !== 'gen') return null;
            this._ensure(b);
            const e = this._activeEntry(b);
            if (!e) return null;
            const main = this._mainUrl(b), emain = this._mainUrl(e.media);
            if (!main || !emain || main !== emain) return null;
            return {
                isDraft: this.isDraftEntry(e),
                at: Number(e.media && e.media.draftAt) || 0,
                taskId: (e.media && e.media.draftTaskId) || '',
                upstreamId: (e.media && e.media.draftUpstreamId) || '',
                billSec: Number(e.media && e.media.draftBillSec) || 0
            };
        },

        // 补齐历史：旧节点已有结果但没有记录 → 把当前结果作为第一条；并把当前结果的最新派生字段（封面/预览版等）同步回当前记录
        _ensure(b) {
            if (!Array.isArray(b.genHistory)) b.genHistory = [];
            const main = this._mainUrl(b);
            if (!b.genHistory.length && main && b.status !== 'generating') {
                const e = { id: this._newId(), ts: b.genStartedAt || b.draftAt || Date.now(), media: this._snapMedia(b), params: b.genParams || this._snapParams(b) };
                b.genHistory.push(e);
                b.genHistoryActive = e.id;
            }
            const act = b.genHistory.find(e => e.id === b.genHistoryActive);
            if (!act || !main || this._mainUrl(act.media) !== main) return;
            // 同步派生字段（封面/预览版等），但样片字段不能反被节点已清空的值覆盖：
            // 记录自身已有样片信息时以记录为准；记录没有而节点仍展示样片时才从节点补写
            const prev = act.media || {};
            const keep = {};
            DRAFT_KEYS.forEach(k => { if (prev[k] !== undefined) keep[k] = prev[k]; });
            act.media = this._snapMedia(b);
            DRAFT_KEYS.forEach(k => { delete act.media[k]; });
            const hadExplicit = ('draft' in prev) || !!prev.draftTaskId || !!prev.draftAt;
            if (hadExplicit) {
                Object.assign(act.media, keep);
            } else if (b.draft === true || !!b.draftTaskId || !!b.draftAt) {
                act.media.draft = true;
                if (b.draftAt) act.media.draftAt = b.draftAt;
                if (b.draftTaskId) act.media.draftTaskId = b.draftTaskId;
                if (b.draftUpstreamId) act.media.draftUpstreamId = b.draftUpstreamId;
                if (b.draftBillSec) act.media.draftBillSec = b.draftBillSec;
            }
        },

        // 发起生成前：补齐旧结果的记录，并记下本次生成设置（完成时写入新记录）
        beforeRun(node, p) {
            if (!node) return;
            this._ensure(node);
            const params = this._snapParams(node);
            const PB = global.PromptBar, CM = global.CanvasMain;
            if (PB && CM && CM._activeNodeId === node.id && typeof PB.getPromptText === 'function') params.prompt = PB.getPromptText();
            if (p) {
                if (p.model) params.model = p.model;
                if (p.aspectRatio) params.aspectRatio = p.aspectRatio;
                if (p.imageSize) params.size = p.imageSize;
                if (p.duration !== undefined) params.duration = p.duration;
                if (p.quality) params.resolution = p.quality;
                if (p.videoMode) params.videoMode = p.videoMode;
            }
            // draftFix1031: 样片标志只认本次提交（p.draft）；升级成片/普通生成一律 false。
            // 不能继承 node.draft —— 否则换模型重新生成、或样片升级 1080 后，新记录会被误标成样片，
            // 导致切到 1080 成片记录还弹出「生成1080」按键。
            params.draft = p ? !!(p.draft) : !!(node.genParams && node.genParams.draft);
            node.genParams = params;
        },

        // 生成完成（结果已写入节点）：新增一条记录并设为当前
        record(nodeId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b) return;
            if (!Array.isArray(b.genHistory)) b.genHistory = [];
            const main = this._mainUrl(b);
            if (!main) return;
            let e = b.genHistory.find(x => this._mainUrl(x.media) === main);
            if (!e) {
                e = { id: this._newId(), ts: Date.now(), media: this._snapMedia(b), params: b.genParams || this._snapParams(b) };
                // 每条新记录显式写入「是否为样片」，之后切换历史不再依赖节点级残留标记
                e.media.draft = b.draft === true;
                b.genHistory.unshift(e);
                if (b.genHistory.length > MAX) b.genHistory.length = MAX;
            }
            b.genHistoryActive = e.id;
            CB._render(b);
            if (this._popNodeId === nodeId) this._renderPopover();
            if (this._fullNodeId === nodeId) this._renderFull();
        },

        // 切换到某条记录：结果 + 设置一起恢复，连线素材不动
        apply(nodeId, entryId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b) return;
            if (b.status === 'generating') { alert('节点正在生成中，完成后再切换记录'); return; }
            this._ensure(b);
            const e = b.genHistory.find(x => x.id === entryId);
            if (!e || e.id === b.genHistoryActive) return;
            const patch = {};
            MEDIA_KEYS.forEach(k => {
                if (k === 'ratio') { if (e.media.ratio) patch.ratio = e.media.ratio; return; }
                patch[k] = e.media[k] !== undefined ? e.media[k] : '';
            });
            Object.assign(patch, e.params || {});
            // draftFix1031: 样片态由「这条结果本身」决定，不再只看 params.draft
            patch.draft = this.isDraftEntry(e);
            // 样片元数据随记录恢复：切到哪条记录就用哪条的 draftAt/draftTaskId（否则切回历史样片会丢升级入口）
            patch.draftAt = Number(e.media && e.media.draftAt) || 0;
            patch.draftTaskId = (e.media && e.media.draftTaskId) || '';
            patch.draftUpstreamId = (e.media && e.media.draftUpstreamId) || '';
            patch.draftBillSec = Number(e.media && e.media.draftBillSec) || 0;
            patch.status = 'done';
            patch.errorMsg = '';
            patch.genHistoryActive = e.id;
            patch.genParams = Object.assign({}, e.params || {});
            CB.update(b.id, patch);
            // 旧历史样片缺少任务号：后台从任务列表按视频文件名找回，找回后按钮自动可用
            if (patch.draft && !patch.draftTaskId) this.recoverNode(b);
            // 视频记录还没有封面/预览版：补生成
            if (this._isVideo(e.media) && global.VideoProxy) {
                const VP = global.VideoProxy;
                if (!VP.validPosterOf(b) || !VP.validPreviewOf(b)) VP.enqueue(b.id, VP.originalOf(b));
            }
            const CM = global.CanvasMain;
            if (CM && CM._activeNodeId === b.id && typeof CM._loadNodeToPromptBar === 'function') CM._loadNodeToPromptBar(b.id);
            if (global.CanvasHistory) global.CanvasHistory.snapshot();
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
            if (this._popNodeId === nodeId) this._renderPopover();
            if (this._fullNodeId === nodeId) this._renderFull();
        },

        // ===== 历史样片任务信息找回 =====
        // 旧版本没有把样片任务号写进历史记录，导致切回旧样片时「生成1080成片」不可用。
        // 任务库里每条任务都保存了 params.draft / params.nodeId / result.videoUrl，
        // 这里按视频文件名匹配找回 draftTaskId/draftAt，恢复升级能力（一次拉取，全画布复用）。
        _tasksPromise: null,
        _recoverTried: null,
        _recoverFail: null,

        _fetchTasks() {
            if (this._tasksPromise) return this._tasksPromise;
            this._tasksPromise = (async () => {
                try {
                    const tk = (JSON.parse(localStorage.getItem('nano_user') || '{}') || {}).token || '';
                    const base = (global.API_CONFIG && global.API_CONFIG.baseUrl) || '';
                    const res = await fetch(base + '/api/tasks?limit=300', {
                        headers: tk ? { Authorization: 'Bearer ' + tk } : {}
                    });
                    if (!res.ok) return [];
                    const j = await res.json();
                    return Array.isArray(j && j.data) ? j.data : [];
                } catch (_) { return []; }
            })();
            return this._tasksPromise;
        },

        // 从任意视频地址里取出文件名（同一对象的签名 URL / 代理 URL / 直链都指向同一文件名）
        _fileKey(u) {
            let s = String(u || '');
            try { s = decodeURIComponent(s); } catch (_) {}
            const m = s.split('#')[0].match(/([^\/?&#]+\.(?:mp4|mov|webm|m4v))(?=[/?&#]|$)/i);
            return m ? m[1].toLowerCase() : '';
        },

        _taskTime(t) {
            const v = t && (t.completedAt || t.updatedAt || t.createdAt);
            if (typeof v === 'number') return v;
            const n = Date.parse(v || '');
            return isFinite(n) ? n : 0;
        },

        // 把一个节点历史里缺任务号的样片记录补齐（返回 Promise<boolean>）
        recoverNode(node) {
            const CB = global.CanvasBlocks;
            const b = typeof node === 'string' ? CB.getById(node) : node;
            if (!b || b.nodeType !== 'gen' || !Array.isArray(b.genHistory)) return Promise.resolve(false);
            const need = b.genHistory.some(e => this.isDraftEntry(e) && !(e.media && e.media.draftTaskId));
            if (!need) return Promise.resolve(false);
            this._recoverTried = this._recoverTried || {};
            this._recoverFail = this._recoverFail || {};
            if (this._recoverTried[b.id]) return this._recoverTried[b.id];
            if (this._recoverFail[b.id] && Date.now() < this._recoverFail[b.id]) return Promise.resolve(false);
            const job = (async () => {
                const tasks = await this._fetchTasks();
                if (!tasks.length) return false;
                const byKey = {};
                const nodeTasks = [];
                tasks.forEach(t => {
                    const p = t && t.params;
                    if (!p || p.draft !== true || t.status !== 'completed') return;
                    const k = this._fileKey(t.result && t.result.videoUrl);
                    if (k && !byKey[k]) byKey[k] = t;
                    // 有些旧记录保存的是上游临时地址（文件名不含本站对象名），只能按「同节点 + 完成时间」匹配
                    if (p.nodeId === b.id) nodeTasks.push({ t: t, used: false });
                });
                const applyTask = (e, t) => {
                    e.params = e.params || {};
                    e.params.draft = true;
                    e.media = e.media || {};
                    e.media.draft = true;
                    e.media.draftTaskId = t.id;
                    e.media.draftAt = this._taskTime(t) || Number(e.media.draftAt) || 0;
                    e.media.draftUpstreamId = (t.result && t.result.upstreamTaskId) || e.media.draftUpstreamId || '';
                    e.media.draftBillSec = parseInt((t.params && (t.params.billDuration || t.params.duration)), 10) ||
                        Number(e.media.draftBillSec) || 0;
                };
                let touched = false;
                const pending = [];
                (b.genHistory || []).forEach(e => {
                    if (!this.isDraftEntry(e) || (e.media && e.media.draftTaskId)) return;
                    const k = this._fileKey(e.media && (e.media.videoUrl || e.media.mediaUrl));
                    const t = k && byKey[k];
                    if (t) {
                        applyTask(e, t);
                        const nt = nodeTasks.find(x => x.t.id === t.id);
                        if (nt) nt.used = true;
                        touched = true;
                        return;
                    }
                    // ts 是「现在」兜底生成的（无 genStartedAt/draftAt）时不可信，不参与时间配对，避免配错任务
                    if (Number(e.ts) && Number(e.ts) < Date.now() - 60000) pending.push(e);
                });
                // 文件名匹配不到：按同节点样片任务的完成时间就近配对（1:1，30 分钟内才算）
                const MAX_GAP = 30 * 60 * 1000;
                pending.forEach(e => {
                    let best = null, bestGap = MAX_GAP;
                    nodeTasks.forEach(x => {
                        if (x.used) return;
                        const gap = Math.abs(Number(e.ts) - this._taskTime(x.t));
                        if (gap < bestGap) { best = x; bestGap = gap; }
                    });
                    if (!best) return;
                    best.used = true;
                    applyTask(e, best.t);
                    touched = true;
                });
                if (!touched) return false;
                // 当前展示的正好是被补全的记录：节点字段同步 → 升级按钮恢复可用
                const act = this._activeEntry(b);
                if (act && act.media && act.media.draftTaskId) {
                    CB.update(b.id, {
                        draft: true,
                        draftAt: Number(act.media.draftAt) || 0,
                        draftTaskId: act.media.draftTaskId,
                        draftUpstreamId: act.media.draftUpstreamId || '',
                        draftBillSec: Number(act.media.draftBillSec) || 0
                    });
                }
                if (global.CanvasStore) global.CanvasStore.scheduleSave();
                if (this._popNodeId === b.id) this._renderPopover();
                return true;
            })();
            this._recoverTried[b.id] = job;
            job.then(ok => {
                if (!ok) {
                    // 没匹配到就别让 1 秒轮询反复扫任务列表，隔一段时间再试
                    this._recoverFail[b.id] = Date.now() + 60000;
                    delete this._recoverTried[b.id];
                }
            }).catch(() => { this._recoverFail[b.id] = Date.now() + 60000; delete this._recoverTried[b.id]; });
            return job;
        },

        // ===== 角标（节点右上角，世界层随画布缩放） =====
        badgeHtml(block) {
            // 一次性修复：旧 bug 清空的提示词，从当前生成记录恢复
            if (block && block.nodeType === 'gen' && !block.prompt && !block.genPromptHealed && Array.isArray(block.genHistory)) {
                const act = block.genHistory.find(e => e.id === block.genHistoryActive) || block.genHistory[0];
                if (act && act.params && act.params.prompt) {
                    block.prompt = act.params.prompt;
                    block.genPromptHealed = true;
                }
            }
            const n = this.count(block);
            if (!n) return '';
            return `<button type="button" class="gen-hist-badge" title="生成记录（${n}）">${n}${CHEVRON}</button>`;
        },

        // ===== 缩略图 =====
        _thumbHtml(media, cls) {
            const VP = global.VideoProxy;
            if (this._isVideo(media)) {
                const poster = VP ? VP.validPosterOf(media) : '';
                if (poster) return `<img class="${cls}" src="${esc(poster)}" alt="" loading="lazy">`;
                const src = (VP ? VP.previewOf(media) : '') || media.videoUrl || media.mediaUrl || '';
                return `<video class="${cls}" src="${esc(src)}#t=0.1" preload="metadata" muted playsinline></video>`;
            }
            const u = media.mediumUrl || media.previewUrl || media.imageUrl || '';
            return `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy">`;
        },
        _modelName(id) {
            if (!id) return '';
            const PB = global.PromptBar;
            const cfg = PB && PB.modelConfigMap && PB.modelConfigMap[id];
            if (cfg && cfg.name) return cfg.name;
            const list = (global.CanvasGenerate && global.CanvasGenerate.models) || [];
            const m = list.find(x => x.id === id);
            return (m && m.name) || id;
        },
        _time(ts) {
            const d = new Date(ts || Date.now());
            const p = (n) => String(n).padStart(2, '0');
            return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        },
        _metaText(e) {
            const p = e.params || {};
            const parts = [this._modelName(p.model)];
            if (p.aspectRatio) parts.push(p.aspectRatio);
            if (this._isVideo(e.media)) { if (p.duration) parts.push(p.duration + 's'); if (p.resolution) parts.push(p.resolution); }
            else if (p.size) parts.push(p.size);
            return parts.filter(Boolean).join(' · ');
        },

        // ===== 悬浮框 =====
        openPopover(nodeId) {
            const b = global.CanvasBlocks && global.CanvasBlocks.getById(nodeId);
            if (!b) return;
            this._ensure(b);
            this.closePopover();
            const app = document.querySelector('.canvas-app') || document.body;
            const el = document.createElement('div');
            el.className = 'gh-pop';
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.addEventListener('click', (e) => {
                const full = e.target.closest('.gh-pop-full');
                if (full) { this.openFull(this._popNodeId); return; }
                const it = e.target.closest('.gh-item[data-id]');
                if (it) this.apply(this._popNodeId, it.dataset.id);
            });
            app.appendChild(el);
            this._popEl = el;
            this._popNodeId = nodeId;
            this._renderPopover();
            this.reposition();
        },
        closePopover() {
            if (this._popEl && this._popEl.parentNode) this._popEl.parentNode.removeChild(this._popEl);
            this._popEl = null;
            this._popNodeId = null;
        },
        _renderPopover() {
            const b = this._popEl && global.CanvasBlocks.getById(this._popNodeId);
            if (!b) { this.closePopover(); return; }
            const list = b.genHistory || [];
            const isVid = list.length ? this._isVideo(list[0].media) : this._isVideo(b);
            this._popEl.innerHTML = `
                <div class="gh-pop-head">
                    <span class="gh-pop-title">生成记录<b>${list.length}</b></span>
                    <button type="button" class="gh-pop-full" title="全屏查看">${EXPAND}<span>全屏查看</span></button>
                </div>
                <div class="gh-pop-grid">
                    ${list.map(e => `
                        <div class="gh-item${e.id === b.genHistoryActive ? ' is-active' : ''}" data-id="${e.id}" title="${esc(this._metaText(e))}&#10;${esc(this._time(e.ts))}">
                            ${this._thumbHtml(e.media, 'gh-thumb')}
                            ${this._isVideo(e.media) ? `<span class="gh-item-play">${PLAY}</span>` : ''}
                            ${e.id === b.genHistoryActive ? `<span class="gh-item-cur">当前</span>` : ''}
                        </div>`).join('')}
                </div>
                <div class="gh-pop-tip">点击记录设为当前${isVid ? '视频' : '图片'}，并恢复当时的提示词和设置</div>`;
        },
        // 定位：节点右侧（放不下则左侧），随画布平移/缩放跟随
        reposition() {
            if (!this._popEl) return;
            const b = global.CanvasBlocks.getById(this._popNodeId);
            const core = global.CanvasCore;
            if (!b || !core) { this.closePopover(); return; }
            const scale = core.viewport.scale;
            const vpRect = core._vpRect || core.viewportEl.getBoundingClientRect();
            const app = this._popEl.parentNode;
            const appRect = app.getBoundingClientRect();
            const sx = vpRect.left - appRect.left + b.x * scale + core.viewport.x;
            const sy = vpRect.top - appRect.top + b.y * scale + core.viewport.y;
            const w = this._popEl.offsetWidth || 300;
            const gap = 14;
            let left = sx + b.w * scale + gap;
            if (left + w > appRect.width - 8) left = sx - w - gap;
            const maxTop = appRect.height - (this._popEl.offsetHeight || 200) - 8;
            this._popEl.style.left = Math.round(Math.max(8, left)) + 'px';
            this._popEl.style.top = Math.round(Math.max(8, Math.min(sy, maxTop))) + 'px';
        },

        // ===== 全屏 =====
        openFull(nodeId) {
            const b = global.CanvasBlocks && global.CanvasBlocks.getById(nodeId);
            if (!b) return;
            this._ensure(b);
            this.closePopover();
            this.closeFull();
            const el = document.createElement('div');
            el.className = 'gh-full';
            el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
            el.addEventListener('click', (e) => {
                if (e.target.closest('.gh-full-close')) { this.closeFull(); return; }
                const set = e.target.closest('.gh-card-set[data-id]');
                if (set) { this.apply(this._fullNodeId, set.dataset.id); return; }
                const dl = e.target.closest('.gh-card-dl[data-id]');
                if (dl) { this._download(dl.dataset.id); return; }
                const im = e.target.closest('.gh-card-media img.gh-card-img');
                if (im) { this._openViewerFor(im.closest('.gh-card')); return; } // _GHVIEWER_1027 复用大图查看器
                const fsb = e.target.closest('.gh-card-fs[data-id]');
                if (fsb) { this._openViewerFor(fsb.closest('.gh-card'), true); return; }
            });
            document.body.appendChild(el);
            this._fullEl = el;
            this._fullNodeId = nodeId;
            this._renderFull();
        },
        closeFull() {
            if (!this._fullEl) return;
            this._fullEl.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {} });
            if (this._fullEl.parentNode) this._fullEl.parentNode.removeChild(this._fullEl);
            this._fullEl = null;
            this._fullNodeId = null;
        },
        _renderFull() {
            const b = this._fullEl && global.CanvasBlocks.getById(this._fullNodeId);
            if (!b) { this.closeFull(); return; }
            // 保留正在播放的视频：只更新"当前"状态，不整体重建
            const list = b.genHistory || [];
            if (this._fullEl.querySelector('.gh-full-grid') && this._fullEl.dataset.sig === list.map(e => e.id).join(',')) {
                this._fullEl.querySelectorAll('.gh-card').forEach(c => {
                    const on = c.dataset.id === b.genHistoryActive;
                    c.classList.toggle('is-active', on);
                    const btn = c.querySelector('.gh-card-set');
                    if (btn) { btn.disabled = on; btn.innerHTML = on ? `${STAR}<span>当前使用</span>` : `<span>${this._isVideo(list.find(e => e.id === c.dataset.id).media) ? '设为主视频' : '设为主图'}</span>`; }
                });
                return;
            }
            this._fullEl.dataset.sig = list.map(e => e.id).join(',');
            const VP = global.VideoProxy;
            const name = esc(b.name || '生成节点');
            this._fullEl.innerHTML = `
                <div class="gh-full-head">
                    <div class="gh-full-title">${name}<span>共 ${list.length} 条生成记录</span></div>
                    <button type="button" class="gh-full-close" title="关闭（Esc）">${CLOSE}</button>
                </div>
                <div class="gh-full-grid">
                    ${list.map(e => {
                        const on = e.id === b.genHistoryActive;
                        const isV = this._isVideo(e.media);
                        let media;
                        let thumbUrl = ''; /* _GHBLUR_1027 模糊填充底图 */
                        if (isV) {
                            const src = (VP ? VP.previewOf(e.media) : '') || e.media.videoUrl || '';
                            const poster = VP ? VP.validPosterOf(e.media) : '';
                            thumbUrl = poster || ''; /* _GHBLUR_1027 */
                            media = `<video src="${esc(src)}${poster ? '' : '#t=0.1'}" ${poster ? `poster="${esc(poster)}" preload="none"` : 'preload="metadata"'} controls playsinline loop></video><button type="button" class="gh-card-fs" data-id="${e.id}" title="大屏播放">${EXPAND}</button>`;
                        } else {
                            const iurl = e.media.mediumUrl || e.media.previewUrl || e.media.imageUrl || ''; /* _GHBLUR_1027 */
                            media = `<img class="gh-card-img" src="${esc(iurl)}" alt="" loading="lazy">`;
                            thumbUrl = iurl;
                        }
                        const setLabel = on ? `${STAR}<span>当前使用</span>` : `<span>${isV ? '设为主视频' : '设为主图'}</span>`;
                        return `
                        <div class="gh-card${on ? ' is-active' : ''}" data-id="${e.id}">
                            <div class="gh-card-media${thumbUrl ? ' gh-has-thumb' : ''}"${thumbUrl ? ` style="--gh-thumb:url(&quot;${esc(thumbUrl)}&quot;)"` : ''}><!-- _GH_SQUARE_1027 方形由 CSS 统一控制 + _GHBLUR_1027 模糊填充 -->${media}</div>
                            <div class="gh-card-info">
                                <div class="gh-card-meta"><span>${esc(this._metaText(e))}</span><span class="gh-card-time">${esc(this._time(e.ts))}</span></div>
                                <div class="gh-card-prompt" title="${esc((e.params && e.params.prompt) || '')}">${esc((e.params && e.params.prompt) || '（无提示词）')}</div>
                                <div class="gh-card-acts">
                                    <button type="button" class="gh-card-set" data-id="${e.id}"${on ? ' disabled' : ''}>${setLabel}</button>
                                    <button type="button" class="gh-card-dl" data-id="${e.id}" title="下载">${DL}</button>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
        },
        _openViewerFor(card, forceVideo) { // _GHVIEWER_1027 复用全屏大图查看器（视频适配播放）
            if (!card || !global.CanvasMain) return;
            const b = global.CanvasBlocks.getById(this._fullNodeId);
            const entry = b && (b.genHistory || []).find(x => x.id === card.dataset.id);
            if (!entry) return;
            const m = entry.media || {};
            const VP = global.VideoProxy;
            const isV = forceVideo || this._isVideo(m);
            const url = isV ? ((VP ? VP.previewOf(m) : '') || m.videoUrl || '') : (m.imageUrl || m.mediumUrl || m.previewUrl || '');
            if (!url) return;
            if (isV) this._fullEl.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });
            const p = entry.params || {};
            const pn = { nodeType: 'gen', model: p.model, aspectRatio: p.aspectRatio || '', size: p.resolution || p.size || '—', prompt: p.prompt };
            global.CanvasMain._openFullscreenViewer(url, pn, isV);
        },
        _download(entryId) {
            const b = global.CanvasBlocks.getById(this._fullNodeId);
            const e = b && (b.genHistory || []).find(x => x.id === entryId);
            if (!e) return;
            const url = e.media.videoUrl || e.media.imageUrl;
            if (url && window.pxDownload) window.pxDownload(url, (b.name || 'nano') + '_' + this._time(e.ts).replace(/[^0-9]/g, ''));
        }
    };

    global.GenHistory = GenHistory;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => GenHistory.init());
    else GenHistory.init();
})(window);
