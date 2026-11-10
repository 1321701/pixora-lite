/**
 * Pixora Lite —— 附加界面：模型服务接口设置、署名
 * Copyright (c) 2026 Pixora (https://pixoraai.cc)
 */
(function (g) {
    'use strict';
    const B = g.PxlBackend;
    const API = g.LiteAPI;
    if (!B || !API) return;
    const LC = B.LC || {};
    const HOME = String(LC.pixoraUrl || 'https://pixoraai.cc').replace(/\/+$/, '');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const IC = {
        gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    };
    // ===== 接口设置 =====
    let modal = null;
    function openSettings() {
        const c = B.readCfg();
        const locked = !!(LC.lockBaseUrl && LC.baseUrl);
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'pxl-mask';
            modal.innerHTML = `<div class="pxl-card">
                <div class="pxl-head"><span>接口设置</span><button type="button" class="pxl-x" data-x>×</button></div>
                <div class="pxl-body">
                    <div class="pxl-col">
                        <label class="pxl-field"><span>中转站接口地址</span><input id="pxlBase" placeholder="https://你的中转站域名" autocomplete="off" spellcheck="false"></label>
                        <label class="pxl-field"><span>API Key</span>
                            <div class="pxl-row"><input id="pxlKey" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false" style="flex:1"><button type="button" class="pxl-ghost" id="pxlShow">显示</button></div>
                        </label>
                        <div class="pxl-hint">支持 OpenAI 兼容的中转站（new-api / one-api 等）。Key 只保存在本浏览器，由浏览器直接请求中转站；生成结果按部署配置保存在本浏览器或部署者的图床。</div>
                        <div class="pxl-row"><button type="button" class="pxl-primary" id="pxlDetect">连接并获取模型</button><button type="button" class="pxl-ghost" id="pxlFill" title="自动从中转站官网模型页补齐图片/视频模型，并用对话模型解析其文档自动适配私有接口协议">AI 自动适配</button></div>
                        <span class="pxl-msg" id="pxlMsg"></span>
                        <div class="pxl-models" id="pxlStats"></div>
                        <label class="pxl-field"><span>对话模型（用于 AI 聊天、角色描述）</span><select id="pxlChat"></select></label>
                        <label class="pxl-field"><span>对话格式（AI 聊天走哪种接口协议；自动探测失败或想固定协议时手动锁定）</span>
                            <select id="pxlChatProto">
                                <option value="">自动探测（推荐）</option>
                                <option value="completions">OpenAI Chat Completions</option>
                                <option value="responses">OpenAI Responses</option>
                                <option value="anthropic">Anthropic Messages</option>
                            </select>
                        </label>
                        <label class="pxl-field"><span>视频接口（自动探测失败时可手动锁定；Seedance 2.0/2.5 推荐「火山方舟 Ark」）</span>
                            <select id="pxlVideoProto">
                                <option value="">自动探测（推荐）</option>
                                <option value="ark">火山方舟 Ark（/api/v3/contents/generations/tasks）</option>
                                <option value="minimax">MiniMax 视频 V2（/v2/video_generation）</option>
                                <option value="newapi">new-api（/v1/video/generations）</option>
                                <option value="openai">OpenAI（/v1/videos）</option>
                                <option value="task">任务型（/v1/videos/generations）</option>
                            </select>
                        </label>
                        <label class="pxl-field"><span>参考图传法（Ark 视频）：有的中转站直接收图片地址，有的要求先上传到它的素材库再用 asset:// 引用</span>
                            <select id="pxlAssetMode">
                                <option value="">自动（先传图片地址，被拒再转存素材库，并记住本站）</option>
                                <option value="url">直接传图片地址（没有素材库的中转站）</option>
                                <option value="asset">先上传到中转站素材库（asset://，如 MuseReel）</option>
                            </select>
                        </label>
                        <details>
                            <summary>文档页地址（AI 自动找不准文档时手动指定，每行一个 URL，最多 3 个）</summary>
                            <label class="pxl-field"><span>填好后点「AI 自动适配」，会优先抓取这些页面解析接口协议</span><textarea id="pxlDocUrls" rows="2" placeholder="https://www.中转站.com/docs&#10;https://docs.中转站.com/api"></textarea></label>
                        </details>
                        <details>
                            <summary>文档内容（抓不到文档页时，直接把 API 文档文本粘贴到这里，优先用它解析）</summary>
                            <label class="pxl-field"><span>粘贴接口地址、请求字段、示例 JSON 等文档内容（越完整越准）</span><textarea id="pxlDocText" rows="5" spellcheck="false" placeholder="例如：&#10;POST /api/v3/contents/generations/tasks&#10;{ &quot;model&quot;: &quot;...&quot;, &quot;content&quot;: [...], &quot;duration&quot;: 5 }"></textarea></label>
                        </details>
                    </div>
                    <div class="pxl-col">
                        <label class="pxl-field"><span>模型类型标记（列表识别不准时手动指定：标记为「图片」的模型会走 /v1/images/generations，「视频」走视频任务接口）</span><div class="pxl-mlist" id="pxlTag" style="max-height:320px"></div></label>
                        <details>
                            <summary>手动添加对话模型（用于 AI 聊天、角色描述；图片/视频模型在右侧「模型能力与启用」顶部添加）</summary>
                            <label class="pxl-field"><span>对话模型（每行一个）</span><textarea id="pxlManChat" rows="2"></textarea></label>
                        </details>
                        <details>
                            <summary>协议共享（把适配成功的私有协议分享给其他人，或从别人导入；不含 API Key）</summary>
                            <div class="pxl-row"><button type="button" class="pxl-ghost" id="pxlProtoExport">复制本站协议</button><button type="button" class="pxl-ghost" id="pxlProtoImport">导入协议</button></div>
                            <label class="pxl-field"><span>协议 JSON（导出得到的内容粘贴到这里，点「导入协议」生效）</span><textarea id="pxlProtoJson" rows="3" spellcheck="false"></textarea></label>
                        </details>
                    </div>
                    <div class="pxl-col">
                        <details open>
                            <summary>模型能力与启用（AI 适配/通用库的默认能力可手动微调；取消勾选的模型不在前端显示和调用）</summary>
                            <div class="pxl-crow pxl-cadd">
                                <input type="text" id="pxlAddId" placeholder="输入模型调用 id，如 doubao-seedance-2-0-260128" style="flex:1;min-width:0">
                                <select id="pxlAddType" style="width:70px;flex-shrink:0;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:#141417;color:#ececef;font-size:12px;outline:none"><option value="image">图片</option><option value="video">视频</option></select>
                                <button type="button" class="pxl-ghost" id="pxlAddBtn" style="flex-shrink:0">添加</button>
                            </div>
                            <div class="pxl-mlist" id="pxlCaps" style="max-height:318px"></div>
                            <div class="pxl-hint">图=参考图上限（0=仅文字）；视频行=时长范围（最小-最大）+尾帧开关；末尾输入框=分辨率档位（逗号分隔）。行尾 ×=删除模型。改动即时生效，关闭本窗口时页面自动刷新。</div>
                            <div class="pxl-row" style="margin-top:8px"><button type="button" class="pxl-ghost" id="pxlResetFix" title="清除 AI 修正与手动添加/禁用，恢复为连接时自动识别的结果">重置模型修正</button></div>
                        </details>
                    </div>
                </div>
                <div class="pxl-foot"><button type="button" class="pxl-ghost" id="pxlClear">清除本机 Key</button><span class="pxl-sp"></span><button type="button" class="pxl-ghost" data-x>取消</button><button type="button" class="pxl-primary" id="pxlSave">保存</button></div>
            </div>`;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (modal._busy) return;
                if (e.target.closest('[data-x]')) { modal.hidden = true; if (modal._dirty) setTimeout(() => location.reload(), 80); }   // 有未应用变更：关闭时刷新页面拉取新配置
            });
            modal.querySelector('#pxlShow').onclick = () => { const k = modal.querySelector('#pxlKey'); k.type = k.type === 'password' ? 'text' : 'password'; modal.querySelector('#pxlShow').textContent = k.type === 'password' ? '显示' : '隐藏'; };
            modal.querySelector('#pxlDetect').onclick = detect;
            modal.querySelector('#pxlFill').onclick = fillModels;
            modal.querySelector('#pxlProtoExport').onclick = exportProto;
            modal.querySelector('#pxlProtoImport').onclick = importProto;
            modal.querySelector('#pxlResetFix').onclick = resetFixes;
            // 添加模型（图片/视频）：直接进「模型能力与启用」列表，即时生效
            modal.querySelector('#pxlAddBtn').onclick = () => {
                const id = String(modal.querySelector('#pxlAddId').value || '').trim();
                const t = modal.querySelector('#pxlAddType').value;
                const msg = modal.querySelector('#pxlMsg');
                if (!id) { msg.textContent = '请输入模型调用 id'; msg.className = 'pxl-msg err'; return; }
                const c = modal._draft || B.readCfg();
                c.manual = c.manual || { image: [], video: [], chat: [] };
                const dup = (c.manual[t] || []).indexOf(id) >= 0 || ((c.detected || {})[t] || []).indexOf(id) >= 0;
                if (dup) { msg.textContent = '模型已存在：' + id; msg.className = 'pxl-msg err'; return; }
                (c.manual[t] = c.manual[t] || []).push(id);
                modal.querySelector('#pxlAddId').value = '';
                applyNow(c);
                renderModels(c);
                msg.textContent = '已添加 ' + (t === 'image' ? '图片' : '视频') + '模型：' + id + '（即时生效）';
                msg.className = 'pxl-msg ok';
            };
            // 删除模型（×）：从列表移除并加入 exclude（防止连接识别重新加回），即时生效
            modal.querySelector('#pxlCaps').addEventListener('click', (e) => {
                const del = e.target.closest('[data-del]');
                if (!del || modal._busy) return;
                const id = del.dataset.del;
                if (!confirm('删除模型 ' + id + '？（连接识别不会再加回；可随时重新添加）')) return;
                const c = modal._draft || B.readCfg();
                c.exclude = [...new Set((Array.isArray(c.exclude) ? c.exclude : []).concat([id]))];
                ['image', 'video'].forEach((t) => { c.manual[t] = (c.manual[t] || []).filter((x) => x !== id); });
                if (c.override) delete c.override[id];
                c.disabledModels = (c.disabledModels || []).filter((x) => x !== id);
                applyNow(c);
                renderModels(c);
                const msg = modal.querySelector('#pxlMsg');
                msg.textContent = '已删除模型：' + id + '（即时生效）';
                msg.className = 'pxl-msg ok';
            });
            // 模型能力/启用编辑（事件委托）——即时持久化
            modal.querySelector('#pxlCaps').addEventListener('input', (e) => {
                const el = e.target;
                const cid = el.dataset.cid != null ? el.dataset.cid : el.dataset.en;
                if (!cid) return;
                const c = modal._draft || B.readCfg();
                c.capsOverride = c.capsOverride || {};
                c.disabledModels = Array.isArray(c.disabledModels) ? c.disabledModels : [];
                if (el.dataset.en != null) {
                    const i = c.disabledModels.indexOf(cid);
                    if (el.checked && i >= 0) c.disabledModels.splice(i, 1);
                    if (!el.checked && i < 0) c.disabledModels.push(cid);
                } else {
                    const ov = c.capsOverride[cid] || (c.capsOverride[cid] = {});
                    const cap = el.dataset.cap;
                    if (cap === 'maxImages') { const n = Number(el.value); if (Number.isFinite(n)) ov[cap] = n; }
                    else if (cap === 'dur') {
                        const mm = String(el.value).split(/[-–—~]/).map((x) => Number(x.trim()));
                        if (Number.isFinite(mm[0])) ov.durationMin = mm[0];
                        if (Number.isFinite(mm[1])) ov.durationMax = mm[1]; else if (Number.isFinite(mm[0])) ov.durationMax = mm[0];
                    }
                    else if (cap === 'res') ov.supportedResolutions = el.value.split(/[,，]+/).map((x) => x.trim()).filter(Boolean);
                    else if (cap === 'firstLast') ov.firstLast = el.checked;
                }
                applyNow(c);
            });
            modal.querySelector('#pxlSave').onclick = save;
            // 对话格式手动锁定：即时持久化，下一次 AI 聊天就按该格式直连（不再自动探测）
            modal.querySelector('#pxlChatProto').onchange = () => {
                const cc = modal._draft || B.readCfg();
                cc.chatProto = modal.querySelector('#pxlChatProto').value;
                applyNow(cc);
                const mm = modal.querySelector('#pxlMsg');
                mm.textContent = cc.chatProto ? '对话格式已锁定：' + modal.querySelector('#pxlChatProto').selectedOptions[0].textContent + '（即时生效）' : '已恢复自动探测（即时生效）';
                mm.className = 'pxl-msg ok';
            };
            modal.querySelector('#pxlVideoProto').onchange = () => {
                const cc = modal._draft || B.readCfg();
                cc.videoProto = modal.querySelector('#pxlVideoProto').value;
                applyNow(cc);
                const mm = modal.querySelector('#pxlMsg');
                mm.textContent = cc.videoProto ? '视频接口已锁定：' + modal.querySelector('#pxlVideoProto').selectedOptions[0].textContent + '（即时生效）' : '视频接口已恢复自动探测（即时生效）';
                mm.className = 'pxl-msg ok';
            };
            modal.querySelector('#pxlAssetMode').onchange = () => {
                const cc = modal._draft || B.readCfg();
                cc.assetMode = modal.querySelector('#pxlAssetMode').value;
                applyNow(cc);
                const mm = modal.querySelector('#pxlMsg');
                mm.textContent = '参考图传法：' + modal.querySelector('#pxlAssetMode').selectedOptions[0].textContent + '（即时生效）';
                mm.className = 'pxl-msg ok';
            };
            modal.querySelector('#pxlClear').onclick = () => { if (!confirm('清除本浏览器保存的 API Key？')) return; const cc = B.readCfg(); cc.key = ''; B.writeCfg(cc); modal.querySelector('#pxlKey').value = ''; refreshBtn(); };
        }
        modal.querySelector('#pxlBase').value = c.base;
        modal.querySelector('#pxlBase').disabled = locked;
        modal.querySelector('#pxlKey').value = c.key;
        modal.querySelector('#pxlManChat').value = c.manual.chat.join('\n');
        modal.querySelector('#pxlDocUrls').value = String(c.docUrls || '');
        modal.querySelector('#pxlDocText').value = String(c.docText || '');
        modal.querySelector('#pxlChatProto').value = c.chatProto || '';
        modal.querySelector('#pxlVideoProto').value = c.videoProto || '';
        modal.querySelector('#pxlAssetMode').value = c.assetMode || '';
        const msg = modal.querySelector('#pxlMsg');
        msg.textContent = ''; msg.className = 'pxl-msg';
        renderModels(c);
        modal.hidden = false;
    }
    function readManual() {
        // 图片/视频模型由「模型能力与启用」区管理（manual 现值），此处只读对话模型
        const cur = modal._draft || B.readCfg();
        const chat = String(modal.querySelector('#pxlManChat').value || '').split(/[\n,，]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
        return { image: cur.manual.image || [], video: cur.manual.video || [], chat };
    }
    function renderModels(c) {
        const lists = B.modelLists(c);
        modal.querySelector('#pxlStats').innerHTML = [['图片', lists.image], ['视频', lists.video], ['对话', lists.chat]]
            .map(([n, l]) => `<div class="pxl-stat"><b>${l.length}</b>${n}模型</div>`).join('');
        const sel = modal.querySelector('#pxlChat');
        const prev = sel.value;   // 重绘前保留用户当前选择（切换后未保存也不被重置）
        const cur = B.chatModelOf(c);
        sel.innerHTML = lists.chat.length ? lists.chat.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('') : '<option value="">（未识别到对话模型，AI 适配将使用内置 AI）</option>';
        sel.value = lists.chat.indexOf(prev) >= 0 ? prev : cur;
        // 模型类型标记：全部已知模型 + 当前归类，可手动改
        const zh = { image: '图片', video: '视频', chat: '对话' };
        const rows = [];
        ['image', 'video', 'chat'].forEach((t) => lists[t].forEach((id) => rows.push({ id, t })));
        modal.querySelector('#pxlTag').innerHTML = rows.length
            ? rows.map((r) => `<div class="pxl-mrow"><span class="pxl-mid" title="${esc(r.id)}">${esc(r.id)}</span><select data-mid="${esc(r.id)}"><option value="">${zh[r.t]}（自动）</option><option value="image">图片</option><option value="video">视频</option><option value="chat">对话</option></select></div>`).join('')
            : '<div class="pxl-hint">尚未识别到模型，连接中转站或手动添加后可在此标记类型。</div>';
        renderCaps(c);
    }
    // 模型能力与启用列表：全部已知生成模型（含已禁用的，可重新勾选）；能力值 = 用户手改 > AI 适配 > 通用库 > 默认 的合并结果
    function rawGenModels(c) {
        const map = {};
        ['image', 'video'].forEach((t) => {
            ((c.detected || {})[t] || []).forEach((id) => { if (!map[id]) map[id] = t; });
            ((c.manual || {})[t] || []).forEach((id) => { map[id] = t; });
        });
        Object.entries(c.override || {}).forEach(([id, t]) => {
            if ((t === 'image' || t === 'video') && map[id] !== undefined) map[id] = t;
            else if (t === 'image' || t === 'video') map[id] = t;
        });
        const ex = Array.isArray(c.exclude) ? c.exclude : [];
        return Object.keys(map).filter((id) => ex.indexOf(id) < 0).map((id) => ({ id, kind: map[id] }));
    }
    function renderCaps(c) {
        const box = modal.querySelector('#pxlCaps');
        if (!box) return;
        const rows = rawGenModels(c);
        const dis = Array.isArray(c.disabledModels) ? c.disabledModels : [];
        box.innerHTML = rows.length ? rows.map((r) => {
            const caps = B.effCaps ? (B.effCaps(r.id) || {}) : {};
            const isV = r.kind === 'video';
            const en = dis.indexOf(r.id) < 0;
            const res = (caps.supportedResolutions || []).join(',');
            const dur = (Number(caps.durationMin) || 4) + '-' + (Number(caps.durationMax) || 12);
            return `<div class="pxl-crow${en ? '' : ' pxl-coff'}">` +
                `<input type="checkbox" data-en="${esc(r.id)}" ${en ? 'checked' : ''} title="启用（取消后不在前端显示和调用）">` +
                `<span class="pxl-cid" title="${esc(r.id)}">${esc(r.id)}</span>` +
                `<span class="pxl-ckind">${isV ? '视频' : '图'}</span>` +
                `<label title="参考图上限（0=仅文字）">图<input type="number" data-cid="${esc(r.id)}" data-cap="maxImages" value="${Number(caps.maxImages) || 0}" min="0" max="99"></label>` +
                (isV ? `<label title="支持首尾帧"><input type="checkbox" data-cid="${esc(r.id)}" data-cap="firstLast" ${caps.firstLast ? 'checked' : ''}>尾帧</label>` : '') +
                (isV ? `<input type="text" data-cid="${esc(r.id)}" data-cap="dur" value="${dur}" title="时长范围（秒），格式 最小-最大" style="width:64px;flex-shrink:0">` : '') +
                `<input type="text" data-cid="${esc(r.id)}" data-cap="res" value="${esc(res)}" placeholder="分辨率" title="分辨率档位（逗号分隔）" style="flex:1;min-width:0">` +
                `<button type="button" class="pxl-x" data-del="${esc(r.id)}" title="删除该模型" style="width:24px;height:24px;flex-shrink:0;font-size:15px">×</button>` +
                `</div>`;
        }).join('') : '<div class="pxl-hint">尚无生成模型：连接中转站或 AI 自动适配后可在此查看/修改能力、选择启用。</div>';
    }
    async function detect() {
        const c = modal._draft || B.readCfg();
        if (!modal.querySelector('#pxlBase').disabled) c.base = API.normBase(modal.querySelector('#pxlBase').value);
        c.key = modal.querySelector('#pxlKey').value.trim();
        c.manual = readManual();
        c.docUrls = modal.querySelector('#pxlDocUrls').value.trim();
        c.docText = String(modal.querySelector('#pxlDocText').value || '').trim();
        c.videoProto = modal.querySelector('#pxlVideoProto').value; c.assetMode = modal.querySelector('#pxlAssetMode').value;
        c.chatProto = modal.querySelector('#pxlChatProto').value;
        const msg = modal.querySelector('#pxlMsg');
        const btn = modal.querySelector('#pxlDetect');
        if (!c.base || !c.key) { msg.textContent = '请填写接口地址和 API Key'; msg.className = 'pxl-msg err'; return; }
        btn.disabled = true; msg.textContent = '连接中…'; msg.className = 'pxl-msg';
        try {
            c.detected = await API.listModels({ base: c.base, key: c.key, modelsPage: (window.LITE_CONFIG || {}).modelsPage });
            // 只以中转站 /v1/models 返回为准：清掉历史遗留的手动图片/视频模型（尤其是别的站点补进来的）
            c.manual = c.manual || { image: [], video: [], chat: [] };
            c.manual.image = [];
            c.manual.video = [];
            msg.textContent = `连接成功：图片 ${c.detected.image.length} · 视频 ${c.detected.video.length} · 对话 ${c.detected.chat.length}`;
            msg.className = 'pxl-msg ok';
        } catch (e) {
            msg.textContent = (e && e.message) || '连接失败';
            msg.className = 'pxl-msg err';
        } finally { btn.disabled = false; }
        applyNow(c);
        renderModels(c);
    }
    // AI 自动适配：①从中转站官网模型页补齐图片/视频模型 ②用对话模型解析其文档页，自动适配私有接口协议
    // 适配期间锁定弹窗（关闭按钮/遮罩/保存全部灰掉），防止误退出中断流程
    // 即时生效：操作完成立即持久化（writeCfg）并标记 _dirty；关闭弹窗时页面自动刷新拉取新配置，无需手动点保存
    function applyNow(c) {
        modal._draft = c;
        modal._dirty = true;
        B.writeCfg(c);
    }
    function setModalBusy(on) {
        modal._busy = on;
        modal.querySelectorAll('[data-x], #pxlSave, #pxlClear, #pxlDetect, #pxlFill, #pxlProtoExport, #pxlProtoImport').forEach((b) => { b.disabled = on; });
        // 适配期间刷新/关闭页面给出确认提示（AI 解析文档可能要 1-2 分钟，防止误关导致上游请求被取消）
        if (on && !setModalBusy._unload) {
            setModalBusy._unload = (e) => { e.preventDefault(); e.returnValue = ''; };
            window.addEventListener('beforeunload', setModalBusy._unload);
        } else if (!on && setModalBusy._unload) {
            window.removeEventListener('beforeunload', setModalBusy._unload);
            setModalBusy._unload = null;
        }
    }
    async function fillModels() {
        const c = modal._draft || B.readCfg();
        if (!modal.querySelector('#pxlBase').disabled) c.base = API.normBase(modal.querySelector('#pxlBase').value);
        c.key = modal.querySelector('#pxlKey').value.trim();
        const msg = modal.querySelector('#pxlMsg');
        const btn = modal.querySelector('#pxlFill');
        if (!c.base || !c.key) { msg.textContent = '请先填写接口地址和 API Key'; msg.className = 'pxl-msg err'; return; }
        setModalBusy(true);
        // 第 1 步：官网模型页补齐
        msg.textContent = '正在从中转站官网识别模型…'; msg.className = 'pxl-msg';
        let added = 0;
        const det0 = c.detected;
        if (det0 && !det0.image.length && !det0.video.length) {   // 已连接且 /v1/models 完全没有生成模型时才看官网页；未连接不抓外部模型
            try {
                const fb = await API.fetchModelsPage({ base: c.base, key: c.key, modelsPage: (window.LITE_CONFIG || {}).modelsPage });
                const manual = c.manual || { image: [], video: [], chat: [] };
                (fb ? fb.image : []).forEach((m) => { if (manual.image.indexOf(m) < 0) { manual.image.push(m); added++; } });
                (fb ? fb.video : []).forEach((m) => { if (manual.video.indexOf(m) < 0) { manual.video.push(m); added++; } });
                if (added) c.manual = { image: manual.image.slice(0, 50), video: manual.video.slice(0, 50), chat: manual.chat.slice(0, 50) };
            } catch (_) { /* 模型补齐失败不阻塞协议适配 */ }
        }
        applyNow(c);
        renderModels(c);
        // 第 2 步：AI 解析文档，适配私有协议（有中转站对话模型就用它；没有就用内置 AI）
        const chatModel = modal.querySelector('#pxlChat').value || (B.modelLists(c).chat[0] || '');
        c.chatModel = chatModel;
        const docText = String(modal.querySelector('#pxlDocText').value || '').trim();
        msg.textContent = (chatModel ? '正在用 ' + chatModel : '正在用内置 AI') + ' 解析文档、适配接口协议…请勿刷新或关闭页面（约 30 秒至 2 分钟）';
        try {
            const docUrls = modal.querySelector('#pxlDocUrls').value.trim();
            c.docUrls = docUrls;
            c.docText = docText;
            const proto = await API.discoverProtocol({ base: c.base, key: c.key, docUrls, docText }, chatModel);
            c.protocol = proto;
            // AI 自动适配只产出协议与能力配置；模型列表一律不修改（分类/id/增删全部由用户在下方手动管理）
            modal._draft = c;
            renderModels(c);
            const desc = [];
            if (proto.image) desc.push('图片 ' + (proto.image.submit.method || 'POST') + ' ' + proto.image.submit.path + (proto.image.poll ? ' → 轮询 ' + proto.image.poll.path : '（同步）'));
            if (proto.video) desc.push('视频 ' + (proto.video.submit.method || 'POST') + ' ' + proto.video.submit.path + (proto.video.poll ? ' → 轮询 ' + proto.video.poll.path : '（同步）'));
            const nCaps = proto.models ? Object.keys(proto.models).length : 0;
            const capKeys = nCaps ? '（' + Object.keys(proto.models).slice(0, 8).join('、') + (nCaps > 8 ? ' 等' : '') + '）' : '——未从文档解析到模型能力，前端将用默认参数';
            const srcTxt = proto._source === 'ai_web' ? '；来源：AI 联网爬取' : (Array.isArray(proto._docPages) && proto._docPages.length ? '；来源：已读取文档页 ' + proto._docPages.join('、') : '');
            msg.textContent = 'AI 自动适配完成：' + desc.join('；') + (nCaps ? '；已识别 ' + nCaps + ' 组模型能力' + capKeys : capKeys) + srcTxt + '（配置即时生效）';
            msg.className = 'pxl-msg ok';
        } catch (e) {
            if (c.protocol) {
                msg.textContent = 'AI 解析文档失败（保留现有 AI 协议）：' + ((e && e.message) || '');
            } else {
                msg.textContent = (added ? '已补齐 ' + added + ' 个模型；' : '') + 'AI 协议解析失败：' + ((e && e.message) || '') + '（不影响标准接口的自动探测）';
            }
            msg.className = 'pxl-msg err';
        }
        setModalBusy(false);
    }
    // 重置模型修正：清除 AI 修正（override/exclude/disabled/caps）与手动添加，恢复为连接时自动识别的结果
    function resetFixes() {
        const c = modal._draft || B.readCfg();
        if (!confirm('重置模型修正？\n\n将清除 AI 修正（分类/调用 id/剔除/禁用/能力覆盖）与手动添加的模型，恢复为「连接并获取模型」时自动识别的结果。\n已适配的接口协议会保留。')) return;
        c.override = {};
        c.exclude = [];
        c.disabledModels = [];
        c.capsOverride = {};
        c.manual = { image: [], video: [], chat: c.manual.chat || [] };
        applyNow(c);
        renderModels(c);
        const msg = modal.querySelector('#pxlMsg');
        msg.textContent = '已重置模型修正（协议保留，即时生效）。';
        msg.className = 'pxl-msg ok';
    }
    // ===== 协议共享（导出/导入/上报；只含中转站域名与协议结构，不含 API Key 与提示词）=====
    function protoPayload(c) {
        if (!c.protocol) return null;
        let host = '';
        try { host = new URL(c.base || '').hostname.toLowerCase() || ''; } catch (_) {}
        if (!host) return null;
        return { host, protocol: { image: c.protocol.image || undefined, video: c.protocol.video || undefined } };
    }
    function exportProto() {
        const c = modal._draft || B.readCfg();
        const payload = protoPayload(c);
        const msg = modal.querySelector('#pxlMsg');
        if (!payload) { msg.textContent = '还没有适配成功的协议：先点「AI 自动适配」或「导入协议」'; msg.className = 'pxl-msg err'; return; }
        const text = JSON.stringify(payload, null, 2);
        const done = () => { msg.textContent = '协议已复制到剪贴板（不含 API Key），发给其他人粘贴导入即可'; msg.className = 'pxl-msg ok'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => { modal.querySelector('#pxlProtoJson').value = text; done; msg.textContent = '复制失败，协议 JSON 已填入下方文本框，请手动复制'; msg.className = 'pxl-msg err'; });
        else { modal.querySelector('#pxlProtoJson').value = text; msg.textContent = '协议 JSON 已填入下方文本框，请手动复制'; msg.className = 'pxl-msg ok'; }
    }
    function importProto() {
        const msg = modal.querySelector('#pxlMsg');
        let obj;
        try { obj = JSON.parse(modal.querySelector('#pxlProtoJson').value); } catch (_) { msg.textContent = '粘贴的内容不是合法 JSON'; msg.className = 'pxl-msg err'; return; }
        const proto = obj && obj.protocol ? obj.protocol : obj;
        try { API.validateProtocol(proto); } catch (e) { msg.textContent = '协议无效：' + ((e && e.message) || ''); msg.className = 'pxl-msg err'; return; }
        const c = modal._draft || B.readCfg();
        c.protocol = { image: proto.image || undefined, video: proto.video || undefined };
        modal._draft = c;
        const parts = [];
        if (c.protocol.image) parts.push('图片 ' + c.protocol.image.submit.path);
        if (c.protocol.video) parts.push('视频 ' + c.protocol.video.submit.path);
        msg.textContent = '协议导入成功（' + parts.join('；') + '）。点「保存」生效。';
        msg.className = 'pxl-msg ok';
    }
    function save() {
        const c = modal._draft || B.readCfg();
        if (!modal.querySelector('#pxlBase').disabled) c.base = API.normBase(modal.querySelector('#pxlBase').value);
        c.key = modal.querySelector('#pxlKey').value.trim();
        c.manual = readManual();
        c.docUrls = modal.querySelector('#pxlDocUrls').value.trim();
        c.docText = String(modal.querySelector('#pxlDocText').value || '').trim();
        c.videoProto = modal.querySelector('#pxlVideoProto').value; c.assetMode = modal.querySelector('#pxlAssetMode').value;
        c.chatModel = modal.querySelector('#pxlChat').value || c.chatModel || '';
        c.override = {};
        modal.querySelectorAll('#pxlTag select[data-mid]').forEach((s) => { if (s.value) c.override[s.dataset.mid] = s.value; });
        const bc = B.readCfg();
        const changedModels = JSON.stringify(B.modelLists(c)) !== JSON.stringify(B.modelLists(bc));
        // 协议（含模型能力 models）变化同样需要刷新：生成页/画布要重新拉 /api/config 才能拿到能力约束
        const changedProto = JSON.stringify((c.protocol || {}).models || null) !== JSON.stringify((bc.protocol || {}).models || null);
        const wasDirty = modal._dirty;
        B.writeCfg(c);
        modal._draft = null;
        modal._dirty = false;
        modal.hidden = true;
        refreshBtn();
        // 模型列表/协议能力/即时操作有变更：刷新页面拉取新配置（画布与生成记录都在本地，不会丢失）
        if (changedModels || changedProto || wasDirty) setTimeout(() => location.reload(), 150);
    }

    // ===== 顶部按钮 =====
    let cfgBtn = null;
    function refreshBtn() {
        if (!cfgBtn) return;
        const c = B.readCfg();
        const lists = B.modelLists(c);
        const n = lists.image.length + lists.video.length + lists.chat.length;
        let host = '';
        try { host = c.base ? new URL(c.base).host : ''; } catch (_) {}
        cfgBtn.classList.remove('ok', 'err');
        if (!c.base || !c.key) { cfgBtn.querySelector('.pxl-host').textContent = '接口设置'; return; }
        cfgBtn.classList.add(n ? 'ok' : 'err');
        cfgBtn.querySelector('.pxl-host').textContent = host || '接口设置';
        cfgBtn.title = host + ' · ' + n + ' 个模型';
    }
    function mount() {
        const host = document.querySelector('.px-topright') || document.querySelector('.float-capsule-tr');
        const bar = document.createElement('div');
        bar.className = 'pxl-bar';
        bar.innerHTML = `<button type="button" class="pxl-btn" id="pxlCfgBtn"><span class="pxl-dot"></span>${IC.gear}<span class="pxl-host">接口设置</span></button>`;
        if (host) host.insertBefore(bar, host.firstChild);
        else { bar.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999'; document.body.appendChild(bar); }
        cfgBtn = bar.querySelector('#pxlCfgBtn');
        cfgBtn.onclick = openSettings;
        refreshBtn();

        const pw = document.createElement('a');
        pw.className = 'pxl-powered';
        pw.href = HOME;
        pw.target = '_blank';
        pw.rel = 'noopener';
        pw.innerHTML = 'Powered by <b>Pixora</b>';
        document.body.appendChild(pw);

        if (!B.secure) {
            const bn = document.createElement('div');
            bn.className = 'pxl-banner';
            bn.textContent = '当前通过 http 访问：浏览器不允许启用本地媒体服务，生成的图片和视频将无法显示。请使用 https 部署，或通过 localhost 访问。';
            document.body.appendChild(bn);
        }
        const c = B.readCfg();
        if ((!c.base || !c.key) && !sessionStorage.getItem('pxl_cfg_prompted')) {
            sessionStorage.setItem('pxl_cfg_prompted', '1');
            setTimeout(openSettings, 600);
        }
    }

    g.PxlUI = { openSettings };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window);
