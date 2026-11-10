/**
 * Pixora 自部署版 —— AI 助手 Agent 本地实现（通用提示词包）
 * Copyright (c) 2026 Pixora (https://pixoraai.cc)
 *
 * 与主站的差异：主站 agent-service.js 使用持续调优的提示词与技能体系（不开源）；
 * 本文件提供功能等价的通用版本，通过用户的中转站 function calling 驱动画布工具。
 * 前端 agent.js 不做任何修改，仍按原 SSE 契约（start/text/call/done/error）工作。
 */
(function (g) {
    'use strict';
    const B = g.PxlBackend, API = g.LiteAPI;
    if (!B || !API) return;

    // ================= 工具定义（与前端 agent.js 的执行/校验一一对应） =================
    const P = (props, req) => ({ type: 'object', properties: props, required: req || [] });
    const S = { type: 'string' };
    const TOOLS = [
        { type: 'function', function: { name: 'get_canvas_summary', description: '读取画布概况：节点总数与分类统计、当前选中节点、视口范围、分组。节点不超过 60 个时返回全部节点列表（含 id/名称/类型/状态/提示词摘要），否则返回可见区域节点。操作画布前应先调用它了解现状。', parameters: P({}) } },
        { type: 'function', function: { name: 'find_nodes', description: '按关键词/类型/状态查找节点，返回节点简介列表。', parameters: P({ query: { ...S, description: '关键词（匹配名称/提示词/文本）' }, type: { ...S, description: '节点类型筛选，可选值参考画布概况里的 byType' }, status: { ...S, description: '状态筛选：todo/generating/done/failed 等' }, limit: { type: 'integer', description: '返回数量上限，默认 20，最大 50' } }) } },
        { type: 'function', function: { name: 'get_nodes', description: '读取若干节点的完整详情（参数、连线、结果）。', parameters: P({ ids: { type: 'array', items: S, description: '节点 id 列表，最多 20 个' } }, ['ids']) } },
        { type: 'function', function: { name: 'create_nodes', description: '批量创建节点（一次最多 10 个），支持图片生成/视频生成/文本/参考图四种。位置建议用 nearNodeId 锚定已有节点，避免重叠。', parameters: P({ nodes: { type: 'array', description: '节点列表', items: { type: 'object', properties: { kind: { ...S, description: 'image_gen | video_gen | text | image_ref' }, name: S, nearNodeId: { ...S, description: '锚定节点，新节点放在它旁边' }, x: { type: 'integer' }, y: { type: 'integer' }, prompt: { ...S, description: '生成类节点的画面描述' }, model: { ...S, description: '必须从上下文的可用模型列表中选择' }, aspectRatio: S, size: { ...S, description: '图片分辨率：1K/2K/4K' }, quality: { ...S, description: '图片画质（仅部分模型支持）：low/medium/high' }, duration: { type: 'integer', description: '视频时长（秒，视频节点）' }, resolution: { ...S, description: '视频分辨率：480p/720p/1080p' }, videoMode: { ...S, description: 'reference（参考图）或 first_last（首尾帧）' }, text: { ...S, description: 'kind=text 时的文本内容' }, url: { ...S, description: 'kind=image_ref 时的图片地址，只能使用已有节点的 imageUrl' } }, required: ['kind'] } } }, ['nodes']) } },
        { type: 'function', function: { name: 'update_nodes', description: '批量修改节点。生成节点可改 prompt/model/aspectRatio/size/quality/duration/resolution/videoMode；文本节点可改 text；参考图/素材/角色节点只能改 name。', parameters: P({ updates: { type: 'array', description: '修改列表，每项必须包含 id', items: { type: 'object', properties: { id: { ...S, description: '节点 id' }, name: S, prompt: S, model: S, aspectRatio: S, size: S, quality: S, duration: { type: 'integer' }, resolution: S, videoMode: S, text: S }, required: ['id'] } } }, ['updates']) } },
        { type: 'function', function: { name: 'connect_nodes', description: '建立连线（参考素材/角色 → 生成节点）。生成前必须把参考图连入生成节点。', parameters: P({ connections: { type: 'array', items: { type: 'object', properties: { from: S, to: S }, required: ['from', 'to'] } } }, ['connections']) } },
        { type: 'function', function: { name: 'disconnect_nodes', description: '删除连线。', parameters: P({ connections: { type: 'array', items: { type: 'object', properties: { from: S, to: S }, required: ['from', 'to'] } } }, ['connections']) } },
        { type: 'function', function: { name: 'delete_nodes', description: '删除节点。删除前若节点有用，先向用户确认（ask 模式下会自动弹出确认）。', parameters: P({ ids: { type: 'array', items: S } }, ['ids']) } },
        { type: 'function', function: { name: 'arrange_nodes', description: '自动整理节点布局（可传 ids 只整理部分，不传整理全部）。', parameters: P({ ids: { type: 'array', items: S } }) } },
        { type: 'function', function: { name: 'select_nodes', description: '在画布上选中节点。', parameters: P({ ids: { type: 'array', items: S } }, ['ids']) } },
        { type: 'function', function: { name: 'focus_nodes', description: '把视图定位到目标节点。', parameters: P({ ids: { type: 'array', items: S } }, ['ids']) } },
        { type: 'function', function: { name: 'group_nodes', description: '把多个节点打组。', parameters: P({ ids: { type: 'array', items: S }, title: S }, ['ids']) } },
        { type: 'function', function: { name: 'list_characters', description: '读取角色库列表（角色可用于保持人物形象一致）。', parameters: P({}) } },
        { type: 'function', function: { name: 'use_character', description: '把角色库中的角色接入若干生成节点（自动创建/复用角色节点并连线），用于保持角色形象一致。', parameters: P({ characterId: S, connectTo: { type: 'array', items: S, description: '要接入的生成节点 id 列表' } }, ['characterId']) } },
        { type: 'function', function: { name: 'get_generation_status', description: '查询节点的生成状态与结果。', parameters: P({ nodeIds: { type: 'array', items: S } }) } },
        { type: 'function', function: { name: 'plan', description: '复杂任务先制定并展示计划（3~6 步），随后按计划逐步执行，状态变化时更新计划。', parameters: P({ steps: { type: 'array', items: { type: 'object', properties: { text: S }, required: ['text'] } } }, ['steps']) } },
        { type: 'function', function: { name: 'ask_user', description: '向用户提问（ask 模式下在关键决定前使用），提供可选项更佳。调用后本轮暂停等待用户回答。', parameters: P({ question: S, options: { type: 'array', items: S } }, ['question']) } },
        { type: 'function', function: { name: 'request_generation', description: '生成前的最后一步：列出将要生成的节点，请用户确认（auto 模式由你判断是否直接生成，前端会处理确认逻辑）。', parameters: P({ nodeIds: { type: 'array', items: S }, note: S }) } }
    ];

    // ================= 通用系统提示词（tuned 版在主站服务端，持续迭代） =================
    function systemPrompt(mode, models) {
        const ml = models.map((m) => `- ${m.id}（${m.isVideo ? '视频' : '图片'}${m.isVideo ? '，时长 ' + m.durationMin + '-' + m.durationMax + 's，分辨率 ' + (m.supportedResolutions || []).join('/') : '，尺寸 1K/2K/4K'}）`).join('\n');
        return `你是「Pixora 无限画布」的 AI 创作助手，通过工具直接操作用户的画布。请使用用户的语言。

## 工作方式
1. 先 get_canvas_summary 了解画布现状，再动手；不要凭空猜测节点 id。
2. 需要创建多个相关节点时，用 create_nodes 一次批量创建，用 nearNodeId 让节点挨着相关节点摆放。
3. 生成图片/视频的标准流程：创建生成节点（写好 prompt、选好 model）→ 有参考图/角色时用 connect_nodes 或 use_character 连入 → request_generation 请求生成。prompt 要具体、有画面感（主体、场景、风格、光线、构图）。
4. model 必须从下方可用模型列表中选择，参数（比例/尺寸/时长/分辨率）不得超出该模型的范围。
5. 复杂任务（≥3 步）先用 plan 展示计划，然后逐步执行；每完成若干步可以更新计划。
6. mode=${mode === 'auto' ? 'auto（AI 接管）' : 'ask（先询问）'}：${mode === 'auto' ? '可以直接执行操作，仅在做不可逆的删除或大批量改动前用 ask_user 确认。' : '在关键决定（选模型、定方案）和删除操作前，用 ask_user 向用户确认；方案明确后用 request_generation 请求生成。'}
7. 每轮回复的文字要简短：说明你做了什么、接下来做什么。不要在文字里罗列长 JSON。工具参数里才放数据。
8. 用户上传的参考图会以 [我刚上传为参考图节点] 形式出现在消息里，把它们连入生成节点即可作为参考。
9. image_ref 的 url 只能使用工具结果中出现过的地址；不要编造 URL。

## 可用模型
${ml || '（未能获取模型列表，请提示用户在接口设置中连接中转站）'}`;
    }

    // ================= 消息映射（前端三角色 → OpenAI 格式） =================
    function mapMessages(msgs) {
        const out = [];
        for (const m of msgs) {
            if (m.role === 'user') out.push({ role: 'user', content: String(m.text || '') });
            else if (m.role === 'model') {
                if (!m.text && !(m.calls || []).length) continue;
                out.push({
                    role: 'assistant',
                    content: m.text || null,
                    tool_calls: (m.calls || []).map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }))
                });
            } else if (m.role === 'function') {
                (m.results || []).forEach((r) => {
                    let s = '';
                    try { s = JSON.stringify(r.response == null ? {} : r.response); } catch (_) { s = '{}'; }
                    out.push({ role: 'tool', tool_call_id: r.id, content: s.slice(0, 12000) });
                });
            }
        }
        while (out.length && out[0].role !== 'user') out.shift();
        return out;
    }

    const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

    // ================= /api/agent/chat：无状态单轮 =================
    async function agentChat(body) {
        let cfg;
        try { cfg = B.relayCfg(); } catch (e) {
            return new Response(sse({ type: 'error', msg: (e && e.message) || '请先配置接口' }), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
        }
        const model = B.chatModelOf();
        if (!model) return new Response(sse({ type: 'error', msg: '请先在「接口设置」中选择对话模型' }), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
        const msgs = Array.isArray(body && body.messages) ? body.messages : [];
        const ctx = (body && body.context) || {};
        const mode = body && body.mode === 'auto' ? 'auto' : 'ask';
        const models = B.buildConfig().data.videoApis.models.concat(B.buildConfig().data.apis.relay.frontend.models)
            .map((m) => ({ id: m.id, isVideo: !!m.isVideo, durationMin: m.durationMin, durationMax: m.durationMax, supportedResolutions: m.supportedResolutions }));
        const system = systemPrompt(mode, models) +
            '\n\n## 当前画布上下文（JSON）\n' + JSON.stringify(ctx).slice(0, 60000);
        const openaiMsgs = [{ role: 'system', content: system }].concat(mapMessages(msgs));

        const enc = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const push = (o) => controller.enqueue(enc.encode(sse(o)));
                try {
                    push({ type: 'start', model });
                    const r = await API.chat(cfg, {
                        model,
                        messages: openaiMsgs,
                        tools: TOOLS,
                        onDelta: (d) => push({ type: 'text', t: d })
                    });
                    const calls = r.toolCalls || [];
                    if (calls.length > 16) calls.length = 16;
                    for (const c of calls) {
                        let args = {};
                        try { args = JSON.parse(c.function.arguments || '{}'); } catch (_) {}
                        push({ type: 'call', id: c.id || 'call_' + Math.random().toString(36).slice(2, 8), name: c.function.name, args, sig: '' });
                    }
                    if (!String(r.content || '').trim() && !calls.length) push({ type: 'done', empty: true });
                    else push({ type: 'done' });
                } catch (e) {
                    push({ type: 'error', msg: (e && e.message) || 'AI 服务暂时不可用，请稍后再试' });
                }
                controller.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // ================= 技能库（本地存储；official 技能为空，adapt 需主站） =================
    async function skillsRoute(method, rest, body) {
        const key = 'lib:agent_skills';
        const list = (await B.idb.get('kv', key)) || [];
        const save = () => B.idb.put('kv', key, list);
        const [id, action] = rest;
        const now = new Date().toISOString();
        const norm = (s) => ({
            id: s.id, name: s.name, description: s.description, content: s.content,
            enabled: s.enabled !== false, builtin: false, createdAt: s.createdAt, updatedAt: now
        });
        if (!id) {
            if (method === 'GET') return B.json({ code: 0, data: { official: [], user: list } });
            if (method === 'POST') {
                const item = norm(Object.assign({}, body || {}, { id: 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: now }));
                list.push(item);
                await save();
                return B.json({ code: 0, data: item });
            }
        }
        const idx = list.findIndex((x) => x.id === id);
        if (idx < 0) return B.json({ code: 1, msg: '技能不存在' }, 404);
        if (method === 'GET') return B.json({ code: 0, data: list[idx] });
        if (method === 'PUT') { list[idx] = norm(Object.assign({}, list[idx], body || {}, { id })); await save(); return B.json({ code: 0, data: list[idx] }); }
        if (method === 'DELETE') { list.splice(idx, 1); await save(); return B.json({ code: 0, data: null }); }
        return B.unsupported();
    }

    B.onRoute(async (url, method, body) => {
        const path = url.pathname.replace(/\/+$/, '');
        if (path === '/api/agent/chat' && method === 'POST') return agentChat(body || {});
        const m = /^\/api\/agent-skills(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
        if (m) {
            if (m[2]) return B.unsupported();   // /adapt、/inspect、/official/:id/toggle 需主站
            return skillsRoute(method, [m[1] ? decodeURIComponent(m[1]) : '', ''], body);
        }
        return null;
    });
})(window);
