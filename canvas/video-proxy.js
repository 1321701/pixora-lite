/**
 * video-proxy.js
 * 视频预览版（代理）：在浏览器本地把视频压缩为低码率小尺寸 MP4，上传到云存储，
 * 画布内播放/预览一律使用预览版（videoPreviewUrl），下载/提交模型仍使用原始视频。
 * 节点字段：videoPreviewUrl（预览版地址）、videoPreviewSrc（生成预览版时对应的原始地址，原视频变更后预览版自动失效）
 */
(function (global) {
    'use strict';

    const MAX_LONG = 960;               // 预览版长边上限
    const MAX_SHORT = 540;              // 预览版短边上限
    const SKIP_BYTES = 4 * 1024 * 1024; // 源已 ≤540p 且 ≤4MB 时不做代理
    const VIDEO_BPS = 1200000;
    const AUDIO_BPS = 96000;
    const FPS = 30;

    const VideoProxy = {
        _queue: [],              // 待处理任务 [{ nodeId, source, srcUrl, size }]
        _running: false,
        _busyId: null,           // 正在压缩的节点 ID
        _proxyFailed: new Set(), // 失败过的节点 ID（只存内存，不持久化，本次会话不再重试）
        _mime: undefined,

        // 选取可用的 MP4 录制格式（不支持返回空串）
        _pickMime() {
            if (this._mime !== undefined) return this._mime;
            let m = '';
            try {
                if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
                    m = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
                        .find(t => MediaRecorder.isTypeSupported(t)) || '';
                }
            } catch (_) { m = ''; }
            this._mime = m;
            return m;
        },

        isSupported() {
            return !!(this._pickMime() && typeof HTMLCanvasElement !== 'undefined' &&
                HTMLCanvasElement.prototype.captureStream);
        },

        // 节点的原始视频地址（下载/提交模型用）
        originalOf(block) {
            if (!block) return '';
            return block.videoUrl || block.mediaUrl || block.imageUrl || '';
        },

        // 节点当前有效的预览版地址（无或已失效返回空串）
        validPreviewOf(block) {
            if (!block || !block.videoPreviewUrl) return '';
            const orig = this.originalOf(block);
            if (block.videoPreviewSrc && block.videoPreviewSrc !== orig) return '';
            return block.videoPreviewUrl;
        },

        // 画布内播放/缩略用地址：有预览版用预览版，否则回退原视频
        previewOf(block) {
            return this.validPreviewOf(block) || this.originalOf(block);
        },

        // 是否站内媒体：同源地址或 /api/img 代理路径（第三方外链不得设 crossOrigin / 走 canvas 取帧）
        isInternalMedia(u) {
            const s = String(u || '');
            if (!s) return false;
            if (s.startsWith('data:') || s.startsWith('blob:')) return true;
            try {
                const uo = new URL(s, global.location.href);
                if (uo.origin === global.location.origin) return true;
                if (uo.pathname.indexOf('/api/img') === 0) return true;
            } catch (_) {
                if (s.indexOf('/api/img') === 0) return true;
            }
            return false;
        },

        // 外链媒体：不生成预览版/封面，不追加 _vp，不设 crossOrigin
        isExternalMedia(u) {
            return !!u && !this.isInternalMedia(u);
        },

        // 节点当前有效的封面图（首帧 JPG，原视频变更后自动失效）
        validPosterOf(block) {
            if (!block || !block.videoPosterUrl || block.videoPosterV !== 2) return '';
            const orig = this.originalOf(block);
            if (block.videoPosterSrc && block.videoPosterSrc !== orig) return '';
            return this._relPoster(block.videoPosterUrl);
        },

        // 站内媒体地址归一化为同源相对路径：历史数据可能保存了绝对地址（如 https://pixoraai.cc/api/img/...），
        // 在国内域名加载时会被当作跨域，/api/img 302 到 TOS 的重定向链一旦缺 ACAO 就直接失败
        sameOrigin(u) {
            const s = String(u || '');
            if (!s) return s;
            try {
                const uo = new URL(s, global.location.href);
                if (uo.pathname.indexOf('/api/img') === 0 && uo.origin !== global.location.origin) {
                    return uo.pathname + uo.search + uo.hash;
                }
            } catch (_) {}
            return s;
        },

        // 封面地址规范化：去掉域名（同视频一样走当前入口域名，国内入口走北京镜像，不跨境回香港）
        // 并去掉多余的 x-tos-process=image/format,jpg（本身就是 JPG，免每次实时处理）
        _relPoster(u) {
            return String(u || '')
                .replace(/^https?:\/\/[^\/]+(?=\/api\/img)/i, '')
                .replace(/&x-tos-process=image(?:\/|%2F)format(?:,|%2C)jpg$/i, '');
        },

        isBusy(nodeId) {
            return !!nodeId && this._busyId === nodeId;
        },

        // 是否为需要预览版的视频节点（素材 + 生成结果）
        _isVideoNode(b) {
            if (!b || b.mediaType !== 'video' || b.videoExpired) return false;
            if (b.status === 'loading' || b.status === 'generating' || b.status === 'failed') return false;
            if (b.nodeType === 'ref') return true;
            const CB = global.CanvasBlocks;
            return b.nodeType === 'gen' && !!(CB && CB._genCategoryOf && CB._genCategoryOf(b) === 'video');
        },

        /**
         * 入队：source 为 File/Blob（本地上传，免再次下载）或 URL；opts.size 为已知文件大小（可选）
         */
        enqueue(nodeId, source, opts) {
            if (!nodeId || !source) return;
            const CB = global.CanvasBlocks;
            const b0 = CB && CB.getById(nodeId);
            if (b0 && b0.videoExpired) return;
            if (!(source instanceof Blob) && this.isExternalMedia(this.sameOrigin(source))) {
                // 第三方外链：跳过预览版（CORS 不可读），静默记入失败集合
                this._proxyFailed.add(nodeId);
                console.debug('[视频预览版] 外链跳过预览生成:', nodeId);
                return;
            }
            this.enqueuePoster(nodeId, source);
            if (!this.isSupported()) return;
            if (this._proxyFailed.has(nodeId)) return;
            const CB2 = global.CanvasBlocks;
            const b = CB2 && CB2.getById(nodeId);
            if (!b) return;
            const srcUrl = this.originalOf(b);
            if (!srcUrl || this.validPreviewOf(b)) return;
            if (this._busyId === nodeId) return;
            const size = (opts && opts.size) || (source instanceof Blob ? source.size : 0) || b.mediaSize || 0;
            const job = { nodeId, source, srcUrl, size };
            const i = this._queue.findIndex(j => j.nodeId === nodeId);
            if (i >= 0) {
                // 已在队列：本地文件优先（免下载），否则保留原任务
                if (source instanceof Blob || this._queue[i].srcUrl !== srcUrl) this._queue[i] = job;
                return;
            }
            this._queue.push(job);
            this._pump();
        },

        // 画布加载后扫描：补齐缺预览版的老视频节点
        scanAll() {
            const CB = global.CanvasBlocks;
            if (!CB || !Array.isArray(CB.blocks)) return;
            // 封面图：缺的都补（从预览版截，更快）；外链/已失效节点不请求
            CB.blocks.forEach(b => {
                if (!this._isVideoNode(b) || this.validPosterOf(b)) return;
                const p = this.previewOf(b);
                if (!this.isInternalMedia(p)) return;
                this.enqueuePoster(b.id, p);
            });
            if (!this.isSupported()) return;
            CB.blocks.forEach(b => {
                if (!this._isVideoNode(b) || this.validPreviewOf(b)) return;
                const u = this.originalOf(b);
                if (u && this.isInternalMedia(u)) this.enqueue(b.id, u, { size: b.mediaSize || 0 });
            });
        },

        // 页面隐藏时等待可见（后台标签页被节流，录出来会卡）
        _waitVisible() {
            if (!document.hidden) return Promise.resolve();
            return new Promise((resolve) => {
                const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); resolve(); } };
                document.addEventListener('visibilitychange', on);
            });
        },

        // 等待用户与页面有过交互（非静音播放与 AudioContext 需要用户手势，否则会被自动播放策略拦截）
        _waitActivation(force) {
            const ua = navigator.userActivation;
            if (!force && (!ua || ua.hasBeenActive)) return Promise.resolve();
            return new Promise((resolve) => {
                const evs = ['pointerdown', 'keydown', 'touchstart'];
                const on = () => { evs.forEach(e => document.removeEventListener(e, on, true)); setTimeout(resolve, 0); };
                evs.forEach(e => document.addEventListener(e, on, true));
            });
        },

        // 名字栏「优化中…」小字（直接改 DOM，避免重渲染打断节点内正在播放的视频）
        _setBadge(nodeId, on) {
            const CB = global.CanvasBlocks;
            const L = CB && CB.layerEl;
            if (!L) return;
            const el = L.querySelector(`.canvas-node[data-block-id="${nodeId}"] .node-name`);
            if (!el) return;
            const old = el.querySelector('.vproxy-badge');
            if (on && !old) el.insertAdjacentHTML('beforeend', '<span class="node-name-res vproxy-badge" title="正在本地生成预览版，用于画布内流畅播放">优化中…</span>');
            else if (!on && old) old.remove();
        },

        async _pump() {
            if (this._running) return;
            this._running = true;
            try {
                while (this._queue.length) {
                    await this._waitVisible();
                    await this._waitActivation(false);
                    const job = this._queue.shift();
                    if (!job) continue;
                    const CB = global.CanvasBlocks;
                    const b = CB && CB.getById(job.nodeId);
                    // 节点已删除 / 原视频已更换 / 已有预览版：跳过
                    if (!b || this.originalOf(b) !== job.srcUrl || this.validPreviewOf(b)) continue;
                    this._busyId = job.nodeId;
                    this._setBadge(job.nodeId, true);
                    try {
                        const blob = await this.createProxy(job.source, { size: job.size });
                        let previewUrl = job.srcUrl;   // 小文件跳过：原地址即预览
                        if (blob) {
                            const base = String(b.name || (job.source && job.source.name) || 'video')
                                .replace(/\.[a-z0-9]{2,4}$/i, '')
                                .replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'video';
                            const file = new File([blob], base + '_preview.mp4', { type: 'video/mp4' });
                            const m = await global.CanvasGenerate.uploadMediaRef(file);
                            if (!m || !m.url) throw new Error('预览版上传失败');
                            previewUrl = m.url;
                        }
                        this._applyPreview(job.nodeId, job.srcUrl, previewUrl);
                    } catch (err) {
                        const msg = (err && err.message) || '';
                        if (msg === '__hidden') {
                            // 录制中切到后台：放回队首，回到前台后重录（不计失败）
                            this._queue.unshift(job);
                        } else if (msg === '__activation') {
                            // 自动播放策略拦截：放回队首，等用户下一次交互后重试（不计失败）
                            this._queue.unshift(job);
                            this._busyId = null;
                            this._setBadge(job.nodeId, false);
                            await this._waitActivation(true);
                        } else {
                            this._proxyFailed.add(job.nodeId);
                            // 外链/已知不可读的源静默跳过，只留一行 debug
                            console.debug('[视频预览版] 生成失败，继续使用原视频:', job.nodeId, msg);
                        }
                    } finally {
                        if (this._busyId === job.nodeId) this._busyId = null;
                        this._setBadge(job.nodeId, false);
                    }
                }
            } finally {
                this._running = false;
            }
        },

        // 回写预览版：节点视频未在播放则重渲染即时切换；正在播放则只写字段，避免打断（下次渲染生效）
        _applyPreview(nodeId, srcUrl, previewUrl) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || this.originalOf(b) !== srcUrl) return;
            const patch = { videoPreviewUrl: previewUrl, videoPreviewSrc: srcUrl };
            const L = CB.layerEl;
            const playing = L && L.querySelector(`video.node-video.is-playing[data-block-id="${nodeId}"]`);
            if (playing) Object.assign(b, patch);
            else CB.update(nodeId, patch);
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        // ===== 外链失效修复（每个节点每会话最多一次）=====
        // 后台转存/回填后任务已改为自有地址，这里调用 /api/video/repair 把画布节点就地换回；
        // 失败或 expired 显示「视频链接已失效」遮罩，不再重复请求。
        _repairTried: new Set(),
        _repairBusy: new Set(),

        repair(nodeId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || b.videoExpired) return;
            const url = this.originalOf(b);
            if (!url || !this.isExternalMedia(url)) return;
            if (this._repairTried.has(nodeId) || this._repairBusy.has(nodeId)) return;
            this._repairTried.add(nodeId);
            this._repairBusy.add(nodeId);
            const base = (global.API_CONFIG && global.API_CONFIG.baseUrl) || '';
            const headers = Object.assign({ 'Content-Type': 'application/json' },
                typeof global.authHeaders === 'function' ? global.authHeaders() : {});
            fetch(base + '/api/video/repair', {
                method: 'POST',
                headers,
                body: JSON.stringify({ taskId: String(b.taskId || b.videoTaskId || ''), videoUrl: url })
            })
                .then(r => r.json().catch(() => ({})))
                .then(d => {
                    const cur = CB.getById(nodeId);
                    if (!cur || this.originalOf(cur) !== url) return;
                    if (d && d.code === 0 && d.data && d.data.videoUrl) {
                        const nu = String(d.data.videoUrl);
                        CB.update(nodeId, {
                            videoUrl: nu, mediaUrl: nu, imageUrl: nu,
                            videoPreviewUrl: '', videoPreviewSrc: '',
                            videoPosterUrl: '', videoPosterSrc: '',
                            videoExpired: false
                        });
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                        console.debug('[视频修复] 已恢复持久地址:', nodeId);
                    } else {
                        this._markExpired(nodeId);
                        console.debug('[视频修复] 失败，显示失效遮罩:', nodeId, (d && (d.reason || d.msg)) || '');
                    }
                })
                .catch(() => {
                    this._markExpired(nodeId);
                    console.debug('[视频修复] 请求异常，显示失效遮罩:', nodeId);
                })
                .finally(() => this._repairBusy.delete(nodeId));
        },

        _markExpired(nodeId) {
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || b.videoExpired) return;
            CB.update(nodeId, { videoExpired: true });
            if (global.CanvasStore) global.CanvasStore.scheduleSave();
        },

        // ===== 封面图（首帧）=====
        // 节点静止时显示封面图而不是 <video> 首帧：<video> 首帧要靠浏览器每次重新拉取+解码，
        // 视频多、文件大、节点重渲染或浏览器回收播放器时就会黑屏；封面图走图片缓存，秒出且不占视频连接
        _posterQueue: [],
        _posterRunning: false,
        _posterFailed: new Set(),

        enqueuePoster(nodeId, source) {
            if (!nodeId || !source || this._posterFailed.has(nodeId)) return;
            const CB = global.CanvasBlocks;
            const b = CB && CB.getById(nodeId);
            if (!b || b.videoExpired || this.validPosterOf(b)) return;
            const srcUrl = this.originalOf(b);
            if (!srcUrl) return;
            if (!(source instanceof Blob) && !this.isInternalMedia(this.sameOrigin(source))) {
                this._posterFailed.add(nodeId);
                console.debug('[视频封面] 外链跳过封面生成:', nodeId);
                return;
            }
            const job = { nodeId, source, srcUrl };
            const i = this._posterQueue.findIndex(j => j.nodeId === nodeId);
            if (i >= 0) { if (source instanceof Blob) this._posterQueue[i] = job; return; }
            this._posterQueue.push(job);
            this._pumpPoster();
        },

        async _pumpPoster() {
            if (this._posterRunning) return;
            this._posterRunning = true;
            try {
                while (this._posterQueue.length) {
                    const job = this._posterQueue.shift();
                    const CB = global.CanvasBlocks;
                    const b = CB && CB.getById(job.nodeId);
                    if (!b || this.originalOf(b) !== job.srcUrl || this.validPosterOf(b)) continue;
                    try {
                        const blob = await this.createPoster(job.source);
                        const file = new File([blob], 'poster_' + job.nodeId + '.jpg', { type: 'image/jpeg' });
                        const r = await global.CanvasGenerate.uploadRef(file);
                        const url = r && (r.highUrl || r.mediumUrl);   // previewUrl 是 150px 缩略，做封面太糊
                        if (!url) throw new Error('封面上传失败');
                        const nb = CB.getById(job.nodeId);
                        if (!nb || this.originalOf(nb) !== job.srcUrl) continue;
                        const patch = { videoPosterUrl: this._relPoster(url), videoPosterSrc: job.srcUrl, videoPosterV: 2 };
                        const playing = CB.layerEl && CB.layerEl.querySelector(`video.node-video.is-playing[data-block-id="${job.nodeId}"]`);
                        if (playing) Object.assign(nb, patch);
                        else CB.update(job.nodeId, patch);
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    } catch (err) {
                        const msg = (err && err.message) || '';
                        if (msg === '__external') {
                            this._posterFailed.add(job.nodeId);
                            console.debug('[视频封面] 外链跳过封面生成:', job.nodeId);
                            continue;
                        }
                        // 页面刚加载时视频请求拥挤容易超时：最多重试 2 次（间隔 15s），仍失败本次会话不再尝试
                        job.tries = (job.tries || 0) + 1;
                        if (job.tries < 3) {
                            setTimeout(() => { this._posterQueue.push(job); this._pumpPoster(); }, 15000);
                        } else {
                            this._posterFailed.add(job.nodeId);
                            console.warn('[视频封面] 生成失败:', job.nodeId, msg || err);
                        }
                    }
                }
            } finally {
                this._posterRunning = false;
            }
        },

        // 截取首帧（0.1s 处）为 JPG，长边 ≤ 960
        async createPoster(source) {
            const isBlob = (typeof Blob !== 'undefined') && source instanceof Blob;
            let objUrl = null, src;
            if (isBlob) { objUrl = URL.createObjectURL(source); src = objUrl; }
            else {
                const s0 = this.sameOrigin(source);
                // 第三方外链不带 ACAO，canvas 取帧必失败：直接放弃（不追加 _vp，避免无谓请求）
                if (!this.isInternalMedia(s0)) throw new Error('__external');
                src = s0 + (s0.indexOf('?') >= 0 ? '&' : '?') + '_vp=' + Date.now();
            }
            const v = document.createElement('video');
            if (!isBlob) v.crossOrigin = 'anonymous';
            v.muted = true;
            v.playsInline = true;
            v.preload = 'auto';
            v.src = src;
            try {
                await this._wait(v, 'loadeddata', 45000);
                const t = Math.min(0.1, (isFinite(v.duration) && v.duration > 0) ? v.duration / 2 : 0.1);
                if (Math.abs(v.currentTime - t) > 0.01) {
                    const sk = this._wait(v, 'seeked', 15000);
                    v.currentTime = t;
                    await sk;
                }
                const vw = v.videoWidth, vh = v.videoHeight;
                if (!vw || !vh) throw new Error('无法读取视频尺寸');
                const k = Math.min(1, 960 / Math.max(vw, vh));
                const c = document.createElement('canvas');
                c.width = Math.round(vw * k); c.height = Math.round(vh * k);
                c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
                if (!blob) throw new Error('封面导出失败');
                return blob;
            } finally {
                try { v.removeAttribute('src'); v.load(); } catch (_) {}
                if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (_) {} }
            }
        },

        // URL 源探测文件大小（Range 0-0 读 Content-Range 总长；读不到返回 0 = 未知）
        async _probeSize(url) {
            const su = this.sameOrigin(url);
            if (!this.isInternalMedia(su)) return 0;   // 外链不探测、不追加 _vp
            try {
                const u = su + (su.indexOf('?') >= 0 ? '&' : '?') + '_vp=' + Date.now();
                const res = await fetch(u, { headers: { Range: 'bytes=0-0' } });
                const cr = res.headers.get('Content-Range') || '';
                const m = cr.match(/\/(\d+)\s*$/);
                if (res.body && res.body.cancel) { try { res.body.cancel(); } catch (_) {} }
                if (m) return parseInt(m[1], 10) || 0;
                if (res.status === 200) return parseInt(res.headers.get('Content-Length') || '0', 10) || 0;
            } catch (_) {}
            return 0;
        },

        _wait(el, evName, ms) {
            return new Promise((resolve, reject) => {
                let timer = null;
                const cleanup = () => { el.removeEventListener(evName, ok); el.removeEventListener('error', bad); clearTimeout(timer); };
                const ok = () => { cleanup(); resolve(); };
                const bad = () => { cleanup(); reject(new Error('视频加载失败')); };
                el.addEventListener(evName, ok);
                el.addEventListener('error', bad);
                timer = setTimeout(() => { cleanup(); reject(new Error('视频加载超时')); }, ms);
            });
        },

        /**
         * 生成预览版：隐藏 video 实时播放 → 逐帧画到缩放 canvas → canvas 视频轨 + WebAudio 音轨 → MediaRecorder 录制 MP4
         * @param {File|Blob|string} source 本地文件或视频 URL
         * @param {{size?:number}} [opts]
         * @returns {Promise<Blob|null>} 预览版 MP4；源已足够小（≤540p 且 ≤4MB）返回 null 表示无需代理
         */
        async createProxy(source, opts) {
            const mime = this._pickMime();
            if (!mime || !this.isSupported()) throw new Error('浏览器不支持本地视频压缩');
            const isBlob = (typeof Blob !== 'undefined') && source instanceof Blob;
            let size = (opts && opts.size) || (isBlob ? source.size : 0);
            let objUrl = null, src;
            if (isBlob) {
                objUrl = URL.createObjectURL(source);
                src = objUrl;
            } else {
                const s = this.sameOrigin(source);
                // 第三方外链不带 ACAO：不生成预览版（不追加 _vp、不设 crossOrigin）
                if (!this.isInternalMedia(s)) throw new Error('__external');
                // 追加一次性参数：避免复用节点内非 CORS <video> 的缓存导致 CORS 失败（同 _vtrimMakeVideo 的 _vtcors）
                src = s + (s.indexOf('?') >= 0 ? '&' : '?') + '_vp=' + Date.now();
            }
            const v = document.createElement('video');
            if (!isBlob) v.crossOrigin = 'anonymous';
            v.preload = 'auto';
            v.playsInline = true;
            v.muted = false;   // 不能静音，否则 WebAudio 拿不到音频；声音经 WebAudio 截流、不接扬声器
            v.loop = false;
            v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
            document.body.appendChild(v);
            v.src = src;

            let actx = null, rec = null, vStream = null, outStream = null;
            let stopped = false, timer = 0, poll = 0, onVis = null;
            try {
                await this._wait(v, 'loadedmetadata', 20000);
                const vw = v.videoWidth, vh = v.videoHeight, dur = v.duration;
                if (!vw || !vh) throw new Error('无法读取视频尺寸');
                if (!isFinite(dur) || dur <= 0) throw new Error('无法读取视频时长');
                // 小文件跳过：源已 ≤540p（短边）且 ≤4MB
                if (Math.min(vw, vh) <= MAX_SHORT) {
                    if (!size && !isBlob) size = await this._probeSize(String(source));
                    if (size > 0 && size <= SKIP_BYTES) return null;
                }
                // 缩放：长边 ≤960、短边 ≤540，保持比例，宽高取偶数
                const longS = Math.max(vw, vh), shortS = Math.min(vw, vh);
                const scale = Math.min(1, MAX_LONG / longS, MAX_SHORT / shortS);
                const even = (x) => Math.max(2, Math.round(x / 2) * 2);
                const w = even(vw * scale), h = even(vh * scale);
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const ctx = c.getContext('2d');
                if (v.readyState < 2) await this._wait(v, 'loadeddata', 20000);
                ctx.drawImage(v, 0, 0, w, h);   // 跨域受限时此处抛 SecurityError → 失败回退
                c.getContext('2d').getImageData(0, 0, 1, 1);
                vStream = c.captureStream(FPS);
                const vTracks = vStream.getVideoTracks();
                if (!vTracks.length) throw new Error('无法获取画面轨');
                // 音轨：WebAudio 截流到 MediaStreamDestination，不连接 actx.destination（不外放）
                let aTracks = [];
                const AC = global.AudioContext || global.webkitAudioContext;
                if (!AC) throw new Error('浏览器不支持 WebAudio');
                actx = new AC();
                const srcNode = actx.createMediaElementSource(v);
                const dest = actx.createMediaStreamDestination();
                srcNode.connect(dest);
                if (actx.state === 'suspended') {
                    await Promise.race([actx.resume(), new Promise(r => setTimeout(r, 3000))]);
                    if (actx.state === 'suspended') throw new Error('__activation');
                }
                aTracks = dest.stream.getAudioTracks();
                outStream = new MediaStream(vTracks.concat(aTracks));
                const chunks = [];
                rec = new MediaRecorder(outStream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
                rec.ondataavailable = (x) => { if (x.data && x.data.size) chunks.push(x.data); };
                const recStopped = new Promise((r) => { rec.onstop = r; });

                // 逐帧绘制：优先 requestVideoFrameCallback，回退 rAF
                const useRVFC = typeof v.requestVideoFrameCallback === 'function';
                const draw = () => {
                    if (stopped) return;
                    try { ctx.drawImage(v, 0, 0, w, h); } catch (_) {}
                    if (useRVFC) v.requestVideoFrameCallback(draw);
                    else requestAnimationFrame(draw);
                };

                rec.start(1000);
                try {
                    await v.play();
                } catch (e) {
                    if (e && e.name === 'NotAllowedError') throw new Error('__activation');
                    throw e;
                }
                draw();
                await new Promise((resolve, reject) => {
                    const done = () => { v.removeEventListener('ended', done); resolve(); };
                    v.addEventListener('ended', done);
                    v.addEventListener('error', () => reject(new Error('视频播放失败')), { once: true });
                    // 超时保护：时长 × 3 + 20 秒
                    timer = setTimeout(() => reject(new Error('压缩超时')), (dur * 3 + 20) * 1000);
                    // 切到后台：中止本次录制（后台节流会导致卡顿），由队列放回重录
                    onVis = () => { if (document.hidden) reject(new Error('__hidden')); };
                    document.addEventListener('visibilitychange', onVis);
                    // 兜底轮询结束状态（ended 事件偶发不触发）
                    poll = setInterval(() => { if (v.ended || v.currentTime >= dur - 0.02) done(); }, 250);
                });
                stopped = true;
                v.pause();
                if (rec.state !== 'inactive') rec.stop();
                await recStopped;
                const blob = new Blob(chunks, { type: 'video/mp4' });
                if (!blob.size) throw new Error('录制结果为空');
                return blob;
            } finally {
                stopped = true;
                clearTimeout(timer);
                clearInterval(poll);
                if (onVis) document.removeEventListener('visibilitychange', onVis);
                try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) {}
                [vStream, outStream].forEach(s => { if (s) s.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); });
                try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch (_) {}
                if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (_) {} }
                if (actx) { try { actx.close(); } catch (_) {} }
            }
        }
    };

    global.VideoProxy = VideoProxy;
})(window);
