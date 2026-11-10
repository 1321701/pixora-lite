/**
 * canvas-generate.js
 * 生成系统：节点式
 *   - loadModels(): 拉取模型列表，注入到 CanvasBlocks 供生成节点下拉使用
 *   - uploadRef(file): 上传图片，返回 { highUrl, previewUrl, tempKey }，供创建参考图节点
 *   - runNode(nodeId): 对某生成节点发起生成；收集其所有连入边的上游图片作为 imageUrls
 * 复用现有 TaskClient（异步任务 + 轮询），taskStatusUpdated 完成后回填到对应节点
 */
(function (global) {
    'use strict';

    const CanvasGenerate = {
        models: [],
        _taskNodeMap: {},   // taskId -> nodeId

        init() {
            this._loadModels();
            this._listenTasks();
        },

        backendUrl() {
            return API_CONFIG.baseUrl;
        },

        getUserId() {
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                return user.id;
            } catch { return undefined; }
        },

        async _loadModels() {
            try {
                const res = await fetch(`${this.backendUrl()}/api/config`);
                const data = await res.json();
                const apis = (data && (data.apis || (data.data && data.data.apis))) || {};
                const seen = new Set();
                const models = [];
                Object.values(apis).forEach(api => {
                    const list = api && api.frontend && api.frontend.models;
                    if (Array.isArray(list)) {
                        list.forEach(m => {
                            if (m && m.id && !seen.has(m.id)) {
                                seen.add(m.id);
                                models.push(m);
                            }
                        });
                    }
                });
                // 视频模型（仅画布可用）：追加到模型列表尾部
                const videoApis = data && (data.videoApis || (data.data && data.data.videoApis));
                if (videoApis && Array.isArray(videoApis.models)) {
                    videoApis.models.forEach(m => {
                        if (m && m.id && !seen.has(m.id)) {
                            seen.add(m.id);
                            models.push(m);
                        }
                    });
                }
                if (models.length === 0) {
                    models.push(
                        { id: 'Nano Banana Pro', name: 'Nano Banana Pro' },
                        { id: 'Nano Banana 2.0', name: 'Nano Banana 2' },
                        { id: 'GPT Image 2 标准', name: 'GPT Image 2' }
                    );
                }
                this.models = models;
            } catch (e) {
                console.error('[画布] 加载模型失败:', e);
                this.models = [{ id: 'Nano Banana Pro', name: 'Nano Banana Pro' }];
            }
            if (global.CanvasBlocks) global.CanvasBlocks.setModels(this.models);
            if (global.CanvasMain && global.CanvasMain._onModelsLoaded) global.CanvasMain._onModelsLoaded();
        },

        // 上传参考图，返回结果对象（失败抛错）
        // 与 PromptBar.validateImageLimits 保持一致的客户端校验
        async uploadRef(file) {
            // 1. 客户端预校验（与主页 prompt-bar.js 一致）
            const MAX = 20 * 1024 * 1024;
            if (file.size > MAX) throw new Error('图片大小超过20MB限制');
            const supported = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/gif', 'image/webp', 'image/tiff', 'image/heic'];
            if (!supported.includes(file.type)) throw new Error('不支持的图片格式: ' + (file.type || '未知'));

            // 2. 上传（附本地缩略图）
            const form = new FormData();
            form.append('file', file);
            if (global.PxThumb) await global.PxThumb.attach(form, file);
            const res = await fetch(`${this.backendUrl()}/v1/image/upload-reference`, {
                method: 'POST',
                  headers: authHeaders(),
                body: form
            });
            // 3. 处理响应（服务器可能返回非 JSON 的 500 错误页）
            if (!res.ok) {
                let msg = '上传失败: ' + res.status;
                try {
                    const text = await res.text();
                    // 尝试从 HTML 错误页中提取有用信息
                    const m = text.match(/<pre>([\s\S]*?)<\/pre>/);
                    if (m) msg = m[1].trim();
                    else { const j = JSON.parse(text); if (j.msg) msg = j.msg; }
                } catch (_) { /* 响应不是 JSON */ }
                throw new Error(msg);
            }
            const data = await res.json();
            if (data.code === 0 && data.data) {
                const r = {
                    highUrl: data.data.originalUrl,
                    previewUrl: data.data.previewUrl,
                    mediumUrl: data.data.mediumUrl || data.data.previewUrl,
                    tempKey: data.data.tempKey
                };
                // 缩略图先进浏览器缓存再返回：节点从本地图切到云端缩略图时无闪烁
                if (global.PxThumb) await global.PxThumb.preload([r.previewUrl, r.mediumUrl]);
                return r;
            }
            throw new Error(data.msg || '上传失败');
        },

        // 上传视频/音频素材，返回 { url, mediaType, tempKey, size, duration }（失败抛错）
        // 上传上限：视频 MP4/MOV ≤200MB（H3 生成时另校验单段≤50MB），音频 MP3/WAV/M4A/AAC ≤15MB，每段≥2秒
        async uploadMediaRef(file) {
            const isVid = /^video\//.test(file.type || '');
            const isAud = /^audio\//.test(file.type || '');
            if (isVid) {
                if (['video/mp4', 'video/quicktime'].indexOf(file.type) === -1) throw new Error('视频仅支持 MP4 / MOV 格式');
                if (file.size > 200 * 1024 * 1024) throw new Error('视频大小不能超过200MB');
            } else if (isAud) {
                if (['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'].indexOf(file.type) === -1) throw new Error('音频仅支持 MP3 / WAV / M4A / AAC 格式');
                if (file.size > 15 * 1024 * 1024) throw new Error('音频大小不能超过15MB');
            } else {
                throw new Error('不支持的媒体格式: ' + (file.type || '未知'));
            }
            // 读取媒体时长（H3 要求每段≥2秒；读取失败或超时跳过不拦）
            const duration = await new Promise((resolve) => {
                const el = document.createElement(isVid ? 'video' : 'audio');
                const objUrl = URL.createObjectURL(file);
                let settled = false;
                const done = (v) => { if (settled) return; settled = true; URL.revokeObjectURL(objUrl); resolve(v); };
                el.preload = 'metadata';
                el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : 0);
                el.onerror = () => done(0);
                setTimeout(() => done(0), 8000);
                el.src = objUrl;
            });
            if (duration && duration < 2) throw new Error('参考素材时长至少 2 秒（当前约 ' + duration.toFixed(1) + ' 秒）');
            const form = new FormData();
            form.append('file', file);
            const res = await fetch(`${this.backendUrl()}/v1/media/upload`, {
                method: 'POST',
                headers: authHeaders(),
                body: form
            });
            if (!res.ok) {
                let msg = '上传失败: ' + res.status;
                try {
                    const text = await res.text();
                    const m = text.match(/<pre>([\s\S]*?)<\/pre>/);
                    if (m) msg = m[1].trim();
                    else { const j = JSON.parse(text); if (j.msg) msg = j.msg; }
                } catch (_) {}
                throw new Error(msg);
            }
            const data = await res.json();
            if (data.code === 0 && data.data) {
                return { url: data.data.url, mediaType: data.data.mediaType, tempKey: data.data.tempKey, size: file.size, duration: Math.round(duration * 10) / 10 };
            }
            throw new Error(data.msg || '上传失败');
        },

        // 入库素材库（部分视频模型的人物一致性需以素材 ID 引用），返回 { assetId, status }；失败抛错
        async ingestAsset(node) {
            const url = node.imageUrl || node.mediumUrl || node.previewUrl;
            if (!url) throw new Error('节点暂无图片，无法入库');
            const res = await fetch(`${this.backendUrl()}/v1/assets/ingest`, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({ url, label: String(node.name || '').slice(0, 100) })
            });
            if (!res.ok) {
                let msg = '入库失败: ' + res.status;
                try {
                    const text = await res.text();
                    const m = text.match(/<pre>([\s\S]*?)<\/pre>/);
                    if (m) msg = m[1].trim();
                    else { const j = JSON.parse(text); if (j.msg) msg = j.msg; }
                } catch (_) {}
                throw new Error(msg);
            }
            const data = await res.json();
            if (data.code === 0 && data.data) return data.data;
            throw new Error(data.msg || '入库失败');
        },

        // 查询素材库入库状态，返回 { assetId, status }（Active/Processing/Failed）
        async pollAssetStatus(assetId) {
            const res = await fetch(`${this.backendUrl()}/v1/assets/${encodeURIComponent(assetId)}/status`, { headers: authHeaders() });
            if (!res.ok) {
                let msg = '状态查询失败: ' + res.status;
                try { const j = await res.json(); if (j.msg) msg = j.msg; } catch (_) {}
                throw new Error(msg);
            }
            const data = await res.json();
            if (data.code === 0 && data.data) return data.data;
            throw new Error(data.msg || '状态查询失败');
        },

        _ratioToSize(ratio) {
            const map = {
                '1:1': [300, 360], '3:4': [280, 400], '4:3': [360, 320],
                '9:16': [260, 420], '16:9': [400, 300]
            };
            return map[ratio] || [300, 360];
        },

        // 视频模型上游素材校验（对齐 apiyi 文档）
        // 数量：2.5 图≤30/视频≤10/音频≤10；2.0 系与 H3 图≤9/视频≤3/音频≤3；H3 媒体合计≤12
        // H3 规格：单段视频≤50MB、多段视频累计≤15秒、每段≥2秒（上传时已拦）
        validateVideoRefs(model, nImg, nVid, nAud, vidMeta, audMeta) {
            const m = String(model || '');
            const isS25 = /seedance-2-5/i.test(m);
            const isH3 = /minimax-h3/i.test(m);
            // 上限优先取模型配置（特价线路），未配置按原有 id 规则
            const vc = (global.PromptBar && global.PromptBar.videoCaps) ? global.PromptBar.videoCaps(m) : null;
            const maxImg = vc ? vc.maxImages : (isS25 ? 30 : 9);
            const maxVid = vc ? vc.maxVideos : (isS25 ? 10 : 3);
            const maxAud = vc ? vc.maxAudios : (isS25 ? 10 : 3);
            if (nImg > maxImg) return `该模型最多支持 ${maxImg} 张参考图`;
            if (nVid > maxVid) return maxVid ? `该模型最多支持 ${maxVid} 段参考视频` : '该模型不支持参考视频';
            if (nAud > maxAud) return maxAud ? `该模型最多支持 ${maxAud} 段参考音频` : '该模型不支持参考音频';
            if (vc && vc.refVideoMaxTotalSec && vidMeta && vidMeta.length) {
                const vSum = vidMeta.reduce((s, v) => s + (v.duration || 0), 0);
                if (vSum > vc.refVideoMaxTotalSec + 0.05) return `该模型参考视频合计时长不能超过 ${vc.refVideoMaxTotalSec} 秒`;
            }
            if (isH3 && (nImg + nVid + nAud) > 12) return 'MiniMax-H3 参考素材合计不能超过 12 个';
            if (/seedance-2-0/i.test(m) && nAud > 0 && nImg === 0 && nVid === 0) return 'Seedance 2.0 的音频参考必须伴随至少一张图片或一段视频';
            if (isH3 && vidMeta && vidMeta.length) {
                let vTotal = 0;
                for (const v of vidMeta) {
                    if (v.size && v.size > 50 * 1024 * 1024) return 'MiniMax-H3 单段参考视频不能超过 50MB，请压缩后再试';
                    vTotal += v.duration || 0;
                }
                if (vTotal > 15) return 'MiniMax-H3 多段参考视频累计时长不能超过 15 秒';
            }
            if (isH3 && audMeta && audMeta.length) {
                let aTotal = 0;
                for (const a of audMeta) aTotal += a.duration || 0;
                if (aTotal > 15) return 'MiniMax-H3 参考音频累计时长不能超过 15 秒（超长部分上游只取前 15 秒）';
            }
            return '';
        },

        // 对某生成节点发起生成。可选传入 params（来自 PromptBar），否则从节点读取
        // 样片升级成片：params.upgradeFromDraft = { taskId: 样片任务id }（CanvasDraft 确认卡片发起）
        async runNode(nodeId, params) {
            const node = global.CanvasBlocks.getById(nodeId);
            if (!node || node.nodeType !== 'gen') return;
            // 防重入：生成中的节点不重复发起（双击/连击生成按钮会创建多个任务互相覆盖 taskId）
            if (node.status === 'generating') return;
            // 样片升级成片模式：上游 content 只引用样片任务（draft_task），不带参考素材/提示词注入
            const upgradeMode = !!(params && params.upgradeFromDraft);

            const userId = this.getUserId();
            if (!userId) {
                alert('请先登录后再使用画布生成');
                return;
            }

            const p = params || {
                baseUrl: '',
                prompt: (node.prompt || '').trim(),
                model: node.model,
                aspectRatio: node.aspectRatio,
                imageSize: node.size,
                imageUrls: global.CanvasEdges.getUpstreamImages(nodeId),
                api: 'auto'
            };
            // 收集上游视频/音频素材（媒体节点）；无论 params 是否外部传入都按连线实时重算
            if (!upgradeMode && global.CanvasEdges && global.CanvasEdges.getUpstreamMedia) {
                const media = global.CanvasEdges.getUpstreamMedia(nodeId);
                // 合并提示词 @ 引用的视频/音频（按 URL 去重：连线已含的不重复计入）
                const seenV = new Set(media.videos || []);
                ((p.promptVideoUrls) || []).forEach(v => { if (v && v.url && !seenV.has(v.url)) { seenV.add(v.url); media.videos.push(v.url); } });
                const seenA = new Set(media.audios || []);
                ((p.promptAudioUrls) || []).forEach(a => { if (a && a.url && !seenA.has(a.url)) { seenA.add(a.url); media.audios.push(a.url); } });
                p.videoUrls = media.videos || [];
                p.audioUrls = media.audios || [];
            }

            // 视频模型：补齐时长与分辨率（PromptBar 传入或节点保存值）
            const mcfg = (this.models || []).find(m => m.id === p.model);
            const isVideo = !!(mcfg && (mcfg.isVideo || mcfg._isVideo));
            if (isVideo && upgradeMode) {
                // 样片升级成片：分辨率强制 1080p，时长沿用样片（服务端按样片继承并重新校验/预扣）
                p.prompt = (p.prompt || (node.prompt || '')).trim();
                p.duration = parseInt(node.duration, 10) || 5;
                p.quality = '1080p';
                p.imageUrls = []; p.videoUrls = []; p.audioUrls = [];
            } else if (isVideo) {
                if (p.duration === undefined) p.duration = node.duration || 5;
                // 重试/重新生成等不带参数的调用：用节点保存的生成模式（否则首尾帧会被当成全能参考提交）
                if (!p.videoMode) p.videoMode = node.videoMode || 'reference';
                if (!p.quality) p.quality = node.resolution || (mcfg.supportedResolutions && mcfg.supportedResolutions[0]) || '720p';
                // 素材元数据（大小/时长，H3 校验用；旧节点缺省 0）
                let vidMeta = [], audMeta = [];
                const edgeVidUrls = new Set(), edgeAudUrls = new Set();
                if (global.CanvasEdges && global.CanvasEdges.edges) {
                    global.CanvasEdges.edges.filter(e => e.to === nodeId).forEach(e => {
                        const s = global.CanvasBlocks.getById(e.from);
                        if (!s || !s.mediaType) return;
                        ((s.mediaType === 'video') ? vidMeta : audMeta).push({ size: s.mediaSize || 0, duration: s.mediaDuration || s.duration || 0 });
                        ((s.mediaType === 'video') ? edgeVidUrls : edgeAudUrls).add(s.mediaUrl || (s.mediaType === 'video' ? s.videoUrl : ''));
                    });
                }
                // @ 引用但未连线的视频/音频：补元数据（H3 时长校验 / Seedance 计费用），按 URL 去重防重复计时
                ((p.promptVideoUrls) || []).forEach(v => { if (v && v.url && !edgeVidUrls.has(v.url)) { edgeVidUrls.add(v.url); vidMeta.push({ size: v.size || 0, duration: v.duration || 0 }); } });
                ((p.promptAudioUrls) || []).forEach(a => { if (a && a.url && !edgeAudUrls.has(a.url)) { edgeAudUrls.add(a.url); audMeta.push({ size: a.size || 0, duration: a.duration || 0 }); } });
                const vErr = this.validateVideoRefs(p.model, (p.imageUrls || []).length, (p.videoUrls || []).length, (p.audioUrls || []).length, vidMeta, audMeta);
                if (vErr) { alert(vErr); return; }
                // 生成模式校验：first_last=首尾帧（恰好 2 图、禁媒体参考）
                const vMode = p.videoMode || 'reference';
                if (vMode === 'first_last') {
                    const nFl = (p.imageUrls || []).length;
                    if (nFl < 1 || nFl > 2) { alert('首尾帧模式需要 1–2 张参考图（1 张为首帧，2 张为首帧 + 尾帧），当前已选 ' + nFl + ' 张'); return; }
                    if ((p.videoUrls || []).length || (p.audioUrls || []).length) { alert('首尾帧模式不支持视频/音频参考，请切换回全能参考模式'); return; }
                }
                // Seedance 含参考视频：参考视频按折算秒数计费（上游带视频输入 token 单价更低：2.5 为 0.60×，2.0 系 0.65×）
                // H3 走自部署通道，参考素材不计费；特价线路按配置 refVideoBillFactor（与 PromptBar 显示、服务端预扣同式）
                const _vc = (global.PromptBar && global.PromptBar.videoCaps) ? global.PromptBar.videoCaps(p.model) : null;
                const vk = _vc ? _vc.refVideoBillFactor : (/minimax-h3/i.test(p.model) ? 0 : (/seedance-?2[._-]?5|2\.5/i.test(String(p.model || '')) ? 0.6 : 0.65));
                if (vk > 0 && vidMeta.length && vidMeta.some(v => v.duration > 0)) {
                    const vidSec = vidMeta.reduce((s, v) => s + (v.duration || 0), 0);
                    const outSec = parseInt(p.duration, 10) || 0;
                    const billSec = Math.round(vidSec * vk + outSec);
                    if (billSec > outSec) p.billDuration = billSec;
                }
            }

            // 拼接上游文本节点内容：首部文本前插 + 尾部文本后插（升级成片只引用样片，不拼注入词）
            if (!upgradeMode && global.CanvasEdges && global.CanvasEdges.getUpstreamTexts) {
                const txts = global.CanvasEdges.getUpstreamTexts(nodeId);
                if (txts.prepend.length || txts.append.length) {
                    const parts = [];
                    if (txts.prepend.length) parts.push(txts.prepend.join(' '));
                    if (p.prompt) parts.push(p.prompt);
                    if (txts.append.length) parts.push(txts.append.join(' '));
                    p.prompt = parts.join(' ').trim();
                }
            }

            // 图片生成节点：最多 8 张参考图（视频任务由 validateVideoRefs 按模型校验）
            const isVideoRun = global.PromptBar && global.PromptBar._isVideoModel && global.PromptBar._isVideoModel(p.model);
            if (!isVideoRun && (p.imageUrls || []).length > 8) {
                alert('图片生成节点最多支持 8 张参考图');
                return;
            }

            // 参考图补全来源信息：PromptBar 传入的参考图只有 URL，按连线上游回填 srcId / assetId / 角色归属
            // （assetId 仅 Seedance 视频模型使用 asset:// 引用）
            const isSeedance = /seedance/i.test(String(p.model || ''));
            const upAll = (global.CanvasEdges && global.CanvasEdges.getUpstreamImages) ? global.CanvasEdges.getUpstreamImages(nodeId) : [];
            const upByUrl = new Map();
            upAll.forEach(u => { if (u && u.highUrl && !upByUrl.has(u.highUrl)) upByUrl.set(u.highUrl, u); });
            const charOf = [];
            p.imageUrls = (p.imageUrls || []).map((im, i) => {
                const u = im && upByUrl.get(im.highUrl);
                charOf[i] = (u && u.charId) || '';
                if (!u) return im;
                const out = Object.assign({}, im, { srcId: im.srcId || u.srcId });
                delete out.charId;
                if (isSeedance && u.assetId) out.assetId = u.assetId;
                else if (u.charId) delete out.assetId;
                return out;
            });
            // 角色节点：提示词前注入角色描述（不写回节点 prompt，只在提交时拼接）
            if (!upgradeMode && global.CharacterLib && global.CharacterLib.buildPromptInjection) {
                // 用户提示词里的角色 chip token / 「@角色名」→「角色【名称】」：不把 @ 或内部 token 发给模型
                if (p.prompt && global.CharacterLib.resolvePromptTokens) p.prompt = global.CharacterLib.resolvePromptTokens(p.prompt, nodeId);
                const inj = global.CharacterLib.buildPromptInjection(nodeId, charOf);
                if (inj) p.prompt = (inj + (p.prompt ? '\n' + p.prompt : '')).trim();
            }
            // 导演台镜头：场景参考图按其在最终提交 imageUrls 中的实际编号引用（与角色注入同一套编号；只在提交时拼接，不写回节点）
            if (!upgradeMode && global.CanvasDirector && global.CanvasDirector.sceneRefInfo) {
                const sr = global.CanvasDirector.sceneRefInfo(nodeId);
                const k = sr ? (p.imageUrls || []).findIndex(im => im && im.srcId === sr.refNodeId) : -1;
                if (sr && k !== -1) {
                    const line = `将[图片${k + 1}]中的场景定义为<场景${sr.no}>。`;
                    p.prompt = (line + (p.prompt ? '\n' + p.prompt : '')).trim();
                }
            }
            // _FRAMES_20261029 导演台分镜图节点：3D 构图图 / 场景参考图按实际编号说明用途（只在提交时拼接，不写回节点）
            if (!upgradeMode && global.CanvasDirector && global.CanvasDirector.frameRefLines) {
                const fl = global.CanvasDirector.frameRefLines(nodeId, p.imageUrls || []);
                if (fl) p.prompt = ((p.prompt ? p.prompt + '\n' : '') + fl).trim();
            }

            // 图片任务画质 / MJ 参数（原先只有视频任务带 quality，GPT 画质选择被服务端按 medium 计费与生成）
            // 仅对配置了 qualityOptions 的模型提交 quality，其余模型服务端按 medium 计价，与 PromptBar 价格显示一致
            const imgExtra = {};
            if (!isVideo) {
                // 模型配置以 PromptBar.modelConfigMap 为准（与价格显示同源；this.models 只含 frontend.models）
                const qcfg = (global.PromptBar && global.PromptBar.modelConfigMap && global.PromptBar.modelConfigMap[p.model]) || mcfg;
                const qOpts = (qcfg && Array.isArray(qcfg.qualityOptions)) ? qcfg.qualityOptions : [];
                if (qOpts.length) {
                    let q = p.quality || node.quality;
                    if (qOpts.indexOf(q) === -1) q = qOpts.indexOf('medium') !== -1 ? 'medium' : qOpts[0];
                    imgExtra.quality = q;
                    if (node.quality !== q) node.quality = q;
                }
                if (String(p.model || '').startsWith('mj-')) {
                    const mj = p.mjParams || node.mjParams;
                    if (mj && typeof mj === 'object') { imgExtra.mjParams = mj; node.mjParams = mj; }
                }
            }

            // 360 全景 / 角色多视角：提交时拼接模板（不写回节点提示词），全景比例锁定 2:1
            if (!upgradeMode && global.CanvasPano && global.CanvasPano.applyToParams(node, p) === false) return;

            if (!upgradeMode && !p.prompt && (!p.imageUrls || p.imageUrls.length === 0)) {
                alert('请填写提示词，或连入至少一张参考图');
                return;
            }

            if (global.GenHistory) global.GenHistory.beforeRun(node, p);
            global.CanvasBlocks.update(nodeId, { status: 'generating', taskId: '', errorMsg: '', genStartedAt: Date.now() });

            // 兜底：task-client.js 加载失败（网络 reset 等）时给友好提示
            if (typeof TaskClient === 'undefined') {
                alert('任务服务加载失败，请刷新页面后重试（task-client.js 未加载）');
                global.CanvasBlocks.update(nodeId, { status: 'failed' });
                return;
            }

            try {
                // 视频任务附加参数：普通/样片=时长+分辨率+参考素材+计费秒；样片升级成片=仅引用样片任务（1080p，其余参数上游按文档继承样片）
                const videoExtra = isVideo
                    ? (upgradeMode
                        ? { duration: p.duration, quality: '1080p', upgradeFromDraft: p.upgradeFromDraft }
                        : Object.assign({
                            duration: p.duration, quality: p.quality, videoUrls: p.videoUrls, audioUrls: p.audioUrls,
                            billDuration: p.billDuration, videoMode: p.videoMode || 'reference'
                        }, p.draft ? { draft: true } : {}))
                    : imgExtra;
                const task = await TaskClient.createTask(Object.assign({
                    baseUrl: p.baseUrl || '',
                    prompt: p.prompt,
                    model: p.model,
                    aspectRatio: p.aspectRatio,
                    imageSize: p.imageSize,
                    imageUrls: p.imageUrls,
                    api: p.api || 'auto',
                    nodeId: nodeId  // 画布任务关联节点ID，用于刷新后重建 _taskNodeMap
                }, videoExtra), { source: 'canvas' });
                this._taskNodeMap[task.id] = nodeId;
                if (global.CharacterLib && global.CharacterLib.markUsed) global.CharacterLib.markUsed(charOf);
                // taskId 持久化保存到节点自身：不再仅依赖易失的本地活跃任务列表 / 内存映射，
                // 刷新页面、清缓存、长时间搁置后都能凭节点自带的 taskId 直接查询真实状态
                global.CanvasBlocks.update(nodeId, { taskId: task.id });
            } catch (e) {
                console.error('[画布] 创建任务失败:', e);
                // 记录失败原因（节点悬停提示 / 导演台据此区分「任务数已满」「积分不足」等）
                global.CanvasBlocks.update(nodeId, { status: 'failed', errorMsg: String((e && e.message) || '').slice(0, 1200) });
            }
            if (global.CanvasStore) global.CanvasStore.saveNow();
        },

        _listenTasks() {
            window.addEventListener('taskStatusUpdated', (e) => {
                const task = e.detail;
                if (!task) return;
                // 仅处理画布任务，主页任务由主页处理
                if (task.source && task.source !== 'canvas') return;
                // 优先用 _taskNodeMap，丢失时从 task.params.nodeId 兜底（防止 createTask 响应丢失导致映射缺失）
                let nodeId = this._taskNodeMap[task.id];
                if (!nodeId && task.params && task.params.nodeId) {
                    nodeId = task.params.nodeId;
                    this._taskNodeMap[task.id] = nodeId;  // 重建映射
                }
                if (!nodeId) return;

                // 防旧任务写回：节点已发起新一轮生成（taskId 变更）时，忽略旧任务的结果
                const blk = global.CanvasBlocks.getById(nodeId);
                if (!blk) return;
                if (blk.taskId && blk.taskId !== task.id) return;

                if (task.status === 'completed') {
                    // 结果回填（视频/音频/图片）统一走 applyTaskResult，与刷新恢复路径一致
                    if (this.applyTaskResult(nodeId, task.result)) {
                        delete this._taskNodeMap[task.id];
                        // 样片/成片元数据写回节点（样片完成→draftAt/上游id；成片完成→徽标与按钮退场）
                        this._applyDraftMeta(nodeId, task);
                        if (global.GenHistory) global.GenHistory.record(nodeId);
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.saveNow();
                    } else {
                        // completed 但无 url：视为失败，避免卡在 generating
                        global.CanvasBlocks.update(nodeId, { status: 'failed', taskId: '' });
                        delete this._taskNodeMap[task.id];
                        if (global.CanvasStore) global.CanvasStore.saveNow();
                    }
                } else if (task.status === 'failed') {
                    const why = task.error || task.errorMessage || task.message || (task.result && task.result.error) || '';
                    global.CanvasBlocks.update(nodeId, { status: 'failed', taskId: '', errorMsg: typeof why === 'string' ? why.slice(0, 1200) : '' });
                    delete this._taskNodeMap[task.id];
                    if (global.CanvasStore) global.CanvasStore.saveNow();
                }
            });
        },

        // 样片/成片任务完成后的节点元数据写回（CanvasDraft 徽标/升级按钮/倒计时依据）
        // 样片完成：draft=true + draftAt（7 天倒计时起点）+ draftTaskId（站内任务）+ draftUpstreamId（上游 cgt id）
        // 成片完成：清除样片标记（genHistory 已保留样片与成片两个版本，可切换）
        _applyDraftMeta(nodeId, task) {
            const CB = global.CanvasBlocks;
            const node = CB && CB.getById(nodeId);
            if (!node || !task || !task.params) return;
            const tp = task.params;
            if (tp.upgradeFromDraft) {
                CB.update(nodeId, { draft: false, draftTaskId: '', draftAt: 0, draftUpstreamId: '', draftBillSec: 0 });
            } else if (tp.draft) {
                const r = task.result || {};
                CB.update(nodeId, {
                    draft: true,
                    draftAt: Date.now(),
                    draftTaskId: task.id,
                    draftUpstreamId: r.upstreamTaskId || node.draftUpstreamId || '',
                    draftBillSec: parseInt(tp.billDuration, 10) || parseInt(tp.duration, 10) || node.duration || 5
                });
            } else if (node.draft || node.draftTaskId) {
                // 普通（非样片）生成完成：必须清掉样片标记，否则切模型/重新生成后节点仍残留「样片」徽标与升级按钮
                CB.update(nodeId, { draft: false, draftTaskId: '', draftAt: 0, draftUpstreamId: '', draftBillSec: 0 });
            }
        },

        // 把已完成任务的结果回填到生成节点（实时事件 / 刷新恢复 / 卡死兜底三条路径共用）
        // 视频：videoUrl 或 mediaType==='video'；音频：audioUrl 或 mediaType==='audio'；其余按图片处理
        // 返回 'video' | 'audio' | 'image'；无可识别结果返回 ''（由调用方标失败）
        applyTaskResult(nodeId, result) {
            const r = result || {};
            const CB = global.CanvasBlocks;
            const isVideo = r.mediaType === 'video' || !!r.videoUrl;
            const isAudio = !isVideo && (r.mediaType === 'audio' || !!r.audioUrl);
            if (isVideo) {
                const vUrl = r.videoUrl || r.imageUrl || r.originalUrl || r.url;
                if (!vUrl) return '';
                // 视频结果：地址原样使用，不做图片缩放处理
                CB.update(nodeId, { videoUrl: vUrl, imageUrl: vUrl, previewUrl: vUrl, mediumUrl: vUrl, mediaType: 'video', status: 'done', taskId: '' });
                // 用结果 URL 入队生成预览版（画布内播放用）
                if (global.VideoProxy) global.VideoProxy.enqueue(nodeId, vUrl);
                return 'video';
            }
            if (isAudio) {
                const aUrl = r.audioUrl || r.url || r.imageUrl;
                if (!aUrl) return '';
                CB.update(nodeId, { mediaUrl: aUrl, mediaType: 'audio', status: 'done', taskId: '' });
                return 'audio';
            }
            const { url, thumb } = this._extractResultUrls(r);
            if (!url) return '';
            // 画布预览图：TOS 动态缩放至 800px 长边（原图大、缩略图太小）
            const mediumUrl = url.includes('x-tos-process') || (!url.includes('tos-cn') && !url.includes('/api/img'))
                ? thumb
                : `${url}${url.includes('?') ? '&' : '?'}x-tos-process=image/resize,l_800,m_lfit`;
            CB.update(nodeId, { imageUrl: url, previewUrl: thumb, mediumUrl: mediumUrl, status: 'done', taskId: '' });
            return 'image';
        },

        // 从 result 对象中尽量全面地提取原图/缩略图 URL，避免因字段名不匹配而把成功任务误判为失败
        _extractResultUrls(result) {
            if (!result) return { url: null, thumb: null };
            const url = result.imageUrl || result.originalUrl || result.url || result.image ||
                result.outputUrl || result.output || (result.images && result.images[0]);
            const thumb = result.thumbnailUrl || result.thumb || result.thumbnail ||
                result.previewUrl || result.preview || url;
            return { url: url || null, thumb: thumb || null };
        },

        // 页面加载/刷新后，针对每个仍处于 generating 但缺失有效映射的节点，
        // 直接用节点自身持久化保存的 taskId 向后端查询真实状态（不依赖易失的本地活跃任务列表）。
        // 这样即使放置很久、本地缓存被清、任务已从活跃列表移除，只要服务端任务记录还没被清理，
        // 依然能查到真实结果，避免节点永久卡死在"生成中"。
        async recoverStuckNodes() {
            if (typeof TaskClient === 'undefined' || !global.CanvasBlocks) return;
            const stuck = global.CanvasBlocks.blocks.filter(b =>
                b.nodeType === 'gen' && b.status === 'generating'
            );
            if (stuck.length === 0) return;
            // generating 但无 taskId：任务从未创建成功（中断于 createTask 前），无法恢复，直接标失败
            const noTask = stuck.filter(b => !b.taskId);
            noTask.forEach(b => {
                global.CanvasBlocks.update(b.id, { status: 'failed', error: '生成任务创建中断' });
            });
            const withTask = stuck.filter(b => b.taskId);
            if (withTask.length === 0) {
                if (noTask.length && global.CanvasStore) global.CanvasStore.saveNow();
                return;
            }

            // 对每个带 taskId 的节点，最多重试 3 次（间隔 2s），避免因任务刚创建/网络抖动查不到就误判失败
            const retryCount = 3;
            const retryDelay = 2000;
            const pending = [...withTask];
            const resolved = new Set();

            for (let attempt = 0; attempt < retryCount && pending.length > 0; attempt++) {
                const roundTasks = pending.slice();
                for (const node of roundTasks) {
                    try {
                        const task = await TaskClient.getTaskStatus(node.taskId);
                        if (!task) {
                            // 查不到任务：继续等下一轮（可能刚创建还没入库、或后端短暂不可用），不轻易标失败
                            continue;
                        }
                        if (task.status === 'completed') {
                            // 原实现视频结果只有 videoUrl 时 _extractResultUrls 取不到 url → 误标失败；改用统一回填
                            if (this.applyTaskResult(node.id, task.result)) {
                                this._applyDraftMeta(node.id, task);
                                if (global.GenHistory) global.GenHistory.record(node.id);
                            } else {
                                // completed 但确实没有任何可识别的结果字段：标失败
                                global.CanvasBlocks.update(node.id, { status: 'failed', taskId: '' });
                            }
                            resolved.add(node.id);
                        } else if (task.status === 'failed') {
                            global.CanvasBlocks.update(node.id, { status: 'failed', taskId: '' });
                            resolved.add(node.id);
                        } else {
                            // 仍在排队/运行中：重建内存映射 + 补回本地活跃任务列表，让轮询继续追踪
                            this._taskNodeMap[node.taskId] = node.id;
                            if (TaskClient.addActiveTask) TaskClient.addActiveTask(node.taskId, 'canvas');
                            TaskClient.startPolling();
                            resolved.add(node.id);
                        }
                    } catch (e) {
                        console.warn('[画布] 查询节点任务状态失败:', node.id, node.taskId, e);
                    }
                }
                // 移除此轮已解决的节点
                for (let i = pending.length - 1; i >= 0; i--) {
                    if (resolved.has(pending[i].id)) pending.splice(i, 1);
                }
                if (pending.length > 0 && attempt < retryCount - 1) {
                    await new Promise(r => setTimeout(r, retryDelay));
                }
            }

            // 三轮都查不到的：明确返回 404（任务已不存在且无历史结果）才标失败；网络/服务异常仍保持生成中，下次刷新再查
            for (const node of pending) {
                if (await this._confirmTaskGone(node.taskId)) {
                    global.CanvasBlocks.update(node.id, { status: 'failed', taskId: '', errorMsg: '任务已结束但未找到结果（可能生成失败），请重试' });
                }
            }
            if (global.CanvasStore) global.CanvasStore.saveNow();
        },

        async _confirmTaskGone(taskId) {
            try {
                const res = await fetch(`${API_CONFIG.baseUrl}/api/tasks/${taskId}`, { headers: TaskClient.getAuthHeaders() });
                return res.status === 404;
            } catch (_) { return false; }
        }
    };

    global.CanvasGenerate = CanvasGenerate;
})(window);
