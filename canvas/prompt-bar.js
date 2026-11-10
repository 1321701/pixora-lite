/**
 * prompt-bar.js
 * 通用提示词输入栏模块 —— 从 index.html / script.js 抽取的底部栏完整逻辑。
 *
 * 任何页面只要放入与原始 .bottom-bar 相同结构的 HTML（元素 id 保持一致），
 * 引入本模块并调用 PromptBar.init()，即可获得与主页完全一致的：
 *   - 模型下拉（从 /api/config 动态加载）
 *   - 比例 + 分辨率组合下拉（含模型尺寸限制、MJ 参数）
 *   - 参考图：添加、上传、预览、拖拽排序、删除
 *   - 提示词 contenteditable + @图片 标签（插入/换图/拖拽/序列化）
 *   - 生成参数收集（getGenerationParams）
 *
 * 画布等场景可通过覆盖 onGenerate(params) 接管生成行为，
 * 并通过 setReferenceImages(images) 从外部（如连线）注入参考图。
 *
 * 依赖：页面提供 API_CONFIG.baseUrl、TaskClient（可选，仅生成时用）、
 *      与 index.html 相同 id 的 DOM 元素。
 */
(function (global) {
    'use strict';

    const MODEL_DESC_KEYS = {
        'Nano Banana Pro': 'descNanoBananaPro',
        'Nano Banana 2.0': 'descNanoBanana2',
        'Nano Banana 2.1': 'descNanoBanana21',
        'GPT Image 2 标准': 'descGptImage2',
        'GPT Image 2 Pro': 'descGptImage2Vip'
    };
    const LONG_PRESS_DURATION = 400;
    const MAX_CONCURRENT_UPLOADS = 10;
    // 参考图槽位容量上限（数组容量，实际可用数量由 _getRefLimit 按模型限制）
    const MAX_REF_SLOTS = 30;
    const NORMAL_SLOT_WIDTH = 80;

    // @ 候选媒体图标（视频/音频占位缩略图）
    const MEDIA_TAG_ICONS = {
        video: '<svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(0,229,255,0.9)"><path d="M8 5v14l11-7z"/></svg>',
        audio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(171,122,255,0.9)"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>',
        character: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(196,241,123,0.95)" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>'
    };

    // 简易 i18n：优先用 window.i18n / window.t，否则回退到 key 或 CN
    function t(key) {
        if (typeof window.t === 'function') return window.t(key) || key;
        const dict = (global.i18n && (global.i18n.zh || global.i18n.en)) || {};
        return dict[key] || key;
    }

    function getBackendUrl() {
        if (global.API_CONFIG && global.API_CONFIG.baseUrl) return global.API_CONFIG.baseUrl;
        const host = global.location && global.location.hostname ? global.location.hostname : 'localhost';
        const port = window.location.port; if (!port || port === '80' || port === '443') { return window.location.protocol + '//' + host; } return 'http://' + host + ':3001';
    }

    const PromptBar = {
        // ---- DOM 引用（init 时获取）----
        el: {
            promptInput: null, modelBtn: null, modelMenu: null, modelLabel: null,
            comboBtn: null, comboMenu: null, comboLabel: null,
            refsStrip: null, refsMini: null, addImgBtn: null,
            generateBtn: null, quickModeBtn: null, proModeBtn: null, taskCounter: null,
            mjStylize: null, mjStylizeValue: null, mjChaos: null, mjChaosValue: null,
            mjQuality: null, mjStyle: null, mjNo: null, mjParamsSection: null,
            resolutionSection: null, gptQualitySection: null, gptQualitySlider: null, quality: null, imageSelectDropdown: null, dropdownImages: null,
            videoSection: null, durationGrid: null, videoResGrid: null,
            genModeToggle: null
        },

        // ---- 状态 ----
        uploadedImages: new Array(8).fill(null),
        currentModel: '',
        currentAspect: 'auto',
        currentRes: '1K',
        currentQuality: 'medium',
        currentDuration: 5,   // 视频时长（秒）
        currentVideoRes: '',  // 视频分辨率（480p/720p/1080p/768P）
        currentGenMode: 'image', // 生成模式：image | video（视频|图片切换键）
        videoMode: 'reference',  // 视频生成模式：reference=全能参考 | first_last=首尾帧
        draftMode: false,        // 样片模式（仅 Seedance 2.5）：true=出 480p 样片，7 天内可升级 1080p 成片
        lastImageModel: '',   // 各模式记住的模型，切回时恢复
        lastVideoModel: '',
        currentProMode: false,
        apiConfig: null,
        modelConfigMap: {},
        loadingImagesCount: 0,
        uploadQueue: [],
        activeUploads: 0,
        dragState: { isDragging: false, draggedIndex: null, longPressTimer: null, startX: 0, currentX: 0, hasMoved: false },
        imageSelectDropdown: null,
        dropdownImages: null,
        savedRange: null,
        dropdownListenersTimeout: null,
        currentEditingTag: null,
        _inited: false,
        _bindings: [],   // 存放需在 destroy 时解绑的监听器

        // ---- 钩子（外部可覆盖）----
        /** 生成按钮点击；params = { prompt, model, actualModel, aspectRatio, imageSize, imageUrls, api, mjParams } */
        onGenerate: null,
        /** 参考图列表发生变化时通知外部（用于同步连线等）images = 数组 */
        onRefsChange: null,
        /** 比例选择变化时通知外部（画布可据此更新节点框比例）aspect = 'auto'/'16:9'/... */
        onAspectChange: null,
        /** 模型/分辨率变化时通知外部（画布据此保存到当前节点）type='model'|'res', value=选中值 */
        onParamChange: null,
        /** 打开图片编辑器（画布可不实现或自定义） */
        onOpenImageEditor: null,
        /**
         * 点击「添加参考图」并选中文件后触发（画布场景覆盖此钩子）。
         * 返回 true 表示已接管（不再走默认的"填入输入栏预览区"流程）；
         * 返回 false / undefined 则走默认流程。
         */
        onAddRefImage: null,

        // ============ 初始化 ============
        init() {
            if (this._inited) return;
            this._inited = true;
            const $ = (id) => document.getElementById(id);
            const e = this.el;
            e.promptInput = $('promptInput');
            e.modelBtn = $('modelBtn'); e.modelMenu = $('modelMenu'); e.modelLabel = $('modelLabel');
            e.comboBtn = $('comboBtn'); e.comboMenu = $('comboMenu'); e.comboLabel = $('comboLabel');
            e.refsStrip = $('refsStrip'); e.refsMini = $('refsMini'); e.addImgBtn = $('addImgBtn');
            e.generateBtn = $('generateBtn'); e.quickModeBtn = $('quickModeBtn'); e.proModeBtn = $('proModeBtn'); e.nanoVerBtn = $('nanoVerBtn'); e.taskCounter = $('taskCounter');
            // 滑块统一收进 bar-tools（紧跟比例/分辨率）：此前在 bottom-lower 中被 flex:1 的 bar-tools 隔开（单胶囊空隙大）或挤压缩水（双胶囊重叠）
            const barToolsEl = document.querySelector('.bottom-lower .bar-tools');
            if (barToolsEl) ['videoModeBtn', 'quickModeBtn', 'nanoVerBtn', 'proModeBtn'].forEach(id => {
                const b = document.getElementById(id);
                if (b && b.parentElement !== barToolsEl) barToolsEl.appendChild(b);
            });
            e.mjStylize = $('mjStylize'); e.mjStylizeValue = $('mjStylizeValue');
            e.mjChaos = $('mjChaos'); e.mjChaosValue = $('mjChaosValue');
            e.mjQuality = $('mjQuality'); e.mjStyle = $('mjStyle'); e.mjNo = $('mjNo');
            e.mjParamsSection = $('mjParamsSection'); e.resolutionSection = $('resolutionSection'); e.gptQualitySection = $('gptQualitySection'); e.gptQualitySlider = $('gptQualitySlider');
            e.imageSelectDropdown = $('imageSelectDropdown'); e.dropdownImages = $('dropdownImages');
            this.imageSelectDropdown = e.imageSelectDropdown; this.dropdownImages = e.dropdownImages;
            e.videoSection = $('videoSection'); e.durationGrid = $('durationGrid'); e.videoResGrid = $('videoResGrid');
            e.genModeToggle = $('genModeToggle');
            this._bindGenMode();

            // 从本地存储恢复模型（尊重用户真实选择，不再强制改写到 GPT 模型）
            const savedModel = localStorage.getItem('nano_selected_model');
            if (savedModel) this.currentModel = savedModel;
            // Nano 家族版本状态独立持久化：与当前模型（正常/快速）解耦
            this.nanoVersion = localStorage.getItem('nano_ver') === '2.1' ? '2.1' : '2.0';

            this._bindAll();
            // @ 视频/音频标签增删后刷新积分显示（参考视频时长会计入视频模型计费）
            if (typeof MutationObserver !== 'undefined' && e.promptInput) {
                new MutationObserver(() => this.updatePriceDisplay()).observe(e.promptInput, { childList: true, subtree: true });
            }
            this.updateComboLabel();
            // 异步加载配置
            this.loadApiConfig();
        },

        _on(target, type, handler, opts) {
            target && target.addEventListener(type, handler, opts);
            this._bindings.push({ target, type, handler, opts });
        },

        _bindAll() {
            const e = this.el, self = this;
            // 模型下拉
            this._on(e.modelBtn, 'click', (ev) => {
                ev.stopPropagation();
                const hidden = e.modelMenu.classList.contains('hidden');
                e.modelMenu.classList.add('hidden');
                e.comboMenu.classList.add('hidden');
                if (hidden) e.modelMenu.classList.remove('hidden');
            });
            // combo 下拉
            this._on(e.comboBtn, 'click', (ev) => {
                ev.stopPropagation();
                const hidden = e.comboMenu.classList.contains('hidden');
                e.modelMenu.classList.add('hidden');
                e.comboMenu.classList.add('hidden');
                if (hidden) e.comboMenu.classList.remove('hidden');
            });
            // 滑条拖动松开不冒泡到 document（否则松手瞬间收起打开中的下拉面板）
            const durSliderEl = document.getElementById('durationSlider');
            if (durSliderEl) this._on(durSliderEl, 'click', (ev) => ev.stopPropagation());
            if (e.gptQualitySlider) this._on(e.gptQualitySlider, 'click', (ev) => ev.stopPropagation());
            // 点击空白关闭
            this._on(document, 'click', () => {
                e.modelMenu.classList.add('hidden');
                e.comboMenu.classList.add('hidden');
            });
            // combo 选项（分辨率）
            const comboOptions = document.querySelectorAll('.combo-option');
            comboOptions.forEach(option => {
                this._on(option, 'click', (ev) => {
                    ev.stopPropagation();
                    const type = option.dataset.type, value = option.dataset.value;
                    const section = option.closest('.combo-section');
                    section.querySelectorAll('.combo-option').forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');
                    if (type === 'size') { this.currentRes = value; this.updatePriceDisplay(); }
                    if (type === 'quality') { this.currentQuality = value; this.updatePriceDisplay(); }
                    this.updateComboLabel();
                    // 通知外部保存到当前节点
                    if (typeof this.onParamChange === 'function') this.onParamChange(type === 'size' ? 'res' : type, value);
                });
            });
            // 比例选项
            const ratioOptions = document.querySelectorAll('.ratio-option');
            ratioOptions.forEach(option => {
                this._on(option, 'click', (ev) => {
                    ev.stopPropagation();
                    ratioOptions.forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');
                    this.currentAspect = option.dataset.value;
                    this.updateComboLabel();
                    // 通知外部（画布）：比例变化，可同步更新节点框比例
                    if (typeof this.onAspectChange === 'function') this.onAspectChange(this.currentAspect);
                });
            });
            // MJ 参数面板阻止冒泡
            this._on(e.mjParamsSection, 'click', (ev) => ev.stopPropagation());
            this._on(e.mjStylize, 'input', () => { if (e.mjStylizeValue) e.mjStylizeValue.textContent = e.mjStylize.value; });
            this._on(e.mjChaos, 'input', () => { if (e.mjChaosValue) e.mjChaosValue.textContent = e.mjChaos.value; });
            // 添加参考图按钮
            this._on(e.addImgBtn, 'click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.triggerUpload(); });
            // 生成按钮
            this._on(e.generateBtn, 'click', () => this._handleGenerate());
            this._on(e.quickModeBtn, 'click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.toggleQuickMode(); });
            this._on(e.proModeBtn, 'click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.toggleProMode(); });
            this._on(e.nanoVerBtn, 'click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.toggleNanoVersion(); });
            this._on(e.gptQualitySlider, 'input', () => this.updateQualityFromSlider());
            if (e.gptQualitySection) this._on(e.gptQualitySection, 'click', (ev) => ev.stopPropagation());
            // 提示词粘贴：图片走上传，文本强制纯文本
            this._on(e.promptInput, 'paste', (ev) => this._onPaste(ev));
            // 提示词 input：检测 @
            this._on(e.promptInput, 'input', (ev) => { if (ev.isComposing) return; this.checkAndShowImageDropdown(); });
            // @ 后按数字直接插标签
            this._on(e.promptInput, 'keydown', (ev) => this._onPromptKeyDown(ev));
            // 点击标签把光标移到后面
            this._on(e.promptInput, 'mousedown', (ev) => {
                const tag = ev.target.closest && ev.target.closest('.image-tag');
                if (tag) {
                    const range = document.createRange();
                    range.setStartAfter(tag); range.collapse(true);
                    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
                }
            });
            // 拖放标签到光标处
            this._setupPromptInputDropZone();
            // selectionchange
            this._on(document, 'selectionchange', () => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;
                const anchor = sel.anchorNode;
                if (!anchor || !e.promptInput.contains(anchor)) return;
                if (this.currentEditingTag) return;
                if (this.imageSelectDropdown && !this.imageSelectDropdown.classList.contains('hidden')) {
                    this.savedRange = sel.getRangeAt(0).cloneRange();
                    this.showImageDropdown();
                }
            });
            // 点击外部关闭下拉
            this._on(document, 'click', (ev) => {
                if (!this.imageSelectDropdown) this.imageSelectDropdown = document.getElementById('imageSelectDropdown');
                if (this.imageSelectDropdown && !this.imageSelectDropdown.contains(ev.target)) {
                    if (!e.promptInput.contains(ev.target)) this.hideImageDropdown();
                }
            });
            // resize 重新定位
            this._on(window, 'resize', () => {
                if (this.imageSelectDropdown && !this.imageSelectDropdown.classList.contains('hidden')) this.showImageDropdown();
            });
            // 整页拖放上传（参考图）
            this._on(document.body, 'dragover', (ev) => ev.preventDefault());
            this._on(document.body, 'drop', (ev) => {
                ev.preventDefault();
                // 仅在画布场景才由 canvas-main 处理节点拖入；这里只处理拖到输入栏
                if (ev.target && ev.target.closest && ev.target.closest('#promptInput')) {
                    if (ev.dataTransfer.files && ev.dataTransfer.files.length) {
                        Array.from(ev.dataTransfer.files).forEach(f => {
                            // 与粘贴路径一致：画布场景先由 onAddRefImage 接管（建节点+连线）
                            if (this.onAddRefImage && this.onAddRefImage(f) === true) return;
                            this.handleFile(f);
                        });
                    }
                }
            });
        },

        // ============ 模型 / 配置 ============
        async loadApiConfig() {
            try {
                const res = await fetch(`${getBackendUrl()}/api/config`);
                const result = await res.json();
                if (result.code === 200) {
                    this.apiConfig = result.data;
                    Object.values(this.apiConfig.apis).forEach(api => {
                        const models = api.frontend?.models || api.models;
                        if (models) models.forEach(m => { this.modelConfigMap[m.id] = m; });
                    });
                    // 视频模型（仅画布）注册进映射表；主界面下拉不渲染（renderModelOptionsForApi 有 CanvasMain 守卫）
                    ((this.apiConfig.videoApis && this.apiConfig.videoApis.models) || []).forEach(m => {
                        m._isVideo = true;
                        this.modelConfigMap[m.id] = m;
                    });
                    // _PB_DRAFT_PSEUDO_1027 样片伪模型：Seedance 2.5 的 480p 样片形态进模型下拉（替代原成片/样片滑块）
                    // 选中即样片模式；提交时剥离 -draft 后缀还原真实模型并带 draft:true。配置自 2.5 派生（480p 价矩阵/时长/参考数）。
                    {
                        const s25 = this.modelConfigMap['doubao-seedance-2-5-260628'];
                        if (s25 && !this.modelConfigMap['doubao-seedance-2-5-260628-draft']) {
                            const dcfg = Object.assign({}, s25, {
                                id: 'doubao-seedance-2-5-260628-draft',
                                name: 'Seedance 2.5 样片',
                                description: '480p 低成本样片，确认效果后 7 天内可升级 1080p 成片',
                                badge: '样片',
                                tagline: '480p 快速出片，7 天内可一键升级成片',
                                supportedResolutions: ['480p'],
                                priceMatrix: (s25.priceMatrix && s25.priceMatrix['480p']) ? { '480p': s25.priceMatrix['480p'] } : s25.priceMatrix
                            });
                            this.modelConfigMap['doubao-seedance-2-5-260628-draft'] = dcfg;
                            const vlist = (this.apiConfig.videoApis && this.apiConfig.videoApis.models) || null;
                            if (vlist && !vlist.some(m => m.id === 'doubao-seedance-2-5-260628-draft')) {
                                vlist.push({ id: 'doubao-seedance-2-5-260628-draft', name: 'Seedance 2.5 样片', _isVideo: true, description: dcfg.description, badge: '样片', tagline: dcfg.tagline });
                            }
                        }
                    }
                    const savedModel = localStorage.getItem('nano_selected_model');
                    const activeNodeId = global.CanvasMain && global.CanvasMain._activeNodeId;
                    const activeNode = activeNodeId && global.CanvasBlocks && global.CanvasBlocks.getById(activeNodeId);
                    // 配置请求可能晚于节点选中返回；已有生成节点时以节点参数为准，不能被本地上次选择覆盖。
                    if (activeNode && activeNode.nodeType === 'gen') {
                        this.currentModel = activeNode.model || this.currentModel;
                        this.currentAspect = activeNode.aspectRatio || this.currentAspect;
                        this.currentRes = activeNode.size || this.currentRes;
                    } else if (savedModel) {
                        this.currentModel = savedModel;
                    }
                    // 新用户 / 清过缓存 / 保存的模型已下线：回退到默认模型，
                    // 否则按钮显示的是占位文字，实际请求 model 为空，服务端会拒绝（"无效的模型名称"）
                    if (!this.currentModel || !this.modelConfigMap[this.currentModel]) {
                        const prefer = ['Nano Banana Pro', 'Nano Banana 2.0', 'GPT Image 2 Pro', 'GPT Image 2 标准', 'Seedream 5.0'];
                        const enabledIds = [];
                        Object.values(this.apiConfig.apis).forEach(api => {
                            if (api.enabled === false) return;
                            (api.frontend?.models || api.models || []).forEach(m => enabledIds.push(m.id));
                        });
                        const fallback = prefer.find(id => enabledIds.includes(id)) || enabledIds[0] || '';
                        if (fallback) {
                            console.warn('[PromptBar] 模型无效，回退到默认模型:', this.currentModel || '(空)', '->', fallback);
                            this.currentModel = fallback;
                        }
                    }
                    this._syncNanoVersionFromModel(this.currentModel);
                    // 按恢复的模型推导生成模式（视频|图片切换键）
                    this.currentGenMode = this._isVideoModel(this.currentModel) ? 'video' : 'image';
                    if (this._isVideoModel(this.currentModel)) { this.lastVideoModel = this.currentModel; } else { this.lastImageModel = this.currentModel; }
                    this._updateGenModeUI();
                    this.renderModelOptionsForApi(this.apiConfig.defaultApi);
                    this.updateResolutionOptions(this.currentModel);
                    this._toggleVideoParams(this.currentModel);
                    this.updatePriceDisplay();
                    return true;
                }
                throw new Error('服务器返回错误');
            } catch (err) {
                console.error('[PromptBar] 加载API配置失败:', err);
                if (this.el.modelMenu) this.el.modelMenu.innerHTML = '<div style="padding: 10px; color: #ff4444; font-size: 12px; text-align: center;">配置加载失败</div>';
                return false;
            }
        },

        getActualModel(model, resolution) {
            const defaultApi = this.apiConfig?.defaultApi;
            if (defaultApi && this.apiConfig?.apis?.[defaultApi]?.frontend?.models) {
                const cfg = this.apiConfig.apis[defaultApi].frontend.models.find(m => m.id === model);
                if (cfg?.actualModel) return cfg.actualModel;
            }
            return model;
        },

        getModelDesc(model) {
            const key = MODEL_DESC_KEYS[model.id];
            return key ? t(key) : (model.description || '');
        },

        renderModelOptionsForApi(apiKey) {
            const modelMenu = this.el.modelMenu;
            if (!modelMenu || !this.apiConfig) return;
            let allModels = [];
            const seen = new Set();
            Object.entries(this.apiConfig.apis).forEach(([k, api]) => {
                if (api.enabled === false) return;
                const models = api.frontend?.models || api.models || [];
                models.forEach(m => {
                    // Nano Banana Lite 不在下拉列表单独显示：仅通过 Nano 2 的快速按键进入；2.1 仅通过版本胶囊切换进入
                    if (m.id === 'Nano Banana 2.0 快速' || m.id === 'Seedream 5.0 快速' || m.id === 'Nano Banana 2.1') return;
                    // 视频模式下不列出图片模型（视频|图片切换键）
                    if (global.CanvasMain && this.currentGenMode === 'video') return;
                    if (!seen.has(m.id)) { seen.add(m.id); allModels.push({ ...m, _apiKey: k }); }
                });
            });
            while (modelMenu.firstChild) modelMenu.removeChild(modelMenu.firstChild);
            const familySeen = new Set();
            allModels = allModels.map(model => {
                if (!model.id.startsWith('GPT Image 2')) return model;
                const family = model.id.startsWith('GPT Image 2.5') ? 'gpt25' : 'gpt2';
                if (familySeen.has(family)) return null;
                familySeen.add(family);
                // 真正替换为简化家族名（此前写法只改了局部变量，数组内对象未变，导致下拉仍显示原始带后缀名字）
                return { ...model, id: family === 'gpt25' ? 'GPT Image 2.5' : 'GPT Image 2 标准', name: family === 'gpt25' ? 'GPT Image 2.5' : 'GPT Image 2 标准' };
            }).filter(Boolean);
            // 主模型固定显示顺序：nano2 → nanopro → gpt2 → gpt2.5 → seed5.0（未列入的排最后）
            const MODEL_ORDER = ['Nano Banana 2.0', 'Nano Banana Pro', 'GPT Image 2 标准', 'GPT Image 2.5', 'Seedream 5.0'];
            // 视频模型（仅画布下拉出现，排最后）
            if (global.CanvasMain && this.currentGenMode === 'video') {
                ((this.apiConfig.videoApis && this.apiConfig.videoApis.models) || []).forEach(m => {
                    if (!seen.has(m.id)) { seen.add(m.id); allModels.push(Object.assign({}, m, { _apiKey: 'video', _isVideo: true })); }
                });
            }
            // 视频模型按常用顺序排在图片模型之后；未列入的按服务返回顺序排最后
            const VIDEO_ORDER = ['doubao-seedance-2-5-260628', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615', 'MiniMax-H3'];
            allModels.sort((a, b) => {
                if (this._isVideoModel(a.id) !== this._isVideoModel(b.id)) return this._isVideoModel(a.id) ? 1 : -1;
                const order = this._isVideoModel(a.id) ? VIDEO_ORDER : MODEL_ORDER;
                const ia = order.indexOf(a.id);
                const ib = order.indexOf(b.id);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            allModels.forEach((model) => {
                const option = document.createElement('div');
                option.className = 'model-option';
                option.dataset.value = model.id;
                option.dataset.api = model._apiKey || 'auto';
                if (model.model4k) option.dataset.model4k = model.model4k;
                const isFamilySelected = (model.id === 'GPT Image 2 标准' && this.currentModel.startsWith('GPT Image 2 ')) || (model.id === 'GPT Image 2.5' && this.currentModel.startsWith('GPT Image 2.5'));
                const isNanoFamilySelected = model.id === 'Nano Banana 2.0' && (this.currentModel === 'Nano Banana 2.0' || this.currentModel === 'Nano Banana 2.0 快速' || this.currentModel === 'Nano Banana 2.1');
                const isSeedream5Selected = model.id === 'Seedream 5.0' && this._isSeedream5Family(this.currentModel);
                if (model.id === this.currentModel || isFamilySelected || isNanoFamilySelected || isSeedream5Selected) {
                    option.classList.add('selected');
                    if (this.el.modelLabel) this.el.modelLabel.textContent = model.name;
                }
                const vcaps = model._isVideo ? this.videoCaps(model.id) : null;
                if (vcaps && vcaps.badge) {
                    // 特价等徽标模型：名称去掉与徽标重复的后缀，右侧胶囊徽标 + 一句话价格说明
                    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                    let nm = String(model.name || model.id);
                    if (nm.length > vcaps.badge.length + 1 && nm.endsWith(' ' + vcaps.badge)) nm = nm.slice(0, -(vcaps.badge.length + 1));
                    option.classList.add('has-badge');
                    option.innerHTML = `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-weight:500;display:flex;align-items:center;gap:6px;"><span>${escH(nm)}</span><span class="model-badge" style="display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:10px;font-weight:600;line-height:1;color:var(--px-lime,#c4f17b);background:rgba(196,241,123,0.14);border:1px solid rgba(196,241,123,0.4);">${escH(vcaps.badge)}</span></span><span class="model-desc" style="font-size:11px;color:#888;">${escH(vcaps.tagline || this.getModelDesc(model))}</span></div>`;
                } else {
                    option.innerHTML = `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-weight:500;">${model.name}</span><span class="model-desc" style="font-size:11px;color:#888;">${this.getModelDesc(model)}</span></div>`;
                }
                modelMenu.appendChild(option);
            });
            this._bindModelOptions();
            this.updateResolutionOptions(this.currentModel);
            this.toggleMjParams(this.currentModel);
            this.toggleGptQuality(this.currentModel);
            this.updateQuickModeButton(this.currentModel);
            this.updateProModeButton(this.currentModel);
            this.updateNanoVerButton(this.currentModel);
        },

        _bindModelOptions() {
            const opts = document.querySelectorAll('.model-option');
            opts.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    let value = option.dataset.value;
                    if (value === 'GPT Image 2 标准' || value === 'GPT Image 2.5') value = this.getFamilyModel(value === 'GPT Image 2.5' ? 'gpt25' : 'gpt2', false, false);
                    this.currentModel = value;
                    // _PB_DRAFT_PSEUDO_1027 伪模型选中 = 样片模式开；选其他模型一律关（滑块已下线）
                    this.draftMode = (value === 'doubao-seedance-2-5-260628-draft');
                    if (this._isVideoModel(value)) { this.lastVideoModel = value; } else { this.lastImageModel = value; }
                    this._syncNanoVersionFromModel(value);
                    localStorage.setItem('nano_selected_model_api', option.dataset.api || 'auto');
                    opts.forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');
                    let cfg = null;
                    const defaultApi = this.apiConfig?.defaultApi;
                    if (defaultApi && this.apiConfig?.apis?.[defaultApi]) {
                        const apiModels = this.apiConfig.apis[defaultApi].frontend?.models || this.apiConfig.apis[defaultApi].models || [];
                        cfg = apiModels.find(m => m.id === value);
                    }
                    if (!cfg) cfg = this.modelConfigMap[value];
                    if (this.el.modelLabel) this._updateModelLabel();
                    this._toggleVideoParams(value);
                    this.updateResolutionOptions(value);
                    this.toggleMjParams(value);
                    this.toggleGptQuality(value);
                    // 先重置画质为新模型家族默认值，再刷新价格，避免沿用上一模型的画质档位算价
                    this.updatePriceDisplay();
                    this.updateQuickModeButton(value);
                    this.updateProModeButton(value);
                    this.updateNanoVerButton(value);
                    localStorage.setItem('nano_selected_model', value);
                    // 通知外部保存到当前节点
                    if (typeof this.onParamChange === 'function') this.onParamChange('model', value);
                });
            });
        },

        updateResolutionOptions(model) {
            const cfg = this.modelConfigMap[model];
            let allowed = cfg?.supportedResolutions || ['1K', '2K', '4K'];
            // Nano Banana Lite 只支持 1K：快速模式下灰掉其他分辨率
            if (model === 'Nano Banana 2.0 快速') allowed = ['1K'];
            const sizeOptions = document.querySelectorAll('.combo-option[data-type="size"]');
            sizeOptions.forEach(opt => {
                const v = opt.dataset.value;
                if (allowed.includes(v)) {
                    opt.classList.remove('disabled'); opt.style.opacity = '1'; opt.style.pointerEvents = 'auto';
                } else {
                    opt.classList.add('disabled'); opt.style.opacity = '0.3'; opt.style.pointerEvents = 'none'; opt.classList.remove('selected');
                }
            });
            if (allowed.length && !allowed.includes(this.currentRes)) {
                this.currentRes = allowed[0];
                sizeOptions.forEach(opt => opt.classList.toggle('selected', opt.dataset.value === this.currentRes));
                this.updateComboLabel();
            }
        },

        getFamilyModel(family, quick, pro) {
            // pro 参数语义统一为『标准版』：
            // gpt2 家族：pro→GPT Image 2 标准（基础），非 pro→GPT Image 2 Pro（专业线路）
            // gpt25 家族：pro→标准档（快速/标准），非 pro→Pro 档
            // 与 updateProModeButton 的 active 状态（标准档时 active）保持一致
            if (family === 'gpt25') return quick ? (pro ? 'GPT Image 2.5 快速' : 'GPT Image 2.5 快速 Pro') : (pro ? 'GPT Image 2.5' : 'GPT Image 2.5 Pro');
            return pro ? 'GPT Image 2 标准' : 'GPT Image 2 Pro';
        },
        updateProModeButton(model) {
            const btn=this.el.proModeBtn; if(!btn) return; const visible=!!model && model.startsWith('GPT Image 2'); btn.classList.toggle('hidden',!visible); const isPro=!model.endsWith(' Pro'); btn.classList.toggle('active',isPro); btn.title=isPro?'切换为标准线路':'切换为 Pro 专业线路';
        },
        toggleProMode() {
            const family=this.currentModel.startsWith('GPT Image 2.5')?'gpt25':'gpt2'; const currentPro=!this.currentModel.endsWith(' Pro'); const nextPro=!currentPro; const next=this.getFamilyModel(family,this.currentModel.includes('快速'),nextPro); if(!this.modelConfigMap[next]) return; this.currentProMode=nextPro; this.currentModel=next; localStorage.setItem('nano_selected_model',next); this.renderModelOptionsForApi(this.apiConfig.defaultApi); this.updateResolutionOptions(next); this.toggleGptQuality(next); this.updateQuickModeButton(next); this.updateProModeButton(next); this.updatePriceDisplay(); if(this.onParamChange)this.onParamChange('model',next);
        },

        isGpt25Model(model) { return !!model && /^GPT Image 2\.5( 快速)?( Pro)?$/.test(model); },
        // 下拉选项值 ↔ 实际模型 的家族匹配：统一处理家族折叠项与隐藏快速项，保证绿色选中态不丢
        _isSeedream5Family(model) { return model === 'Seedream 5.0' || model === 'Seedream 5.0 快速'; },
        _modelOptionMatches(optionValue, model) {
            if (!model) return false;
            if (optionValue === model) return true;
            if (optionValue === 'GPT Image 2.5') return model.startsWith('GPT Image 2.5');
            if (optionValue === 'GPT Image 2 标准') return model.startsWith('GPT Image 2 ');
            if (optionValue === 'Nano Banana 2.0') return this._isNano2Family(model);
            if (optionValue === 'Seedream 5.0') return this._isSeedream5Family(model);
            return false;
        },
        // Nano 2 家族：版本状态独立（this.nanoVersion: '2.0' | '2.1'），快速模式统一走 Lite，正常模式按版本取模型
        _isNano2Family(model) { return model === 'Nano Banana 2.0' || model === 'Nano Banana 2.1' || model === 'Nano Banana 2.0 快速'; },
        _nanoNormalModel() { return this.nanoVersion === '2.1' ? 'Nano Banana 2.1' : 'Nano Banana 2.0'; },
        _syncNanoVersionFromModel(model) {
            // 模型为 2.0/2.1 正常态时同步版本状态；Lite（快速）不改变版本状态，胶囊保持原位置
            if (model === 'Nano Banana 2.0') this.nanoVersion = '2.0';
            else if (model === 'Nano Banana 2.1') this.nanoVersion = '2.1';
            localStorage.setItem('nano_ver', this.nanoVersion);
        },
        updateNanoVerButton(model) {
            const btn = this.el.nanoVerBtn;
            if (!btn) return;
            const visible = this._isNano2Family(model);
            btn.classList.toggle('hidden', !visible);
            if (!visible) return;
            const is21 = this.nanoVersion === '2.1';
            btn.classList.toggle('active', is21);
            btn.title = is21 ? '切换到 2.0 版本' : '切换到 2.1 版本';
            btn.setAttribute('aria-label', btn.title);
        },
        toggleNanoVersion() {
            if (!this._isNano2Family(this.currentModel)) return;
            this.nanoVersion = this.nanoVersion === '2.1' ? '2.0' : '2.1';
            localStorage.setItem('nano_ver', this.nanoVersion);
            // 处于快速（Lite）时仅更新版本状态与胶囊，生成模型保持 Lite 不变
            if (this.currentModel === 'Nano Banana 2.0 快速') { this.updateNanoVerButton(this.currentModel); return; }
            const next = this._nanoNormalModel();
            if (!this.modelConfigMap[next]) { this.nanoVersion = this.nanoVersion === '2.1' ? '2.0' : '2.1'; localStorage.setItem('nano_ver', this.nanoVersion); this.updateNanoVerButton(this.currentModel); return; }
            this.currentModel = next;
            localStorage.setItem('nano_selected_model', next);
            localStorage.setItem('nano_selected_model_api', 'auto');
            this._updateModelLabel();
            this.updateResolutionOptions(next); this.toggleGptQuality(next); this.updateQuickModeButton(next); this.updateProModeButton(next); this.updateNanoVerButton(next); this.updatePriceDisplay();
            if (typeof this.onParamChange === 'function') this.onParamChange('model', next);
        },
        quickModelFor(model) {
            // Nano 2 家族快速模式：任意版本正常态 → Lite；Lite → 当前版本正常态
            if (model === 'Nano Banana 2.0' || model === 'Nano Banana 2.1') return 'Nano Banana 2.0 快速';
            if (model === 'Nano Banana 2.0 快速') return this._nanoNormalModel();
            // Seedream 系列快速模式：5.0 ↔ 5.0 快速 互切
            if (model === 'Seedream 5.0') return 'Seedream 5.0 快速';
            if (model === 'Seedream 5.0 快速') return 'Seedream 5.0';
            // GPT 2.5 快速模式：快速 ↔ 标准 互切
            if (!this.isGpt25Model(model)) return null;
            const vip = model.endsWith(' Pro') ? ' Pro' : '';
            return model.includes('快速') ? 'GPT Image 2.5' + vip : 'GPT Image 2.5 快速' + vip;
        },
        updateQuickModeButton(model) {
            const btn = this.el.quickModeBtn;
            // 快速按键对 GPT 2.5 家族和 Nano 2 系列均显示
            const isNanoQuick = model === 'Nano Banana 2.0' || model === 'Nano Banana 2.0 快速' || model === 'Nano Banana 2.1' || model === 'Seedream 5.0' || model === 'Seedream 5.0 快速';
            const visible = this.isGpt25Model(model) || isNanoQuick;
            if (!btn) return;
            btn.classList.toggle('hidden', !visible);
            if (!visible) return;
            const quick = model.includes('快速');
            btn.classList.toggle('active', quick);
            btn.title = quick ? '切换为标准模式' : '切换为快速模式';
            btn.setAttribute('aria-label', btn.title);
            
        },
        toggleQuickMode() {
            const next = this.quickModelFor(this.currentModel);
            if (!next || !this.modelConfigMap[next]) return;
            this.currentModel = next;
            this._syncNanoVersionFromModel(next);
            localStorage.setItem('nano_selected_model', next);
            // 端口路由统一在提交时由 getApiForModel 解析，这里固定存 'auto'
            const api = 'auto';
            localStorage.setItem('nano_selected_model_api', api);
            this._updateModelLabel();
            document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', this._modelOptionMatches(o.dataset.value, next)));
            this.updateResolutionOptions(next); this.toggleGptQuality(next); this.updateQuickModeButton(next); this.updateProModeButton(next); this.updateNanoVerButton(next); this.updatePriceDisplay();
            if (typeof this.onParamChange === 'function') this.onParamChange('model', next);
        },

        updateQualityFromSlider() {
            const cfg = this.modelConfigMap[this.currentModel]; const slider=this.el.gptQualitySlider; if(!cfg || !slider) return; this.currentQuality=cfg.qualityOptions[Number(slider.value)] || 'medium'; this.updatePriceDisplay(); if(typeof this.onParamChange==='function') this.onParamChange('quality',this.currentQuality);
        },
        toggleGptQuality(model) {
            const cfg = this.modelConfigMap[model];
            const curFamily = model && model.startsWith('GPT Image 2.5') ? 'gpt25' : (model && model.startsWith('GPT Image 2 ') ? 'gpt2' : 'other');
            if (this._lastQFamily !== curFamily) { this._lastQFamily = curFamily; const dq = curFamily === 'gpt25' ? 'high' : 'medium'; if (cfg && cfg.qualityOptions && cfg.qualityOptions.includes(dq)) this.currentQuality = dq; }
            const visible = !!(cfg && Array.isArray(cfg.qualityOptions) && cfg.qualityOptions.length);
            // 无画质档的模型（Nano / Seedream）：画质回到默认 medium，避免残留 GPT 2.5 的 high 被提交
            if (cfg && !visible) this.currentQuality = 'medium';
            const slider = this.el.gptQualitySlider;
            if (slider && visible) { const idx = Math.max(0, cfg.qualityOptions.indexOf(this.currentQuality)); slider.max = String(Math.max(0, cfg.qualityOptions.length - 1)); slider.value = String(idx < 0 ? Math.min(1, cfg.qualityOptions.length - 1) : idx); }
            if (this.el.gptQualitySection) this.el.gptQualitySection.classList.toggle('hidden', !visible);
                        if (visible) { const labels=document.querySelectorAll('.quality-slider-labels [data-quality]'); labels.forEach(label => { label.style.display = cfg.qualityOptions.includes(label.dataset.quality) ? '' : 'none'; if(label.dataset.quality==='max') label.textContent='Ultra'; }); if (!cfg.qualityOptions.includes(this.currentQuality)) { const defaultQ = (model && model.startsWith('GPT Image 2.5')) ? 'high' : 'medium'; this.currentQuality = cfg.qualityOptions.includes(defaultQ) ? defaultQ : (cfg.qualityOptions.includes('medium') ? 'medium' : cfg.qualityOptions[0]); } }
        },

        toggleMjParams(model) {
            const isMj = model && model.startsWith('mj-');
            const isVideo = this._isVideoModel(model);
            if (this.el.resolutionSection) this.el.resolutionSection.classList.toggle('hidden', isMj || isVideo);
            if (this.el.mjParamsSection) this.el.mjParamsSection.classList.toggle('hidden', !isMj);
        },

        _isVideoModel(model) {
            const cfg = this.modelConfigMap[model];
            return !!(cfg && (cfg.isVideo || cfg._isVideo));
        },

        // 视频模型能力：优先读 /api/config 下发的配置字段（特价线路等），未配置时回退原有按模型 id 推断（Seedance / H3 行为不变）
        videoCaps(model) {
            const m = String(model || '');
            const cfg = this.modelConfigMap[m] || {};
            const isS25 = /seedance-2-5/i.test(m);
            const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
            return {
                maxImages: num(cfg.maxImages, isS25 ? 30 : 9),
                maxVideos: num(cfg.maxVideos, isS25 ? 10 : 3),
                maxAudios: num(cfg.maxAudios, isS25 ? 10 : 3),
                firstLast: typeof cfg.firstLast === 'boolean' ? cfg.firstLast : /seedance-2|minimax-h3/i.test(m),
                // 参考视频计费折算：Seedance 2.5 为 0.60×、2.0 系 0.65×、H3 不计费；配置了 refVideoBillFactor 的模型按配置
                refVideoBillFactor: num(cfg.refVideoBillFactor, /minimax-h3/i.test(m) ? 0 : (/seedance-?2[._-]?5|2\.5/i.test(m) ? 0.6 : 0.65)),
                refVideoMaxTotalSec: num(cfg.refVideoMaxTotalSec, 0),
                aspectRatios: (Array.isArray(cfg.aspectRatios) && cfg.aspectRatios.length) ? cfg.aspectRatios.slice() : null,
                badge: typeof cfg.badge === 'string' ? cfg.badge : '',
                tagline: typeof cfg.tagline === 'string' ? cfg.tagline : ''
            };
        },

        // 生成模式切换键（视频 | 图片）：切换后模型下拉只显示对应类型
        _bindGenMode() {
            const toggle = this.el.genModeToggle;
            if (!toggle) return;
            toggle.querySelectorAll('.gen-mode-option').forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const mode = btn.dataset.mode;
                    if (!mode || mode === this.currentGenMode) return;
                    this.currentGenMode = mode;
                    this._updateGenModeUI();
                    // 切换到该模式记住的模型；没有记忆则取该类型第一个
                    const isVideoMode = mode === 'video';
                    let target = isVideoMode ? this.lastVideoModel : this.lastImageModel;
                    if (!(target && this.modelConfigMap[target] && this._isVideoModel(target) === isVideoMode)) {
                        target = this._firstModelOfMode(isVideoMode);
                    }
                    if (target) this._selectModelInternal(target);
                    if (typeof this.onParamChange === 'function') this.onParamChange('genMode', mode);
                });
            });
        },

        _updateGenModeUI() {
            const toggle = this.el.genModeToggle;
            if (!toggle) return;
            toggle.querySelectorAll('.gen-mode-option').forEach(b => {
                b.classList.toggle('selected', b.dataset.mode === this.currentGenMode);
            });
        },

        _firstModelOfMode(isVideo) {
            if (isVideo) {
                const list = (this.apiConfig.videoApis && this.apiConfig.videoApis.models) || [];
                return list.length ? list[0].id : '';
            }
            for (const api of Object.values(this.apiConfig.apis || {})) {
                if (api.enabled === false) continue;
                const list = api.frontend?.models || api.models || [];
                const first = list.find(m => m.id !== 'Nano Banana 2.0 快速' && m.id !== 'Seedream 5.0 快速' && m.id !== 'Nano Banana 2.1');
                if (first) return first.id;
            }
            return '';
        },

        // 程序化选模型：与下拉点击同一套联动（标签/参数区/价格/快捷键）
        _selectModelInternal(value) {
            setTimeout(() => { if (this._renderMediaRefs) this._renderMediaRefs(); }, 0);
            // 用户切换到另一个视频模型：时长回到默认 5s、分辨率回到默认档（720p/768P）
            if (value !== this.currentModel && this._isVideoModel(value)) {
                this.currentDuration = 5;
                this.currentVideoRes = '';
            }
            this.currentModel = value;
            // _PB_DRAFT_PSEUDO_1027 伪模型选中 = 样片模式开；选其他模型一律关
            this.draftMode = (value === 'doubao-seedance-2-5-260628-draft');
            if (this._isVideoModel(value)) { this.lastVideoModel = value; } else { this.lastImageModel = value; }
            this._syncNanoVersionFromModel(value);
            if (this.el.modelLabel) this._updateModelLabel();
            this._toggleVideoParams(value);
            this.updateResolutionOptions(value);
            this.toggleMjParams(value);
            this.toggleGptQuality(value);
            this.updatePriceDisplay();
            this.updateQuickModeButton(value);
            this.updateProModeButton(value);
            this.updateNanoVerButton(value);
            // 切换视频/图片模式或模型后刷新下拉列表（按 currentGenMode 过滤，否则下拉残留旧列表）
            this.renderModelOptionsForApi(this.apiConfig && this.apiConfig.defaultApi);
            // 参考图展示上限随模型变化，重渲染槽位
            this.renderRefs();
            localStorage.setItem('nano_selected_model', value);
            if (typeof this.onParamChange === 'function') this.onParamChange('model', value);
        },

        // 视频模型参数区切换：显示时长/分辨率档位，隐藏图片尺寸区；比例网格禁用不支持档位
        _toggleVideoParams(model) {
            const isVideo = this._isVideoModel(model);
            if (this.el.videoSection) this.el.videoSection.classList.toggle('hidden', !isVideo);
            if (!isVideo) {
                // 恢复比例档位；图片模型隐藏参考/首尾帧滑块（否则从视频模型切回时残留显示）
                document.querySelectorAll('.ratio-option').forEach(o => { o.classList.remove('disabled'); o.style.display = ''; o.style.opacity = '1'; o.style.pointerEvents = 'auto'; });
                const modeBtn = document.getElementById('videoModeBtn');
                if (modeBtn) modeBtn.classList.add('hidden');
                // hintMove1027: 成片/样片滑块与样片小字同样只属于视频模型——切到图片模型时一并隐藏（此前只藏了参考/首尾帧，导致图片节点残留成片/样片）
                const draftBtn = document.getElementById('draftModeBtn');
                if (draftBtn) draftBtn.classList.add('hidden');
                const draftHintEl = document.getElementById('draftHint');
                if (draftHintEl) draftHintEl.classList.add('hidden');
                if (this.draftMode) this.draftMode = false;
                return;
            }
            const cfg = this.modelConfigMap[model] || {};
            this._renderDurationOptions(cfg);
            // 先确定当前分辨率再渲染档位，保证有选中态；默认优先 720p / 768P 档
            let resList = cfg.supportedResolutions || ['720p'];
            // 样片模式（Seedance 2.5）：分辨率锁定 480p（样片即 480p 输出，7 天内可升级 1080p 成片）
            const draftLock = this.draftMode && /seedance-2-5/i.test(String(model || ''));
            if (draftLock) resList = ['480p'];
            if (!this.currentVideoRes || !resList.includes(this.currentVideoRes)) {
                this.currentVideoRes = draftLock ? '480p' : (resList.find(r => /^(720|768)/i.test(String(r))) || resList[0]);
            }
            this._renderVideoResOptions(resList);
            // 模式/任务类型联动（比例档禁用、时长禁用、下拉显隐）统一处理
            this._syncVideoModeUI();
        },

        // 生成模式联动：底排滑块切参考/首尾帧；视频模型不支持的比例档位直接隐藏（首尾帧仅留 auto）
        _syncVideoModeUI() {
            if (!this._vmBound) {
                this._vmBound = true;
                // hintMove1027: 样片小字挪到面板顶层悬浮显示，不参与工具行布局，避免挤压按键重叠
                const _hint = document.getElementById('draftHint');
                const _bar = _hint && _hint.closest('.bottom-bar');
                if (_hint && _bar && _hint.parentElement !== _bar) _bar.appendChild(_hint);
                const modeBtn = document.getElementById('videoModeBtn');
                if (modeBtn) modeBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    this.videoMode = this.videoMode === 'first_last' ? 'reference' : 'first_last';
                    if (this.renderRefs) this.renderRefs();
                    this._syncVideoModeUI();
                });
                // 样片模式 chip（仅 Seedance 2.5）：开启后分辨率锁定 480p，7 天内可一键升级 1080p 成片
                const draftBtn = document.getElementById('draftModeBtn');
                if (draftBtn) draftBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    this.draftMode = !this.draftMode;
                    this.updateResolutionOptions(this.currentModel);
                    this._toggleVideoParams(this.currentModel);
                    this.updatePriceDisplay();
                    this._syncVideoModeUI();
                    if (typeof this.onParamChange === 'function') this.onParamChange('draft', this.draftMode);
                });
                const durSlider = document.getElementById('durationSlider');
                if (durSlider) durSlider.addEventListener('input', () => {
                    const d = parseInt(durSlider.value, 10) || this.currentDuration;
                    if (d === this.currentDuration) return;
                    this.currentDuration = d;
                    const elCur = document.getElementById('durLabelCur');
                    if (elCur) elCur.textContent = d + 's';
                    this.updatePriceDisplay();
                    // 底部输入栏的组合标签（如 auto / 5s）也要跟着刷新，之前只更新了价格
                    this.updateComboLabel();
                    if (typeof this.onParamChange === 'function') this.onParamChange('duration', d);
                });
            }
            const model = this.currentModel;
            const isVid = !!(this._isVideoModel && this._isVideoModel(model));
            const canFirstLast = isVid && this._supportsFirstLast(model);
            // 不支持首尾帧的模型残留首尾帧模式时回到全能参考（否则比例只剩 auto、参考图被限 2 张）
            if (!canFirstLast && this.videoMode === 'first_last') {
                this.videoMode = 'reference';
                if (this.renderRefs) this.renderRefs();
            }
            const modeBtn = document.getElementById('videoModeBtn');
            if (modeBtn) {
                modeBtn.classList.toggle('hidden', !canFirstLast);
                modeBtn.classList.toggle('active', isVid && this.videoMode === 'first_last');
            }
            // 样片 chip：仅 Seedance 2.5 显示；切走模型或关闭时复位
            const isS25Cur = isVid && /seedance-2-5/i.test(String(model || ''));
            if (!isS25Cur && this.draftMode) this.draftMode = false;
            // _PB_DRAFT_PSEUDO_1027 成片/样片滑块永久隐藏（功能改由「Seedance 2.5 样片」伪模型承担）
            const draftBtn = document.getElementById('draftModeBtn');
            if (draftBtn) draftBtn.classList.add('hidden');
            const draftHint = document.getElementById('draftHint');
            if (draftHint) draftHint.classList.toggle('hidden', !(isS25Cur && this.draftMode));
            // 视频模型：不支持的比例档位隐藏（首尾帧仅留 auto）；图片模型全部显示
            const hide = new Set();
            const allowAsp = isVid ? this.videoCaps(model).aspectRatios : null;
            if (isVid) {
                ['3:2', '2:3', '5:4', '4:5'].forEach(v => hide.add(v));
                if (this.videoMode === 'first_last') ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].forEach(v => hide.add(v));
                // 配置了可用比例的模型（如稳定版仅 16:9 / 9:16）：其余档位隐藏
                if (allowAsp && this.videoMode !== 'first_last') document.querySelectorAll('.ratio-option').forEach(o => { if (allowAsp.indexOf(o.dataset.value) === -1) hide.add(o.dataset.value); });
            }
            document.querySelectorAll('.ratio-option').forEach(o => {
                const off = hide.has(o.dataset.value);
                o.style.display = off ? 'none' : '';
                o.classList.toggle('disabled', off);
            });
            // 当前比例不被该模型支持：自动切到最接近的可用档（竖幅→9:16，其余→16:9），并同步到节点
            if (allowAsp && this.videoMode !== 'first_last' && allowAsp.indexOf(this.currentAspect) === -1) {
                const portrait = /^(9:16|3:4|2:3|4:5)$/.test(String(this.currentAspect));
                const next = (portrait && allowAsp.indexOf('9:16') !== -1) ? '9:16' : (allowAsp.indexOf('16:9') !== -1 ? '16:9' : allowAsp[0]);
                this.currentAspect = next;
                document.querySelectorAll('.ratio-option').forEach(o => o.classList.toggle('selected', o.dataset.value === next));
                this.updateComboLabel();
                if (typeof this.onAspectChange === 'function') this.onAspectChange(next);
            }
        },

        // 支持首尾帧的视频模型：Seedance 2.0/2.5、MiniMax-H3（content role first_frame/last_frame）；特价线路按配置 firstLast
        _supportsFirstLast(model) {
            return this.videoCaps(model).firstLast;
        },

        // 时长滑条（复用画质滑条样式）：按模型 durationMin/durationMax 范围，任意整数秒
        _renderDurationOptions(cfg) {
            const slider = document.getElementById('durationSlider');
            if (!slider) return;
            const dMin = (cfg && cfg.durationMin) || 4, dMax = (cfg && cfg.durationMax) || 15;
            slider.min = dMin; slider.max = dMax; slider.step = 1;
            if (!this.currentDuration || this.currentDuration < dMin || this.currentDuration > dMax) {
                this.currentDuration = Math.min(Math.max(5, dMin), dMax);
            }
            slider.value = this.currentDuration;
            const elMin = document.getElementById('durLabelMin');
            const elCur = document.getElementById('durLabelCur');
            const elMax = document.getElementById('durLabelMax');
            if (elMin) elMin.textContent = dMin + 's';
            if (elMax) elMax.textContent = dMax + 's';
            if (elCur) elCur.textContent = this.currentDuration + 's';
        },

        _renderDurationStepperLegacy(cfg) {
            const grid = this.el.durationGrid;
            if (!grid) return;
            const dMin = (cfg && cfg.durationMin) || 4, dMax = (cfg && cfg.durationMax) || 15;
            if (!this.currentDuration || this.currentDuration < dMin || this.currentDuration > dMax) {
                this.currentDuration = Math.min(Math.max(5, dMin), dMax);
            }
            grid.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'duration-stepper';
            const mkBtn = (txt) => {
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'duration-step-btn'; b.textContent = txt;
                return b;
            };
            const minus = mkBtn('\u2212'), plus = mkBtn('+');
            const input = document.createElement('input');
            input.type = 'number'; input.className = 'duration-input';
            input.min = dMin; input.max = dMax; input.step = 1; input.value = this.currentDuration;
            const unit = document.createElement('span');
            unit.className = 'duration-unit'; unit.textContent = '秒';
            const apply = (v) => {
                let d = parseInt(v, 10);
                if (!Number.isFinite(d)) d = this.currentDuration;
                d = Math.min(dMax, Math.max(dMin, d));
                input.value = d;
                minus.disabled = d <= dMin;
                plus.disabled = d >= dMax;
                if (d === this.currentDuration) return;
                this.currentDuration = d;
                const elCur = document.getElementById('durLabelCur');
                if (elCur) elCur.textContent = d + 's';
                this.updatePriceDisplay();
                this.updateComboLabel();
                if (typeof this.onParamChange === 'function') this.onParamChange('duration', d);
            };
            minus.addEventListener('click', (ev) => { ev.stopPropagation(); apply(this.currentDuration - 1); });
            plus.addEventListener('click', (ev) => { ev.stopPropagation(); apply(this.currentDuration + 1); });
            input.addEventListener('click', (ev) => ev.stopPropagation());
            input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') input.blur(); });
            input.addEventListener('change', () => apply(input.value));
            apply(this.currentDuration);
            wrap.appendChild(minus);
            wrap.appendChild(input);
            wrap.appendChild(unit);
            wrap.appendChild(plus);
            grid.appendChild(wrap);
        },

        _renderVideoResOptions(resolutions) {
            const grid = this.el.videoResGrid;
            if (!grid) return;
            grid.innerHTML = '';
            resolutions.forEach(r => {
                const el = document.createElement('div');
                el.className = 'combo-option' + (r === this.currentVideoRes ? ' selected' : '');
                el.dataset.value = r;
                el.textContent = r.toUpperCase();
                el.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    grid.querySelectorAll('.combo-option').forEach(o => o.classList.remove('selected'));
                    el.classList.add('selected');
                    this.currentVideoRes = el.dataset.value;
                    this.updatePriceDisplay();
                    if (typeof this.onParamChange === 'function') this.onParamChange('videoRes', this.currentVideoRes);
                });
                grid.appendChild(el);
            });
        },

        // 提交用画质：仅配置了多于一档 qualityOptions 的图片模型才带 quality；不支持当前档时回退 medium / 第一档
        _effectiveQuality(model) {
            const cfg = this.modelConfigMap[model] || this.modelConfigMap[this.getActualModel(model, this.currentRes)];
            const opts = (cfg && Array.isArray(cfg.qualityOptions)) ? cfg.qualityOptions : [];
            if (opts.length <= 1) return null;
            if (opts.indexOf(this.currentQuality) !== -1) return this.currentQuality;
            return opts.indexOf('medium') !== -1 ? 'medium' : opts[0];
        },
        _priceQualityKey(pm, q) {
            if (!pm || typeof pm !== 'object') return null;
            if (pm[q] && typeof pm[q] === 'object') return q;
            if (pm.medium && typeof pm.medium === 'object') return 'medium';
            const ks = Object.keys(pm).filter(k => pm[k] && typeof pm[k] === 'object');
            return ks.length ? ks[0] : null;
        },

        updatePriceDisplay() {
            if (!this.el.taskCounter) return;
            const actualModel = this.getActualModel(this.currentModel, this.currentRes);
            // Lite 快速模式：标签显示主名而非 Lite 后缀（只更新标签，不提前返回，保证价格正常刷新）
            if (this.currentModel === 'Nano Banana 2.0 快速') { this.el.modelLabel.textContent = 'Nano Banana 2'; }
            if (this.currentModel === 'Seedream 5.0 快速') { this.el.modelLabel.textContent = 'Seedream 5.0'; }
            let cfg = null;
            const defaultApi = this.apiConfig?.defaultApi;
            if (defaultApi && this.apiConfig?.apis?.[defaultApi]?.frontend?.models) {
                cfg = this.apiConfig.apis[defaultApi].frontend.models.find(m => m.id === actualModel);
            }
            if (!cfg && defaultApi && this.apiConfig?.apis?.[defaultApi]?.models) {
                cfg = this.apiConfig.apis[defaultApi].models.find(m => m.id === actualModel);
            }
            if (!cfg) cfg = this.modelConfigMap[actualModel];
            // 价格矩阵优先：按当前画质 × 分辨率取价，未配置的组合回退到模型默认价格
            // 视频模型：画质=分辨率(480p/720p/1080p)，档位=计费秒数（输出时长 + 参考视频时长）
            const isVideo = this._isVideoModel(this.currentModel);
            let price = cfg?.price;
            const pm = cfg?.priceMatrix || {};
            const q = isVideo ? String(this.currentVideoRes || '720p').toLowerCase() : (this.currentQuality || 'medium');
            let r = isVideo ? String(this.currentDuration || 5) : (this.currentRes || '1K');
            if (isVideo) {
                // Seedance 参考视频按折算秒数计费：上游带视频输入走更低的 token 单价（2.5 为 0.60×，2.0 系约 0.65×）
                // H3 走自部署通道，参考素材不额外收费；特价线路按配置 refVideoBillFactor（稳定版 1.0×，按次计价线路 0）
                let billSec = parseInt(this.currentDuration, 10) || 5;
                const _vk = this.videoCaps(this.currentModel).refVideoBillFactor;
                if (_vk > 0) {
                    billSec += Math.round(this._getRefVideoSeconds() * _vk);
                }
                r = String(billSec);
                if (pm[q]) {
                    if (typeof pm[q][r] === 'number') {
                        price = pm[q][r];
                    } else {
                        // 超出矩阵最大时长档：按最大档每秒单价外推
                        const durKeys = Object.keys(pm[q]).map(Number).filter(n => isFinite(n) && n > 0);
                        const maxD = durKeys.length ? Math.max.apply(null, durKeys) : 0;
                        if (maxD && billSec > maxD && typeof pm[q][String(maxD)] === 'number') {
                            price = Math.round(pm[q][String(maxD)] / maxD * billSec);
                        }
                    }
                }
            } else {
                // 与服务端预扣一致：画质不在矩阵中 → medium → 矩阵第一档；该档无此分辨率 → 模型默认价
                const qk = this._priceQualityKey(pm, this._effectiveQuality(this.currentModel) || 'medium');
                if (qk && typeof pm[qk][r] === 'number') price = pm[qk][r];
            }
            // 单位直接用字面量：i18n 缺条目时 t() 返回键名（如 unitVideo），曾导致价格显示成 7/unitVideo
            const unit = isVideo ? '视频' : '图片';
            // 积分显示不带小数点：去尾随零，整数价格显示如 15/张
            this.el.taskCounter.textContent = price !== undefined ? `${Number(price.toFixed(2))}/${unit}` : `-${unit}`;
        },

        updateComboLabel() {
            if (!this.el.comboLabel) return;
            if (this._isVideoModel(this.currentModel)) {
                this.el.comboLabel.textContent = `${this.currentAspect} / ${this.currentDuration || 5}s`; // hintMove1027: auto 比例直接显示 auto
                return;
            }
            const isMj = this.currentModel && this.currentModel.startsWith('mj-');
            if (isMj) {
                const qMap = { '0.5': '标清', '1': '高清', '2': '超清', '4': '实验' };
                this.el.comboLabel.textContent = `${this.currentAspect} / ${qMap[this.currentRes] || this.currentRes}`;
            } else {
                this.el.comboLabel.textContent = `${this.currentAspect} / ${this.currentRes}`;
            }
        },

        // ============ 参考图：上传 / 渲染 / 排序 / 删除 ============
        triggerUpload(slotIndex = null) {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.m4a,.aac'; input.multiple = false; input.style.display = 'none';
            input.onchange = ev => {
                const file = ev.target.files && ev.target.files[0];
                document.body.removeChild(input);
                if (!file) return;
                // 画布场景可接管：上传到画布并连接当前节点
                if (this.onAddRefImage && this.onAddRefImage(file, slotIndex) === true) return;
                this.handleFile(file, slotIndex);
            };
            document.body.appendChild(input);
            input.click();
        },

        generateFileId(file) { return `${file.name}_${file.size}_${file.lastModified}`; },

        async processUploadQueue() {
            while (this.uploadQueue.length > 0 && this.activeUploads < MAX_CONCURRENT_UPLOADS) {
                const task = this.uploadQueue.shift();
                this.activeUploads++;
                task.uploadFn().finally(() => { this.activeUploads--; this.processUploadQueue(); });
            }
        },

        async validateImageLimits(file) {
            const MAX = 20 * 1024 * 1024;
            if (file.size > MAX) return { valid: false, error: '图片大小超过20MB限制' };
            const supported = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/gif', 'image/webp', 'image/tiff', 'image/heic'];
            if (!supported.includes(file.type)) return { valid: false, error: '不支持的图片格式' };
            return new Promise((resolve) => {
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                    URL.revokeObjectURL(url);
                    const w = img.width, h = img.height;
                    const maxDim = 10000, maxPixels = 50 * 1000 * 1000;
                    if (w > maxDim || h > maxDim) return resolve({ valid: false, error: '图片尺寸过大' });
                    if (w * h > maxPixels) return resolve({ valid: false, error: '图片像素过大' });
                    resolve({ valid: true });
                };
                img.onerror = () => { URL.revokeObjectURL(url); resolve({ valid: false, error: '无法读取图片' }); };
                img.src = url;
            });
        },

        // 当前模型允许的参考图数量：视频模型按 videoCaps（Seedance 2.5=30；其他视频模型=9；特价线路按配置）；Midjourney=3；图片模型=8
        _getRefLimit() {
            const m = String(this.currentModel || '');
            if (m.startsWith('mj-')) return 3;
            if (this._isVideoModel(m)) {
                if (this.videoMode === 'first_last') return 2; // 首尾帧：仅 2 张图
                return this.videoCaps(m).maxImages;
            }
            return 8;
        },

        handleFile(file, slotIndex = null) {
            if (!file || !file.type.startsWith('image/')) return;
            const fileId = this.generateFileId(file);
            const refLimit = this._getRefLimit();
            let idx = slotIndex;
            if (idx == null) {
                const used = this.uploadedImages.filter(img => img && !img.loading).length;
                idx = this.uploadedImages.findIndex(v => !v);
                if (idx === -1 || used >= refLimit) { alert('当前模型最多支持 ' + refLimit + ' 张参考图'); return; }
            }
            this.uploadedImages[idx] = { loading: true, file: file, fileId: fileId };
            const slotRef = this.uploadedImages[idx];  // 保存对象引用,用于 writeBack 精确定位
            this.loadingImagesCount++;
            this.updateGenerateButtonState();
            this.renderRefs();

            // 用对象引用定位(不受 renderRefs 压缩重排影响,同一文件多次上传也不会误写)
            const writeBack = (fn) => {
                const cur = this.uploadedImages.indexOf(slotRef);
                if (cur === -1) return;  // 已被移除,放弃写回
                fn(cur);
            };
            const uploadTask = async () => {
                try {
                    const validation = await this.validateImageLimits(file);
                    if (!validation.valid) throw new Error(validation.error);
                    const formData = new FormData();
                    formData.append('file', file);
                    if (window.PxThumb) await window.PxThumb.attach(formData, file);
                    const res = await fetch(`${getBackendUrl()}/v1/image/upload-reference`, { method: 'POST', headers: authHeaders(), body: formData });
                    if (!res.ok) throw new Error('上传失败: ' + res.status);
                    const result = await res.json();
                    if (result.code !== 0) throw new Error(result.msg || '上传失败');
                    const cleanOriginal = result.data.originalUrl ? String(result.data.originalUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '') : '';
                    const cleanPreview = result.data.previewUrl ? String(result.data.previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '') : '';
                    // 缩略图先进缓存，切换时无闪烁
                    if (window.PxThumb) await window.PxThumb.preload([cleanPreview]);
                    writeBack(i => {
                        this.uploadedImages[i] = { highUrl: cleanOriginal, previewUrl: cleanPreview, tempKey: result.data.tempKey, fileId: fileId, isUploaded: true };
                        // 编辑器用的完整图：直接用本地文件，不再回头下载刚上传的原图
                        const pre = new Image(); pre.src = URL.createObjectURL(file); this.uploadedImages[i].preloadedImg = pre;
                    });
                } catch (err) {
                    console.error('[PromptBar 上传] 失败:', err);
                    alert(`上传失败: ${err.message}`);
                    writeBack(i => { this.uploadedImages[i] = null; });
                } finally {
                    this.loadingImagesCount--;
                    this.updateGenerateButtonState();
                    // rAF 节流:多个上传同时完成时合并 renderRefs 调用,避免 DOM 频繁更新闪烁
                    this._scheduleRenderRefs();
                }
            };
            this.uploadQueue.push({ uploadFn: uploadTask });
            this.processUploadQueue();
        },

        // rAF 节流 renderRefs:合并同一帧内多次调用,避免并发上传完成时闪烁
        _renderRefsRaf: null,
        _scheduleRenderRefs() {
            if (this._renderRefsRaf) return;
            this._renderRefsRaf = requestAnimationFrame(() => {
                this._renderRefsRaf = null;
                this.renderRefs();
            });
        },

        updateGenerateButtonState() {
            const btn = this.el.generateBtn;
            if (btn) {
                const setDisabled = (disabled, title) => {
                    btn.disabled = disabled;
                    btn.title = title;
                    btn.classList.toggle('loading', disabled);
                };
                if (this.loadingImagesCount > 0) {
                    setDisabled(true, `图片处理中 (${this.loadingImagesCount})...`);
                } else if (this._activeNodeGenerating) {
                    // 当前选中节点正在生成中：禁用按钮避免重复发起
                    setDisabled(true, '生成中…');
                } else {
                    setDisabled(false, t('generate'));
                }
            }
            if (this.el.addImgBtn) {
                const cnt = this.uploadedImages.filter(img => img && !img.loading).length;
                const isMj = this.currentModel && this.currentModel.startsWith('mj-');
                this.el.addImgBtn.style.display = (isMj && cnt >= 3) ? 'none' : 'flex';
            }
        },

        // 参考图条溢出时显示左右翻页按键（每次滑 8 张）；监听子节点变化/尺寸变化/滚动自动刷新按键显隐
        _ensureRefScroll() {
            const { refsStrip, refsMini } = this.el;
            if (!refsStrip || !refsMini || this._refScrollReady) return;
            // 生成页底部固定输入栏：最多 8 张参考图，宽度足够不会溢出，不需要左右翻页键
            // （翻页键的样式只存在于画布浮层用的 canvas.css，生成页会退化成两个白色原生按钮）
            if (!refsStrip.closest('.prompt-float')) return;
            this._refScrollReady = true;
            const mk = (dir) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ref-scroll-btn ' + dir;
                b.innerHTML = dir === 'left'
                    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'
                    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
                b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
                b.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const slot = refsMini.querySelector('.ref-slot-mini');
                    const gap = parseFloat(getComputedStyle(refsMini).columnGap) || 8;
                    const stepW = slot ? (slot.getBoundingClientRect().width + gap) * 8 : refsMini.clientWidth * 0.8;
                    refsMini.scrollBy({ left: dir === 'left' ? -stepW : stepW, behavior: 'smooth' });
                });
                refsStrip.appendChild(b);
            };
            mk('left'); mk('right');
            const update = () => {
                const max = refsMini.scrollWidth - refsMini.clientWidth;
                refsStrip.classList.toggle('ref-can-left', max > 1 && refsMini.scrollLeft > 1);
                refsStrip.classList.toggle('ref-can-right', max > 1 && refsMini.scrollLeft < max - 1);
            };
            this._updateRefScroll = update;
            refsMini.addEventListener('scroll', update, { passive: true });
            // 鼠标滚轮竖向滚动转横向（溢出时）
            refsMini.addEventListener('wheel', (e) => {
                if (refsMini.scrollWidth <= refsMini.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                e.preventDefault();
                refsMini.scrollLeft += e.deltaY;
            }, { passive: false });
            if (typeof MutationObserver !== 'undefined') new MutationObserver(() => requestAnimationFrame(update)).observe(refsMini, { childList: true });
            if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => update()).observe(refsMini);
            requestAnimationFrame(update);
        },

        // 参考图分组：同一角色节点展开的连续多张图聚合为一组（画布角色节点，charId=角色节点 id），其余每张一组。
        // 组内图片在 uploadedImages 中连续，idx 为其扁平下标（= 提交顺序，序号 = idx+1）
        _refGroups() {
            const out = [];
            this.uploadedImages.forEach((im, i) => {
                if (!im) return;
                const last = out[out.length - 1];
                if (im.charId && !im.loading && last && last.charId === im.charId) { last.items.push(im); last.idx.push(i); return; }
                out.push({ charId: (im.charId && !im.loading) ? im.charId : '', items: [im], idx: [i] });
            });
            return out;
        },
        _groupKey(g) {
            return g.charId ? ('char_' + g.charId + ':' + g.items.map(x => x.highUrl).join('|')) : (g.items[0].fileId || '');
        },

        renderRefs() {
            this._ensureRefScroll();
            setTimeout(() => this._renderMediaRefs(), 0);
            const nonNull = this.uploadedImages.filter(img => img);
            // 原地压缩+填充 null:保持数组引用不变,避免与 script.js 的 uploadedImages 断开
            this.uploadedImages.length = 0;
            nonNull.forEach(img => this.uploadedImages.push(img));
            for (let i = nonNull.length; i < MAX_REF_SLOTS; i++) this.uploadedImages.push(null);
            const { refsStrip, refsMini } = this.el;
            const has = this.uploadedImages.some(img => img && (img.loading || img.highUrl || img.previewUrl || img.dataUrl || img.url));
            if (!has) { refsStrip.classList.add('hidden'); refsMini.innerHTML = ''; this.updateImageTags(); this._notifyRefsChange(); return; }
            refsStrip.classList.remove('hidden');
            const maxSlots = this._getRefLimit();
            // 按组展示：角色节点展开的多张图聚合为一个参考项（占用连续序号），普通图每张一项
            const toShow = [];
            let shownImgs = 0;
            this._refGroups().forEach((g) => {
                if (shownImgs >= maxSlots) return;
                shownImgs += g.items.length;
                toShow.push(g);
            });

            // 增量更新:避免全量 innerHTML='' 清空导致上传完成时闪烁
            const existingSlots = Array.from(refsMini.children).filter(el => el.classList && el.classList.contains('ref-slot-mini'));
            // 移除多余 slot（拖动中的 slot 保留，防止异步渲染杀掉拖动会话导致节点跳回原位）
            while (existingSlots.length > toShow.length) {
                const stale = existingSlots.pop();
                if (stale && !stale.classList.contains('dragging')) stale.remove();
            }
            // 逐个对比:fileId(组键) + loading 状态 + 起始序号都匹配则复用,否则替换该 slot
            toShow.forEach((g, displayIndex) => {
                const data = g.items[0];
                const originalIndex = g.idx[0];
                const slot = existingSlots[displayIndex];
                const fid = this._groupKey(g);
                const slotFid = slot ? (slot.dataset.fileId || '') : '';
                const slotLoading = slot ? (slot.dataset.loading === 'true') : false;
                const dataLoading = !!data.loading;
                const startChanged = !!g.charId && slot && slot.dataset.start !== String(originalIndex + 1);
                const make = () => g.charId ? this._createCharSlotElement(g) : this._createSlotElement(data, originalIndex, originalIndex);
                if (!slot) {
                    // 新增 slot
                    refsMini.appendChild(make());
                } else if ((fid !== slotFid || slotLoading !== dataLoading || startChanged) && !slot.classList.contains('dragging')) {
                    // 内容变化(如 loading→图片):替换该 slot,不全量清空
                    const newSlot = make();
                    slot.replaceWith(newSlot);
                    existingSlots[displayIndex] = newSlot;
                } else {
                    // 没变:只更新序号
                    slot.dataset.index = originalIndex;
                }
            });
            this._updateSlotOrder();
            // 图片数≥2 时给所有 slot 补绑长按拖动(先上传的 slot 创建时只有一张图，会漏绑)
            const readyCount = this.uploadedImages.filter(im => im && !im.loading).length;
            if (readyCount > 1) {
                refsMini.querySelectorAll('.ref-slot-mini.has-image').forEach(s => {
                    if (!s._dragSortBound) this._setupDragSort(s, parseInt(s.dataset.index) || 0);
                });
            }
            // 上传中:添加 uploading 类,通过 CSS 隐藏删除按钮+禁用已完成 slot 的交互
            refsMini.classList.toggle('uploading', this.loadingImagesCount > 0);
            this.updateImageTags();
            this._notifyRefsChange();
        },

        // 创建 slot 元素(不 append),供 renderRefs 增量替换使用
        _createSlotElement(data, displayIndex, originalIndex) {
            const slot = document.createElement('div');
            slot.className = 'ref-slot-mini has-image';
            slot.dataset.index = displayIndex;
            slot.dataset.fileId = data.fileId || '';
            slot.dataset.loading = data.loading ? 'true' : 'false';
            const getPreviewUrl = (url) => url && url.includes('/original/') ? url.replace('/original/', '/preview/') : url;

            const isLoading = data && data.loading;
            if (isLoading) {
                slot.classList.add('loading');
                // 上传中立即显示本地原图（叠加加载遮罩）
                if (data.file instanceof Blob && /^image\//.test(data.file.type || '')) {
                    if (!data._localUrl) data._localUrl = URL.createObjectURL(data.file);
                    const li = document.createElement('img'); li.src = data._localUrl; li.draggable = false; slot.appendChild(li);
                }
                const overlay = document.createElement('div'); overlay.className = 'image-loading-overlay';
                const spinner = document.createElement('div'); spinner.className = 'image-loading-spinner'; overlay.appendChild(spinner);
                const txt = document.createElement('span'); txt.className = 'image-loading-text'; txt.textContent = t('processing'); overlay.appendChild(txt);
                slot.appendChild(overlay);
            } else {
                const img = document.createElement('img');
                let imageSrc, editorImageSrc;
                if (typeof data === 'string') { imageSrc = data; editorImageSrc = data; }
                else if (data.previewUrl) {
                    imageSrc = data.previewUrl.startsWith('data:') ? (data.highUrl ? getPreviewUrl(data.highUrl) : data.previewUrl) : getPreviewUrl(data.previewUrl);
                    editorImageSrc = data.highUrl || imageSrc;
                } else if (data.highUrl) { imageSrc = getPreviewUrl(data.highUrl); editorImageSrc = data.highUrl; }
                else if (data.dataUrl) { imageSrc = data.dataUrl; editorImageSrc = data.dataUrl; }
                else if (data.url) { imageSrc = data.url; editorImageSrc = data.url; }
                img.src = imageSrc; img.draggable = false;
                img.onerror = () => {
                    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23333" width="100" height="100"/><text fill="%23999" x="50" y="50" text-anchor="middle" font-size="12">加载失败</text></svg>';
                    img.style.opacity = '0.5';
                };
                slot.appendChild(img);

                // 始终添加删除按钮(显隐由 renderRefs 中的 uploading 类控制)
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn'; delBtn.innerHTML = '×'; delBtn.title = t('delete');
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.loadingImagesCount > 0) return;  // 上传中禁止删除
                    // 优先按 fileId 匹配（画布同步会重建对象导致引用失效），对象引用兜底
                    let actualIndex = (data && data.fileId) ? this.uploadedImages.findIndex(im => im && im.fileId === data.fileId) : -1;
                    if (actualIndex === -1) actualIndex = this.uploadedImages.findIndex(im => im === data);
                    if (actualIndex !== -1) {
                        const fileId = this.uploadedImages[actualIndex]?.fileId;
                        this.uploadedImages[actualIndex] = null;
                        this.removeImageTagByFileId(fileId, actualIndex + 1);
                    }
                    this.renderRefs();
                    this._notifyRefsChange();
                });
                slot.appendChild(delBtn);

                slot.addEventListener('click', (e) => {
                    if (this.loadingImagesCount > 0) return;  // 上传中禁止编辑
                    if (!e.target.closest('.delete-btn') && !this.dragState.hasMoved) {
                        // 提供原图 URL、显示序号、fileId，供画布确定编辑目标
                        if (this.onOpenImageEditor) this.onOpenImageEditor(editorImageSrc, displayIndex, data.fileId);
                    }
                });

                const imageCount = this.uploadedImages.filter(im => im && !im.loading).length;
                if (imageCount > 1) this._setupDragSort(slot, displayIndex);
            }
            return slot;
        },

        // 角色聚合参考项：一个角色节点展开的 N 张参考图显示为一个叠层卡片（序号范围 start-end = 提交顺序编号）
        _createCharSlotElement(g) {
            const CL = global.CharacterLib;
            const info = (CL && CL.slotInfo) ? CL.slotInfo(g.charId) : null;
            const n = g.items.length;
            const start = g.idx[0] + 1, end = g.idx[g.idx.length - 1] + 1;
            const total = info ? Math.max(info.total, n) : n;
            const trunc = n < total;
            const name = info ? info.name : '';
            const slot = document.createElement('div');
            slot.className = 'ref-slot-mini has-image ref-char-slot' + (trunc ? ' is-trunc' : '');
            slot.dataset.index = g.idx[0];
            slot.dataset.fileId = this._groupKey(g);
            slot.dataset.loading = 'false';
            slot.dataset.start = String(start);
            slot.dataset.count = String(n);
            slot.dataset.total = String(total);
            slot.dataset.charNode = g.charId;
            // 占用 n 个 CSS 序号（主题 ::after counter），保证后面普通参考图的角标与提交编号一致
            slot.style.counterIncrement = 'pxref ' + n;
            const rangeTxt = n > 1 ? `${start}-${end}` : String(start);
            slot.title = trunc ? `角色：${name} · 已计入 ${n}/${total} 张参考图（超出模型上限）` : `角色：${name} · ${n} 张参考图`;
            if (total > 1) {
                const c2 = document.createElement('span'); c2.className = 'rcs-card rcs-card-2';
                const c1 = document.createElement('span'); c1.className = 'rcs-card rcs-card-1';
                slot.appendChild(c2); slot.appendChild(c1);
            }
            const img = document.createElement('img');
            const first = g.items[0];
            img.src = (info && info.cover && !trunc) ? info.cover : (first.previewUrl || first.highUrl);
            img.draggable = false;
            img.alt = '';
            slot.appendChild(img);
            const tag = document.createElement('span');
            tag.className = 'rcs-tag';
            tag.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>';
            slot.appendChild(tag);
            const rg = document.createElement('span'); rg.className = 'rcs-range'; rg.textContent = rangeTxt; slot.appendChild(rg);
            const ct = document.createElement('span'); ct.className = 'rcs-count'; ct.textContent = trunc ? `${n}/${total}` : `×${n}`; slot.appendChild(ct);

            // 移除：整组移出（画布侧 _onRefsChange 据此断开该角色节点的连线）
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn'; delBtn.innerHTML = '×'; delBtn.title = '移除角色';
            delBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.loadingImagesCount > 0) return;
                if (CL && CL.closeRefPopover) CL.closeRefPopover();
                const cid = g.charId;
                for (let i = this.uploadedImages.length - 1; i >= 0; i--) {
                    const im = this.uploadedImages[i];
                    if (im && im.charId === cid) {
                        this.uploadedImages[i] = null;
                        this.removeImageTagByFileId(im.fileId, i + 1);
                    }
                }
                this.renderRefs();
                this._notifyRefsChange();
            });
            slot.appendChild(delBtn);

            slot.addEventListener('click', (e) => {
                if (this.loadingImagesCount > 0) return;
                if (e.target.closest('.delete-btn') || this.dragState.hasMoved) return;
                if (!CL || !CL.openRefPopover) return;
                if (CL.isRefPopoverOpen && CL.isRefPopoverOpen()) { CL.closeRefPopover(); return; }
                const s = parseInt(slot.dataset.start, 10) || start;
                CL.openRefPopover(g.charId, s, parseInt(slot.dataset.count, 10) || n, slot);
            });
            const imageCount = this.uploadedImages.filter(im => im && !im.loading).length;
            if (imageCount > 1) this._setupDragSort(slot, g.idx[0]);
            return slot;
        },

        _addImageSlot(data, displayIndex, originalIndex) {
            const slot = this._createSlotElement(data, displayIndex, originalIndex);
            this.el.refsMini.appendChild(slot);
            this._updateSlotOrder();
        },

        _updateSlotOrder() {
            this.el.refsMini.querySelectorAll('.ref-slot-mini.has-image').forEach((s, i) => { s.dataset.order = i; });
        },

        _setupDragSort(slot, idx) {
            if (slot._dragSortBound) return;  // 防重复绑定(双击渲染路径可能多次进入)
            slot._dragSortBound = true;
            let startX = 0, isDragging = false, longPressTimer = null, hasMoved = false;
            let deleteBtn = slot.querySelector('.delete-btn');
            let originalOrder = 0, currentOrder = 0, slotWidth = 0, slotGap = 8;
            const self = this;

            const startDrag = (e) => {
                if (e.target.closest('.delete-btn')) return;
                if (self.loadingImagesCount > 0) return;  // 上传中禁止拖动
                e.preventDefault();
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                startX = clientX; hasMoved = false;
                self._updateSlotOrder();
                originalOrder = parseInt(slot.dataset.order) || 0; currentOrder = originalOrder;
                // 动态量测布局值：px-theme 主题把 slot 覆盖为 52px!important、gap 8px!important，
                // 任何常量都会与实际步进错位（让位过远+临界翻转闪烁），offsetWidth 不含 transform 无 hover 污染
                slotWidth = slot.offsetWidth;
                slotGap = parseFloat(getComputedStyle(self.el.refsMini).columnGap) || 8;
                longPressTimer = setTimeout(() => {
                    isDragging = true; self.dragState.isDragging = true; self.dragState.draggedIndex = idx;
                    slot.classList.add('dragging');
                    if (deleteBtn) { deleteBtn.style.opacity = '0'; deleteBtn.style.pointerEvents = 'none'; }
                    document.body.classList.add('ref-dragging-active');
                    document.body.classList.add('px-drag-active');
                    self.el.refsMini.querySelectorAll('.ref-slot-mini.has-image').forEach(s => { if (s !== slot) s.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)'; });
                    if (e.preventDefault) e.preventDefault();
                }, LONG_PRESS_DURATION);
            };
            const moveDrag = (e) => {
                if (!isDragging) {
                    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                    if (Math.abs(clientX - startX) > 10) clearTimeout(longPressTimer);
                    return;
                }
                hasMoved = true; self.dragState.hasMoved = true;
                if (e.cancelable) e.preventDefault();  // 拖动中阻止页面滚动打断手势
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                const dx = clientX - startX;
                slot.style.transform = `translateX(${dx}px) scale(1.15)`;
                const moveSlots = Math.round(dx / (slotWidth + slotGap));
                const allSlots = Array.from(self.el.refsMini.querySelectorAll('.ref-slot-mini.has-image'));
                const maxOrder = allSlots.length - 1;
                let newOrder = Math.max(0, Math.min(originalOrder + moveSlots, maxOrder));
                if (newOrder !== currentOrder) { currentOrder = newOrder; updateOtherSlots(allSlots, originalOrder, currentOrder); }
            };
            const updateOtherSlots = (allSlots, fromOrder, toOrder) => {
                const moveDistance = slotWidth + slotGap;
                allSlots.forEach((s) => {
                    if (s === slot) return;
                    const o = parseInt(s.dataset.order) || 0; let off = 0;
                    if (fromOrder < toOrder) { if (o > fromOrder && o <= toOrder) off = -moveDistance; }
                    else if (fromOrder > toOrder) { if (o >= toOrder && o < fromOrder) off = moveDistance; }
                    s.style.transform = off !== 0 ? `translateX(${off}px)` : '';
                });
            };
            const endDrag = () => {
                clearTimeout(longPressTimer);
                unbindDoc();
                if (isDragging) {
                    isDragging = false; self.dragState.isDragging = false;
                    self.el.refsMini.querySelectorAll('.ref-slot-mini.has-image').forEach(s => { s.style.transition = ''; s.style.transform = ''; });
                    slot.classList.remove('dragging');
                    if (deleteBtn) { deleteBtn.style.opacity = ''; deleteBtn.style.pointerEvents = ''; }
                    document.body.classList.remove('ref-dragging-active');
                    document.body.classList.remove('px-drag-active');
                    if (currentOrder !== originalOrder) {
                        // 按「组」整体移动：角色聚合项携带其全部图片一起移动，普通图为单张组
                        const groups = self._refGroups();
                        const [movedG] = groups.splice(originalOrder, 1);
                        if (movedG) groups.splice(Math.min(currentOrder, groups.length), 0, movedG);
                        const flat = [];
                        groups.forEach(g => g.items.forEach(im => flat.push(im)));
                        self.uploadedImages.length = 0;
                        flat.forEach(im => self.uploadedImages.push(im));
                        for (let i = flat.length; i < MAX_REF_SLOTS; i++) self.uploadedImages.push(null);
                        // 按组键原地移动已有 slot 节点(appendChild 复用同一元素，不重建 <img>)，
                        // 使 renderRefs 位置对齐后走复用分支。画布上游同步会重建数组对象，不能用对象身份匹配
                        const byFid = new Map();
                        self.el.refsMini.querySelectorAll('.ref-slot-mini.has-image').forEach(s => {
                            const k = s.dataset.fileId;
                            if (!byFid.has(k)) byFid.set(k, []);
                            byFid.get(k).push(s);
                        });
                        self._refGroups().forEach(g => {
                            const q = byFid.get(self._groupKey(g));
                            const s = q && q.shift();
                            if (s) self.el.refsMini.appendChild(s);
                        });
                    }
                    self.renderRefs();
                    setTimeout(() => { self.dragState.hasMoved = false; self.dragState.draggedIndex = null; }, 100);
                }
            };
            // document 级监听仅在拖动会话期间挂载，结束即解绑（endDrag 中移除），避免泄漏累积
            const bindDoc = () => {
                document.addEventListener('mousemove', moveDrag);
                document.addEventListener('mouseup', endDrag);
                document.addEventListener('touchmove', moveDrag, { passive: false });
                document.addEventListener('touchend', endDrag);
            };
            const unbindDoc = () => {
                document.removeEventListener('mousemove', moveDrag);
                document.removeEventListener('mouseup', endDrag);
                document.removeEventListener('touchmove', moveDrag);
                document.removeEventListener('touchend', endDrag);
            };
            slot.addEventListener('mousedown', (e) => { startDrag(e); bindDoc(); });
            slot.addEventListener('touchstart', (e) => { startDrag(e); bindDoc(); }, { passive: false });
        },

        // ============ @图片 下拉 ============
        getUploadedImagesForDropdown() {
            const images = [];
            this.uploadedImages.forEach((img, index) => {
                if (img && (img.previewUrl || img.previewDataUrl || img.highUrl || img.dataUrl || img.url)) {
                    let thumb = img.previewUrl || img.previewDataUrl || img.dataUrl || img.highUrl || img.url;
                    if (thumb && thumb.includes('/original/')) thumb = thumb.replace('/original/', '/preview/');
                    images.push({ index: index + 1, url: img.highUrl || img.url || img.dataUrl, thumbnailUrl: thumb, fileId: img.fileId });
                }
            });
            return images;
        },

        // 已连入当前生成节点的视频/音频（停靠模式：当前选中的媒体节点，生成时会被连入新节点）
        _getConnectedMedia() {
            const videos = [], audios = [];
            // previewUrl 仅用于参考条缩略显示；url 保持原始地址（@/提交给模型用原画质）
            const _pv = (b) => (global.VideoProxy && global.VideoProxy.validPreviewOf(b)) || '';
            const CB = global.CanvasBlocks, CE = global.CanvasEdges, CM = global.CanvasMain;
            if (!CB || !CE) return { videos, audios };
            let srcIds = [];
            const active = CM && CM._activeNodeId ? CB.getById(CM._activeNodeId) : null;
            if (active && active.nodeType === 'gen') {
                srcIds = CE.edges.filter(e => e.to === active.id).map(e => e.from);
            } else if (CM && CM._inDock && global.CanvasSelection) {
                srcIds = global.CanvasSelection.getSelectedIds() || [];
            }
            srcIds.forEach((id) => {
                const b = CB.getById(id);
                if (!b) return;
                if (b.nodeType === 'ref' && b.mediaType === 'video') {
                    const u = b.mediaUrl || b.videoUrl;
                    if (u) videos.push({ srcId: b.id, url: u, previewUrl: _pv(b), duration: b.mediaDuration || 0, size: b.mediaSize || 0, name: b.name || '' });
                } else if (b.nodeType === 'ref' && b.mediaType === 'audio') {
                    if (b.mediaUrl) audios.push({ srcId: b.id, url: b.mediaUrl, duration: b.mediaDuration || 0, size: b.mediaSize || 0, name: b.name || '' });
                } else if (b.nodeType === 'gen' && b.videoUrl && CB._genCategoryOf && CB._genCategoryOf(b) === 'video') {
                    videos.push({ srcId: b.id, url: b.videoUrl, previewUrl: _pv(b), duration: b.mediaDuration || b.duration || 0, size: 0, name: b.name || '' });
                }
            });
            return { videos, audios };
        },

        // 参考视频计费秒数：与提交侧一致，只统计已连入当前生成节点的视频（按 URL 去重）
        _getRefVideoSeconds() {
            let sec = 0;
            try {
                const { videos } = this._getConnectedMedia();
                const seen = new Set();
                (videos || []).forEach(v => {
                    const u = v.url || '';
                    if (u && seen.has(u)) return;
                    if (u) seen.add(u);
                    sec += Number(v.duration) || 0;
                });
            } catch (_) { }
            return Math.round(sec);
        },

        // 已连入当前生成节点的文本节点（停靠模式：选中的文本节点）
        _getConnectedTexts() {
            const CB = global.CanvasBlocks, CE = global.CanvasEdges, CM = global.CanvasMain;
            if (!CB || !CE) return [];
            let srcIds = [];
            const active = CM && CM._activeNodeId ? CB.getById(CM._activeNodeId) : null;
            if (active && active.nodeType === 'gen') srcIds = CE.edges.filter(e => e.to === active.id).map(e => e.from);
            else if (CM && CM._inDock && global.CanvasSelection) srcIds = global.CanvasSelection.getSelectedIds() || [];
            return srcIds.map(id => CB.getById(id)).filter(b => b && b.nodeType === 'text');
        },

        // 参考图条追加已连入的视频/音频缩略（不占图片名额，独立编号，对应提示词里的 [视频N]/[音频N]）
        // 文本节点卡片放在最前（无序号、不可 @）
        _renderMediaRefs() {
            const { refsStrip, refsMini } = this.el;
            if (!refsStrip || !refsMini) return;
            refsMini.querySelectorAll('.ref-media-slot').forEach(e => e.remove());
            // 删除按键：选中生成节点时断开该素材的连线（停靠模式无连线，不显示）
            const CMm = global.CanvasMain, CBm = global.CanvasBlocks;
            const activeGen = CMm && CMm._activeNodeId && CBm ? CBm.getById(CMm._activeNodeId) : null;
            const _mediaDelBtn = (slot, srcId) => {
                if (!activeGen || activeGen.nodeType !== 'gen' || !srcId) return;
                const del = document.createElement('div');
                del.className = 'delete-btn'; del.innerHTML = '×'; del.title = '移除';
                del.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
                del.addEventListener('click', (ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    const CE = global.CanvasEdges;
                    if (!CE) return;
                    CE.edges.filter(x => x.from === srcId && x.to === activeGen.id).forEach(x => CE.remove(x.id));
                    if (global.CanvasHistory) global.CanvasHistory.snapshot();
                    if (global.CanvasStore) global.CanvasStore.scheduleSave();
                    if (CMm.onEdgesChange) CMm.onEdgesChange();
                    this._renderMediaRefs();
                });
                slot.appendChild(del);
            };
            const texts = this._getConnectedTexts();
            texts.slice().reverse().forEach(tb => {
                const d = document.createElement('div');
                d.className = 'ref-media-slot text';
                const txt = String(tb.text || '').trim();
                d.title = '文本：' + (txt ? (txt.length > 80 ? txt.slice(0, 80) + '…' : txt) : '（空）');
                d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
                _mediaDelBtn(d, tb.id);
                refsMini.insertBefore(d, refsMini.firstChild);
            });
            const isVid = !!(this._isVideoModel && this._isVideoModel(this.currentModel));
            const md = isVid ? this._getConnectedMedia() : { videos: [], audios: [] };
            const add = (item, kind, i) => {
                const d = document.createElement('div');
                d.className = 'ref-media-slot ' + kind;
                d.title = (kind === 'video' ? '视频' : '音频') + (i + 1) + (item.name ? '：' + item.name : '');
                if (kind === 'video') {
                    const v = document.createElement('video');
                    v.src = (item.previewUrl || item.url) + '#t=0.1';  // 缩略用预览版
                    v.muted = true; v.preload = 'metadata'; v.playsInline = true;
                    d.appendChild(v);
                } else {
                    d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
                }
                const badge = document.createElement('span');
                badge.className = 'ref-media-badge';
                badge.textContent = (kind === 'video' ? '▶' : '♪') + (i + 1);
                d.appendChild(badge);
                _mediaDelBtn(d, item.srcId);
                refsMini.appendChild(d);
            };
            md.videos.forEach((x, i) => add(x, 'video', i));
            md.audios.forEach((x, i) => add(x, 'audio', i));
            const hasImg = !!refsMini.querySelector('.ref-slot-mini');
            if (md.videos.length + md.audios.length + texts.length > 0) refsStrip.classList.remove('hidden');
            else if (!hasImg) refsStrip.classList.add('hidden');
            if (this._updateRefScroll) requestAnimationFrame(this._updateRefScroll);
            // 参考视频增减/连线变化后，同步刷新生成框的积分显示
            this.updatePriceDisplay();
        },

        // @ 视频/音频候选：只列出已连入当前生成节点的素材（与提交侧一致）
        getCanvasMediaForDropdown() {
            return this._getConnectedMedia();
        },

        // （旧实现保留备查，已不再使用）收集画布全部视频/音频节点
        _getAllCanvasMediaLegacy() {
            const videos = [], audios = [];
            const CB = global.CanvasBlocks;
            if (!CB || !Array.isArray(CB.blocks)) return { videos, audios };
            CB.blocks.forEach((b) => {
                if (!b) return;
                if (b.nodeType === 'ref' && b.mediaType === 'video') {
                    const u = b.mediaUrl || b.videoUrl;
                    if (u) videos.push({ srcId: b.id, url: u, duration: b.mediaDuration || 0, size: b.mediaSize || 0 });
                } else if (b.nodeType === 'ref' && b.mediaType === 'audio') {
                    if (b.mediaUrl) audios.push({ srcId: b.id, url: b.mediaUrl, duration: b.mediaDuration || 0, size: b.mediaSize || 0 });
                } else if (b.nodeType === 'gen' && b.videoUrl && CB._genCategoryOf && CB._genCategoryOf(b) === 'video') {
                    // 视频生成节点的产物视频也可 @（提交侧按 URL 去重，与连线引用不冲突）
                    videos.push({ srcId: b.id, url: b.videoUrl, duration: 0, size: 0 });
                }
            });
            return { videos, audios };
        },

        renderImageDropdown() {
            if (!this.imageSelectDropdown) this.imageSelectDropdown = document.getElementById('imageSelectDropdown');
            if (!this.dropdownImages) this.dropdownImages = document.getElementById('dropdownImages');
            if (!this.imageSelectDropdown || !this.dropdownImages) return;
            const images = this.getUploadedImagesForDropdown()
                // 角色节点展开的图不逐张列出：角色以单条目「@角色名（N张）」出现在「角色」段
                .filter(im => { const u = this.uploadedImages[im.index - 1]; return !(u && u.charId); });
            const media = this.getCanvasMediaForDropdown();
            // 视频/音频候选仅对视频模型展示（图片模型上游不支持媒体参考）；首尾帧模式禁选
            const isVideoSel = !!(this._isVideoModel && this._isVideoModel(this.currentModel));
            const firstLastLock = isVideoSel && this.videoMode === 'first_last';
            // 角色库候选（仅画布生成节点可用）：选中后自动在生成节点左侧创建角色节点并连线
            const chars = (global.CharacterLib && global.CharacterLib.getMentionCandidates) ? global.CharacterLib.getMentionCandidates() : [];
            if (images.length === 0 && media.videos.length === 0 && media.audios.length === 0 && chars.length === 0) { this.dropdownImages.innerHTML = `<div class="dropdown-empty">${t('noImageContent')}</div>`; return; }
            this.dropdownImages.innerHTML = '';
            this.dropdownImages.className = 'dropdown-content vertical';
            // 排列：图片在上 / 视频居中 / 音频在下（分段标题，空段不显示）
            const _secLabel = (txt) => {
                const s = document.createElement('div');
                s.className = 'dropdown-section-label'; s.textContent = txt;
                this.dropdownImages.appendChild(s);
            };
            if (images.length > 0) _secLabel('图片');
            images.forEach((img) => {
                const item = document.createElement('div');
                item.className = 'dropdown-image-item vertical';
                item.dataset.imageIndex = img.index; item.dataset.url = img.url;
                let thumbUrl = img.thumbnailUrl;
                if (thumbUrl && thumbUrl.startsWith('http')) thumbUrl = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(img.thumbnailUrl)}`;
                item.innerHTML = `<img class="dropdown-thumb" src="${thumbUrl || ''}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2230%22 height=%2230%22%3E%3Crect fill=%22%23333%22 width=%2230%22 height=%2230%22/%3E%3Ctext fill=%22%23666%22 x=%2215%22 y=%2220%22 text-anchor=%22middle%22 font-size=%2212%22%3E${img.index}%3C/text%3E%3C/svg%3E'"><span class="img-label">${t('imageLabel')} ${img.index}</span><span class="img-at">(@${img.index})</span>`;
                item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.insertImageTag(img.index); this.hideImageDropdown(); });
                this.dropdownImages.appendChild(item);
            });
            // 视频段（居中）
            if (isVideoSel && media.videos.length > 0) {
                _secLabel('视频');
                media.videos.forEach((v, vi) => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-image-item vertical' + (firstLastLock ? ' disabled' : '');
                    item.dataset.mediaType = 'video'; item.dataset.mediaIndex = vi + 1; item.dataset.srcId = v.srcId; item.dataset.url = v.url;
                    item.innerHTML = `<span class="dropdown-thumb media-thumb-icon">${MEDIA_TAG_ICONS.video}</span><span class="img-label">视频 ${vi + 1}</span><span class="img-at">(@${vi + 1})</span>`;
                    item.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        if (firstLastLock) return; // 首尾帧模式仅支持 2 张图片
                        this.insertMediaTag('video', vi + 1, v); this.hideImageDropdown();
                    });
                    this.dropdownImages.appendChild(item);
                });
            }
            // 音频段（在下）
            if (isVideoSel && media.audios.length > 0) {
                _secLabel('音频');
                media.audios.forEach((a, ai) => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-image-item vertical' + (firstLastLock ? ' disabled' : '');
                    item.dataset.mediaType = 'audio'; item.dataset.mediaIndex = ai + 1; item.dataset.srcId = a.srcId; item.dataset.url = a.url;
                    item.innerHTML = `<span class="dropdown-thumb media-thumb-icon">${MEDIA_TAG_ICONS.audio}</span><span class="img-label">音频 ${ai + 1}</span><span class="img-at">(@${ai + 1})</span>`;
                    item.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        if (firstLastLock) return; // 首尾帧模式仅支持 2 张图片
                        this.insertMediaTag('audio', ai + 1, a); this.hideImageDropdown();
                    });
                    this.dropdownImages.appendChild(item);
                });
            }
            // 角色段（来自角色库）
            if (chars.length > 0) {
                _secLabel('角色');
                const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                chars.forEach((c) => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-image-item vertical dropdown-char-item';
                    item.dataset.charId = c.id;
                    const cover = c.cover ? `<img class="dropdown-thumb" src="${escH(c.cover)}" alt="">` : `<span class="dropdown-thumb media-thumb-icon">${MEDIA_TAG_ICONS.character || ''}</span>`;
                    item.innerHTML = `${cover}<span class="img-label px-no-i18n">${escH(c.name)}</span>${c.count ? `<span class="img-cnt">（${c.count}张）</span>` : ''}${c.linked ? '<span class="img-at">已连入</span>' : ''}`;
                    item.title = c.count ? `@${c.name}（${c.count}张）` : `@${c.name}`;
                    item.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        // 防重复：同一次选择只插入一次（双击 / 事件重复触发）
                        if (this._charPickAt && Date.now() - this._charPickAt < 400) return;
                        this._charPickAt = Date.now();
                        this.insertCharacterTag(c);
                        this.hideImageDropdown();
                        global.CharacterLib.mentionCharacter(c.id);
                        // 连入后 chip 即为有效态（mentionCharacter 连线失败时显示为失效）
                        this.refreshCharacterTags();
                    });
                    this.dropdownImages.appendChild(item);
                });
            }
        },

        // 角色 chip：头像 + @名称（lime 风格）；node=匹配到的已连入角色节点，缺省为失效态（角色未连入当前节点）
        // 序列化为 token「[角色:名称#characterId]」，见 getPromptText / setPromptText
        createCharacterTagElement(name, charId, node) {
            const CL = global.CharacterLib;
            const tag = document.createElement('span');
            tag.className = 'image-tag media-tag-character' + (node ? '' : ' is-invalid');
            tag.dataset.mediaType = 'character';
            tag.dataset.charId = charId || '';
            tag.dataset.charName = name || '';
            tag.dataset.charNode = node ? node.id : '';
            tag.setAttribute('contenteditable', 'false');
            const cover = node && CL && CL.coverOfNode ? CL.coverOfNode(node) : '';
            tag.innerHTML = (cover ? '<img class="image-tag-thumbnail char-tag-avatar" alt="" draggable="false">' : `<span class="image-tag-thumbnail media-tag-icon">${MEDIA_TAG_ICONS.character || ''}</span>`)
                + '<span class="image-tag-text px-no-i18n"></span>';
            if (cover) {
                const im = tag.querySelector('img');
                im.src = cover;
                im.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'image-tag-thumbnail media-tag-icon'; s.innerHTML = MEDIA_TAG_ICONS.character || ''; im.replaceWith(s); }, { once: true });
            }
            tag.querySelector('.image-tag-text').textContent = '@' + (name || '');
            if (!node) {
                // 输入框（contenteditable）不参与 DOM 自动翻译：tooltip 在此按当前语言取译文
                const tip = '该角色未连入当前节点';
                let en = null;
                try { if (typeof window.getCurrentLang === 'function' && window.getCurrentLang() === 'en' && window.PX_I18N) en = window.PX_I18N.translate(tip); } catch (_) { /* 无翻译模块 */ }
                tag.title = en || tip;
            }
            return tag;
        },

        // 连线变化后刷新已有角色 chip 的有效 / 失效态（原位替换，不重建整个输入框，光标不跳）
        refreshCharacterTags() {
            const CL = global.CharacterLib;
            const input = this.el && this.el.promptInput;
            if (!CL || !CL.linkedCharNodes || !input) return;
            const tags = input.querySelectorAll('.image-tag[data-media-type="character"]');
            if (!tags.length) return;
            const list = CL.linkedCharNodes();
            tags.forEach(tag => {
                const node = CL.matchLinked(list, tag.dataset.charName, tag.dataset.charId);
                const name = node ? CL.charNameOf(node) : tag.dataset.charName;
                if ((node ? node.id : '') === (tag.dataset.charNode || '') && name === tag.dataset.charName) return;
                const nt = this.createCharacterTagElement(name, (node && node.characterId) || tag.dataset.charId, node);
                if (tag.parentNode) tag.parentNode.replaceChild(nt, tag);
            });
        },

        // 插入 @角色 标签（序列化为 token [角色:名称#id]，刷新 / 重新打开后还原为 chip）
        insertCharacterTag(c) {
            const input = this.el.promptInput;
            const sel = window.getSelection();
            const CL = global.CharacterLib;
            const node = CL && CL.linkedCharNodes ? CL.matchLinked(CL.linkedCharNodes(), c.name, c.id) : null;
            const tag = this.createCharacterTagElement(c.name, c.id, node);
            if (this.currentEditingTag && this.currentEditingTag.parentNode) {
                this.currentEditingTag.parentNode.replaceChild(tag, this.currentEditingTag);
                this.currentEditingTag = null;
            } else {
                if (this.savedRange) { sel.removeAllRanges(); sel.addRange(this.savedRange); }
                this._removeAtNumberFromInput(0);
                // 光标前紧挨着同一角色的 chip（重复选择）：不再追加
                let prev = null;
                if (sel.rangeCount) {
                    const r = sel.getRangeAt(0);
                    let n = r.startContainer, off = r.startOffset;
                    if (n.nodeType === Node.TEXT_NODE) { if (n.textContent.slice(0, off).trim() === '') { prev = n.previousSibling; } }
                    else if (n === input && off > 0) prev = input.childNodes[off - 1];
                    while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.trim() === '') prev = prev.previousSibling;
                }
                if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.dataset && prev.dataset.mediaType === 'character' && prev.dataset.charId === String(c.id)) {
                    this.savedRange = null; input.focus(); return;
                }
                this._insertElementAtCursor(tag); this._insertTextAtCursor(' ');
            }
            this.savedRange = null; input.focus();
        },

        getCursorPosition() {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return null;
            const range = sel.getRangeAt(0);
            const rects = range.getClientRects();
            if (rects.length > 0) { const r = rects[rects.length - 1]; return { x: r.left, y: r.bottom }; }
            const rect = range.getBoundingClientRect();
            return { x: rect.left, y: rect.bottom };
        },

        showImageDropdown() {
            if (!this.imageSelectDropdown) this.imageSelectDropdown = document.getElementById('imageSelectDropdown');
            if (!this.imageSelectDropdown) return;
            const sel = window.getSelection();
            if (sel.rangeCount > 0) this.savedRange = sel.getRangeAt(0).cloneRange();
            this.renderImageDropdown();
            let cursorPos; try { cursorPos = this.getCursorPosition(); } catch (_) {}
            const ww = window.innerWidth, wh = window.innerHeight;
            const dw = 200 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1);
            let left = cursorPos ? cursorPos.x : 100, top = cursorPos ? cursorPos.y + 5 : 100;
            const dd = this.imageSelectDropdown;
            dd.style.setProperty('display', 'block', 'important');
            dd.style.setProperty('position', 'fixed', 'important');
            dd.style.setProperty('left', '-9999px', 'important');
            dd.style.setProperty('top', '-9999px', 'important');
            dd.style.setProperty('visibility', 'hidden', 'important');
            dd.style.setProperty('opacity', '0', 'important');
            dd.classList.remove('hidden');
            void dd.offsetHeight;
            const actualH = dd.getBoundingClientRect().height || 200;
            if (left + dw > ww - 10) left = ww - dw - 10;
            if (left < 10) left = 10;
            const spaceBelow = wh - top - 10, spaceAbove = (cursorPos ? cursorPos.y : 100) - 10;
            if (spaceBelow < actualH && spaceAbove > actualH) top = (cursorPos ? cursorPos.y : 100) - actualH - 5;
            if (top < 10) top = 10;
            dd.style.setProperty('display', 'block', 'important');
            dd.style.setProperty('position', 'fixed', 'important');
            dd.style.setProperty('left', left + 'px', 'important');
            dd.style.setProperty('top', top + 'px', 'important');
            dd.style.setProperty('background', 'rgba(30, 30, 35, 0.95)', 'important');
            dd.style.setProperty('border', '2px solid rgba(0, 229, 255, 0.5)', 'important');
            dd.style.setProperty('border-radius', '12px', 'important');
            dd.style.setProperty('min-width', '200px', 'important');
            dd.style.setProperty('max-width', '400px', 'important');
            dd.style.setProperty('box-shadow', '0 8px 32px rgba(0, 0, 0, 0.5)', 'important');
            dd.style.setProperty('backdrop-filter', 'blur(24px)', 'important');
            dd.style.setProperty('z-index', '99999', 'important');
            dd.style.setProperty('opacity', '1', 'important');
            dd.style.setProperty('visibility', 'visible', 'important');
            dd.style.setProperty('overflow', 'visible', 'important');
            if (this.dropdownListenersTimeout) clearTimeout(this.dropdownListenersTimeout);
            this.dropdownListenersTimeout = setTimeout(() => {
                this.dropdownListenersTimeout = null;
                document.addEventListener('click', this._handleClickOutsideBound);
                document.addEventListener('keydown', this._handleKeyDownBound);
            }, 100);
        },

        showImageDropdownForTag(tag) {
            if (this.currentEditingTag && this.currentEditingTag !== tag) this.hideImageDropdown();
            this.currentEditingTag = tag;
            this.savedRange = null;
            const r = tag.getBoundingClientRect();
            this._showImageDropdownAtPosition(r.left, r.bottom);
        },

        _showImageDropdownAtPosition(x, y) {
            if (!this.imageSelectDropdown) this.imageSelectDropdown = document.getElementById('imageSelectDropdown');
            if (!this.imageSelectDropdown) return;
            this.renderImageDropdown();
            const ww = window.innerWidth, wh = window.innerHeight, dw = 200 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1);
            const dd = this.imageSelectDropdown;
            dd.style.setProperty('display', 'block', 'important');
            dd.style.setProperty('visibility', 'hidden', 'important');
            dd.style.setProperty('position', 'fixed', 'important');
            dd.style.setProperty('left', '-9999px', 'important');
            dd.style.setProperty('top', '-9999px', 'important');
            dd.style.setProperty('opacity', '0', 'important');
            dd.classList.remove('hidden');
            void dd.offsetHeight;
            const actualH = dd.getBoundingClientRect().height || 200;
            let left = x, top = y + 5;
            if (left + dw > ww - 10) left = ww - dw - 10;
            if (left < 10) left = 10;
            const spaceBelow = wh - top - 10, spaceAbove = y - 10;
            if (spaceBelow < actualH && spaceAbove > actualH) top = y - actualH - 5;
            if (top < 10) top = 10;
            dd.style.setProperty('display', 'block', 'important');
            dd.style.setProperty('position', 'fixed', 'important');
            dd.style.setProperty('left', left + 'px', 'important');
            dd.style.setProperty('top', top + 'px', 'important');
            dd.style.setProperty('z-index', '99999', 'important');
            dd.style.setProperty('opacity', '1', 'important');
            dd.style.setProperty('visibility', 'visible', 'important');
            if (this.dropdownListenersTimeout) clearTimeout(this.dropdownListenersTimeout);
            this.dropdownListenersTimeout = setTimeout(() => {
                this.dropdownListenersTimeout = null;
                document.addEventListener('click', this._handleClickOutsideBound);
                document.addEventListener('keydown', this._handleKeyDownBound);
            }, 100);
        },

        _handleClickOutside(e) {
            if (!this.imageSelectDropdown) return;
            if (this.imageSelectDropdown.contains(e.target)) return;
            if (e.target.closest && e.target.closest('.image-tag')) return;
            this.hideImageDropdown();
        },

        _handleKeyDown(e) {
            if (e.key === 'Escape') { this.hideImageDropdown(); return; }
            if (e.isComposing) return;
            if (this.imageSelectDropdown && !this.imageSelectDropdown.classList.contains('hidden')) {
                if (/^[0-9]$/.test(e.key)) {
                    const idx = parseInt(e.key, 10);
                    const images = this.getUploadedImagesForDropdown();
                    if (images.some(im => im.index === idx)) { e.preventDefault(); e.stopPropagation(); this.insertImageTag(idx); this.hideImageDropdown(); }
                }
            }
        },

        hideImageDropdown() {
            if (!this.imageSelectDropdown) this.imageSelectDropdown = document.getElementById('imageSelectDropdown');
            if (this.imageSelectDropdown) {
                this.imageSelectDropdown.classList.add('hidden');
                ['display', 'position', 'left', 'top', 'visibility', 'opacity', 'z-index'].forEach(p => this.imageSelectDropdown.style.removeProperty(p));
            }
            if (this.dropdownListenersTimeout) { clearTimeout(this.dropdownListenersTimeout); this.dropdownListenersTimeout = null; }
            this.currentEditingTag = null;
            document.removeEventListener('click', this._handleClickOutsideBound);
            document.removeEventListener('keydown', this._handleKeyDownBound);
        },

        // ============ 标签 / 序列化 ============
        createImageTagElement(imageIndex) {
            const img = this.uploadedImages[imageIndex - 1];
            if (!img) return null;
            let thumb = img.previewUrl || img.previewDataUrl || img.dataUrl || img.highUrl || img.url || '';
            if (thumb && thumb.includes('/original/')) thumb = thumb.replace('/original/', '/preview/');
            if (thumb && thumb.startsWith('http')) thumb = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(thumb)}`;
            const tag = document.createElement('span');
            tag.className = 'image-tag';
            tag.dataset.imageIndex = imageIndex;
            tag.dataset.fileId = img.fileId || '';
            tag.setAttribute('contenteditable', 'false');
            tag.innerHTML = `<img class="image-tag-thumbnail" src="${thumb || ''}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect fill=%22%23333%22 width=%2216%22 height=%2216%22/%3E%3Ctext fill=%22%23666%22 x=%228%22 y=%2212%22 text-anchor=%22middle%22 font-size=%229%22%3E${imageIndex}%3C/text%3E%3C/svg%3E'"><span class="image-tag-text">图片${imageIndex}</span>`;
            this._setupImageTagDrag(tag);
            let isDragging = false, mouseDownTime = 0, mX = 0, mY = 0;
            tag.addEventListener('mousedown', (e) => { isDragging = false; mouseDownTime = Date.now(); mX = e.clientX; mY = e.clientY; this.hideImageDropdown(); });
            tag.addEventListener('dragstart', () => { isDragging = true; });
            tag.addEventListener('mouseup', (e) => {
                if (isDragging) return;
                if (Math.abs(e.clientX - mX) > 5 || Math.abs(e.clientY - mY) > 5) return;
                if (Date.now() - mouseDownTime > 200) return;
                e.preventDefault(); e.stopPropagation();
                this.showImageDropdownForTag(tag);
            });
            return tag;
        },

        // 创建 @ 媒体标签（视频/音频）：复用 .image-tag 结构，data-media-type 区分配色与序列化
        createMediaTagElement(mediaType, index, cand) {
            if (!cand || !cand.url) return null;
            const tag = document.createElement('span');
            tag.className = 'image-tag media-tag-' + mediaType;
            tag.dataset.mediaType = mediaType;
            tag.dataset.mediaIndex = index;
            tag.dataset.srcId = cand.srcId || '';
            tag.dataset.mediaUrl = cand.url;
            tag.dataset.mediaDuration = cand.duration || 0;
            tag.dataset.mediaSize = cand.size || 0;
            tag.setAttribute('contenteditable', 'false');
            tag.innerHTML = `<span class="image-tag-thumbnail media-tag-icon">${MEDIA_TAG_ICONS[mediaType] || ''}</span><span class="image-tag-text">${mediaType === 'video' ? '视频' : '音频'}${index}</span>`;
            this._setupImageTagDrag(tag);
            let isDragging = false, mouseDownTime = 0, mX = 0, mY = 0;
            tag.addEventListener('mousedown', (e) => { isDragging = false; mouseDownTime = Date.now(); mX = e.clientX; mY = e.clientY; this.hideImageDropdown(); });
            tag.addEventListener('dragstart', () => { isDragging = true; });
            tag.addEventListener('mouseup', (e) => {
                if (isDragging) return;
                if (Math.abs(e.clientX - mX) > 5 || Math.abs(e.clientY - mY) > 5) return;
                if (Date.now() - mouseDownTime > 200) return;
                e.preventDefault(); e.stopPropagation();
                this.showImageDropdownForTag(tag);
            });
            return tag;
        },

        // 插入 @ 媒体标签（视频/音频）；点击已有标签换绑时原位替换
        insertMediaTag(mediaType, index, cand) {
            const input = this.el.promptInput;
            const sel = window.getSelection();
            if (this.currentEditingTag && this.currentEditingTag.parentNode) {
                const tag = this.createMediaTagElement(mediaType, index, cand);
                if (tag) { this.currentEditingTag.parentNode.replaceChild(tag, this.currentEditingTag); this.currentEditingTag = null; }
                this.savedRange = null; input.focus();
                this.updatePriceDisplay();
                return;
            }
            if (this.savedRange) { sel.removeAllRanges(); sel.addRange(this.savedRange); }
            this._removeAtNumberFromInput(index);
            const tag = this.createMediaTagElement(mediaType, index, cand);
            if (tag) { this._insertElementAtCursor(tag); this._insertTextAtCursor(' '); }
            this.savedRange = null; input.focus();
            this.updatePriceDisplay();
        },

        _setupImageTagDrag(tag) {
            tag.draggable = true;
            tag.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                // 媒体标签（视频/音频）携带类型，拖放落点按 类型+编号 定位标签
                if (tag.dataset.mediaType) e.dataTransfer.setData('application/x-pixora-media', tag.dataset.mediaType);
                e.dataTransfer.setData('text/plain', tag.dataset.mediaType ? tag.dataset.mediaIndex : tag.dataset.imageIndex);
                tag.classList.add('dragging');
                const r = tag.getBoundingClientRect();
                e.dataTransfer.setDragImage(tag, r.width / 2, r.height / 2);
            });
            tag.addEventListener('dragend', () => tag.classList.remove('dragging'));
        },

        insertImageTag(imageIndex) {
            const input = this.el.promptInput;
            const sel = window.getSelection();
            if (this.currentEditingTag && this.currentEditingTag.parentNode) {
                const tag = this.createImageTagElement(imageIndex);
                if (tag) { this.currentEditingTag.parentNode.replaceChild(tag, this.currentEditingTag); this.currentEditingTag = null; }
                this.savedRange = null; input.focus(); return;
            }
            if (this.savedRange) { sel.removeAllRanges(); sel.addRange(this.savedRange); }
            this._removeAtNumberFromInput(imageIndex);
            const tag = this.createImageTagElement(imageIndex);
            if (tag) { this._insertElementAtCursor(tag); this._insertTextAtCursor(' '); }
            this.savedRange = null; input.focus();
        },

        _deleteTextBeforeCursor(deleteLen) {
            const sel = window.getSelection();
            if (sel.rangeCount === 0 || deleteLen <= 0) return false;
            const endRange = sel.getRangeAt(0).cloneRange();
            const textNodes = []; let total = 0;
            const walker = document.createTreeWalker(this.el.promptInput, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while ((node = walker.nextNode()) !== null) {
                const nr = document.createRange(); nr.selectNode(node);
                if (endRange.compareBoundaryPoints(Range.START_TO_START, nr) <= 0) break;
                let len = node.textContent.length;
                if (endRange.compareBoundaryPoints(Range.START_TO_START, nr) > 0 && endRange.compareBoundaryPoints(Range.START_TO_END, nr) < 0) {
                    const br = document.createRange(); br.setStart(node, 0); br.setEnd(endRange.startContainer, endRange.startOffset); len = br.toString().length;
                }
                textNodes.push({ node, len }); total += len;
            }
            const target = total - deleteLen;
            if (target < 0) return false;
            let cur = 0;
            for (const { node, len } of textNodes) {
                if (cur + len >= target) {
                    const r = document.createRange();
                    r.setStart(node, target - cur); r.setEnd(endRange.startContainer, endRange.startOffset);
                    r.deleteContents(); return true;
                }
                cur += len;
            }
            return false;
        },

        _removeAtNumberFromInput(imageIndex) {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const cr = sel.getRangeAt(0).cloneRange();
            const br = document.createRange();
            br.selectNodeContents(this.el.promptInput);
            br.setEnd(cr.startContainer, cr.startOffset);
            const text = br.toString();
            let deleteLen = 0;
            const p = new RegExp(`@${imageIndex}(?!\\d)$`);
            if (p.test(text)) deleteLen = (`@${imageIndex}`).length;
            else if (/@$/.test(text)) deleteLen = 1;
            if (deleteLen > 0) this._deleteTextBeforeCursor(deleteLen);
        },

        _insertElementAtCursor(element) {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(element);
            r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
        },

        _insertTextAtCursor(text) {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const r = sel.getRangeAt(0); r.deleteContents();
            const tn = document.createTextNode(text); r.insertNode(tn);
            r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
        },

        getPromptText() {
            const clone = this.el.promptInput.cloneNode(true);
            clone.querySelectorAll('.image-tag').forEach(tag => {
                // 媒体标签（视频/音频）与图片标签分别序列化：[视频N] / [音频N] / [图片N]
                const mType = tag.dataset.mediaType;
                // 角色 chip → [角色:名称#characterId]（无角色库模块时退化为 @名称）
                if (mType === 'character') {
                    const CL = global.CharacterLib;
                    const nm = tag.dataset.charName || ((tag.querySelector('.image-tag-text') || {}).textContent || '').replace(/^@/, '');
                    tag.parentNode.replaceChild(document.createTextNode(CL && CL.charToken ? CL.charToken(nm, tag.dataset.charId) : '@' + nm), tag);
                    return;
                }
                const idx = mType ? tag.dataset.mediaIndex : tag.dataset.imageIndex;
                if (idx) {
                    const label = mType === 'video' ? '视频' : (mType === 'audio' ? '音频' : '图片');
                    tag.parentNode.replaceChild(document.createTextNode(`[${label}${idx}]`), tag);
                }
            });
            return clone.textContent || '';
        },

        setPromptText(text) {
            const input = this.el.promptInput;
            input.innerHTML = '';
            if (!text) return;
            // 角色：token [角色:名称#id] 按已连入当前生成节点的角色节点还原 chip（先 id 后名称，未连入为失效态）；
            // 旧数据纯文本「@名称」若已连入同名角色（最长名优先）自动升级为 chip
            const CL = global.CharacterLib;
            const linked = (CL && CL.linkedCharNodes) ? CL.linkedCharNodes() : [];
            const pushText = (s) => {
                if (!s) return;
                if (!linked.length || s.indexOf('@') === -1) { input.appendChild(document.createTextNode(s)); return; }
                CL.splitAtMentions(s, linked).forEach(p => {
                    if (p.node) input.appendChild(this.createCharacterTagElement(p.name, p.node.characterId, p.node));
                    else if (p.text) input.appendChild(document.createTextNode(p.text));
                });
            };
            const regex = new RegExp('\\[(图片|视频|音频)(\\d+)\\]' + (CL && CL.CHAR_TOKEN_SRC ? '|' + CL.CHAR_TOKEN_SRC : ''), 'g');
            let lastIndex = 0, match;
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) pushText(text.slice(lastIndex, match.index));
                const label = match[1], idx = parseInt(match[2]);
                let tag = null;
                if (match[3] !== undefined) {
                    const node = CL.matchLinked(linked, match[3], match[4]);
                    tag = this.createCharacterTagElement(node ? CL.charNameOf(node) : match[3], (node && node.characterId) || match[4] || '', node);
                } else if (label === '图片') {
                    tag = this.createImageTagElement(idx);
                } else if (global.CanvasBlocks && Array.isArray(global.CanvasBlocks.blocks)) {
                    // 媒体标签按编号解析当前画布候选；候选已删时回退纯文本
                    const media = this.getCanvasMediaForDropdown();
                    const list = label === '视频' ? media.videos : media.audios;
                    tag = this.createMediaTagElement(label === '视频' ? 'video' : 'audio', idx, list[idx - 1]);
                }
                if (tag) input.appendChild(tag); else input.appendChild(document.createTextNode(match[0]));
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < text.length) pushText(text.slice(lastIndex));
        },

        removeImageTagByFileId(fileId, imageIndex) {
            this.el.promptInput.querySelectorAll('.image-tag').forEach(tag => {
                if (fileId && tag.dataset.fileId === fileId) tag.remove();
                else if (!fileId && imageIndex && parseInt(tag.dataset.imageIndex) === imageIndex) tag.remove();
            });
        },

        updateImageTags() {
            // 跳过媒体标签（视频/音频）：无 fileId，编号不随参考图槽位重排
            this.el.promptInput.querySelectorAll('.image-tag:not([data-media-type])').forEach(tag => {
                const fileId = tag.dataset.fileId;
                const oldIndex = parseInt(tag.dataset.imageIndex);
                let cur = -1;
                if (fileId) cur = this.uploadedImages.findIndex(im => im && im.fileId === fileId);
                if (cur === -1) { tag.remove(); return; }
                const newIndex = cur + 1;
                const img = this.uploadedImages[cur];
                let thumb = img.previewUrl || img.previewDataUrl || img.dataUrl;
                if (thumb && thumb.includes('/original/')) thumb = thumb.replace('/original/', '/preview/');
                if (thumb && thumb.startsWith('http')) thumb = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(thumb)}`;
                const tEl = tag.querySelector('.image-tag-thumbnail');
                if (tEl && thumb && tEl.src !== thumb) tEl.src = thumb;
                if (newIndex !== oldIndex) {
                    tag.dataset.imageIndex = newIndex;
                    const ts = tag.querySelector('.image-tag-text');
                    if (ts) ts.textContent = `图片${newIndex}`;
                }
            });
        },

        checkAndShowImageDropdown() {
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const node = range.startContainer, off = range.startOffset;
            this.savedRange = range.cloneRange();
            let text = '';
            if (node.nodeType === Node.TEXT_NODE) text = node.textContent.slice(0, off);
            else if (node.nodeType === Node.ELEMENT_NODE) {
                const r = document.createRange(); r.selectNodeContents(this.el.promptInput); r.setEnd(node, off); text = r.toString();
            }
            if (text.endsWith('@')) this.showImageDropdown(); else this.hideImageDropdown();
        },

        _onPromptKeyDown(e) {
            if (e.isComposing) return;
            if (!/^[0-9]$/.test(e.key)) return;
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const node = range.startContainer, off = range.startOffset;
            let text = '';
            if (node.nodeType === Node.TEXT_NODE) text = node.textContent.slice(0, off);
            if (!text.endsWith('@')) return;
            const idx = parseInt(e.key, 10);
            const images = this.getUploadedImagesForDropdown();
            if (images.some(im => im.index === idx)) { e.preventDefault(); e.stopPropagation(); this.insertImageTag(idx); this.hideImageDropdown(); }
        },

        _onPaste(e) {
            const items = e.clipboardData && e.clipboardData.items;
            if (items) {
                for (const it of items) {
                    if (it.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = it.getAsFile();
                        if (file) {
                            // 画布场景：选中 gen 节点时粘贴图片 → 创建参考图节点 + 连线（与「+参考图」按钮一致）
                            if (this.onAddRefImage && this.onAddRefImage(file) === true) return;
                            this.handleFile(file);
                        }
                        return;
                    }
                }
            }
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const tn = document.createTextNode(text);
            range.insertNode(tn);
            range.collapse(false);
            sel.removeAllRanges(); sel.addRange(range);
            this.checkAndShowImageDropdown();
        },

        _setupPromptInputDropZone() {
            const pi = this.el.promptInput;
            if (!pi) return;
            pi.addEventListener('dragover', (e) => {
                e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
            });
            pi.addEventListener('drop', (e) => {
                const mediaType = e.dataTransfer.getData('application/x-pixora-media');
                const imageIndex = e.dataTransfer.getData('text/plain');
                // 仅处理标签拖拽（纯数字序号：图片或视频/音频媒体标签）；普通文字拖入不拦截
                if (!imageIndex || !/^\d+$/.test(imageIndex.trim())) return;
                e.preventDefault();
                const draggedTag = mediaType
                    ? pi.querySelector(`.image-tag[data-media-type="${mediaType}"][data-media-index="${imageIndex.trim()}"]`)
                    : pi.querySelector(`.image-tag[data-image-index="${imageIndex.trim()}"]`);
                if (!draggedTag) return;
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (!range) return;
                let container = range.startContainer;
                if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;
                const enclosing = container && container.closest ? container.closest('.image-tag') : null;
                if (enclosing === draggedTag) return;
                if (enclosing) { range.setStartBefore(enclosing); range.collapse(true); }
                if (draggedTag.parentNode) draggedTag.parentNode.removeChild(draggedTag);
                range.insertNode(draggedTag);
                const nr = document.createRange(); nr.setStartAfter(draggedTag); nr.collapse(true);
                const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(nr);
            });
        },

        // ============ 生成 ============
        /** 收集生成参数（不发起任务），供外部 onGenerate 使用 */
        getGenerationParams() {
            const prompt = this.getPromptText().trim();
            const imageUrls = this.uploadedImages.filter(Boolean).map(im => ({ highUrl: im.highUrl, previewUrl: im.previewUrl }));
            const params = {
                baseUrl: (typeof getBackendUrl === 'function') ? getBackendUrl() : (global.API_CONFIG && global.API_CONFIG.baseUrl) || '',
                prompt,
                // 任务中使用用户实际选中的前端模型 ID，避免 actualModel 映射把模型语义改成另一个模型。
                // _PB_DRAFT_PSEUDO_1027 样片伪模型剥离 -draft 后缀还原真实模型（draft 标记见下）
                model: String(this.currentModel || '').replace(/-draft$/, ''),
                aspectRatio: this.currentAspect,
                imageSize: this.currentRes,
                ...(this._isVideoModel(this.currentModel) ? { quality: this.currentVideoRes || '720p', duration: this.currentDuration || 5 }
                    : (this._effectiveQuality(this.currentModel) ? { quality: this._effectiveQuality(this.currentModel) } : {})),
                // 样片模式（仅 Seedance 2.5）：随任务提交 draft 标记，服务端强制 480p 并按 480p 价计费
                ...(this._isVideoModel(this.currentModel) && this.draftMode && /seedance-2-5/i.test(String(this.currentModel || '')) ? { draft: true } : {}),
                imageUrls,
                api: localStorage.getItem('nano_selected_model_api') || 'auto'
            };
            // @ 引用的画布媒体（视频/音频标签）：提交时带上 URL 与元数据，画布生成侧与连线素材合并去重
            const refVideos = [], refAudios = [];
            const seenIds = new Set(), seenUrls = new Set();
            const _conn = this._getConnectedMedia();
            const _allowed = new Set([].concat(_conn.videos, _conn.audios).map(x => x.url));
            this.el.promptInput.querySelectorAll('.image-tag[data-media-type]').forEach(tag => {
                const u = tag.dataset.mediaUrl; if (!u) return;
                if (!_allowed.has(u)) return; // 未连入的旧 @ 标签不提交
                const sid = tag.dataset.srcId;
                if ((sid && seenIds.has(sid)) || seenUrls.has(u)) return;
                if (sid) seenIds.add(sid);
                seenUrls.add(u);
                const meta = { url: u, size: parseInt(tag.dataset.mediaSize, 10) || 0, duration: parseFloat(tag.dataset.mediaDuration) || 0 };
                (tag.dataset.mediaType === 'video' ? refVideos : refAudios).push(meta);
            });
            if (refVideos.length) params.promptVideoUrls = refVideos;
            if (refAudios.length) params.promptAudioUrls = refAudios;
            if (this.currentModel && this.currentModel.startsWith('mj-') && this.el.mjStylize) {
                params.mjParams = {
                    stylize: this.el.mjStylize.value,
                    quality: this.el.mjQuality.value,
                    chaos: this.el.mjChaos.value,
                    style: this.el.mjStyle.value,
                    no: this.el.mjNo.value
                };
            }
            return params;
        },

        _handleGenerate() {
            const params = this.getGenerationParams();
            if (!params.prompt) { this.el.promptInput && this.el.promptInput.focus(); alert('请输入提示词'); return; }
            if (this.onGenerate) this.onGenerate(params);
            else console.warn('[PromptBar] 未设置 onGenerate 钩子', params);
        },

        _notifyRefsChange() {
            // 程序化注入（连线同步）不触发外部回调，避免回声导致误删连线
            if (this._suppressRefsNotify) return;
            if (this.onRefsChange) this.onRefsChange(this.uploadedImages.filter(Boolean));
        },

        // ============ 外部 API：注入/同步参考图（画布连线场景）============
        /**
         * 切换输入栏模式：
         *   'full'    — 完整模式（含 +按钮 和参考图预览条），用于生成节点
         *   'minimal' — 极简模式（隐藏 +按钮 和参考图预览条），用于参考图节点 / 编辑图片节点
         */
        setMode(mode) {
            const refsStrip = this.el && this.el.refsStrip;
            const addImgBtn = this.el && this.el.addImgBtn;
            if (mode === 'minimal') {
                if (refsStrip) refsStrip.classList.add('hidden');
                if (addImgBtn) addImgBtn.classList.add('hidden');
            } else {
                if (refsStrip) refsStrip.classList.remove('hidden');
                if (addImgBtn) addImgBtn.classList.remove('hidden');
            }
        },

        /** 用外部图片数组替换当前参考图列表；每项 {highUrl, previewUrl, fileId?} */
        setReferenceImages(images) {
            // 原地清空+填充:保持数组引用不变,避免与 window.uploadedImages / script.js uploadedImages 断开
            this.uploadedImages.length = 0;
            (images || []).slice(0, MAX_REF_SLOTS).forEach((im, i) => {
                this.uploadedImages.push({
                    highUrl: im.highUrl || im.url,
                    previewUrl: im.previewUrl || im.highUrl || im.url,
                    fileId: im.fileId || ('ext_' + i),
                    srcId: im.srcId || null,
                    charId: im.charId || null,
                    isUploaded: true
                });
            });
            for (let i = this.uploadedImages.length; i < MAX_REF_SLOTS; i++) this.uploadedImages.push(null);
            // 程序化注入期间抑制 _notifyRefsChange 回声
            this._suppressRefsNotify = true;
            this.renderRefs();
            this._suppressRefsNotify = false;
        },

        /** 清空参考图与提示词 */
        clearAll() {
            // 原地清空:保持数组引用不变
            this.uploadedImages.length = 0;
            for (let i = 0; i < MAX_REF_SLOTS; i++) this.uploadedImages.push(null);
            if (this.el.promptInput) this.el.promptInput.innerHTML = '';
            this.renderRefs();
        },

        /** 把当前状态写回指定节点对象（画布持久化用）
         *  仅生成节点保存 model/aspectRatio/size；参考图/文本节点不需要这些字段，
         *  避免切换节点时把上一个节点的设置串到当前节点造成"共享"假象。
         */
        snapshotToNode(node) {
            if (!node) return;
            node.prompt = this.getPromptText();
            if (node.nodeType === 'gen') {
                // _PB_DRAFT_PSEUDO_1027 节点持久化真实模型 ID（样片伪模型剥离 -draft；样片态走 node.draft 标记）
                node.model = String(this.currentModel || '').replace(/-draft$/, '');
                node.aspectRatio = this.currentAspect;
                node.size = this.currentRes;
                node.duration = this.currentDuration;
                node.resolution = this.currentVideoRes;
                // 视频节点：持久化当前模式，避免提交时节点旧值覆盖刚切换的模式
                if (this._isVideoModel(this.currentModel)) {
                    node.videoMode = this.videoMode || 'reference';
                    // 样片模式随节点持久化（刷新后徽标/升级按钮凭 node.draft/draftAt 恢复）
                    // draftFix1031：只置真不置假——node.draft 表示「当前展示中的这条结果是不是样片」，
                    // 由生成完成/历史记录切换维护；在面板里换模型、改分辨率不能把正在展示的历史样片标记清掉
                    if (this.draftMode && /seedance-2-5/i.test(String(this.currentModel || ''))) node.draft = true;
                } else {
                    // 图片节点：持久化 GPT 画质与 MJ 参数（重试 / 再来一个 / 右键生成时按节点值提交）
                    const qcfg = this.modelConfigMap[this.currentModel];
                    if (qcfg && Array.isArray(qcfg.qualityOptions) && qcfg.qualityOptions.length) node.quality = this.currentQuality;
                    if (this.currentModel && this.currentModel.startsWith('mj-') && this.el.mjStylize) {
                        node.mjParams = { stylize: this.el.mjStylize.value, quality: this.el.mjQuality.value, chaos: this.el.mjChaos.value, style: this.el.mjStyle.value, no: this.el.mjNo.value };
                    }
                }
            }
        },

        /** 从节点对象恢复状态
         *  生成节点：用节点自身保存的值，缺失时用默认值（不继承上一个节点的状态）；
         *  参考图/文本节点：保持 PromptBar 当前状态不变（这些节点不使用这些字段）。
         */
        // 面板模式跟随节点类型：ref 视频素材→video，其余 ref/text→image（gen 节点按自身模型处理）
        // 跟随模式经 loadFromNode 调用；固定（停靠）模式由 CanvasMain 停靠分支直接调用
        _syncModeForNode(node) {
            if (!node || node.nodeType === 'gen') return;
            const mode = (node.nodeType === 'ref' && node.mediaType === 'video') ? 'video' : 'image';
            if (this.currentGenMode === mode) return;
            this.currentGenMode = mode;
            this.currentModel = (mode === 'video' ? this.lastVideoModel : this.lastImageModel)
                || this._firstModelOfMode(mode === 'video') || this.currentModel;
            if (mode === 'video') { this.lastVideoModel = this.currentModel; } else { this.lastImageModel = this.currentModel; }
            this._updateGenModeUI();
            this.renderModelOptionsForApi();
        },

        loadFromNode(node) {
            if (!node) return;
            if (node.nodeType === 'gen') {
                // 旧视频节点自愈：genCategory 为 video 但 model 缺失/是图片模型时，按节点类别修正模型与名字
                if (node.genCategory === 'video' && !(node.model && this._isVideoModel(node.model))) {
                    const fixed = (this.lastVideoModel && this._isVideoModel(this.lastVideoModel)) ? this.lastVideoModel : this._firstModelOfMode(true);
                    if (fixed) {
                        node.model = fixed;
                        const patch = { model: fixed };
                        if (/^图片节点\d+$/.test(node.name || '') && global.CanvasBlocks && global.CanvasBlocks._nextGenName) {
                            patch.name = global.CanvasBlocks._nextGenName('视频节点');
                        }
                        if (global.CanvasBlocks && global.CanvasBlocks.update) global.CanvasBlocks.update(node.id, patch);
                    }
                }
                // 生成节点：使用节点保存的值，缺失时用默认（不继承上一个节点）
                const defaultModel = (this.models && this.models[0] && this.models[0].id) || this.currentModel || 'Nano Banana Pro';
                // _PB_DRAFT_PSEUDO_1027 样片节点（node.draft + Seedance 2.5）映射为伪模型选项，同步恢复样片态
                const _isDraftNode = !!(node.draft && /seedance-2-5/i.test(String(node.model || '')));
                this.currentModel = _isDraftNode ? 'doubao-seedance-2-5-260628-draft' : (node.model || defaultModel);
                this.currentAspect = node.aspectRatio || '1:1';
                this.currentRes = node.size || '4K';
                this.currentDuration = node.duration || 5;
                this.currentVideoRes = node.resolution || '';
                // 恢复节点保存的视频模式（全能参考|首尾帧）；变化时重渲染参考图槽位（首尾帧限 2 张）
                const prevMode = this.videoMode;
                this.videoMode = node.videoMode || 'reference';
                if (this.renderRefs && prevMode !== this.videoMode) this.renderRefs();
                // 恢复节点保存的样片模式（样片节点已映射为伪模型；480p 锁定与价格随之联动）
                this.draftMode = _isDraftNode;
            }
            // ref/text 节点：不写回节点，但面板模式跟随节点类型
            // （点图片素材出图片面板、点视频素材出视频面板；文本/音频保持图片模式），修复模式残留
            if (node.nodeType !== 'gen') {
                const wantVideo = node.nodeType === 'ref' && node.mediaType === 'video';
                const mode = wantVideo ? 'video' : 'image';
                if (this.currentGenMode !== mode) {
                    this.currentGenMode = mode;
                    this.currentModel = (mode === 'video' ? this.lastVideoModel : this.lastImageModel)
                        || this._firstModelOfMode(mode === 'video') || this.currentModel;
                    if (mode === 'video') { this.lastVideoModel = this.currentModel; } else { this.lastImageModel = this.currentModel; }
                }
            }
            this.setPromptText(node.prompt || '');
            this.updateComboLabel();
            // 按节点模型推导生成模式（视频|图片切换键）
            this.currentGenMode = this._isVideoModel(this.currentModel) ? 'video' : 'image';
            if (this._isVideoModel(this.currentModel)) { this.lastVideoModel = this.currentModel; } else { this.lastImageModel = this.currentModel; }
            this._updateGenModeUI();
            // 按当前模式重渲染模型下拉（视频节点只列视频模型，图片节点只列图片模型）
            if (global.CanvasMain && this.apiConfig) this.renderModelOptionsForApi(this.apiConfig.defaultApi);
            this.updateResolutionOptions(this.currentModel);
            this._toggleVideoParams(this.currentModel);
            this.toggleMjParams(this.currentModel);
            // 生成节点：恢复节点保存的 GPT 画质 / MJ 参数，并同步画质滑块（原先切换节点时画质沿用上一个节点的全局值）
            if (node.nodeType === 'gen' && !this._isVideoModel(this.currentModel)) this._restoreImageParams(node);
            this.updatePriceDisplay();
            // 同步模型按钮文字（切换节点时模型标签也要跟着变）
            this._updateModelLabel();
            // 同步选中态
            document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.dataset.value === this.currentModel));
            document.querySelectorAll('.combo-option[data-type="size"]').forEach(o => o.classList.toggle('selected', o.dataset.value === this.currentRes));
            document.querySelectorAll('.ratio-option').forEach(o => o.classList.toggle('selected', o.dataset.value === this.currentAspect));
        },

        _restoreImageParams(node) {
            const model = this.currentModel;
            const cfg = this.modelConfigMap[model];
            const qOpts = (cfg && Array.isArray(cfg.qualityOptions)) ? cfg.qualityOptions : [];
            if (node.quality && qOpts.indexOf(node.quality) !== -1) {
                // 预置家族标记：避免 toggleGptQuality 判定「换家族」而把节点画质重置为默认档
                this._lastQFamily = model && model.startsWith('GPT Image 2.5') ? 'gpt25' : (model && model.startsWith('GPT Image 2 ') ? 'gpt2' : 'other');
                this.currentQuality = node.quality;
            }
            this.toggleGptQuality(model);
            const mj = node.mjParams;
            if (mj && typeof mj === 'object' && model && model.startsWith('mj-') && this.el.mjStylize) {
                const e = this.el;
                if (mj.stylize !== undefined) { e.mjStylize.value = mj.stylize; if (e.mjStylizeValue) e.mjStylizeValue.textContent = mj.stylize; }
                if (mj.quality !== undefined && e.mjQuality) e.mjQuality.value = mj.quality;
                if (mj.chaos !== undefined && e.mjChaos) { e.mjChaos.value = mj.chaos; if (e.mjChaosValue) e.mjChaosValue.textContent = mj.chaos; }
                if (mj.style !== undefined && e.mjStyle) e.mjStyle.value = mj.style;
                if (mj.no !== undefined && e.mjNo) e.mjNo.value = mj.no;
            }
        },

        /** 根据 currentModel 更新模型按钮显示文字 */
        _updateModelLabel() {
            if (!this.el.modelLabel) return;
            // 模型标签统一显示家族简化名（不带 flare/sunburst/vip 等后缀）
            if (this.currentModel && this.currentModel.startsWith('GPT Image 2.5')) {
                this.el.modelLabel.textContent = 'GPT Image 2.5';
                return;
            }
            if (this.currentModel && this.currentModel.startsWith('GPT Image 2 ')) {
                this.el.modelLabel.textContent = 'GPT Image 2';
                return;
            }
            // Nano 2 家族统一显示总名字，子版本名（2.1/Lite）不上标题
            if (this._isNano2Family(this.currentModel)) {
                this.el.modelLabel.textContent = 'Nano Banana 2';
                return;
            }
            let cfg = null;
            const defaultApi = this.apiConfig?.defaultApi;
            if (defaultApi && this.apiConfig?.apis?.[defaultApi]) {
                const apiModels = this.apiConfig.apis[defaultApi].frontend?.models || this.apiConfig.apis[defaultApi].models || [];
                cfg = apiModels.find(m => m.id === this.currentModel);
            }
            if (!cfg) cfg = this.modelConfigMap[this.currentModel];
            if (cfg && cfg.name) this.el.modelLabel.textContent = cfg.name;
        },

        destroy() {
            this._bindings.forEach(({ target, type, handler, opts }) => target && target.removeEventListener(type, handler, opts));
            this._bindings = [];
            this._inited = false;
        }
    };

    // 绑定实例方法引用（用于 add/removeEventListener 配对）
    PromptBar._handleClickOutsideBound = PromptBar._handleClickOutside.bind(PromptBar);
    PromptBar._handleKeyDownBound = PromptBar._handleKeyDown.bind(PromptBar);

    global.PromptBar = PromptBar;
})(window);
