/**
 * canvas-edges.js
 * 连线系统：SVG 贝塞尔曲线，表示节点数据流（参考图/上游生成图 → 生成节点输入）
 * 规则：
 *   - 从「输出端口」拖出，落到生成节点的「输入端口」（或生成节点本体）建立连线
 *   - 生成时收集所有「连入边」的上游节点图片作为 imageUrls
 *   - 上游若是生成节点：只取其「输出成品图」，不向下传递它自己连入的参考图
 * 连线层在世界容器内，跟随平移缩放
 */
(function (global) {
    'use strict';

    const SVGNS = 'http://www.w3.org/2000/svg';

    const CanvasEdges = {
        edges: [],          // { id, from, to }  from=上游输出, to=生成节点输入
        layerEl: null,
        _idSeq: 0,
        _pending: null,

        init() {
            this.layerEl = document.getElementById('edgesLayer');
            // 临时虚线层（拖线中）：在节点之上，虚线不被途经节点遮挡
            this.tempLayerEl = document.getElementById('edgesTempLayer') || this.layerEl;
            // 连线主体随 world 自动跟随；剪刀按钮需要额外同步反向缩放，保持固定像素大小。
            if (global.CanvasCore && global.CanvasCore.onTransform) {
                global.CanvasCore.onTransform(() => {
                    this.edges.forEach(edge => {
                        if (edge._hovered || (edge._groupEl && edge._groupEl.classList.contains("cut-visible"))) {
                            this._positionCutControl(edge);
                        }
                    });
                });
            }
            if (global.CanvasCore && global.CanvasCore.onTransform) {
                global.CanvasCore.onTransform(() => {
                    if (this._updateDensityMode()) this.refresh();
                });
            }
            // path d 基于节点世界坐标计算，只在节点位置变化时需要 refresh（由拖动方调用）
            this._bindPortDrag();
            this._startCometLoop();
        },

        genId() {
            return 'edge_' + Date.now() + '_' + (this._idSeq++);
        },

        // 彗星拖尾用多段短线模拟头亮尾暗，无需 defs 渐变定义（保留占位以兼容旧调用）
        _ensureEdgeCometGrad(edgeId) {},
        _removeEdgeCometGrad(edgeId) {},

        // 建立连线：to 必须是 gen 节点，或 edited 节点（仅 force=true 时允许程序化连入）
        // 成环检测：从 toId 沿现有连线方向（from→to）做广度优先遍历，若能到达 fromId，则新增 fromId→toId 会构成环
        _wouldCreateCycle(fromId, toId) {
            if (fromId === toId) return true;
            const visited = new Set([toId]);
            const queue = [toId];
            while (queue.length) {
                const cur = queue.shift();
                for (const e of this.edges) {
                    if (e.from === cur && !visited.has(e.to)) {
                        if (e.to === fromId) return true;
                        visited.add(e.to);
                        queue.push(e.to);
                    }
                }
            }
            return false;
        },
        _toast(msg) {
            if (global.CanvasMain && typeof global.CanvasMain.toast === 'function') global.CanvasMain.toast(msg);
            else if (typeof alert === 'function') alert(msg);
        },

        add(fromId, toId, force) {
            this._lastAddError = null;
            if (fromId === toId) return null;
            const to = global.CanvasBlocks.getById(toId);
            if (!to) return null;
            // 生成节点：可被任意连入
            // 编辑图片节点(subType='edited')：仅允许 force（程序化编辑流程）连入，拒绝手动连入
            // 其他 ref 节点：不允许被连入
            if (to.nodeType === 'gen') {
                // 每个生成节点最多连接 1 个文本节点
                const fromB = global.CanvasBlocks.getById(fromId);
                if (fromB && fromB.nodeType === 'text' && this.edges.some(x => x.to === toId && x.from !== fromId && (global.CanvasBlocks.getById(x.from) || {}).nodeType === 'text')) {
                    this._lastAddError = '每个节点最多连接一个文本节点';
                    this._toast(this._lastAddError);
                    return null;
                }
                // 参考图数量上限：已连入图片类来源达到上限则拒绝（文本来源不占名额）
                const linkErr = this._canConnectTo(fromId, toId);
                if (linkErr) {
                    this._lastAddError = linkErr;
                    this._toast(linkErr);
                    return null;
                }
                const max = this._getMaxImagesForNode(to);
                if (this._countImageInputs(toId) >= max) {
                    // 素材已满：明确提示（原先静默失败）
                    const from = global.CanvasBlocks.getById(fromId);
                    const isMedia = from && from.nodeType === 'ref' && (from.mediaType === 'video' || from.mediaType === 'audio');
                    if (!isMedia) {
                        this._lastAddError = `素材已满：该节点最多 ${max} 张参考图`;
                        this._toast(this._lastAddError);
                        return null;
                    }
                }
            } else if (to.subType === 'edited' && force) {
                // ok - 程序化连入
            } else {
                return null;
            }
            if (this.edges.some(e => e.from === fromId && e.to === toId)) return null;
            // 成环检测：若从 toId 沿现有连线方向能回到 fromId，则新连线会构成环，拒绝
            if (!force && this._wouldCreateCycle(fromId, toId)) {
                if (global.CanvasMain && typeof global.CanvasMain.toast === 'function') {
                    global.CanvasMain.toast('不能形成环形连线');
                } else if (typeof alert === 'function') {
                    alert('不能形成环形连线');
                }
                return null;
            }
            const edge = { id: this.genId(), from: fromId, to: toId };
            this.edges.push(edge);
            // 角色节点连入：展开的参考图超出上限时提示截断张数
            const fromNode = global.CanvasBlocks.getById(fromId);
            if (to.nodeType === 'gen' && fromNode && fromNode.subType === 'character' && global.CharacterLib) {
                this.getUpstreamImages(toId);
                const tr = (this._charTrunc[toId] || []).find(t => t.name === (fromNode.name || ''));
                if (tr) this._toast(global.CharacterLib.truncMsg(tr.used));
            }
            this.refresh();
            if (global.CanvasMain && global.CanvasMain.onEdgesChange) global.CanvasMain.onEdgesChange();
            return edge;
        },

        remove(id) {
            const idx = this.edges.findIndex(e => e.id === id);
            if (idx === -1) return;
            const removed = this.edges[idx];
            this.edges.splice(idx, 1);
            // 移除整个分组（含 hit + path）
              if (removed._hoverTimer) clearTimeout(removed._hoverTimer);
            const g = this.layerEl.querySelector(`[data-edge-group="${id}"]`);
            if (g) g.remove();
            // 清理该边独立的彗星渐变定义
            this._removeEdgeCometGrad(id);
            if (this._selectedEdgeId === id) this._selectedEdgeId = null;
            // 编辑图片节点：任何连线被断开后降级为普通参考图节点（清除 subType，可被正常连接）
            [removed.from, removed.to].forEach(nodeId => {
                const n = global.CanvasBlocks.getById(nodeId);
                if (n && n.subType === 'edited') {
                    delete n.subType;
                    if (global.CanvasBlocks) global.CanvasBlocks._render(n);
                }
            });
            if (global.CanvasMain && global.CanvasMain.onEdgesChange) global.CanvasMain.onEdgesChange();
        },

        removeByBlock(blockId) {
            // 记录受影响的 edited 节点（与被删除节点相连的另一端）
            const affectedEdited = new Set();
            this.edges.forEach(e => {
                if (e.from === blockId || e.to === blockId) {
                    const otherId = e.from === blockId ? e.to : e.from;
                    const other = global.CanvasBlocks.getById(otherId);
                    if (other && other.subType === 'edited') affectedEdited.add(otherId);
                }
            });
            const removedIds = [];
            this.edges = this.edges.filter(e => {
                if (e.from === blockId || e.to === blockId) {
                    removedIds.push(e.id);
                    return false;
                }
                return true;
            });
            removedIds.forEach(id => {
                const g = this.layerEl.querySelector(`[data-edge-group="${id}"]`);
                if (g) g.remove();
            });
            if (this._selectedEdgeId && removedIds.includes(this._selectedEdgeId)) this._selectedEdgeId = null;
            // 受影响的 edited 节点降级为普通参考图节点
            affectedEdited.forEach(sid => {
                const n = global.CanvasBlocks.getById(sid);
                if (n && n.subType === 'edited') {
                    delete n.subType;
                    if (global.CanvasBlocks) global.CanvasBlocks._render(n);
                }
            });
            if (global.CanvasMain && global.CanvasMain.onEdgesChange) global.CanvasMain.onEdgesChange();
        },

        // 收集某生成节点所有上游图片：{ highUrl, previewUrl }
        // 角色节点（ref + subType:'character'）展开为该角色的全部参考图（按 role 优先级，选中造型时造型图优先），
        // 并按生成节点参考图上限截断：普通图片优先占位，剩余名额按连线顺序分给角色；截断信息记在 _charTrunc[genNodeId]
        getUpstreamImages(genNodeId) {
            const out = [];
            const gen = global.CanvasBlocks.getById(genNodeId);
            const CL = global.CharacterLib;
            const ins = this.edges.filter(e => e.to === genNodeId).map(e => global.CanvasBlocks.getById(e.from)).filter(Boolean);
            const isChar = (s) => !!(CL && s.subType === 'character' && s.nodeType === 'ref');
            const max = gen && gen.nodeType === 'gen' ? this._getMaxImagesForNode(gen) : Infinity;
            const plainCount = ins.filter(s => !isChar(s) && s.mediaType !== 'video' && s.imageUrl).length;
            let budget = Math.max(0, max - plainCount);
            const trunc = [];
            const seedance = gen && /seedance/i.test(String(gen.model || ''));
            ins.forEach(src => {
                // 视频节点不能作为图片参考（mp4 非图片，上游接口会拒绝）
                if (src.mediaType === 'video') return;
                if (isChar(src)) {
                    const refs = CL.expandRefs(src);
                    const take = refs.slice(0, budget);
                    budget -= take.length;
                    if (take.length < refs.length) trunc.push({ name: src.name || '', used: take.length, total: refs.length });
                    const asset = (seedance && !CL.assetIdFor) ? CL.assetFor(src) : null;
                    // 角色库存的是站内相对地址（/api/img?...）：补全为绝对地址，与普通参考图节点的 highUrl 形态一致
                    const abs = (u) => (typeof u === 'string' && /^\/api\/img[/?]/.test(u) && global.location && /^https?:/.test(global.location.origin || '')) ? global.location.origin + u : u;
                    take.forEach(r => {
                        // Seedance：每张参考图（含造型图）各自用自己的素材 ID（asset://）引用；未入库的图走普通 url
                        const aid = !seedance ? '' : (CL.assetIdFor ? CL.assetIdFor(src, r.url) : ((asset && asset.url === r.url) ? asset.assetId : ''));
                        out.push({ highUrl: abs(r.url), previewUrl: r.previewUrl || r.url, srcId: src.id, assetId: aid, charId: src.id });
                    });
                    return;
                }
                // ref 节点 → 参考图；gen 节点 → 只取其输出成品图
                const high = src.imageUrl;
                const prev = src.previewUrl || src.imageUrl;
                if (high) out.push({ highUrl: high, previewUrl: prev, srcId: src.id, assetId: src.assetId || '' });
            });
            if (!this._charTrunc) this._charTrunc = {};
            this._charTrunc[genNodeId] = trunc;
            // 应用用户在提示词区域拖拽调整过的参考图顺序（refOrder 存 srcId|highUrl）：
            // 之前重排只改了提示词区本地数组，重新选中节点会被连线顺序覆盖，看起来"又变回去了"
            if (gen && Array.isArray(gen.refOrder) && gen.refOrder.length) {
                const rk = (o) => o.srcId ? (o.srcId + '|' + (o.highUrl || '')) : (o.highUrl || '');
                const idx = new Map();
                gen.refOrder.forEach((k, i) => { if (typeof k === 'string' && !idx.has(k)) idx.set(k, i); });
                out.sort((a, b) => {
                    const ia = idx.has(rk(a)) ? idx.get(rk(a)) : 1e9;
                    const ib = idx.has(rk(b)) ? idx.get(rk(b)) : 1e9;
                    return ia - ib;
                });
            }
            return out;
        },

        // 收集某生成节点所有上游视频/音频素材（媒体节点，不占参考图名额）：{ videos:[url], audios:[url] }
        getUpstreamMedia(genNodeId) {
            const videos = [], audios = [];
            this.edges.filter(e => e.to === genNodeId).forEach(e => {
                const src = global.CanvasBlocks.getById(e.from);
                if (!src) return;
                // 视频生成节点的产物视频：作为参考视频（原先既不计图片也不计媒体，被静默丢弃）
                if (src.nodeType === 'gen' && src.videoUrl && (src.genCategory || '') === 'video') { videos.push(src.videoUrl); return; }
                if (!src.mediaType) return;
                const u = src.mediaUrl || (src.mediaType === 'video' ? src.videoUrl : '');
                if (!u) return;
                if (src.mediaType === 'video') videos.push(u);
                else if (src.mediaType === 'audio') audios.push(u);
            });
            return { videos, audios };
        },

        // 收集某生成节点所有上游文本节点内容：按 insertPos 分别返回前插/后插文本
        // 返回 { prepend: [String], append: [String] }
        getUpstreamTexts(genNodeId) {
            const prepend = [], append = [];
            this.edges.filter(e => e.to === genNodeId).forEach(e => {
                const src = global.CanvasBlocks.getById(e.from);
                if (!src || src.nodeType !== 'text') return;
                const text = (src.text || '').trim();
                if (!text) return;
                if (src.insertPos === 'tail') append.push(text);
                else prepend.push(text);
            });
            return { prepend, append };
        },

        // 贝塞尔 path：从节点右边缘 → 到节点左边缘（线条直接连上节点，端口作为外侧手柄）
        _pathBetween(from, to) {
            const x1 = from.x + from.w, y1 = from.y + from.h / 2;
            const x2 = to.x, y2 = to.y + to.h / 2;
            // 短线沿用原始弧度；距离变长后，控制柄最多放大到原来的 1.5 倍。
            const dx = x2 - x1;
            const dy = y2 - y1;
            const distance = Math.hypot(dx, dy);
            const baseCurve = Math.min(120, Math.max(40, Math.abs(dx) * 0.3));
            const longRatio = Math.min(1, Math.max(0, (distance - 220) / 780));
            const direction = dx >= 0 ? 1 : -1;
            const curve = baseCurve * (1 + 0.5 * longRatio);
            return {
                d: `M ${x1} ${y1} C ${x1 + direction * curve} ${y1}, ${x2 - direction * curve} ${y2}, ${x2} ${y2}`,
                x1, y1, x2, y2
            };
        },

        refresh(ids) {
            this._updateDensityMode();
            // 拖动时(ids 不为空)同步执行：连线必须立即跟随节点，不能延迟一帧
            // 非拖动时 rAF 节流：合并 onTransform 等多次调用
            if (ids) {
                this._refreshScheduled = false;
                this._doRefresh(ids);
                return;
            }
            if (this._refreshScheduled) return;
            this._refreshScheduled = true;
            requestAnimationFrame(() => {
                this._refreshScheduled = false;
                this._doRefresh();
            });
        },

        _doRefresh(ids) {
            const selectedNodeIds = global.CanvasSelection ? new Set(global.CanvasSelection.getSelectedIds()) : new Set();
              const blockMap = new Map(global.CanvasBlocks.blocks.map(block => [block.id, block]));
            this.edges.forEach(edge => {
                  const from = blockMap.get(edge.from);
                  const to = blockMap.get(edge.to);
                if (!from || !to) return;
                const pb = this._pathBetween(from, to);
                const d = pb.d;
                // 缓存 DOM 引用，避免每帧 querySelector
                let groupEl = edge._groupEl;
                if (!groupEl || !groupEl.parentNode) {
                    groupEl = this.layerEl.querySelector(`[data-edge-group="${edge.id}"]`);
                    if (!groupEl) {
                        groupEl = document.createElementNS(SVGNS, 'g');
                        groupEl.classList.add('edge-group');
                        groupEl.dataset.edgeGroup = edge.id;

                        const hitEl = document.createElementNS(SVGNS, 'path');
                        hitEl.classList.add('edge-hit');
                        hitEl.dataset.edgeId = edge.id;

                        const pathEl = document.createElementNS(SVGNS, 'path');
                        pathEl.classList.add('edge-path');
                        pathEl.dataset.edgeId = edge.id;
                        pathEl.setAttribute('d', d);

                        groupEl.appendChild(hitEl);
                        groupEl.appendChild(pathEl);

                        const cometsG = document.createElementNS(SVGNS, 'g');
                        cometsG.classList.add('edge-comets');
                        groupEl.appendChild(cometsG);
                          const cutEl = document.createElementNS(SVGNS, "g");
                          cutEl.classList.add("edge-cut-control");
                          const cutBg = document.createElementNS(SVGNS, "circle");
                          cutBg.classList.add("edge-cut-bg");
                          cutBg.setAttribute("r", "18");
                          const cutIcon = document.createElementNS(SVGNS, "path");
                          cutIcon.classList.add("edge-cut-icon");
                          cutIcon.setAttribute("d", "M-2 -2 L9 9 M-2 2 L9 -9 M-5 -5 A3 3 0 1 0 -5 -4.99 M-5 5 A3 3 0 1 0 -5 5.01");
                          cutEl.appendChild(cutBg);
                          cutEl.appendChild(cutIcon);
                          cutEl.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
                          cutEl.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.remove(edge.id); });
                          groupEl.appendChild(cutEl);
                          edge._cutEl = cutEl;

                        groupEl.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (global.CanvasMain) global.CanvasMain.showEdgeMenu(edge.id, e.clientX, e.clientY);
                        });
                        groupEl.addEventListener('mousedown', (e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            this.selectEdge(edge.id);
                        });

                                                  groupEl.addEventListener("mouseenter", (e) => {
                              edge._hoverClient = { x: e.clientX, y: e.clientY };
                              if (this.layerEl && this.layerEl.classList.contains("boxing")) return;
                              edge._hovered = true; groupEl.classList.add("hover-animated");
                              if (edge._hoverTimer) clearTimeout(edge._hoverTimer);
                              this._syncActiveState();
                              this._positionCutControl(edge);
                              edge._hoverTimer = setTimeout(() => {
                                  this._positionCutControl(edge);
                                  if (edge._hovered && edge._groupEl === groupEl && groupEl.isConnected) groupEl.classList.add("cut-visible");
                              }, 500);
                          });
                          groupEl.addEventListener("mousemove", (e) => {
                              edge._hoverClient = { x: e.clientX, y: e.clientY };
                              if (!groupEl.classList.contains("cut-visible")) this._positionCutControl(edge);
                          });

                          groupEl.addEventListener("mouseleave", () => {
                              edge._hovered = false; groupEl.classList.remove("hover-animated");
                              if (edge._hoverTimer) { clearTimeout(edge._hoverTimer); edge._hoverTimer = null; }
                              groupEl.classList.remove("cut-visible");
                              this._syncActiveState();
                          });

this.layerEl.appendChild(groupEl);
                        edge._groupEl = groupEl;
                        edge._pathEl = groupEl.querySelector('.edge-path');
                        edge._hitEl = groupEl.querySelector('.edge-hit');
                    } else {
                        edge._groupEl = groupEl;
                        edge._pathEl = groupEl.querySelector('.edge-path');
                        edge._hitEl = groupEl.querySelector('.edge-hit');
                    }
                }
                // 只在 d 变化时 setAttribute（避免相同值触发不必要的 SVG 重绘）
                if (edge._lastD !== d) {
                    edge._lastD = d;
                    edge._pathEl.setAttribute('d', d);
                    edge._hitEl.setAttribute('d', d);
                }
                if (edge._hovered || groupEl.classList.contains("cut-visible")) this._positionCutControl(edge);
                // pulsing 状态 + comet path d 更新
                const isPulsing = (this._selectedEdgeId === edge.id) || edge._hovered || selectedNodeIds.has(edge.to) || selectedNodeIds.has(edge.from);
                if (!ids || ids.includes(edge.from) || ids.includes(edge.to)) {
                    const multiDragging = this.layerEl && this.layerEl.classList.contains('multi-dragging');
                    if (!multiDragging) this._syncCometPaths(edge._groupEl, d, isPulsing);
                    edge._pathEl.classList.toggle('node-active', selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to));
                    edge._pathEl.classList.toggle('edge-active', this._selectedEdgeId === edge.id);
                }
            });
        },

        _updateDensityMode() {
            if (!this.layerEl || !global.CanvasCore || !global.CanvasBlocks) return false;
            const vp = global.CanvasCore.viewport;
            const viewEl = global.CanvasCore.viewportEl;
            const blocks = new Map((global.CanvasBlocks.blocks || []).map(block => [block.id, block]));
            const scale = vp.scale || 1;
            const width = (viewEl && viewEl.clientWidth) || 0;
            const height = (viewEl && viewEl.clientHeight) || 0;
            const pad = 160 / scale;
            const left = -vp.x / scale - pad;
            const top = -vp.y / scale - pad;
            const right = (width - vp.x) / scale + pad;
            const bottom = (height - vp.y) / scale + pad;
            let visibleEdges = 0;

            this.edges.forEach(edge => {
                const from = blocks.get(edge.from);
                const to = blocks.get(edge.to);
                if (!from || !to) return;
                const minX = Math.min(from.x, to.x);
                const minY = Math.min(from.y, to.y);
                const maxX = Math.max(from.x + from.w, to.x + to.w);
                const maxY = Math.max(from.y + from.h, to.y + to.h);
                if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) visibleEdges++;
            });

            const overloaded = visibleEdges >= 120 || (this.edges.length >= 220 && visibleEdges >= 80);
            const changed = this.layerEl.classList.contains('edge-overload') !== overloaded;
            this.layerEl.classList.toggle('edge-overload', overloaded);
            return changed;
        },

        _positionCutControl(edge) {
            if (!edge || !edge._cutEl || !edge._hoverClient || !global.CanvasCore) return;
            const world = global.CanvasCore.screenToWorld(edge._hoverClient.x, edge._hoverClient.y);
            const scale = global.CanvasCore.viewport.scale || 1;
            edge._cutEl.setAttribute("transform", "translate(" + world.x + " " + world.y + ") scale(" + (1 / scale) + ")");
        },

        // 启动彗星拖尾的帧循环（requestAnimationFrame），每帧沿各边真实曲线采样绘制
        // 性能策略：用 CSS stroke-dasharray 动画替代 JS getPointAtLength()。
        // stroke-dasharray/dashoffset 是 GPU 加速的纯 CSS 动画，100 条边也不卡。
        // 每条 pulsing 边用 3 条 <path>（同一 d），分别错开 dashoffset 动画相位模拟 3 个彗星。
        _startCometLoop() {
            // 不再需要 JS 帧循环，CSS 动画自动运行
            // 保留空方法以兼容 init() 调用
        },

        // 拖动态切换：拖动时跳过昂贵的 getTotalLength 计算
        // 只设置标志，由调用方在拖动结束后调用 refresh() 重算
        setDragging(d, multi) {
            this._dragging = d;
            if (this.layerEl) this.layerEl.classList.toggle('multi-dragging', !!d && !!multi);
            // 同步拖动态类：CSS 据此降低脉冲透明度（此前从未添加该类，样式一直无效）
            if (this.layerEl) {
                this.layerEl.querySelectorAll('.edge-comets').forEach(g => {
                    g.classList.toggle('dragging', !!d);
                });
            }
        },

        // 创建/更新彗星拖尾路径：3 条 path 共用同一 d，CSS 动画控制 dashoffset
        _syncCometPaths(groupEl, d, isPulsing) {
            let cometsG = groupEl.querySelector('.edge-comets');
            // 非活动边不创建 24 条 SVG 彗星路径，避免大量隐藏动画占用资源。
            if (!isPulsing && !cometsG) return;
            if (!isPulsing && cometsG) {
                cometsG.classList.remove('pulsing');
                cometsG.classList.toggle('dragging', !!this._dragging);
                return;
            }
            if (!cometsG) {
                cometsG = document.createElementNS(SVGNS, 'g');
                cometsG.classList.add('edge-comets');
                groupEl.appendChild(cometsG);
            }

            // 单个彗星由两条圆角胶囊和六条等透明度平头矩形叠加。
            // 三个彗星之间错开相位；每个彗星内部所有层保持同相，避免分段撕裂。
            const COMET_COUNT = 3;
            const SEG_COUNT = 8; // 2 条胶囊 + 6 条平头矩形
            const TOTAL_PATHS = COMET_COUNT * SEG_COUNT;
            let cometPaths = cometsG._cometPaths;
            if (!cometPaths || cometPaths.length !== TOTAL_PATHS) {
                cometsG.innerHTML = '';
                cometPaths = [];
                for (let i = 0; i < TOTAL_PATHS; i++) {
                    const p = document.createElementNS(SVGNS, 'path');
                    p.classList.add('edge-comet-path');
                    p.setAttribute('fill', 'none');
                    const cometIdx = Math.floor(i / SEG_COUNT);
                    const layerIdx = i % SEG_COUNT;
                    const layerClass = layerIdx === 0 ? 'edge-comet-shell' : (layerIdx === 1 ? 'edge-comet-body' : 'edge-comet-square');
                    p.classList.add(layerClass);
                    p.style.opacity = layerIdx === 0 ? '0.10' : (layerIdx === 1 ? '0.10' : ((layerIdx - 1) / 6).toFixed(3));
                    p.style.strokeWidth = layerIdx === 0 ? '14' : (layerIdx === 1 ? '10' : '4.2');
                    p.style.animationDelay = '0s';
                    cometsG.appendChild(p);
                    cometPaths.push(p);
                }
                cometsG._cometPaths = cometPaths;
            }

            // d 未变化且 dasharray 已初始化：只同步状态类，跳过全部 DOM 属性操作。
            // getTotalLength 会强制同步布局，百级节点选中时每条边重算是卡顿主因。
            if (cometsG._dashInited && cometsG._lastD === d) {
                cometsG.classList.toggle('pulsing', isPulsing);
                cometsG.classList.toggle('dragging', !!this._dragging);
                return;
            }
            cometsG._lastD = d;

            // 更新彗星路径 d（跟随主路径，确保脉冲跟随节点移动）
            cometPaths.forEach(p => p.setAttribute('d', d));
            // 拖动态类同步（新建的边在拖动中也能正确降透明度）
            cometsG.classList.toggle('dragging', !!this._dragging);

            cometsG._dashInited = true;

            // 计算路径长度，设置 stroke-dasharray 实现彗星拖尾
            const pathEl = groupEl.querySelector('.edge-path');
            if (pathEl) {
                let totalLen = 0;
                try { totalLen = pathEl.getTotalLength(); } catch (e) {
                    cometsG.classList.toggle('pulsing', isPulsing);
                    return;
                }
                if (totalLen > 0) {
                    const baseLen = Math.max(30, totalLen * 0.16);
                    const gapLen = Math.max(48, totalLen * 0.22);
                    let visibleCount = 1;
                    for (let n = 2; n <= COMET_COUNT; n++) {
                        if (n * baseLen + (n - 1) * gapLen <= totalLen * 0.96) visibleCount = n;
                    }
                    const squareCount = 6;
                    // 每个彗星的外壳/主体是一条连续胶囊；内部六段等长相接。
                    cometPaths.forEach((p, i) => {
                        const cometIdx = Math.floor(i / SEG_COUNT);
                        const layerIdx = i % SEG_COUNT;
                        const baseCometLen = baseLen;
                        const isSquare = layerIdx >= 2;
                        const squareIdx = layerIdx - 2;
                        const dashLen = isSquare ? baseCometLen / squareCount : baseCometLen;
                        const dashGap = totalLen + 2 * baseCometLen - dashLen;
                        // 固定一轮时间 = 固定相对速度：长线移动更快，短线移动更慢。
                        const duration = 2.4;
                        const shift = isSquare ? -(squareIdx * dashLen) : 0;
                        p.setAttribute('stroke-dasharray', `${dashLen.toFixed(1)} ${dashGap.toFixed(1)}`);
                        p.style.setProperty('--seg-shift', shift.toFixed(1) + 'px');
                        // 所有层使用同一运动窗口，避免不同 dash 长度造成速度错位。
                        p.style.setProperty('--comet-start', baseCometLen.toFixed(1) + 'px');
                        p.style.setProperty('--comet-end', (-(totalLen + baseCometLen)).toFixed(1) + 'px');
                        p.style.setProperty('--comet-duration', duration.toFixed(2) + 's');
                        p.style.display = cometIdx < visibleCount ? '' : 'none';
                        p.style.animationDelay = `-${(duration * cometIdx / visibleCount).toFixed(2)}s`;
                        if (isSquare) p.style.opacity = ((squareIdx + 1) / squareCount).toFixed(3);
                    });
                }
            }

            cometsG.classList.toggle("pulsing", isPulsing);
        },

        // 连线选中
        selectEdge(edgeId) {
            if (this._selectedEdgeId === edgeId) {
                this._selectedEdgeId = null;
            } else {
                this._selectedEdgeId = edgeId;
            }
            this._syncActiveState();
            // 选中连线时清除节点选中，避免视觉混乱
            if (this._selectedEdgeId && global.CanvasSelection) {
                global.CanvasSelection.clear();
            }
        },

        clearEdgeSelection() {
            this._selectedEdgeId = null;
            this._syncActiveState();
        },

        // 根据选中节点 + 选中连线，切换激活态类
        _syncActiveState() {
            const selectedNodeIds = global.CanvasSelection ? new Set(global.CanvasSelection.getSelectedIds()) : new Set();
            let pulsingCount = 0;
            // 用缓存的 edge._groupEl 遍历，避免 querySelectorAll + edges.find（O(n^2)）
            this.edges.forEach(edge => {
                const g = edge._groupEl;
                const pathEl = edge._pathEl;
                if (!g || !pathEl) return;
                const nodeActive = selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to);
                const edgeActive = this._selectedEdgeId === edge.id;
                // 蓝色彗星脉冲：选中连线本身 或 选中节点的输入/输出边
                const isPulsing = edgeActive || nodeActive || edge._hovered;
                if (isPulsing) pulsingCount++;
                // 状态未变化的边完全跳过：百级节点选中时避免对全部边做 DOM 操作
                // （pulsing 类反复切换会重启 CSS 动画，表现为脉冲闪烁）
                if (edge._lastNodeActive === nodeActive &&
                    edge._lastEdgeActive === edgeActive &&
                    edge._lastPulsing === isPulsing) return;
                edge._lastNodeActive = nodeActive;
                edge._lastEdgeActive = edgeActive;
                edge._lastPulsing = isPulsing;
                // 选中节点关联的连线：node-active（仅提升透明度，不加粗）
                pathEl.classList.toggle('node-active', nodeActive);
                // 选中连线本身：edge-active（白线加亮，不加粗，不虚线）
                pathEl.classList.toggle('edge-active', edgeActive);
                // 同步彗星路径的 pulsing 状态（d 已在 refresh 时同步过，这里只切换类）
                this._syncCometPaths(g, pathEl.getAttribute('d'), isPulsing);
            });
            // 大量脉冲边时进入轻量模式：CSS 据此禁用发光滤镜（数百个 drop-shadow 是帧率杀手）
            if (this.layerEl) {
                this.layerEl.classList.toggle('comets-heavy', pulsingCount > 12);
            }
        },

        // 获取某生成节点允许的最大参考图数量
        _getMaxImagesForNode(node) {
            if (!node || node.nodeType !== 'gen') return 0;
            const model = node.model || '';
            if (model.startsWith('mj-')) return 3;
            // 视频生成节点按模型上限（首尾帧 2；Seedance 2.5=30；其他视频=9）；图片生成节点固定 8
            const isVideo = global.PromptBar && global.PromptBar._isVideoModel && global.PromptBar._isVideoModel(model);
            if (isVideo) {
                if (node.videoMode === 'first_last') return 2;
                return global.PromptBar.videoCaps ? global.PromptBar.videoCaps(model).maxImages : (/seedance-2-5/i.test(model) ? 30 : 9);
            }
            // 自部署：图片节点参考图上限按模型能力（maxImages）约束；0=仅文字（不支持参考图）
            const icfg = (global.PromptBar && global.PromptBar.modelConfigMap) ? global.PromptBar.modelConfigMap[model] : null;
            const imax = icfg && Number.isFinite(Number(icfg.maxImages)) ? Number(icfg.maxImages) : null;
            return imax == null ? 8 : imax;
        },

        // 连线类型约束：图片生成节点仅允许 图片/图片生成/文字 来源；视频生成节点不限
        _canConnectTo(fromId, toId) {
            const to = global.CanvasBlocks.getById(toId);
            const from = global.CanvasBlocks.getById(fromId);
            if (!to || !from || to.id === from.id) return null;
            if (to.nodeType !== 'gen') return null;
            // 角色节点：按展开后的参考图数计入上限，已满则拒绝（未满但不够时连入后按上限截断）
            if (from.subType === 'character' && !this.edges.some(ed => ed.from === fromId && ed.to === toId)) {
                const cmax = this._getMaxImagesForNode(to);
                if (this._countImageInputs(toId) >= cmax) return `素材已满：该节点最多 ${cmax} 张参考图`;
            }
            const toCat = to.genCategory || ((global.PromptBar && global.PromptBar._isVideoModel && global.PromptBar._isVideoModel(to.model)) ? 'video' : 'image');
            if (toCat !== 'image') {
                // 视频生成节点：媒体素材数量按模型上限（与提交校验一致：2.5=视频10/音频10，其他=3/3，特价线路按配置）
                const isS25 = /seedance-2-5/i.test(String(to.model || ''));
                const vc = (global.PromptBar && global.PromptBar.videoCaps) ? global.PromptBar.videoCaps(to.model) : null;
                const maxVid = vc ? vc.maxVideos : (isS25 ? 10 : 3), maxAud = vc ? vc.maxAudios : (isS25 ? 10 : 3);
                const cntMedia = (type) => this.edges.filter(ed => ed.to === toId).filter(ed => {
                    if (ed.from === fromId) return false;
                    const n = global.CanvasBlocks.getById(ed.from);
                    return n && n.mediaType === type;
                }).length;
                if (from.mediaType === 'video' && !maxVid) return '该模型不支持参考视频';
                if (from.mediaType === 'audio' && !maxAud) return '该模型不支持参考音频';
                if (from.mediaType === 'video' && cntMedia('video') >= maxVid) return '该模型最多支持 ' + maxVid + ' 段参考视频';
                if (from.mediaType === 'audio' && cntMedia('audio') >= maxAud) return '该模型最多支持 ' + maxAud + ' 段参考音频';
                return null;
            }
            const fromCat = from.genCategory || ((global.PromptBar && global.PromptBar._isVideoModel && global.PromptBar._isVideoModel(from.model)) ? 'video' : 'image');
            if (from.mediaType === 'video' || from.mediaType === 'audio') return '图片生成节点不能接入视频/音频素材，请改用视频生成节点';
            if (from.nodeType === 'gen' && fromCat === 'video') return '图片生成节点不能接入视频生成节点的输出';
            return null;
        },

        // 统计 gen 节点已连入的图片类来源数量（文本/媒体节点不占名额，媒体按模型在提交时校验）
        // 角色节点按实际展开的参考图张数计入
        _countImageInputs(toId) {
            return this.edges.reduce((sum, e) => {
                if (e.to !== toId) return sum;
                const src = global.CanvasBlocks.getById(e.from);
                if (!(src && src.nodeType !== 'text' && !src.mediaType && !(src.nodeType === 'gen' && (src.genCategory || '') === 'video'))) return sum;
                return sum + this._imageWeight(src);
            }, 0);
        },
        // 来源节点贡献的参考图张数：角色节点 = 展开后的参考图数（至少 1），其余 = 1
        _imageWeight(src) {
            if (src && src.subType === 'character' && global.CharacterLib) return Math.max(1, global.CharacterLib.expandRefs(src).length);
            return 1;
        },

        // 批量连接：从多选包围框拖出，将所有选中输出节点连入目标生成节点（受最大数量限制）
        startBatchConnection(selectedIds, e) {
            const fromIds = (selectedIds || []).filter(id => {
                const b = global.CanvasBlocks.getById(id);
                return b && (b.nodeType === 'ref' || b.nodeType === 'gen');
            });
            if (fromIds.length === 0) return;

            // 计算包围框中心/右侧作为拖拽起点
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            fromIds.forEach(id => {
                const b = global.CanvasBlocks.getById(id);
                if (!b) return;
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
            });
            const startX = maxX;
            const startY = (minY + maxY) / 2;

            const tmp = document.createElementNS(SVGNS, 'path');
            tmp.classList.add('edge-path');
            tmp.style.strokeDasharray = '6 4';
            this.tempLayerEl.appendChild(tmp);
            this._pending = { fromIds, tmp };

            const onMove = (ev) => {
                const w = CanvasCore.screenToWorld(ev.clientX, ev.clientY);
                const dx = Math.max(40, Math.abs(w.x - startX) * 0.5);
                tmp.setAttribute('d', `M ${startX} ${startY} C ${startX + dx} ${startY}, ${w.x - dx} ${w.y}, ${w.x} ${w.y}`);
            };
            const onUp = (ev) => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                tmp.remove();
                this._pending = null;
                const targetEl = ev.target.closest && ev.target.closest('.canvas-node');
                if (!targetEl) return;
                const toId = targetEl.dataset.blockId;
                const to = global.CanvasBlocks.getById(toId);
                if (!to || to.nodeType !== 'gen' || fromIds.includes(toId)) return;

                const max = this._getMaxImagesForNode(to);
                // 去重并过滤已有连接；连接数上限需扣除该节点已连入的图片数
                const existing = new Set(this.edges.filter(edge => edge.to === toId).map(edge => edge.from));
                const remain = Math.max(0, max - this._countImageInputs(toId));
                const candidates = fromIds.filter(id => !existing.has(id));
                const toConnect = candidates.slice(0, remain);
                if (toConnect.length === 0) {
                    if (candidates.length > 0 && remain === 0) this._toast(`素材已满：该节点最多 ${max} 张参考图`);
                    return;
                }

                let added = 0;
                toConnect.forEach(fromId => {
                    if (this.add(fromId, toId)) added++;
                });

                if (candidates.length > toConnect.length) {
                    const skipped = candidates.length - toConnect.length;
                    alert(`该生成节点最多支持 ${max} 张参考图，已自动连接前 ${toConnect.length} 个，跳过 ${skipped} 个。`);
                }
                if (added > 0) {
                    if (global.CanvasHistory) global.CanvasHistory.snapshot();
                    if (global.CanvasStore) global.CanvasStore.scheduleSave();
                }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        },

        // 端口实际渲染中心（含磁吸位移）转世界坐标；取不到时返回 null
        _portCenterWorld(block, sel) {
            const pe = block && block._el && block._el.querySelector(sel);
            if (!pe) return null;
            const r = pe.getBoundingClientRect();
            if (!r.width) return null;
            return CanvasCore.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
        },
        // 虚线存在期间每帧重算起点，保证始终从端口中心出发（拖动中与松手弹菜单阶段都对齐）
        _followPortStart(tmp, draw) {
            const loop = () => {
                if (!tmp.isConnected) return;
                draw();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        },

        // 从输出端口拖出连线
        _bindPortDrag() {
            global.CanvasBlocks._onPortDragStart = (fromId, e) => {
                const from = global.CanvasBlocks.getById(fromId);
                const tmp = document.createElementNS(SVGNS, 'path');
                tmp.classList.add('edge-path');
                tmp.style.strokeDasharray = '6 4';
                this.tempLayerEl.appendChild(tmp);
                this._pending = { fromId, tmp };

                let last = null;
                const draw = () => {
                    if (!last) return;
                    const w = last;
                    // 起点取端口实际渲染中心（端口有磁吸位移），取不到时回退节点外侧 12px
                    const pc = this._portCenterWorld(from, '.port-out');
                    const x1 = pc ? pc.x : from.x + from.w + 12, y1 = pc ? pc.y : from.y + from.h / 2;
                    const dx = Math.max(40, Math.abs(w.x - x1) * 0.5);
                    tmp.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${w.x - dx} ${w.y}, ${w.x} ${w.y}`);
                };
                const onMove = (ev) => {
                    last = CanvasCore.screenToWorld(ev.clientX, ev.clientY);
                    draw();
                };
                this._followPortStart(tmp, draw);
                const onUp = (ev) => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    this._pending = null;
                    // 落在节点上：先尝试连线，连成则结束；已连过/不可连入则退化为弹出创建菜单
                    const targetEl = ev.target.closest && ev.target.closest('.canvas-node');
                    const toId = targetEl && targetEl.dataset.blockId;
                    if (toId && toId !== fromId && this.add(fromId, toId)) {
                        tmp.remove();
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                        return;
                    }
                    // 落在节点上但被拒（素材已满等，已 toast 提示）：直接结束，不弹创建菜单
                    if (toId && this._lastAddError) { tmp.remove(); this._lastAddError = null; return; }
                    if (global.CanvasMain) {
                        // 落在空白 / 无法连线：弹出「引用该节点生成」菜单
                        // 虚线保留，选择节点后连接、点其他地方消失
                        global.CanvasMain.showNodeCreateMenu({ mode: 'generate', fromId, clientX: ev.clientX, clientY: ev.clientY, tempPath: tmp });
                    } else {
                        tmp.remove();
                    }
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };

            // 从输入端口（gen 节点左侧）拖出连线：落到上游节点或空白处弹「添加上下文」菜单
            global.CanvasBlocks._onPortInDragStart = (toId, e) => {
                const to = global.CanvasBlocks.getById(toId);
                if (!to) return;
                const tmp = document.createElementNS(SVGNS, 'path');
                tmp.classList.add('edge-path');
                tmp.style.strokeDasharray = '6 4';
                this.tempLayerEl.appendChild(tmp);
                this._pending = { toId, tmp };

                let last = null;
                const draw = () => {
                    if (!last) return;
                    const w = last;
                    // 起点取输入端口实际渲染中心（含磁吸位移），取不到时回退节点外侧 12px
                    const pc = this._portCenterWorld(to, '.port-in');
                    const x1 = pc ? pc.x : to.x - 12, y1 = pc ? pc.y : to.y + to.h / 2;
                    const dx = Math.max(40, Math.abs(w.x - x1) * 0.5);
                    tmp.setAttribute('d', `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${w.x + dx} ${w.y}, ${w.x} ${w.y}`);
                };
                const onMove = (ev) => {
                    last = CanvasCore.screenToWorld(ev.clientX, ev.clientY);
                    draw();
                };
                this._followPortStart(tmp, draw);
                const onUp = (ev) => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    this._pending = null;
                    // 落在节点上：先尝试连线，连成则结束；已连过/不可连入则退化为弹出创建菜单
                    const targetEl = ev.target.closest && ev.target.closest('.canvas-node');
                    const fromId = targetEl && targetEl.dataset.blockId;
                    if (fromId && fromId !== toId && this.add(fromId, toId)) {
                        tmp.remove();
                        if (global.CanvasHistory) global.CanvasHistory.snapshot();
                        if (global.CanvasStore) global.CanvasStore.scheduleSave();
                        return;
                    }
                    if (fromId && this._lastAddError) { tmp.remove(); this._lastAddError = null; return; }
                    if (global.CanvasMain) {
                        // 落在空白 / 无法连线：弹出「添加上下文」菜单
                        // 虚线保留，选择节点后连接、点其他地方消失
                        global.CanvasMain.showNodeCreateMenu({ mode: 'context', toId, clientX: ev.clientX, clientY: ev.clientY, tempPath: tmp });
                    } else {
                        tmp.remove();
                    }
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };
        },

        clear() {
            this.edges = [];
            this.layerEl.querySelectorAll('.edge-group').forEach(el => el.remove());
        },

        serialize() {
            // 只持久化纯数据字段，运行时 DOM 引用（_groupEl/_cutEl 等）与临时状态不随文档保存，
            // 避免序列化残留导致下次加载时变换回调读取假元素的 classList 报错
            return this.edges.map(e => ({ id: e.id, from: e.from, to: e.to }));
        },
        load(arr) {
            // 兼容旧文档中混入的运行时残留字段：加载时清理为纯数据
            if (Array.isArray(arr)) arr = arr.map(e => ({ id: e.id, from: e.from, to: e.to }));
            this.clear();
            this.edges = (arr || []).map(e => ({ ...e }));
            this.refresh();
        }
    };

    global.CanvasEdges = CanvasEdges;
})(window);
