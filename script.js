// ===== 全局配置 =====
// 后端服务器端口配置（本地开发时修改此处）
const BACKEND_CONFIG = {
    port: 3001  // 后端服务实际运行的端口
};

// ===== 收藏功能 =====
const FAVORITES_KEY = 'nano_task_favorites';

// 鉴权请求头：服务端受保护接口（/api/history、/api/canvas）要求 Bearer token
function authHeaders(extra) {
    let h = {};
    try {
        const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
        if (user.token) h['Authorization'] = 'Bearer ' + user.token;
    } catch (e) { /* ignore */ }
    return Object.assign(h, extra || {});
}

// 获取所有收藏的任务（从localStorage）
function getFavoriteTasks() {
    try {
        const data = localStorage.getItem(FAVORITES_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
}

// 检查任务是否已收藏（优先从后端记录检查）
function checkTaskFavorited(taskId) {
    // 先检查localStorage（兼容旧数据）
    const favorites = getFavoriteTasks();
    if (favorites[taskId]) return true;
    
    // 再检查后端记录（如果已加载）- 使用全局变量或空数组
    const cache = typeof historyRecordsCache !== 'undefined' ? historyRecordsCache : [];
    const record = cache.find(r => r.taskId === taskId || r.id === taskId);
    if (record && record.isFavorited) return true;
    
    return false;
}

// 添加任务到收藏（本地+后端）
async function addTaskFavorite(taskId, taskData) {
    // 本地存储
    const favorites = getFavoriteTasks();
    favorites[taskId] = taskData;
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
    }
    
    // 后端同步
    try {
        const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
        if (user.id) {
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history/favorite`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ userId: user.id, taskId: taskId })
            });
            const result = await response.json();
            if (result.code === 200) {
            }
        }
    } catch (err) {
    }
}

// 从收藏中移除任务（本地+后端）
async function removeTaskFavorite(taskId) {
    // 本地移除
    const favorites = getFavoriteTasks();
    delete favorites[taskId];
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
    }
    
    // 后端同步
    try {
        const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
        if (user.id) {
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history/unfavorite`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ userId: user.id, taskId: taskId })
            });
            const result = await response.json();
            if (result.code === 200) {
            }
        }
    } catch (err) {
    }
}

// 获取后端收藏记录
async function getFavoriteRecordsFromBackend() {
    try {
        const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
        if (!user.id) {
            return [];
        }
        const response = await fetch(`${API_CONFIG.baseUrl}/api/history/favorites?userId=${user.id}`, { headers: authHeaders() });
        const result = await response.json();
        
        if (result && result.code === 200 && result.data) {
            return result.data.records || [];
        }
        return [];
    } catch (err) {
        return [];
    }
}

// 显示通知消息
function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        animation: slideDown 0.3s ease;
        max-width: 80%;
        word-wrap: break-word;
    `;
    
    // 根据类型设置颜色
    if (type === 'error') {
        notification.style.backgroundColor = '#ff4444';
        notification.style.color = '#fff';
    } else if (type === 'success') {
        notification.style.backgroundColor = '#00C853';
        notification.style.color = '#fff';
    } else {
        notification.style.backgroundColor = '#00838F';
        notification.style.color = '#fff';
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // 3秒后自动移除
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from { transform: translate(-50%, -100%); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
    }
    @keyframes slideUp {
        from { transform: translate(-50%, 0); opacity: 1; }
        to { transform: translate(-50%, -100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// 自定义确认弹窗
function showCustomConfirm(options) {
    return new Promise((resolve) => {
        const { title, message, btn1Text, btn2Text, btn1Primary = false, btn2Primary = true } = options;
        
        customConfirmTitle.textContent = title;
        customConfirmMessage.innerHTML = message.replace(/\n/g, '<br>');
        customConfirmBtn1.textContent = btn1Text;
        customConfirmBtn2.textContent = btn2Text;
        
        // 设置按钮样式 - 使用CSS类
        customConfirmBtn1.className = btn1Primary ? 'custom-confirm-btn btn-confirm' : 'custom-confirm-btn btn-cancel';
        customConfirmBtn2.className = btn2Primary ? 'custom-confirm-btn btn-confirm' : 'custom-confirm-btn btn-cancel';
        customConfirmBtn1.style.cssText = '';
        customConfirmBtn2.style.cssText = '';
        
        // 显示弹窗
        customConfirmModal.classList.remove('hidden');
        
        // 按钮1点击（保留收藏/取消）
        const btn1Handler = () => {
            customConfirmModal.classList.add('hidden');
            cleanup();
            resolve(false); // false 表示保留收藏
        };
        
        // 按钮2点击（全部记录/确定）
        const btn2Handler = () => {
            customConfirmModal.classList.add('hidden');
            cleanup();
            resolve(true); // true 表示全部记录
        };
        
        // 点击背景关闭
        const modalHandler = (e) => {
            if (e.target === customConfirmModal) {
                customConfirmModal.classList.add('hidden');
                cleanup();
                resolve(null); // null 表示取消
            }
        };
        
        // 关闭按钮点击
        const closeHandler = () => {
            customConfirmModal.classList.add('hidden');
            cleanup();
            resolve(null); // null 表示取消
        };
        
        // 清理事件监听
        function cleanup() {
            customConfirmBtn1.removeEventListener('click', btn1Handler);
            customConfirmBtn2.removeEventListener('click', btn2Handler);
            customConfirmModal.removeEventListener('click', modalHandler);
            if (closeCustomConfirmBtn) {
                closeCustomConfirmBtn.removeEventListener('click', closeHandler);
            }
        }
        
        customConfirmBtn1.addEventListener('click', btn1Handler);
        customConfirmBtn2.addEventListener('click', btn2Handler);
        customConfirmModal.addEventListener('click', modalHandler);
        if (closeCustomConfirmBtn) {
            closeCustomConfirmBtn.addEventListener('click', closeHandler);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // ===== 随机初始化彩球位置 =====
    const balls = document.querySelectorAll('.bg-ball');
    balls.forEach((ball, index) => {
        // 随机位置：-30% 到 80% 之间
        const randomTop = Math.random() * 110 - 30;
        const randomLeft = Math.random() * 110 - 30;
        ball.style.top = `${randomTop}%`;
        ball.style.left = `${randomLeft}%`;
        // 移除原来的位置设置
        ball.style.bottom = 'auto';
        ball.style.right = 'auto';
    });
    
    // ===== 阻止 Edge 浏览器右键菜单（鼠标手势）==========
    // 使用 capture 阶段确保最早阻止，但只阻止菜单，不阻止右键拖动功能
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }, true);
    
    // ===== 阻止参考图区域的默认拖拽行为（防止拖出复制）=====
    document.addEventListener('dragstart', (e) => {
        if (e.target.closest('#refsMini') || e.target.closest('.ref-slot-mini')) {
            e.preventDefault();
        }
    }, true);
    
    // DOM Elements
    const generateBtn = document.getElementById('generateBtn');
    const promptInput = document.getElementById('promptInput');
    const imagesGrid = document.getElementById('imagesGrid');
    const taskCounter = document.getElementById('taskCounter');
    
    // Settings & Config
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const apiKeyInput = document.getElementById('apiKeySetting');
    // baseUrlInput 已移除，改为从API配置获取

    // 后端会自动选择最优接口，前端不需要关心具体使用哪个API
    // 保留此函数用于兼容性，但不再返回特定API的URL
    function getCurrentApiBaseUrl() {
        return '';
    }

    // History
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');

    // Favorites
    const favoritesBtn = document.getElementById('favoritesBtn');
    const favoritesModal = document.getElementById('favoritesModal');
    const closeFavoritesBtn = document.getElementById('closeFavoritesBtn');
    const favoritesList = document.getElementById('favoritesList');
    const favoritesCount = document.getElementById('favoritesCount');

    // Custom Confirm Modal
    const customConfirmModal = document.getElementById('customConfirmModal');
    const customConfirmTitle = document.getElementById('customConfirmTitle');
    const customConfirmMessage = document.getElementById('customConfirmMessage');
    const customConfirmBtn1 = document.getElementById('customConfirmBtn1');
    const customConfirmBtn2 = document.getElementById('customConfirmBtn2');
    const closeCustomConfirmBtn = document.getElementById('closeCustomConfirmBtn');

    // Model Dropdown
    const modelBtn = document.getElementById('modelBtn');
    const modelMenu = document.getElementById('modelMenu');
    const modelLabel = document.getElementById('modelLabel');
    const modelOptions = document.querySelectorAll('.model-option');

    // Combo Dropdown
    const comboBtn = document.getElementById('comboBtn');
    const comboMenu = document.getElementById('comboMenu');
    const comboLabel = document.getElementById('comboLabel');
    const comboOptions = document.querySelectorAll('.combo-option');

    // State
    let activeTasks = [];
    // 参考图数组：PromptBar 加载后直接指向 PromptBar.uploadedImages（同一份引用，无需手动同步）
    let uploadedImages = new Array(8).fill(null);
    window.uploadedImages = uploadedImages; // 暴露给 image-editor.js 使用
    let currentModel = localStorage.getItem('nano_selected_model') || 'GPT Image 2 Pro';
    let currentAspect = 'auto';
    let currentRes = '1K';

    // 暴露给设置弹窗使用
    window.mainCurrentModel = currentModel;

    // 内存优化配置
    const MAX_TASK_CARDS = 100; // 最大任务卡片数量

    // 参考图拖动排序状态
    let dragState = {
        isDragging: false,
        draggedIndex: null,
        longPressTimer: null,
        startX: 0,
        currentX: 0,
        hasMoved: false
    };
    const LONG_PRESS_DURATION = 400; // 长按触发时间（毫秒）



    // ===== 委托给统一 PromptBar 模块（与画布共用同一套逻辑） =====
    // PromptBar 已在 index.html 中先于 script.js 加载，这里仅初始化并接管生成行为。
    // 后续的内联函数（renderModelOptions、showImageDropdown、triggerUpload 等）仍保留作为
    // 兜底实现，但因 PromptBar 已绑定所有事件监听器，这些函数不会被调用（除非 PromptBar 加载失败）。
    if (typeof PromptBar !== 'undefined') {
        PromptBar.init();
        // 让本地 uploadedImages 变量直接指向 PromptBar.uploadedImages（同一份引用）
        // 这样所有引用 uploadedImages 的旧代码（handleFile、prepareImageUrlsForGeneration 等）
        // 均能透明访问 PromptBar 管理的参考图数据。
        uploadedImages = PromptBar.uploadedImages;
        window.uploadedImages = uploadedImages;
        // 接管生成行为：将 PromptBar 收集的参数传给主页的 startGeneration
        PromptBar.onGenerate = (params) => startGeneration(params);
        // 参考图变化时同步本地状态变量（保持兼容）
        PromptBar.onRefsChange = () => { uploadedImages = PromptBar.uploadedImages; window.uploadedImages = uploadedImages; };
        // 比例/模型/分辨率变化时保存设置
        PromptBar.onAspectChange = () => saveSettings();
        PromptBar.onParamChange = () => saveSettings();
        // 图片编辑器入口
        PromptBar.onOpenImageEditor = (imageUrl, displayIndex, fileId) => {
            if (typeof openImageEditor === 'function') openImageEditor(imageUrl, displayIndex, fileId);
        };
        // 添加参考图走默认流程（PromptBar 内部上传到 TOS）
        PromptBar.onAddRefImage = null;
    }

    // 获取实际使用的模型
    function getActualModel(model, resolution) {
        // 检查是否有 actualModel 映射
        const defaultApi = apiConfig?.defaultApi;
        // 新链路models结构优先
        if (defaultApi && apiConfig?.apis?.[defaultApi]?.models) {
            const modelConfig = apiConfig.apis[defaultApi].models.find(m => m.id === model);
            if (modelConfig?.actualModel) {
                return modelConfig.actualModel;
            }
        }
        // 兼容旧结构
        if (defaultApi && apiConfig?.apis?.[defaultApi]?.frontend?.models) {
            const modelConfig = apiConfig.apis[defaultApi].frontend.models.find(m => m.id === model);
            if (modelConfig?.actualModel) {
                return modelConfig.actualModel;
            }
        }
        return model;
    }

    // 更新价格显示
    function updatePriceDisplay() {
        // 获取实际使用的模型（考虑分辨率）
        const actualModel = getActualModel(currentModel, currentRes);

        // 价格显示修复：新链路models结构优先，兼容旧结构，全局兜底
        let modelConfig = null;
        const defaultApi = apiConfig?.defaultApi;
        if (defaultApi && apiConfig?.apis?.[defaultApi]?.models) {
            modelConfig = apiConfig.apis[defaultApi].models.find(m => m.id === actualModel);
        }
        if (!modelConfig && defaultApi && apiConfig?.apis?.[defaultApi]?.frontend?.models) {
            modelConfig = apiConfig.apis[defaultApi].frontend.models.find(m => m.id === actualModel);
        }
        if (!modelConfig) {
            for (const apiObj of Object.values(apiConfig?.apis || {})) {
                const found = (apiObj.models || (apiObj.frontend && apiObj.frontend.models) || []).find(m => m.id === actualModel);
                if (found) { modelConfig = found; break; }
            }
        }
        if (!modelConfig) {
            modelConfig = modelConfigMap[actualModel];
        }

        // 价格矩阵优先：按当前画质 × 分辨率取价，未配置的组合回退到模型默认价格
        let price = modelConfig?.price;
        const pm = modelConfig?.priceMatrix || {};
        // 与 PromptBar / 服务端预扣一致：仅多档画质模型使用当前画质；画质不在矩阵中 → medium → 第一档
        const q = (typeof PromptBar !== 'undefined' && PromptBar._effectiveQuality) ? (PromptBar._effectiveQuality(currentModel) || 'medium') : 'medium';
        const qk = (typeof PromptBar !== 'undefined' && PromptBar._priceQualityKey) ? PromptBar._priceQualityKey(pm, q) : (pm[q] ? q : 'medium');
        if (qk && pm[qk] && typeof pm[qk][currentRes] === 'number') {
            price = pm[qk][currentRes];
        }

        if (price !== undefined) {
            // 积分显示不带小数点：去尾随零，整数价格显示如 15/张
            taskCounter.textContent = `${Number(price.toFixed(2))}/${t('unitImage') || '张'}`;
        } else {
            taskCounter.textContent = `-${t('unitImage') || '张'}`;
        }
    }



    // 全局配置存储
    let apiConfig = null;
    let modelConfigMap = {};

    async function loadApiConfig() {
        try {
            const response = await fetch(`${API_CONFIG.baseUrl}/api/config`);
            const result = await response.json();
            if (result.code === 200) {
                apiConfig = result.data;
                // 构建模型配置映射
                Object.values(apiConfig.apis).forEach(api => {
                    const models = api.frontend?.models || api.models;
                    if (models) {
                        models.forEach(model => {
                            modelConfigMap[model.id] = model;
                        });
                    }
                });
                
                // 后端自动选择接口，前端只选择模型
                // 从本地存储获取保存的模型
                const savedModel = localStorage.getItem('nano_selected_model');
                // 尊重用户真实选择（含 nano 系列），仅当保存的模型在配置中不存在时才忽略，由后续默认逻辑兜底
                const effectiveSavedModel = (savedModel && modelConfigMap[savedModel]) ? savedModel : null;
                if (effectiveSavedModel) {
                    currentModel = effectiveSavedModel;
                    window.mainCurrentModel = effectiveSavedModel;
                }
                
                // 更新设置面板中的模型列表
                renderSettingsModelList();
                
                // 渲染模型选项
                renderModelOptionsForApi(apiConfig.defaultApi);
                                
                return true;
            } else {
                throw new Error('服务器返回错误');
            }
        } catch (err) {
            console.error('加载API配置失败:', err);
            // 显示错误提示
            const modelMenu = document.getElementById('modelMenu');
            if (modelMenu) {
                modelMenu.innerHTML = '<div style="padding: 10px; color: #ff4444; font-size: 12px; text-align: center;">配置加载失败</div>';
            }
            return false;
        }
    }

    // 设置默认模型显示
    function setDefaultModelLabel() {
        // 等待配置加载完成后再设置
        if (modelLabel && apiConfig && apiConfig.apis) {
            const defaultApi = apiConfig.defaultApi || 'provider_b';
            const api = apiConfig.apis[defaultApi];
            if (api && api.models && api.models.length > 0) {
                modelLabel.textContent = api.models[0].name;
            }
        }
    }

    // 动态生成模型选项
    function renderModelOptions() {
        const modelMenu = document.getElementById('modelMenu');
        if (!modelMenu || !apiConfig) return;
        
        modelMenu.innerHTML = '';
        
        // 获取所有启用的模型
        const allModels = [];
        Object.values(apiConfig.apis).forEach(api => {
            if (api.models) {
                allModels.push(...api.models);
            }
        });
        
        // 生成选项
        allModels.forEach((model, index) => {
            const option = document.createElement('div');
            option.className = 'model-option';
            option.dataset.value = model.id;
            if (model.model4k) {
                option.dataset.model4k = model.model4k;
            }
            if (index === 0) {
                option.classList.add('selected');
                currentModel = model.id;
                if (modelLabel) {
                    modelLabel.textContent = model.name;
                }
            }
            option.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-weight: 500;">${model.name}</span>
                    <span class="model-desc" style="font-size: 11px; color: #888;">${getModelDesc(model)}</span>
                </div>
            `;
            modelMenu.appendChild(option);
        });
        
        // 重新绑定点击事件
        bindModelOptionEvents();
    }

    // 绑定模型选项点击事件
    function bindModelOptionEvents() {
        const modelOptions = document.querySelectorAll('.model-option');
        modelOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，防止面板关闭
                
                let value = option.dataset.value;
                // 点击 Nano 2 家族代表项时，按版本胶囊状态解析为真实模型（2.0/2.1）
                if (value === 'Nano Banana 2.0') value = nanoNormalModel();
                currentModel = value;
                
                // 获取选择的 API（如果有特殊标记）
                const selectedApi = option.dataset.api || 'auto';
                localStorage.setItem('nano_selected_model_api', selectedApi);
                
                // Update UI
                modelOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                // 不自动关闭面板，让用户可以继续选择
                
                // Update label with model name from default API's config
                // 从默认API的模型列表中获取
                let modelConfig = null;
                const defaultApi = apiConfig?.defaultApi;
                if (defaultApi && apiConfig && apiConfig.apis[defaultApi]) {
                    const apiModels = apiConfig.apis[defaultApi].frontend?.models || apiConfig.apis[defaultApi].models || [];
                    modelConfig = apiModels.find(m => m.id === value);
                }
                // 如果当前API中没有找到，再从全局map中查找
                if (!modelConfig) {
                    modelConfig = modelConfigMap[value];
                }
                if (modelLabel && modelConfig) {
                    modelLabel.textContent = modelConfig.name;
                }
                
                // Update price display
                updatePriceDisplay();

                // Update resolution options based on model restrictions
                updateResolutionOptions(value);

                // 切换 MJ 参数显示
                toggleMjParams(value);
                
                // 保存选择到本地存储
                localStorage.setItem('nano_selected_model', value);
                window.mainCurrentModel = value;
            });
        });
    }

    // Nano 2 版本胶囊（2.0/2.1）：与 canvas prompt-bar.js 同口径
    // 版本状态独立于具体模型；快速档（Lite）只记版本不切模型
    let nanoVersion = localStorage.getItem('nano_ver') === '2.1' ? '2.1' : '2.0';
    if (currentModel === 'Nano Banana 2.1') nanoVersion = '2.1';
    else if (currentModel === 'Nano Banana 2.0') nanoVersion = '2.0';
    function isNano2FamilyModel(m) { return m === 'Nano Banana 2.0' || m === 'Nano Banana 2.1' || m === 'Nano Banana 2.0 快速'; }
    function nanoNormalModel() { return nanoVersion === '2.1' ? 'Nano Banana 2.1' : 'Nano Banana 2.0'; }
    function updateNanoVerButton() {
        const btn = document.getElementById('nanoVerBtn');
        if (!btn) return;
        const visible = isNano2FamilyModel(currentModel);
        btn.classList.toggle('hidden', !visible);
        if (!visible) return;
        const is21 = nanoVersion === '2.1';
        btn.classList.toggle('active', is21);
        btn.title = is21 ? '切换到 2.0 版本' : '切换到 2.1 版本';
        btn.setAttribute('aria-label', btn.title);
    }
    function toggleNanoVersion() {
        if (!isNano2FamilyModel(currentModel)) return;
        nanoVersion = nanoVersion === '2.1' ? '2.0' : '2.1';
        localStorage.setItem('nano_ver', nanoVersion);
        // 快速档（Lite）只更新版本状态与胶囊位置，生成模型保持 Lite 不变
        if (currentModel === 'Nano Banana 2.0 快速') { updateNanoVerButton(); return; }
        const next = nanoNormalModel();
        if (!modelConfigMap[next]) { nanoVersion = nanoVersion === '2.1' ? '2.0' : '2.1'; localStorage.setItem('nano_ver', nanoVersion); updateNanoVerButton(); return; }
        currentModel = next;
        localStorage.setItem('nano_selected_model', next);
        localStorage.setItem('nano_selected_model_api', 'auto');
        window.mainCurrentModel = next;
        // 下拉高亮同步到家族代表项（2.1 无独立下拉项）
        document.querySelectorAll('.model-option').forEach(opt => {
            const v = opt.dataset.value;
            opt.classList.toggle('selected', v === 'Nano Banana 2.0' || v === next);
        });
        if (modelLabel) modelLabel.textContent = 'Nano Banana 2';
        updateResolutionOptions(next);
        updatePriceDisplay();
        toggleMjParams(next);
        updateNanoVerButton();
    }
    const nanoVerBtnEl = document.getElementById('nanoVerBtn');
    if (nanoVerBtnEl) nanoVerBtnEl.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleNanoVersion(); });

    // 当前选择的模型（从主界面同步）- 使用已有的 currentModel
    if (window.mainCurrentModel) {
        currentModel = window.mainCurrentModel;
    }
    
    // 根据模型名称映射对应的 API
    function getApiForModel(modelId) {
        // 渠道分组完全由后端配置决定（模型 grp 字段/配置分组键），前端不再按模型名推断
        if (apiConfig && apiConfig.apis) {
            for (const api of Object.values(apiConfig.apis)) {
                const models = api.frontend?.models || api.models || [];
                const hit = models.find(m => m.id === modelId);
                if (hit && hit.grp) return hit.grp;
            }
            for (const gk of Object.keys(apiConfig.apis)) {
                const models = apiConfig.apis[gk].frontend?.models || apiConfig.apis[gk].models || [];
                if (models.some(m => m.id === modelId)) return gk;
            }
        }
        return '';
    }
    // currentApi 根据当前模型动态映射
    let currentApi = getApiForModel(currentModel) || (apiConfig && apiConfig.apis && Object.keys(apiConfig.apis)[0]) || 'gB';

    // 渲染设置面板中的模型选择列表
    function renderSettingsModelList() {
        const container = document.getElementById('modelSelector');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 如果没有apiConfig，显示加载中
        if (!apiConfig) {
            container.innerHTML = '<div style="padding: 10px; color: #888; font-size: 12px; text-align: center;">加载中...</div>';
            return;
        }
        
        // 遍历所有启用的API收集模型（去重 by model.id）
        const allModels = [];
        const seenModelIds = new Set();
        Object.entries(apiConfig.apis).forEach(([apiKey, api]) => {
            if (api.enabled === false) return;
            const models = api.frontend?.models || api.models || [];
            models.forEach(model => {
                // Nano Banana 2.1 仅通过版本胶囊切换进入，不在下拉单列（与 canvas prompt-bar 同口径）
                if (model.id === 'Nano Banana 2.1') return;
                if (!seenModelIds.has(model.id)) {
                    seenModelIds.add(model.id);
                    allModels.push(model);
                }
            });
        });
        
        if (allModels.length === 0) {
            container.innerHTML = '<div style="padding: 10px; color: #888; font-size: 12px; text-align: center;">暂无可用模型</div>';
            return;
        }
        
        // 显示所有模型
        allModels.forEach((model) => {
            const isSelected = model.id === currentModel;
            const modelDiv = document.createElement('div');
            modelDiv.style.cssText = `padding: 10px; border-radius: 6px; margin-bottom: 8px; cursor: pointer; ${isSelected ? 'background: rgba(196, 241, 123, 0.1); border: 1px solid var(--primary-accent);' : 'background: rgba(255,255,255,0.05); border: 1px solid transparent;'}`;
            modelDiv.dataset.model = model.id;
            modelDiv.onclick = () => selectModel(model.id);
            
            modelDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; ${isSelected ? 'color: var(--primary-accent);' : 'color: #fff;'}">${model.name}</span>
                    <span style="font-size: 11px; color: #888;">${isSelected ? '当前使用' : '点击切换'}</span>
                </div>
                <div style="font-size: 10px; color: #666; margin-top: 4px;">${model.description}</div>
            `;
            
            container.appendChild(modelDiv);
        });
    }

    // 选择模型
    window.selectModel = function(modelId) {
        currentModel = modelId;

        // 更新UI
        renderSettingsModelList();

        // 同步到主界面的 currentModel
        window.mainCurrentModel = modelId;

        // 保存选择到本地存储
        localStorage.setItem('nano_selected_model', modelId);
        
        // 渠道分组由后端配置决定，前端不做模型名推断
        const selectedApi = getApiForModel(modelId);
        currentApi = selectedApi;
        localStorage.setItem('nano_selected_model_api', selectedApi);

        // 更新价格显示
        updatePriceDisplay();
    };
    
    // 为指定API渲染模型选项
    const MODEL_DESC_KEYS = {
        'Nano Banana Pro': 'descNanoBananaPro',
        'Nano Banana 2.0': 'descNanoBanana2',
        'Nano Banana 2.1': 'descNanoBanana21',
        'GPT Image 2 标准': 'descGptImage2',
        'GPT Image 2 Pro': 'descGptImage2Vip'
    };
    function getModelDesc(model) {
        const key = MODEL_DESC_KEYS[model.id];
        return key ? t(key) : (model.description || '');
    }

    function renderModelOptionsForApi(apiKey) {
        // 首页与画布共用 PromptBar，禁止旧版脚本重复绘制并产生双状态。
        if (typeof PromptBar !== 'undefined' && PromptBar._inited) {
            PromptBar.renderModelOptionsForApi(apiKey);
            return;
        }
        const modelMenu = document.getElementById('modelMenu');
        if (!modelMenu) return;
        
        // 如果没有配置，显示加载中
        if (!apiConfig || !apiConfig.apis[apiKey]) {
            modelMenu.innerHTML = `<div style="padding: 10px; color: #888; font-size: 12px; text-align: center;">${t('loading')}</div>`;
            return;
        }
        
        // 遍历所有启用的API收集模型（去重 by model.id）
        const allModels = [];
        const seenModelIds = new Set();
        Object.entries(apiConfig.apis).forEach(([apiKey, api]) => {
            if (api.enabled === false) return;
            const models = api.frontend?.models || api.models || [];
            models.forEach(model => {
                // Nano Banana 2.1 仅通过版本胶囊切换进入，不在下拉单列（与 canvas prompt-bar 同口径）
                if (model.id === 'Nano Banana 2.1') return;
                if (!seenModelIds.has(model.id)) {
                    seenModelIds.add(model.id);
                    allModels.push({ ...model, _apiKey: apiKey });
                }
            });
        });
        
        // 完全清空模型菜单，移除所有子元素
        while (modelMenu.firstChild) {
            modelMenu.removeChild(modelMenu.firstChild);
        }
        
        allModels.forEach((model, index) => {
            const option = document.createElement('div');
            option.className = 'model-option';
            option.dataset.value = model.id;
            if (model.model4k) {
                option.dataset.model4k = model.model4k;
            }
            // 检查是否是当前选中的模型（从 localStorage 或当前状态）
            // Nano 2 家族（2.0/2.1）共享同一下拉项的高亮（2.1 由版本胶囊管理）
            const optFam = (model.id === 'Nano Banana 2.0' || model.id === 'Nano Banana 2.1') ? 'Nano Banana 2.0' : model.id;
            const curFam = (currentModel === 'Nano Banana 2.0' || currentModel === 'Nano Banana 2.1') ? 'Nano Banana 2.0' : currentModel;
            const isSelected = optFam === curFam;
            if (isSelected) {
                option.classList.add('selected');
                if (modelLabel) {
                    modelLabel.textContent = model.name;
                }
            } else if (index === 0 && !currentModel) {
                // 如果没有选中任何模型，默认选择第一个
                option.classList.add('selected');
                currentModel = model.id;
                if (modelLabel) {
                    modelLabel.textContent = model.name;
                }
            }
            option.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-weight: 500;">${model.name}</span>
                    <span class="model-desc" style="font-size: 11px; color: #888;">${getModelDesc(model)}</span>
                </div>
            `;
            modelMenu.appendChild(option);
        });
        
        // 重新绑定点击事件
        bindModelOptionEvents();

        // 更新分辨率选项
        if (currentModel) {
            updateResolutionOptions(currentModel);
        } else if (allModels.length > 0) {
            updateResolutionOptions(allModels[0].id);
        }

        // 更新 MJ 参数面板显示
        toggleMjParams(currentModel);

        // 初始化 Nano 版本胶囊位置
        updateNanoVerButton();
    }

    // --- Init ---
    // 模型下拉/比例/分辨率/@图片 等提示词栏 UI 已由 PromptBar 模块统一初始化。
    // 此处仅保留主页特有的初始化（任务恢复、设置加载等），避免重复加载 API 配置导致下拉菜单重渲染。
    if (typeof PromptBar === 'undefined') {
        updateComboLabel();
    }
    initI18n();

    // 加载配置（主页仅用于获取模型价格、任务恢复等；提示词栏的模型/比例下拉已由 PromptBar 自行加载）
    loadApiConfig().then(async () => {
        if (typeof PromptBar === 'undefined') {
            updateResolutionOptions(currentModel);
            updatePriceDisplay();
        }
        loadSettings();
        // 先从后端恢复进行中的任务（插入到最前面）
        await restoreActiveTasksFromBackend();
        // 再从历史记录恢复任务卡片（添加到后面）
        await restoreTaskCardsFromHistory();
    });
    
    // Initialize model label with display name
    const selectedModelOption = document.querySelector('.model-option.selected');
    if (modelLabel && selectedModelOption) {
        modelLabel.textContent = selectedModelOption.textContent;
    }
    
    // 监听后端任务恢复事件
    window.addEventListener('tasksRestored', (e) => {
        const tasks = e.detail;
        // 仅恢复主页任务，画布任务由画布自行恢复
        tasks.forEach(task => {
            if (task.source === 'canvas') return;
            createTaskCardFromBackendTask(task);
        });
    });

    // 监听任务状态更新（仅处理主页任务，画布任务由画布处理）
    window.addEventListener('taskStatusUpdated', (e) => {
        const task = e.detail;
        if (task && task.source === 'canvas') return;
        updateTaskCardFromBackend(task);
    });
    // 任务不存在（404）时，从历史记录恢复卡片数据
    window.addEventListener('taskNotFound', async (e) => {
        const { taskId, source } = e.detail;
        if (source === 'canvas') return;
        if (typeof historyRecordsCache !== 'undefined' && historyRecordsCache.length > 0) {
            const record = historyRecordsCache.find(r => r.taskId === taskId);
            if (record) { createTaskCardFromRecord(record, false); return; }
        }
        try {
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            const resp = await fetch(getBackendUrl() + '/api/history?limit=50', {
                headers: { 'Authorization': 'Bearer ' + (user.token || '') }
            });
            const data = await resp.json();
            if (data.code === 200 && data.data && data.data.records) {
                historyRecordsCache = data.data.records;
                const record = historyRecordsCache.find(r => r.taskId === taskId);
                if (record) { createTaskCardFromRecord(record, false); }
            }
        } catch (err) { console.error('[任务恢复] 从历史记录恢复失败:', err); }
    });
    
    // 监听任务完成
    window.addEventListener('taskCompleted', async (e) => {
        await completeTaskCardFromBackend(e.detail);
    });

    // --- Event Listeners ---

    // Language Switch (handled in i18n.js)
    // 注册语言切换回调：模型下拉/比例/分辨率 等提示词栏 UI 的多语言由 PromptBar 自行处理；
    // 主页仅负责历史/收藏弹窗的重渲染和价格显示更新。
    if (typeof onLangChange === 'function') {
        onLangChange(() => {
            if (typeof PromptBar === 'undefined') {
                updatePriceDisplay();
                try {
                    if (typeof currentApi !== 'undefined' && currentApi) {
                        renderModelOptionsForApi(currentApi);
                    } else if (apiConfig && apiConfig.defaultApi) {
                        renderModelOptionsForApi(apiConfig.defaultApi);
                    }
                } catch (e) {}
            }
            // 若历史/收藏弹窗当前可见，重新渲染以应用新语言
            if (historyModal && !historyModal.classList.contains('hidden')) {
                renderHistoryList();
            }
            if (favoritesModal && !favoritesModal.classList.contains('hidden')) {
                renderFavoritesList();
            }
        });
    }

    // Generate —— 生成按钮的点击事件由 PromptBar 模块统一绑定（onGenerate 钩子 → startGeneration）。
    // 仅当 PromptBar 未加载时走兜底绑定。
    if (typeof PromptBar === 'undefined') {
        generateBtn.addEventListener('click', () => startGeneration());
    }

    // Settings
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

    // History Modal Events
    historyBtn.addEventListener('click', () => {
        renderHistoryList();
        historyModal.classList.remove('hidden');
    });
    closeHistoryBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
    clearHistoryBtn.addEventListener('click', async () => {
        // 使用自定义弹窗
        const result = await showCustomConfirm({
            title: t('clearHistoryTitle'),
            message: t('clearHistoryMessage'),
            btn1Text: t('keepFavorites'),
            btn2Text: t('allRecords'),
            btn1Primary: false,
            btn2Primary: true
        });
        
        if (result) {
            // 点击了"全部记录"
            await clearGenerationRecords(true);
            renderHistoryList();
        } else if (result === false) {
            // 点击了"保留收藏"
            await clearGenerationRecords(false);
            renderHistoryList();
        }
        // 如果 result === null，表示用户关闭了弹窗，不执行任何操作
    });

    // Favorites Modal Events
    favoritesBtn.addEventListener('click', () => {
        renderFavoritesList();
        favoritesModal.classList.remove('hidden');
    });
    closeFavoritesBtn.addEventListener('click', () => favoritesModal.classList.add('hidden'));

    // API 切换功能已移除，后端自动根据权重选择最优接口
    saveSettingsBtn.addEventListener('click', () => {
        saveSettings();
        settingsModal.classList.add('hidden');
    });

    // 模型下拉、比例/分辨率下拉、@图片下拉、参考图上传等交互
    // 均已由 PromptBar 模块统一绑定（详见上方 PromptBar.init() 段落）。
    // 仅当 PromptBar 未加载时走兜底绑定，避免双重监听导致下拉菜单重复弹窗。
    if (typeof PromptBar === 'undefined') {
        // Model dropdown toggle
        modelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = modelMenu.classList.contains('hidden');
            modelMenu.classList.add('hidden');
            comboMenu.classList.add('hidden');
            if (isHidden) modelMenu.classList.remove('hidden');
        });

        // Model options - 静态选项回退（配置加载失败时使用）
        if (modelOptions.length > 0) {
            modelOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const value = option.dataset.value;
                    modelOptions.forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                    currentModel = value;
                    modelLabel.textContent = option.textContent;
                    updatePriceDisplay();
                    updateResolutionOptions(value);
                });
            });
        }
    }

    // Update resolution options based on model restrictions
    function updateResolutionOptions(model) {
        // 优先使用从服务器获取的配置
        const modelConfig = modelConfigMap[model];
        let allowedSizes = modelConfig?.supportedResolutions;
        
        // 如果没有服务器配置，使用本地默认配置
        if (!allowedSizes) {
            allowedSizes = ['1K', '2K', '4K'];
        }
        
        const sizeOptions = document.querySelectorAll('.combo-option[data-type="size"]');
        
        sizeOptions.forEach(opt => {
            const sizeValue = opt.dataset.value;
            
            if (allowedSizes && allowedSizes.length > 0) {
                // Model has restrictions
                if (allowedSizes.includes(sizeValue)) {
                    opt.classList.remove('disabled');
                    opt.style.opacity = '1';
                    opt.style.pointerEvents = 'auto';
                } else {
                    opt.classList.add('disabled');
                    opt.style.opacity = '0.3';
                    opt.style.pointerEvents = 'none';
                    // Remove selected class if this option was selected
                    opt.classList.remove('selected');
                }
            } else {
                // No restrictions for this model
                opt.classList.remove('disabled');
                opt.style.opacity = '1';
                opt.style.pointerEvents = 'auto';
            }
        });
        
        // If current resolution is not allowed, switch to first allowed one
        if (allowedSizes && allowedSizes.length > 0 && !allowedSizes.includes(currentRes)) {
            currentRes = allowedSizes[0];
            // Update selected state
            sizeOptions.forEach(opt => {
                if (opt.dataset.value === currentRes) {
                    opt.classList.add('selected');
                } else {
                    opt.classList.remove('selected');
                }
            });
            updateComboLabel();
        }
    }

    // 切换 MJ 参数显示
    function toggleMjParams(model) {
        const isMj = model && model.startsWith('mj-');
        const resolutionSection = document.getElementById('resolutionSection');
        const mjParamsSection = document.getElementById('mjParamsSection');

        if (isMj) {
            // MJ 模型：隐藏分辨率，显示 MJ 参数
            if (resolutionSection) resolutionSection.classList.add('hidden');
            if (mjParamsSection) mjParamsSection.classList.remove('hidden');
        } else {
            // 非 MJ 模型：显示分辨率，隐藏 MJ 参数
            if (resolutionSection) resolutionSection.classList.remove('hidden');
            if (mjParamsSection) mjParamsSection.classList.add('hidden');
        }
    }

    // 比例/分辨率下拉、参考图上传按钮、提示词粘贴/输入/keydown 等事件
    // 均已由 PromptBar 模块统一绑定。仅当 PromptBar 未加载时走兜底绑定。
    if (typeof PromptBar === 'undefined') {
        // Combo Dropdown Toggle
        comboBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = comboMenu.classList.contains('hidden');
            modelMenu.classList.add('hidden');
            comboMenu.classList.add('hidden');
            if (isHidden) comboMenu.classList.remove('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            comboMenu.classList.add('hidden');
            modelMenu.classList.add('hidden');
        });

        // Combo Dropdown Options (for resolution)
        comboOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = option.dataset.type;
                const value = option.dataset.value;
                const section = option.closest('.combo-section');
                section.querySelectorAll('.combo-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                if (type === 'size') { currentRes = value; updatePriceDisplay(); }
                updateComboLabel();
            });
        });

        // Ratio Options
        const ratioOptions = document.querySelectorAll('.ratio-option');
        ratioOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                ratioOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                currentAspect = value;
                updateComboLabel();
            });
        });

        // Input (Bottom +)
        const addImgBtn = document.getElementById('addImgBtn');
        if (addImgBtn) {
            addImgBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                triggerUpload();
            });
        }

        // Paste in prompt
        promptInput.addEventListener('paste', e => {
            const activeElement = document.activeElement;
            const chatInput = document.getElementById('chatInput');
            if (chatInput && (activeElement === chatInput || chatInput.contains(activeElement))) return;
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    handleFile(items[i].getAsFile());
                    e.preventDefault();
                    return;
                }
            }
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            if (text) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    const textNode = document.createTextNode(text);
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                } else {
                    document.execCommand('insertText', false, text);
                }
                checkAndShowImageDropdown();
            }
        });
    } else {
        // PromptBar 已加载：确保本地 currentModel/currentAspect/currentRes 状态变量
        // 与 PromptBar 模块内部状态保持同步（onParamChange/onAspectChange 钩子触发时更新）。
        const _syncLocalState = () => {
            currentModel = PromptBar.currentModel || currentModel;
            currentAspect = PromptBar.currentAspect || currentAspect;
            currentRes = PromptBar.currentRes || currentRes;
        };
        const _origOnParam = PromptBar.onParamChange;
        const _origOnAspect = PromptBar.onAspectChange;
        PromptBar.onParamChange = (type, value) => {
            if (type === 'model') currentModel = value;
            else if (type === 'res') currentRes = value;
            _syncLocalState();
            if (typeof _origOnParam === 'function') _origOnParam(type, value);
        };
        PromptBar.onAspectChange = (aspect) => {
            currentAspect = aspect;
            _syncLocalState();
            if (typeof _origOnAspect === 'function') _origOnAspect(aspect);
        };
    }

    // @图片选择功能
    let imageSelectDropdown = null;
    let dropdownImages = null;
    let savedRange = null; // 保存光标位置
    let dropdownListenersTimeout = null; // 下拉框外部事件监听器挂起超时

    // 获取已上传图片的列表（用于@选择）
    function getUploadedImagesForDropdown() {
        // console.log('uploadedImages in getUploadedImagesForDropdown:', uploadedImages);
        const images = [];
        uploadedImages.forEach((img, index) => {
            // console.log(`Checking image ${index}:`, img);
            // 放宽条件：只要有图片数据就显示
            if (img && (img.previewUrl || img.previewDataUrl || img.highUrl || img.dataUrl || img.url)) {
                // 优先使用预览图，避免加载完整图
                let thumbnailUrl;
                if (img.previewUrl) {
                    thumbnailUrl = img.previewUrl;
                } else if (img.previewDataUrl) {
                    thumbnailUrl = img.previewDataUrl;
                } else if (img.dataUrl) {
                    thumbnailUrl = img.dataUrl;
                } else {
                    thumbnailUrl = img.highUrl || img.url;
                }
                // 将 original 路径转换为 preview 路径
                if (thumbnailUrl && thumbnailUrl.includes('/original/')) {
                    thumbnailUrl = thumbnailUrl.replace('/original/', '/preview/');
                } else if (thumbnailUrl && thumbnailUrl.indexOf('%2Foriginal%2F') !== -1) {
                    // 代理形态 URL（桶私有化后 key 为 URL 编码）：直接换成 preview 对象，列表不再拉原图
                    thumbnailUrl = thumbnailUrl.replace('k=generated%2Foriginal%2F', 'k=generated%2Fpreview%2F');
                } else if (thumbnailUrl && thumbnailUrl.indexOf('/api/img?') !== -1 && thumbnailUrl.indexOf('x-tos-process') === -1) {
                    // 上传原图等无 preview 对象的代理 URL：叠加 TOS 图片处理参数出小图（服务端白名单校验后透传）
                    thumbnailUrl += '&x-tos-process=' + encodeURIComponent('image/resize,w_600/format,webp');
                }
                images.push({
                    index: index + 1,
                    url: img.highUrl || img.url || img.dataUrl,
                    thumbnailUrl: thumbnailUrl,
                    fileId: img.fileId
                });
            }
        });
        return images;
    }

    // 渲染图片选择下拉菜单
    function renderImageDropdown() {
        if (!imageSelectDropdown) {
            imageSelectDropdown = document.getElementById('imageSelectDropdown');
        }
        if (!dropdownImages) {
            dropdownImages = document.getElementById('dropdownImages');
        }
        
        // console.log('dropdownImages element:', dropdownImages);
        
        if (!imageSelectDropdown || !dropdownImages) return;

        const images = getUploadedImagesForDropdown();
        // console.log('Images from getUploadedImagesForDropdown:', images);
        // console.log('Images length:', images.length);
        // console.log('Images array type:', Object.prototype.toString.call(images));
        
        // 检查是否是真正的数组
        if (!Array.isArray(images)) {
            // console.log('ERROR: images is not an array!');
            dropdownImages.innerHTML = `<div class="empty">${t('noImages')}</div>`;
            return;
        }

        if (images.length === 0) {
            // console.log('Images array is empty');
            dropdownImages.innerHTML = `<div class="dropdown-empty">${t('noImageContent')}</div>`;
            return;
        }

        // console.log('Rendering', images.length, 'images:', images);
        dropdownImages.innerHTML = '';
        dropdownImages.className = 'dropdown-content vertical';
        
        images.forEach((img, idx) => {
            const item = document.createElement('div');
            item.className = 'dropdown-image-item vertical';
            item.dataset.imageIndex = img.index;
            item.dataset.url = img.url;
            
            // 构建缩略图URL
            let thumbUrl = img.thumbnailUrl;
            if (thumbUrl && thumbUrl.startsWith('http')) {
                thumbUrl = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(img.thumbnailUrl)}`;
            }
            
            item.innerHTML = `
                <img class="dropdown-thumb" src="${thumbUrl || ''}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2230%22 height=%2230%22%3E%3Crect fill=%22%23333%22 width=%2230%22 height=%2230%22/%3E%3Ctext fill=%22%23666%22 x=%2215%22 y=%2220%22 text-anchor=%22middle%22 font-size=%2212%22%3E${img.index}%3C/text%3E%3C/svg%3E'">
                <span class="img-label">${t('imageLabel')} ${img.index}</span>
                <span class="img-at">(@${img.index})</span>
            `;
            
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // console.log('Dropdown item clicked, imageIndex:', img.index);
                insertImageTag(img.index);
                hideImageDropdown();
            });
            
            dropdownImages.appendChild(item);
        });
    }

    // 获取光标位置的像素坐标（用于定位下拉菜单）
    function getCursorPosition() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return null;
        
        const range = selection.getRangeAt(0);
        
        // 方法1：尝试使用 getClientRects 获取更精确的光标位置
        const rects = range.getClientRects();
        if (rects.length > 0) {
            // 使用最后一个矩形（光标位置）
            const lastRect = rects[rects.length - 1];
            // console.log('Using getClientRects, last rect:', lastRect.left, lastRect.bottom);
            return { x: lastRect.left, y: lastRect.bottom };
        }
        
        // 方法2：使用 getBoundingClientRect
        const rect = range.getBoundingClientRect();
        // console.log('Using getBoundingClientRect:', rect.left, rect.bottom);
        return { x: rect.left, y: rect.bottom };
    }

    // 显示图片选择下拉菜单
    function showImageDropdown() {
        if (!imageSelectDropdown) {
            imageSelectDropdown = document.getElementById('imageSelectDropdown');
        }
        if (!imageSelectDropdown) return;
        
        // 保存当前光标位置
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            savedRange = selection.getRangeAt(0).cloneRange();
        }
        
        // 先渲染内容
        renderImageDropdown();
        
        // 获取光标位置
        let cursorPos;
        try {
            cursorPos = getCursorPosition();
        } catch(e) {
            console.error('Error getting cursor position:', e);
        }
        
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const dropdownWidth = 200 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1);
        const dropdownHeight = 200;
        
        // 计算基础位置 - 紧贴@符号下方
        let left = cursorPos ? cursorPos.x : 100;
        let top = cursorPos ? cursorPos.y + 5 : 100; // 紧贴光标下方（5px间距）
        
        // console.log('Raw cursor position:', cursorPos);
        // console.log('Initial position:', left, top);
        // console.log('Window size:', windowWidth, windowHeight);
        
        // 先临时显示下拉框以获取实际尺寸：position:fixed + 离屏 + 不可见，避免在左上角闪烁
        imageSelectDropdown.style.setProperty('display', 'block', 'important');
        imageSelectDropdown.style.setProperty('position', 'fixed', 'important');
        imageSelectDropdown.style.setProperty('left', '-9999px', 'important');
        imageSelectDropdown.style.setProperty('top', '-9999px', 'important');
        imageSelectDropdown.style.setProperty('visibility', 'hidden', 'important');
        imageSelectDropdown.style.setProperty('opacity', '0', 'important');
        imageSelectDropdown.classList.remove('hidden');

        // 强制浏览器重排以获取实际尺寸
        void imageSelectDropdown.offsetHeight;

        const actualRect = imageSelectDropdown.getBoundingClientRect();
        const actualHeight = actualRect.height || 200;
        
        // console.log('Actual dropdown height:', actualHeight);
        
        // 边界检查：确保不超出视口
        // 水平方向
        if (left + dropdownWidth > windowWidth - 10) {
            left = windowWidth - dropdownWidth - 10;
        }
        if (left < 10) {
            left = 10;
        }
        
        // 垂直方向：优先显示在光标下方，如果空间不够则显示在上方
        const spaceBelow = windowHeight - top - 10; // 下方可用空间
        const spaceAbove = (cursorPos ? cursorPos.y : 100) - 10; // 上方可用空间
        
        if (spaceBelow < actualHeight && spaceAbove > actualHeight) {
            // 下方空间不够，显示在上方
            top = (cursorPos ? cursorPos.y : 100) - actualHeight - 5;
        }
        
        // 确保不会超出边界
        if (top < 10) {
            top = 10;
        }
        
        // console.log('Final position:', left, top);
        
        // 强制显示 - 使用!important覆盖全局.hidden类
        imageSelectDropdown.style.setProperty('display', 'block', 'important');
        imageSelectDropdown.style.setProperty('position', 'fixed', 'important');
        imageSelectDropdown.style.setProperty('left', left + 'px', 'important');
        imageSelectDropdown.style.setProperty('top', top + 'px', 'important');
        imageSelectDropdown.style.setProperty('background', 'rgba(30, 30, 35, 0.95)', 'important');
        imageSelectDropdown.style.setProperty('border', '2px solid rgba(196, 241, 123, 0.5)', 'important');
        imageSelectDropdown.style.setProperty('border-radius', '12px', 'important');
        imageSelectDropdown.style.setProperty('min-width', '200px', 'important');
        imageSelectDropdown.style.setProperty('max-width', '400px', 'important');
        imageSelectDropdown.style.setProperty('box-shadow', '0 8px 32px rgba(0, 0, 0, 0.5)', 'important');
        imageSelectDropdown.style.setProperty('backdrop-filter', 'blur(24px)', 'important');
        imageSelectDropdown.style.setProperty('z-index', '99999', 'important');
        imageSelectDropdown.style.setProperty('opacity', '1', 'important');
        imageSelectDropdown.style.setProperty('visibility', 'visible', 'important');
        imageSelectDropdown.style.setProperty('overflow', 'visible', 'important');
        
        // console.log('Dropdown final rect:', imageSelectDropdown.getBoundingClientRect());
        
        // 添加点击外部关闭的事件监听（延迟避免当前点击立即关闭）
        if (dropdownListenersTimeout) {
            clearTimeout(dropdownListenersTimeout);
        }
        dropdownListenersTimeout = setTimeout(() => {
            dropdownListenersTimeout = null;
            document.addEventListener('click', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }, 100);
    }
    
    // 处理点击外部关闭下拉菜单
    function handleClickOutside(e) {
        if (!imageSelectDropdown) return;
        // 点击在下拉框内：不处理
        if (imageSelectDropdown.contains(e.target)) return;
        // 点击在图片标签上：由标签自己的 mouseup 处理换图，不在这里关闭
        if (e.target.closest && e.target.closest('.image-tag')) return;
        hideImageDropdown();
    }
    
    // 处理键盘事件（ESC关闭 / 数字键快速选择）
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            hideImageDropdown();
            return;
        }
        // 忽略输入法组合过程中的按键
        if (e.isComposing) return;

        // 数字键快速选择：当下拉框可见时
        if (imageSelectDropdown && !imageSelectDropdown.classList.contains('hidden')) {
            if (/^[0-9]$/.test(e.key)) {
                const imageIndex = parseInt(e.key, 10);
                const images = getUploadedImagesForDropdown();
                if (images.some(img => img.index === imageIndex)) {
                    e.preventDefault();
                    e.stopPropagation();
                    insertImageTag(imageIndex);
                    hideImageDropdown();
                }
            }
        }
    }

    // 隐藏图片选择下拉菜单
    function hideImageDropdown() {
        if (!imageSelectDropdown) {
            imageSelectDropdown = document.getElementById('imageSelectDropdown');
        }
        if (imageSelectDropdown) {
            imageSelectDropdown.classList.add('hidden');
            // 清除所有 !important 显示样式，确保 .hidden 类生效
            imageSelectDropdown.style.removeProperty('display');
            imageSelectDropdown.style.removeProperty('position');
            imageSelectDropdown.style.removeProperty('left');
            imageSelectDropdown.style.removeProperty('top');
            imageSelectDropdown.style.removeProperty('visibility');
            imageSelectDropdown.style.removeProperty('opacity');
            imageSelectDropdown.style.removeProperty('z-index');
        }

        // 取消尚未挂载的外部监听器，避免隐藏后仍然被触发
        if (dropdownListenersTimeout) {
            clearTimeout(dropdownListenersTimeout);
            dropdownListenersTimeout = null;
        }

        // 清除换图模式标记，避免下次 @ 新增时误走替换分支
        currentEditingTag = null;

        // 移除事件监听
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
    }

    // 为标签显示下拉框（用于更换图片）
    let currentEditingTag = null;
    function showImageDropdownForTag(tag) {
        // 若切换到另一个标签，先关闭旧下拉框，清理旧状态与样式残留
        if (currentEditingTag && currentEditingTag !== tag) {
            hideImageDropdown();
        }
        currentEditingTag = tag;

        // 换图模式下清除保存的光标位置，避免 insertImageTag 恢复旧光标
        // 导致 removeAtNumberFromInput 误删其他位置的 @ 文本
        savedRange = null;

        // 获取标签的位置
        const tagRect = tag.getBoundingClientRect();

        // 显示下拉框（使用标签位置）
        showImageDropdownAtPosition(tagRect.left, tagRect.bottom);
    }
    
    // 在指定位置显示图片选择下拉菜单
    function showImageDropdownAtPosition(x, y) {
        if (!imageSelectDropdown) {
            imageSelectDropdown = document.getElementById('imageSelectDropdown');
        }
        if (!imageSelectDropdown) return;

        // 先渲染内容
        renderImageDropdown();

        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const dropdownWidth = 200 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1);

        // 先隐藏所有 !important 样式，确保测量阶段完全不可见
        imageSelectDropdown.style.setProperty('display', 'block', 'important');
        imageSelectDropdown.style.setProperty('visibility', 'hidden', 'important');
        imageSelectDropdown.style.setProperty('position', 'fixed', 'important');
        imageSelectDropdown.style.setProperty('left', '-9999px', 'important');
        imageSelectDropdown.style.setProperty('top', '-9999px', 'important');
        imageSelectDropdown.style.setProperty('opacity', '0', 'important');
        imageSelectDropdown.classList.remove('hidden');

        // 强制浏览器重排以获取实际尺寸
        void imageSelectDropdown.offsetHeight;

        const actualRect = imageSelectDropdown.getBoundingClientRect();
        const actualHeight = actualRect.height || 200;
        
        // 计算位置 - 紧贴指定位置下方
        let left = x;
        let top = y + 5; // 5px 间距
        
        // 边界检查：确保不超出视口
        if (left + dropdownWidth > windowWidth - 10) {
            left = windowWidth - dropdownWidth - 10;
        }
        if (left < 10) {
            left = 10;
        }
        
        // 垂直方向：优先显示在下方，如果空间不够则显示在上方
        const spaceBelow = windowHeight - top - 10;
        const spaceAbove = y - 10;
        
        if (spaceBelow < actualHeight && spaceAbove > actualHeight) {
            top = y - actualHeight - 5;
        }
        
        if (top < 10) {
            top = 10;
        }
        
        // 强制显示
        imageSelectDropdown.style.setProperty('display', 'block', 'important');
        imageSelectDropdown.style.setProperty('position', 'fixed', 'important');
        imageSelectDropdown.style.setProperty('left', left + 'px', 'important');
        imageSelectDropdown.style.setProperty('top', top + 'px', 'important');
        imageSelectDropdown.style.setProperty('z-index', '99999', 'important');
        imageSelectDropdown.style.setProperty('opacity', '1', 'important');
        imageSelectDropdown.style.setProperty('visibility', 'visible', 'important');
        
        // 添加点击外部关闭的事件监听（延迟避免当前点击立即关闭）
        if (dropdownListenersTimeout) {
            clearTimeout(dropdownListenersTimeout);
        }
        dropdownListenersTimeout = setTimeout(() => {
            dropdownListenersTimeout = null;
            document.addEventListener('click', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }, 100);
    }

    // 拖动标签功能 - 使用原生 HTML5 Drag and Drop API
    function setupImageTagDrag(tag) {
        tag.draggable = true;
        
        tag.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tag.dataset.imageIndex);
            tag.classList.add('dragging');
            
            // 创建拖动时的半透明效果
            const rect = tag.getBoundingClientRect();
            e.dataTransfer.setDragImage(tag, rect.width / 2, rect.height / 2);
        });
        
        tag.addEventListener('dragend', () => {
            tag.classList.remove('dragging');
        });
    }
    
    // 设置 promptInput 的拖放区域 - 延迟初始化确保 DOM 已准备好
    function setupPromptInputDropZone() {
        if (!promptInput) {
            console.error('promptInput not found');
            return;
        }
        
        promptInput.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // 获取光标位置
            const selection = window.getSelection();
            const range = document.caretRangeFromPoint(e.clientX, e.clientY);
            
            if (range) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
        
        promptInput.addEventListener('drop', (e) => {
            const imageIndex = e.dataTransfer.getData('text/plain');
            // 仅处理图片标签拖拽（纯数字序号）；普通文字拖入不拦截，走浏览器默认插入
            if (!imageIndex || !/^\d+$/.test(imageIndex.trim())) return;
            e.preventDefault();

            // 获取被拖动的标签
            const draggedTag = promptInput.querySelector(`.image-tag[data-image-index="${imageIndex.trim()}"]`);
            if (!draggedTag) return;

            // 获取放置位置
            const range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (!range) return;

            // 防止插入到其他 image-tag 内部：若光标落在某个 image-tag 中，调整到该 tag 之前
            let container = range.startContainer;
            if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;
            const enclosingTag = container && container.closest ? container.closest('.image-tag') : null;

            // 落在自身内部，无意义移动
            if (enclosingTag === draggedTag) return;

            if (enclosingTag) {
                range.setStartBefore(enclosingTag);
                range.collapse(true);
            }

            // 先从原位置移除，避免重复
            if (draggedTag.parentNode) {
                draggedTag.parentNode.removeChild(draggedTag);
            }

            // 在目标位置插入（Range.insertNode 会自动处理文本节点拆分）
            range.insertNode(draggedTag);

            // 移动光标到标签后面
            const newRange = document.createRange();
            newRange.setStartAfter(draggedTag);
            newRange.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(newRange);
        });
    }
    
    // 初始化拖放区域 - 使用 DOMContentLoaded 确保 DOM 已准备好
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupPromptInputDropZone);
    } else {
        setupPromptInputDropZone();
    }

    // 创建图片标签元素
    function createImageTagElement(imageIndex) {
        const img = uploadedImages[imageIndex - 1];
        if (!img) return null;
        
        // 优先使用预览图，避免加载完整图
        let thumbnailUrl = img.previewUrl || img.previewDataUrl || img.dataUrl || img.highUrl || img.url || '';
        // 将 original 路径转换为 preview 路径
        if (thumbnailUrl && thumbnailUrl.includes('/original/')) {
            thumbnailUrl = thumbnailUrl.replace('/original/', '/preview/');
        }
        if (thumbnailUrl && thumbnailUrl.startsWith('http')) {
            thumbnailUrl = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(thumbnailUrl)}`;
        }
        
        const tag = document.createElement('span');
        tag.className = 'image-tag';
        tag.dataset.imageIndex = imageIndex;
        tag.dataset.fileId = img.fileId || ''; // 保存 fileId 用于位置变化时匹配
        tag.setAttribute('contenteditable', 'false');
        
        tag.innerHTML = `
            <img class="image-tag-thumbnail" src="${thumbnailUrl || ''}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect fill=%22%23333%22 width=%2216%22 height=%2216%22/%3E%3Ctext fill=%22%23666%22 x=%228%22 y=%2212%22 text-anchor=%22middle%22 font-size=%229%22%3E${imageIndex}%3C/text%3E%3C/svg%3E'">
            <span class="image-tag-text">图片${imageIndex}</span>
        `;
        
        // 设置拖动功能
        setupImageTagDrag(tag);
        
        // 使用 mousedown/mouseup 区分点击和拖动
        let isDragging = false;
        let mouseDownTime = 0;
        let mouseDownX = 0;
        let mouseDownY = 0;

        tag.addEventListener('mousedown', (e) => {
            isDragging = false;
            mouseDownTime = Date.now();
            mouseDownX = e.clientX;
            mouseDownY = e.clientY;
            // mousedown 阶段立即隐藏旧下拉框，避免按下未松开时残留可见
            hideImageDropdown();
        });

        tag.addEventListener('dragstart', () => {
            isDragging = true;
        });

        tag.addEventListener('mouseup', (e) => {
            // 如果拖动过，不触发点击
            if (isDragging) return;

            // 鼠标移动超过 5px 视为拖动，不触发点击
            const dx = Math.abs(e.clientX - mouseDownX);
            const dy = Math.abs(e.clientY - mouseDownY);
            if (dx > 5 || dy > 5) return;

            // 如果按住时间超过 200ms，可能是想拖动，不触发点击
            const holdTime = Date.now() - mouseDownTime;
            if (holdTime > 200) return;

            e.preventDefault();
            e.stopPropagation();
            showImageDropdownForTag(tag);
        });
        
        return tag;
    }

    // 在输入框中插入图片标签（可视化）
    function insertImageTag(imageIndex) {
        const input = promptInput;
        const selection = window.getSelection();

        // 换图模式（点击已有标签）：不恢复光标、不删除 @数字，直接替换标签
        if (currentEditingTag && currentEditingTag.parentNode) {
            const tag = createImageTagElement(imageIndex);
            if (tag) {
                currentEditingTag.parentNode.replaceChild(tag, currentEditingTag);
                currentEditingTag = null;
            }
            savedRange = null;
            input.focus();
            return;
        }

        // 新增模式：恢复保存的光标位置（如果存在）
        if (savedRange) {
            selection.removeAllRanges();
            selection.addRange(savedRange);
        }

        // 先删除输入框中所有与当前图片索引匹配的 @数字
        removeAtNumberFromInput(imageIndex);

        // 创建并插入图片标签
        const tag = createImageTagElement(imageIndex);
        if (tag) {
            insertElementAtCursor(tag);
            // 在标签后插入空格
            insertTextAtCursor(' ');
        }

        // 清除保存的光标位置
        savedRange = null;
        input.focus();
    }

    // 删除光标前指定长度的文本（跨文本节点/元素边界）
    function deleteTextBeforeCursor(deleteLen) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0 || deleteLen <= 0) return false;

        const endRange = selection.getRangeAt(0).cloneRange();

        // 收集光标之前的所有文本节点及其长度
        const textNodes = [];
        let totalLen = 0;
        const walker = document.createTreeWalker(promptInput, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode()) !== null) {
            const nodeRange = document.createRange();
            nodeRange.selectNode(node);

            // 节点完全在光标之后：停止遍历
            if (endRange.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0) {
                break;
            }

            let len = node.textContent.length;
            // 节点包含光标：只计算光标之前的部分
            if (endRange.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0 &&
                endRange.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0) {
                const beforeCursorRange = document.createRange();
                beforeCursorRange.setStart(node, 0);
                beforeCursorRange.setEnd(endRange.startContainer, endRange.startOffset);
                len = beforeCursorRange.toString().length;
            }

            textNodes.push({ node, len });
            totalLen += len;
        }

        const targetOffset = totalLen - deleteLen;
        if (targetOffset < 0) return false;

        let currentOffset = 0;
        for (const { node, len } of textNodes) {
            if (currentOffset + len >= targetOffset) {
                const nodeOffset = targetOffset - currentOffset;
                const range = document.createRange();
                range.setStart(node, nodeOffset);
                range.setEnd(endRange.startContainer, endRange.startOffset);
                range.deleteContents();
                return true;
            }
            currentOffset += len;
        }
        return false;
    }

    // 删除输入框中指定图片索引的 @数字
    function removeAtNumberFromInput(imageIndex) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        // 获取光标之前的全部文本（跨越图片标签等元素）
        const cursorRange = selection.getRangeAt(0).cloneRange();
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(promptInput);
        beforeRange.setEnd(cursorRange.startContainer, cursorRange.startOffset);
        const textBeforeCursor = beforeRange.toString();

        let deleteLen = 0;
        const atNumberPattern = new RegExp(`@${imageIndex}(?!\\d)$`);
        if (atNumberPattern.test(textBeforeCursor)) {
            deleteLen = (`@${imageIndex}`).length;
        } else if (/@$/.test(textBeforeCursor)) {
            deleteLen = 1;
        }

        if (deleteLen > 0) {
            deleteTextBeforeCursor(deleteLen);
        }
    }

    // 在光标位置插入元素
    function insertElementAtCursor(element) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(element);
        
        // 将光标移动到元素后面
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // 在光标位置插入文本
    function insertTextAtCursor(text) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // 获取提示词文本（将图片标签转换为[图片N]格式）
    function getPromptText() {
        const input = promptInput;
        const tags = input.querySelectorAll('.image-tag');
        
        // 克隆元素用于处理
        const clone = input.cloneNode(true);
        const cloneTags = clone.querySelectorAll('.image-tag');
        
        cloneTags.forEach(tag => {
            const imageIndex = tag.dataset.imageIndex;
            if (imageIndex) {
                const textNode = document.createTextNode(`[图片${imageIndex}]`);
                tag.parentNode.replaceChild(textNode, tag);
            }
        });
        
        return clone.textContent || '';
    }

    // 设置提示词文本（将[图片N]格式转换为可视化标签）
    function setPromptText(text) {
        const input = promptInput;
        input.innerHTML = '';
        
        if (!text) return;
        
        // 使用正则表达式匹配 [图片N] 格式，不使用捕获组避免分割问题
        const regex = /\[图片\d+\]/g;
        let lastIndex = 0;
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            // 添加匹配前的文本
            if (match.index > lastIndex) {
                input.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }
            
            // 提取图片索引并创建标签
            const imageMatch = match[0].match(/\[图片(\d+)\]/);
            if (imageMatch) {
                const imageIndex = parseInt(imageMatch[1]);
                const tag = createImageTagElement(imageIndex);
                if (tag) {
                    input.appendChild(tag);
                } else {
                    // 如果图片不存在，显示原始文本
                    input.appendChild(document.createTextNode(match[0]));
                }
            }
            
            lastIndex = regex.lastIndex;
        }
        
        // 添加剩余的文本
        if (lastIndex < text.length) {
            input.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
    }

    // 根据 fileId 或索引删除提示词内的图片标签
    function removeImageTagByFileId(fileId, imageIndex) {
        const tags = promptInput.querySelectorAll('.image-tag');
        tags.forEach(tag => {
            // 优先匹配 fileId
            if (fileId && tag.dataset.fileId === fileId) {
                tag.remove();
            }
            // 如果没有 fileId，匹配索引
            else if (!fileId && imageIndex && parseInt(tag.dataset.imageIndex) === imageIndex) {
                tag.remove();
            }
        });
    }

    // 更新所有图片标签的显示（当图片位置变化时）
    function updateImageTags() {
        const tags = promptInput.querySelectorAll('.image-tag');

        tags.forEach(tag => {
            const fileId = tag.dataset.fileId;
            const oldIndex = parseInt(tag.dataset.imageIndex);

            let currentIndex = -1;

            // 优先使用 fileId 查找（唯一可靠的身份标识）
            if (fileId) {
                currentIndex = uploadedImages.findIndex((img) => {
                    return img && img.fileId === fileId;
                });
            }

            // 找不到对应图片：移除标签（图片可能已被删除）
            if (currentIndex === -1) {
                tag.remove();
                return;
            }

            const newIndex = currentIndex + 1;
            const img = uploadedImages[currentIndex];

            // 更新预览图
            let thumbnailUrl = img.previewUrl || img.previewDataUrl || img.dataUrl;
            if (thumbnailUrl && thumbnailUrl.includes('/original/')) {
                thumbnailUrl = thumbnailUrl.replace('/original/', '/preview/');
            }
            if (thumbnailUrl && thumbnailUrl.startsWith('http')) {
                thumbnailUrl = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(thumbnailUrl)}`;
            }

            const thumbnail = tag.querySelector('.image-tag-thumbnail');
            if (thumbnail && thumbnailUrl) {
                if (thumbnail.src !== thumbnailUrl) {
                    thumbnail.src = thumbnailUrl;
                }
            }

            // 位置变化了，更新索引和文字
            if (newIndex !== oldIndex) {
                tag.dataset.imageIndex = newIndex;
                const textSpan = tag.querySelector('.image-tag-text');
                if (textSpan) textSpan.textContent = `图片${newIndex}`;
            }
        });
    }
    
    // 暴露到 window 供 image-editor.js 调用
    window.updateImageTags = updateImageTags;

    // 监听输入框输入事件，检测@符号
    function checkAndShowImageDropdown() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const currentNode = range.startContainer;
        const currentOffset = range.startOffset;

        // 保存当前光标位置，供下拉菜单点击时恢复
        savedRange = range.cloneRange();

        // 获取光标前的文本内容
        let textBeforeCursor = '';
        if (currentNode.nodeType === Node.TEXT_NODE) {
            textBeforeCursor = currentNode.textContent.slice(0, currentOffset);
        } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
            const tempRange = document.createRange();
            tempRange.selectNodeContents(promptInput);
            tempRange.setEnd(currentNode, currentOffset);
            textBeforeCursor = tempRange.toString();
        }

        // 检查光标前最后一个字符是否是@
        if (textBeforeCursor.endsWith('@')) {
            showImageDropdown();
        } else {
            // 光标前不是@，关闭下拉框
            hideImageDropdown();
        }
    }

    // @ 图片的 keydown/input/mousedown 等事件已由 PromptBar 模块统一绑定。
    // 仅当 PromptBar 未加载时走兜底绑定，避免 @ 后按数字重复插入标签等双重监听问题。
    if (typeof PromptBar === 'undefined') {
        promptInput.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            const isNumberKey = /^[0-9]$/.test(e.key);
            if (!isNumberKey) return;
            const selection = window.getSelection();
            if (selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            const currentNode = range.startContainer;
            const currentOffset = range.startOffset;
            let textBeforeCursor = '';
            if (currentNode.nodeType === Node.TEXT_NODE) {
                textBeforeCursor = currentNode.textContent.slice(0, currentOffset);
            }
            if (!textBeforeCursor.endsWith('@')) return;
            const imageIndex = parseInt(e.key, 10);
            const images = getUploadedImagesForDropdown();
            const targetImage = images.find(img => img.index === imageIndex);
            if (targetImage) {
                e.preventDefault();
                e.stopPropagation();
                insertImageTag(imageIndex);
                hideImageDropdown();
            }
        });

        promptInput.addEventListener('input', (e) => {
            if (e.isComposing) return;
            checkAndShowImageDropdown();
        });
    }

    // 获取光标在文本中的偏移量
    function getTextOffsetAtCursor() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return 0;
        
        const range = document.createRange();
        range.selectNodeContents(promptInput);
        range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
        
        return range.toString().length;
    }

    // 监听输入框选择变化
    document.addEventListener('selectionchange', () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const anchorNode = selection.anchorNode;
        if (!anchorNode || !promptInput.contains(anchorNode)) return;

        // 换图模式下不响应光标变化，避免触发 @ 的下拉框
        if (currentEditingTag) return;

        // 如果下拉菜单已打开，同步最新光标位置并更新下拉框位置
        if (imageSelectDropdown && !imageSelectDropdown.classList.contains('hidden')) {
            savedRange = selection.getRangeAt(0).cloneRange();
            showImageDropdown();
        }
    });

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
        if (!imageSelectDropdown) {
            imageSelectDropdown = document.getElementById('imageSelectDropdown');
        }
        
        if (imageSelectDropdown && !imageSelectDropdown.contains(e.target)) {
            if (!promptInput.contains(e.target)) {
                hideImageDropdown();
            }
        }
    });

    // 窗口大小改变时重新定位下拉菜单
    window.addEventListener('resize', () => {
        if (imageSelectDropdown && !imageSelectDropdown.classList.contains('hidden')) {
            showImageDropdown();
        }
    });

    // 点击图片标签时将光标移到标签后面 —— 已由 PromptBar 统一绑定，仅兜底。
    if (typeof PromptBar === 'undefined') {
        promptInput.addEventListener('mousedown', (e) => {
            const tag = e.target.closest('.image-tag');
            if (tag) {
                const range = document.createRange();
                range.setStartAfter(tag);
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
    }

    // Drag and drop images onto the page
    document.body.addEventListener('dragover', e => {
        e.preventDefault();
    });
    document.body.addEventListener('drop', e => {
        e.preventDefault();

        // 如果拖到提示词输入框，由 PromptBar 处理（避免重复上传）
        if (e.target && e.target.closest && e.target.closest('#promptInput')) {
            return;
        }

        // 检查是否拖拽到聊天侧边栏区域
        const aiChatSidebar = document.getElementById('aiChatSidebar');
        if (aiChatSidebar && aiChatSidebar.classList.contains('open')) {
            const rect = aiChatSidebar.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            // 如果拖拽位置在聊天侧边栏内，则不处理（由侧边栏自己的事件处理）
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return;
            }
        }

        if (e.dataTransfer.files.length > 0) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                handleFile(e.dataTransfer.files[i]);
            }
        }
    });

    function updateComboLabel() {
        // MJ 模型显示比例和画质
        const isMj = currentModel && currentModel.startsWith('mj-');
        if (isMj) {
            const qualityLabels = {
                '0.5': '标清',
                '1': '高清',
                '2': '超清',
                '4': '实验'
            };
            const qualityLabel = qualityLabels[currentRes] || currentRes;
            comboLabel.textContent = `${currentAspect} / ${qualityLabel}`;
        } else {
            comboLabel.textContent = `${currentAspect} / ${currentRes}`;
        }
    }

    // MJ 参数滑块事件
    const mjStylize = document.getElementById('mjStylize');
    const mjStylizeValue = document.getElementById('mjStylizeValue');
    const mjChaos = document.getElementById('mjChaos');
    const mjChaosValue = document.getElementById('mjChaosValue');
    const mjQuality = document.getElementById('mjQuality');
    const mjStyle = document.getElementById('mjStyle');
    const mjNo = document.getElementById('mjNo');

    // 阻止 MJ 参数面板内的事件冒泡，防止关闭 comboMenu
    const mjParamsSection = document.getElementById('mjParamsSection');
    if (mjParamsSection) {
        mjParamsSection.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    if (mjStylize && mjStylizeValue) {
        mjStylize.addEventListener('input', () => {
            mjStylizeValue.textContent = mjStylize.value;
        });
    }

    if (mjChaos && mjChaosValue) {
        mjChaos.addEventListener('input', () => {
            mjChaosValue.textContent = mjChaos.value;
        });
    }

    function triggerUpload(slotIndex = null) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = false;
        input.style.display = 'none';
        input.onchange = e => {
            if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0], slotIndex);
            }
            // Clean up
            document.body.removeChild(input);
        };
        // Add to DOM temporarily (required by some browsers)
        document.body.appendChild(input);
        input.click();
    }

    // 跟踪正在加载的图片数量
    let loadingImagesCount = 0;
    
    // 上传队列：支持并发上传
    const MAX_CONCURRENT_UPLOADS = 10; // 限制并发数，避免后端过载
    let uploadQueue = [];
    let activeUploads = 0;

    // 生成文件唯一标识符（基于文件名、大小、修改时间）
    function generateFileId(file) {
        return `${file.name}_${file.size}_${file.lastModified}`;
    }

    // 并发上传管理器
    async function processUploadQueue() {
        while (uploadQueue.length > 0 && activeUploads < MAX_CONCURRENT_UPLOADS) {
            const task = uploadQueue.shift();
            activeUploads++;
            
            task.uploadFn().finally(() => {
                activeUploads--;
                // 继续处理队列
                processUploadQueue();
            });
        }
    }

    // 验证图片限制（存储服务限制）
    async function validateImageLimits(file) {
        // 文件大小限制：20MB
        const MAX_FILE_SIZE = 20 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            return { valid: false, error: '图片大小超过20MB限制' };
        }

        // 支持的格式
        const supportedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/gif', 'image/webp', 'image/tiff', 'image/heic'];
        if (!supportedTypes.includes(file.type)) {
            return { valid: false, error: '不支持的图片格式，仅支持 jpg/jpeg、png、bmp、gif、webp、tiff、heic' };
        }

        // 获取图片尺寸
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const url = URL.createObjectURL(file);
            
            img.onload = () => {
                URL.revokeObjectURL(url);
                
                const width = img.width;
                const height = img.height;
                const totalPixels = width * height;
                
                // 宽高限制：30000px
                if (width > 30000 || height > 30000) {
                    resolve({ valid: false, error: `图片宽高不能超过30000px (当前: ${width}x${height})` });
                    return;
                }
                
                // 总像素限制：2.5亿
                if (totalPixels > 250000000) {
                    resolve({ valid: false, error: `图片总像素不能超过2.5亿 (当前: ${totalPixels})` });
                    return;
                }
                
                // webp格式特殊限制
                if (file.type === 'image/webp') {
                    if (width > 16383 || height > 16383) {
                        resolve({ valid: false, error: `webp格式图片宽高不能超过16383px (当前: ${width}x${height})` });
                        return;
                    }
                }
                
                resolve({ valid: true, width, height, totalPixels });
            };
            
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve({ valid: false, error: '无法读取图片信息' });
            };
            
            img.src = url;
        });
    }

    function handleFile(file, slotIndex = null) {
        if (!file || !file.type.startsWith('image/')) return;

        // 生成文件唯一标识
        const fileId = generateFileId(file);

        // MJ 模型限制最多3张参考图
        if (currentModel && currentModel.startsWith('mj-')) {
            const currentImageCount = uploadedImages.filter(img => img && !img.loading).length;
            if (currentImageCount >= 3) {
                alert('Midjourney 模型最多支持 3 张参考图');
                return;
            }
        }

        // 找到插入位置
        let idx = slotIndex;
        if (idx == null) {
            idx = uploadedImages.findIndex(v => !v);
            if (idx === -1) idx = 0;
        }

        // 标记为加载中
        uploadedImages[idx] = { loading: true, file: file, fileId: fileId };
        const slotRef = uploadedImages[idx];  // 保存对象引用,用于上传完成时精确定位
        loadingImagesCount++;
        updateGenerateButtonState();
        window.renderRefs();

        // 定义上传任务
        const uploadTask = async () => {
            try {
                // 1. 验证图片限制
                const validation = await validateImageLimits(file);
                if (!validation.valid) {
                    throw new Error(validation.error);
                }

                const backendUrl = getBackendUrl();

                // 2. 上传到后端，后端使用存储服务处理
                const formData = new FormData();
                formData.append('file', file);
                if (window.PxThumb) await window.PxThumb.attach(formData, file);

                const uploadRes = await fetch(`${backendUrl}/v1/image/upload-reference`, {
                    method: 'POST',
                      headers: authHeaders(),
                    body: formData
                });

                if (!uploadRes.ok) {
                    throw new Error('上传失败: ' + uploadRes.status);
                }

                const result = await uploadRes.json();
                if (result.code !== 0) {
                    throw new Error(result.msg || '上传失败');
                }

                // 3. 更新状态(用引用定位,不受 renderRefs 压缩重排影响)
                const cleanOriginalUrl = result.data.originalUrl ? String(result.data.originalUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '') : '';
                const cleanPreviewUrl = result.data.previewUrl ? String(result.data.previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '') : '';
                // 缩略图先进缓存，切换时无闪烁
                if (window.PxThumb) await window.PxThumb.preload([cleanPreviewUrl]);

                const cur = uploadedImages.indexOf(slotRef);
                if (cur !== -1) {
                    uploadedImages[cur] = {
                        highUrl: cleanOriginalUrl,
                        previewUrl: cleanPreviewUrl,
                        tempKey: result.data.tempKey,
                        fileId: fileId,
                        isUploaded: true
                    };
                    // 4. 编辑器用的完整图：直接用本地文件，不再回头下载刚上传的原图
                    const preloadImg = new Image();
                    preloadImg.src = URL.createObjectURL(file);
                    uploadedImages[cur].preloadedImg = preloadImg;
                }

            } catch (err) {
                console.error('[上传] 失败:', err);
                alert(`上传失败: ${err.message}`);
                const cur = uploadedImages.indexOf(slotRef);
                if (cur !== -1) uploadedImages[cur] = null;
            } finally {
                loadingImagesCount--;
                updateGenerateButtonState();
                window.renderRefs();
            }
        };

        // 添加到队列并触发处理
        uploadQueue.push({ uploadFn: uploadTask });
        processUploadQueue();
    }

    // 更新生成按钮状态
    function updateGenerateButtonState() {
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            if (loadingImagesCount > 0) {
                generateBtn.disabled = true;
                generateBtn.classList.add('loading');
                generateBtn.title = `图片处理中 (${loadingImagesCount})...`;
            } else {
                generateBtn.disabled = false;
                generateBtn.classList.remove('loading');
                generateBtn.title = t('generate');
            }
        }

        // 更新添加按钮显示状态（MJ 模型限制 3 张）
        const addImgBtn = document.getElementById('addImgBtn');
        if (addImgBtn) {
            const currentImageCount = uploadedImages.filter(img => img && !img.loading).length;
            const isMj = currentModel && currentModel.startsWith('mj-');
            if (isMj && currentImageCount >= 3) {
                addImgBtn.style.display = 'none';
            } else {
                addImgBtn.style.display = 'flex';
            }
        }
    }

    // 将图片URL添加为参考图（直接使用持久URL，无需再上传）
    async function addImageAsReference(imageUrl, previewUrl = null) {
        // 检查是否有空位
        const emptyIndex = uploadedImages.findIndex(img => !img);
        if (emptyIndex === -1) {
            alert(t('refSlotsFull') || '参考图位置已满，请先删除一张图片');
            return;
        }

        // 显示加载状态
        uploadedImages[emptyIndex] = { loading: true, url: imageUrl };
        loadingImagesCount++;
        updateGenerateButtonState();
        window.renderRefs();

        try {
            // 直接使用传入的URL（任务卡片的图片已经是TOS持久URL）
            // imageUrl: 完整图URL（持久URL）
            // previewUrl: 预览图URL（持久URL或实时处理URL）
            
            const finalPreviewUrl = previewUrl || imageUrl;
            
            // 直接存储URL，无需上传
            // 判断是否是持久URL：不包含 x-tos-process 参数且不是 base64
            const isPermanentUrl = !imageUrl.includes('x-tos-process') && !imageUrl.startsWith('data:');
            uploadedImages[emptyIndex] = {
                highUrl: imageUrl,           // 完整图（TOS持久URL或实时处理URL）
                previewUrl: finalPreviewUrl,  // 预览图
                fileId: 'ref_' + Date.now(),
                isUploaded: isPermanentUrl,  // 只有持久URL才标记为已上传
                isFromTask: true             // 标记来自任务卡片
            };
            
            loadingImagesCount--;
            updateGenerateButtonState();
            window.renderRefs();
            

            
        } catch (err) {
            uploadedImages[emptyIndex] = null;
            loadingImagesCount--;
            updateGenerateButtonState();
            window.renderRefs();
            console.error('[添加参考图] 失败:', err);
            alert(t('addRefFailed') || '添加参考图失败: ' + err.message);
        }
    }

    // 从 dataUrl 生成 fileId
    function generateFileIdFromDataUrl(dataUrl) {
        let hash = 0;
        for (let i = 0; i < dataUrl.length; i++) {
            const char = dataUrl.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'task-ref-' + Math.abs(hash).toString(16).substring(0, 12);
    }

    function renderRefs() {
        // 原地整理数组:保持引用不变,避免与 PromptBar.uploadedImages 断开
        const nonNullImages = uploadedImages.filter(img => img);
        uploadedImages.length = 0;
        nonNullImages.forEach(img => uploadedImages.push(img));
        for (let i = nonNullImages.length; i < 8; i++) uploadedImages.push(null);
        // uploadedImages 引用未变,window.uploadedImages 仍指向同一数组

        const refsStrip = document.getElementById('refsStrip');
        const refsMini = document.getElementById('refsMini');

        // 兼容新数据结构：检查 dataUrl、url、loading、previewDataUrl、highUrl、previewUrl 或纯字符串
        const hasImages = uploadedImages.some(img => {
            if (!img) return false;
            if (typeof img === 'string') return true;
            return img.dataUrl || img.url || img.loading || img.previewDataUrl || img.highUrl || img.previewUrl;
        });
        if (!hasImages) {
            refsStrip.classList.add('hidden');
            refsMini.innerHTML = '';
            return;
        }

        refsStrip.classList.remove('hidden');
        refsMini.innerHTML = '';

        // MJ 模型最多显示 3 张图
        const maxSlots = (currentModel && currentModel.startsWith('mj-')) ? 3 : 8;

        let displayIndex = 0;
        let slotCount = 0;
        uploadedImages.forEach((data, idx) => {
            if (!data) return;
            if (slotCount >= maxSlots) return; // MJ 模型限制 3 张
            addImageSlot(data, displayIndex, idx);
            displayIndex++;
            slotCount++;
        });
        
        // 图片位置可能变化，更新提示词区域的图片标签
        updateImageTags();
    }

    // 添加单个图片到预览区域
    function addImageSlot(data, displayIndex, originalIndex) {
        const slot = document.createElement('div');
        slot.className = 'ref-slot-mini has-image';
        slot.dataset.index = displayIndex;

        // 辅助函数：将 original 路径转换为 preview 路径
        function getPreviewUrl(url) {
            if (!url) return url;
            // 如果 URL 包含 /original/，替换为 /preview/
            if (url.includes('/original/')) {
                return url.replace('/original/', '/preview/');
            }
            return url;
        }

        // 检查是否是加载中状态
        const isLoading = data && data.loading;

        if (isLoading) {
            // 加载中状态：显示变暗效果+加载动画
            slot.classList.add('loading');
            // 上传中立即显示本地原图（叠加加载遮罩）
            if (data.file instanceof Blob && /^image\//.test(data.file.type || '')) {
                if (!data._localUrl) data._localUrl = URL.createObjectURL(data.file);
                const li = document.createElement('img'); li.src = data._localUrl; li.draggable = false; slot.appendChild(li);
            }
            
            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'image-loading-overlay';
            
            const spinner = document.createElement('div');
            spinner.className = 'image-loading-spinner';
            loadingOverlay.appendChild(spinner);
            
            const loadingText = document.createElement('span');
            loadingText.className = 'image-loading-text';
            loadingText.textContent = t('processing');
            loadingOverlay.appendChild(loadingText);
            
            slot.appendChild(loadingOverlay);
        } else {
            // 正常显示图片
            const img = document.createElement('img');
            // 兼容新数据结构：{ originalUrl, previewDataUrl, highUrl, previewUrl, dataUrl, fileId, isUploaded }
            let imageSrc;
            let editorImageSrc;
            if (typeof data === 'string') {
                imageSrc = data;
                editorImageSrc = data;
            } else if (data.previewDataUrl) {
                // 优先使用预览图URL（如果有的话）
                // 如果是base64数据(data:)，改用dataUrl或originalUrl
                const cdnUrl = data.previewDataUrl;
                if (cdnUrl.startsWith('data:')) {
                    // base64数据不使用，改用dataUrl或originalUrl
                    if (data.dataUrl) {
                        imageSrc = data.dataUrl;
                    } else if (data.originalUrl) {
                        const originalUrl = data.originalUrl.startsWith('http') ? data.originalUrl : (getBackendUrl() + data.originalUrl);
                        imageSrc = originalUrl;
                    } else {
                        imageSrc = cdnUrl; // 兜底：仍使用base64
                    }
                } else {
                    // 是http URL，使用代理
                    imageSrc = getBackendUrl() + '/v1/image/proxy?url=' + encodeURIComponent(cdnUrl);
                }
                // 编辑器优先使用 highUrl（TOS永久链接）
                if (data.highUrl) {
                    editorImageSrc = data.highUrl.startsWith('http') ? (getBackendUrl() + '/v1/image/proxy?url=' + encodeURIComponent(data.highUrl)) : data.highUrl;
                } else if (data.originalUrl) {
                    const originalUrl = data.originalUrl.startsWith('http') ? data.originalUrl : (getBackendUrl() + data.originalUrl);
                    editorImageSrc = originalUrl;
                } else {
                    editorImageSrc = imageSrc;
                }
            } else if (data.previewUrl) {
                // 优先使用预览图URL（AI生成任务的预览图）
                // 如果是base64数据(data:)，改用originalUrl避免性能问题
                if (data.previewUrl.startsWith('data:')) {
                    // base64数据不使用，改用其他URL
                    if (data.highUrl) {
                        // 编辑后的图片使用 highUrl
                        imageSrc = getPreviewUrl(data.highUrl);
                    } else if (data.fullUrl) {
                        // 编辑后的图片使用 fullUrl
                        imageSrc = getPreviewUrl(data.fullUrl);
                    } else if (data.originalUrl) {
                        const originalUrl = data.originalUrl.startsWith('http') ? data.originalUrl : (getBackendUrl() + data.originalUrl);
                        imageSrc = getPreviewUrl(originalUrl);
                    } else {
                        imageSrc = data.previewUrl; // 兜底：仍使用base64
                    }
                } else if (data.previewUrl.startsWith('http')) {
                    // 预览图直接访问，不使用代理（TOS图片可以直接访问）
                    // 如果 previewUrl 包含 /original/，转换为 /preview/
                    imageSrc = getPreviewUrl(data.previewUrl);
                } else {
                    imageSrc = getPreviewUrl(data.previewUrl);
                }
                // 编辑器使用原图
                if (data.highUrl) {
                    // 编辑后的图片优先使用 highUrl
                    editorImageSrc = data.highUrl.startsWith('http') ? (getBackendUrl() + '/v1/image/proxy?url=' + encodeURIComponent(data.highUrl)) : data.highUrl;
                } else if (data.fullUrl) {
                    // 编辑后的图片使用 fullUrl
                    editorImageSrc = data.fullUrl.startsWith('http') ? (getBackendUrl() + '/v1/image/proxy?url=' + encodeURIComponent(data.fullUrl)) : data.fullUrl;
                } else if (data.originalUrl) {
                    const originalUrl = data.originalUrl.startsWith('http') ? data.originalUrl : (getBackendUrl() + data.originalUrl);
                    editorImageSrc = originalUrl;
                } else {
                    editorImageSrc = imageSrc;
                }
            } else if (data.highUrl) {
                // 编辑后的图片：使用 highUrl 作为原图，直接访问
                // 预览图显示时使用 preview 路径
                imageSrc = getPreviewUrl(data.highUrl);
                editorImageSrc = data.highUrl;
            } else if (data.fullUrl) {
                // 编辑后的图片：使用 fullUrl 作为原图，直接访问
                // 预览图显示时使用 preview 路径
                imageSrc = getPreviewUrl(data.fullUrl);
                editorImageSrc = data.fullUrl;
            } else if (data.originalUrl) {
                // 使用原图URL（作参考图时使用），直接访问
                const originalUrl = data.originalUrl.startsWith('http') ? data.originalUrl : (getBackendUrl() + data.originalUrl);
                // 预览图显示时使用 preview 路径
                imageSrc = getPreviewUrl(originalUrl);
                editorImageSrc = originalUrl;
            } else if (data.preview) {
                imageSrc = data.preview;
                editorImageSrc = data.preview;
            } else if (data.dataUrl) {
                imageSrc = data.dataUrl;
                editorImageSrc = data.dataUrl;
            } else if (data.url) {
                imageSrc = data.url;
                editorImageSrc = data.url;
            }
            img.src = imageSrc;
            img.draggable = false; // 禁用默认拖拽
            // 添加图片加载错误处理
            img.onerror = () => {
                console.error('[参考图] 图片加载失败:', imageSrc);
                img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23333" width="100" height="100"/><text fill="%23999" x="50" y="50" text-anchor="middle" font-size="12">加载失败</text></svg>';
                img.style.opacity = '0.5';
            };
            slot.appendChild(img);

            // 检查是否有图片正在上传中
            const isUploading = loadingImagesCount > 0;

            // 删除按钮（仅在无上传任务时显示）
            if (!isUploading) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.innerHTML = '×';
                deleteBtn.title = t('delete');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // 通过查找数据对象在数组中的实际索引来删除（因为renderRefs会重新排序数组）
                    const actualIndex = uploadedImages.findIndex(img => img === data);
                    if (actualIndex !== -1) {
                        const fileId = uploadedImages[actualIndex]?.fileId;
                        // 获取当前显示索引（1-based）
                        const currentImageIndex = actualIndex + 1;
                        uploadedImages[actualIndex] = null;
                        
                        // 删除提示词内对应的图片框
                        removeImageTagByFileId(fileId, currentImageIndex);
                    }
                    window.renderRefs();
                });
                slot.appendChild(deleteBtn);
            }

            // 点击预览图打开编辑器（仅在非拖动状态下）
            slot.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn') && !dragState.hasMoved) {
                    openImageEditor(editorImageSrc, displayIndex);
                }
            });

            // 长按拖动排序功能（仅当无上传任务且图片数量大于1时启用）
            const imageCount = uploadedImages.filter(img => img && !img.loading).length;
            if (!isUploading && imageCount > 1) {
                setupDragSort(slot, displayIndex);
            }
        }

        refsMini.appendChild(slot);
        
        // 设置视觉顺序（用于拖动排序）
        updateSlotOrder();
    }
    
    // 更新所有 slot 的视觉顺序
    function updateSlotOrder() {
        const slots = refsMini.querySelectorAll('.ref-slot-mini.has-image');
        slots.forEach((s, i) => {
            s.dataset.order = i;
        });
    }

    // 设置拖动排序 - 实时让位效果
    function setupDragSort(slot, idx) {
        // 防重绑：与 PromptBar._setupDragSort 共用同一标记，确保同一 slot 只被一套拖动逻辑绑定
        // （双绑定会导致松手时两套 endDrag 各 splice 一次数组→排序错乱跳动）
        if (slot._dragSortBound) return;
        slot._dragSortBound = true;
        let startX = 0;
        let currentX = 0;
        let isDragging = false;
        let longPressTimer = null;
        let hasMoved = false;
        let deleteBtn = slot.querySelector('.delete-btn');
        let originalOrder = 0; // 原始视觉顺序
        let currentOrder = 0; // 当前视觉顺序
        let slotWidth = 0; // 缓存 slot 宽度
        let slotGap = 0; // 缓存间距
        let dataArrayIndex = idx; // 在 uploadedImages 中的实际索引

        const startDrag = (e) => {
            // 忽略删除按钮上的操作
            if (e.target.closest('.delete-btn')) return;
            
            // 阻止默认拖拽行为
            e.preventDefault();
            
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            startX = clientX;
            hasMoved = false;
            
            // 更新视觉顺序
            updateSlotOrder();
            
            // 获取当前视觉顺序
            originalOrder = parseInt(slot.dataset.order) || 0;
            currentOrder = originalOrder;
            dataArrayIndex = idx;
            
            // 缓存 slot 尺寸（动态量测：px-theme 主题覆盖为 52px!important/gap 8px!important，
            // 常量会与实际步进错位导致让位过远+临界翻转闪烁；offsetWidth 不含 transform 无 hover 污染）
            slotWidth = slot.offsetWidth;
            slotGap = parseFloat(getComputedStyle(refsMini).columnGap) || 8;
            
            // 启动长按定时器
            longPressTimer = setTimeout(() => {
                isDragging = true;
                dragState.isDragging = true;
                dragState.draggedIndex = idx;
                slot.classList.add('dragging');
                
                // 隐藏删除按钮
                if (deleteBtn) {
                    deleteBtn.style.opacity = '0';
                    deleteBtn.style.pointerEvents = 'none';
                }
                
                // 添加全局拖动样式
                document.body.classList.add('ref-dragging-active');
                
                // 给其他 slot 添加过渡动画
                const allSlots = refsMini.querySelectorAll('.ref-slot-mini.has-image');
                allSlots.forEach(s => {
                    if (s !== slot) {
                        s.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
                    }
                });
                
                // 阻止默认行为（防止滚动）
                if (e.preventDefault) e.preventDefault();
            }, LONG_PRESS_DURATION);
        };

        const moveDrag = (e) => {
            if (!isDragging) {
                // 如果移动距离超过阈值，取消长按
                const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
                if (Math.abs(clientX - startX) > 10) {
                    clearTimeout(longPressTimer);
                }
                return;
            }
            
            hasMoved = true;
            dragState.hasMoved = true;
            
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            // 计算鼠标移动距离
            const mouseDeltaX = clientX - startX;
            
            // 拖动时同时应用 translateX 和 scale，保持和悬停时一样的大小
            currentX = mouseDeltaX;
            slot.style.transform = `translateX(${currentX}px) scale(1.15)`;
            
            // 计算当前应该插入的位置（基于未放大的 slot 宽度 + 间距）
            const slotTotalWidth = slotWidth + slotGap;
            const moveSlots = Math.round(currentX / slotTotalWidth);
            
            // 获取所有有图片的 slot
            const allSlots = Array.from(refsMini.querySelectorAll('.ref-slot-mini.has-image'));
            const maxOrder = allSlots.length - 1;
            
            // 计算新的视觉顺序
            let newOrder = originalOrder + moveSlots;
            newOrder = Math.max(0, Math.min(newOrder, maxOrder));
            
            // 如果位置发生变化，更新其他 slot 的位置
            if (newOrder !== currentOrder) {
                currentOrder = newOrder;
                updateOtherSlotsPosition(allSlots, originalOrder, currentOrder);
            }
        };

        // 更新其他 slot 的位置（让位效果）
        function updateOtherSlotsPosition(allSlots, fromOrder, toOrder) {
            // 使用拖动起点动态量测的实际布局宽 + 间距计算位移（与步进口径一致）
            const moveDistance = slotWidth + slotGap;
            
            allSlots.forEach((s) => {
                if (s === slot) return; // 跳过正在拖动的 slot
                
                const slotOrder = parseInt(s.dataset.order) || 0;
                let offsetX = 0;
                
                if (fromOrder < toOrder) {
                    // 向后拖动：fromOrder 到 toOrder 之间的 slot 向左移动
                    if (slotOrder > fromOrder && slotOrder <= toOrder) {
                        offsetX = -moveDistance;
                    }
                } else if (fromOrder > toOrder) {
                    // 向前拖动：toOrder 到 fromOrder 之间的 slot 向右移动
                    if (slotOrder >= toOrder && slotOrder < fromOrder) {
                        offsetX = moveDistance;
                    }
                }
                
                s.style.transform = offsetX !== 0 ? `translateX(${offsetX}px)` : '';
            });
        }

        const endDrag = (e) => {
            clearTimeout(longPressTimer);
            
            unbindDoc();

            if (isDragging) {
                isDragging = false;
                dragState.isDragging = false;
                
                // 清除所有 slot 的 transform
                const allSlots = refsMini.querySelectorAll('.ref-slot-mini.has-image');
                allSlots.forEach(s => {
                    s.style.transition = '';
                    s.style.transform = '';
                });
                
                slot.classList.remove('dragging');
                
                // 恢复删除按钮
                if (deleteBtn) {
                    deleteBtn.style.opacity = '';
                    deleteBtn.style.pointerEvents = '';
                }
                
                document.body.classList.remove('ref-dragging-active');
                
                // 如果位置有变化，执行数据交换
                if (currentOrder !== originalOrder) {
                    // 获取当前所有非空图片的数组索引（按视觉顺序排序）
                    const nonNullIndices = [];
                    uploadedImages.forEach((img, i) => {
                        if (img) nonNullIndices.push(i);
                    });
                    
                    // 找到原始位置和新位置对应的数组索引
                    const fromArrayIndex = nonNullIndices[originalOrder];
                    const toArrayIndex = nonNullIndices[currentOrder];
                    
                    // 从数组中移除原位置的元素
                    const [movedItem] = uploadedImages.splice(fromArrayIndex, 1);
                    
                    // 插入到新位置
                    let insertIndex = toArrayIndex;
                    if (fromArrayIndex < toArrayIndex) {
                        insertIndex = toArrayIndex;
                    }
                    uploadedImages.splice(insertIndex, 0, movedItem);
                }
                
                // 直接重新渲染，不播放动画
                // 委托统一入口：PromptBar 已加载时走增量复用渲染，避免 innerHTML 全量重建
                // 导致 <img> 全部重新加载（松手闪烁）
                window.renderRefs();
                
                // 延迟重置 hasMoved，防止触发点击事件
                setTimeout(() => {
                    dragState.hasMoved = false;
                    dragState.draggedIndex = null;
                }, 100);
            }
        };

        // document 级监听仅在拖动会话期间挂载，结束即解绑（修复每次渲染累积监听器的泄漏）
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

        // 鼠标事件
        slot.addEventListener('mousedown', (e) => { startDrag(e); bindDoc(); });

        // 触摸事件
        slot.addEventListener('touchstart', (e) => { startDrag(e); bindDoc(); }, { passive: false });
    }

    // === 上传到存储图床：使用 FormData 直接传文件 ===

    // 获取后端服务器地址（支持局域网访问）
    function getBackendUrl() {
        const host = window.location.hostname || 'localhost';
        
        // 云端服务器使用 Nginx 80 端口转发，不需要指定后端端口
        if (window.location.port === '' || window.location.port === '80' || window.location.port === '443') {
            return `${window.location.protocol}//${host}`;
        }
        
        const port = BACKEND_CONFIG.port || 3000;
        if (!host || host.includes(' ') || port < 1 || port > 65535) {
            return 'http://localhost:3000';
        }
        return `http://${host}:${port}`;
    }

    // 上传单张图片到存储图床，返回图片 URL
    // 调用本地后端服务，用 FormData 传文件
    async function uploadImageToVolcHost(dataUrl, { uploadEndpoint, uploadToken, apiKey, baseUrl }) {
        if (!dataUrl) {
            throw new Error('无效的图片数量');
        }

        // dataURL 转成 Blob
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        const UPLOAD_SERVER = getBackendUrl();
        const endpoint = uploadEndpoint || `${UPLOAD_SERVER}/v1/image/upload`;

        // 根据 dataUrl 类型确定文件扩展名
        const isPng = dataUrl.startsWith('data:image/png');
        const fileName = isPng ? 'image.png' : 'image.jpg';

        const form = new FormData();
        form.append('file', blob, fileName);

        const resp = await fetch(endpoint, {
            method: 'POST',
            body: form
        });

        if (!resp.ok) {
            throw new Error(`图片上传失败 (${resp.status})`);
        }

        const json = await resp.json();
        if (json.code === 0 && json.data && json.data.url) {
            const cleanUrl = json.data.url.trim();
            return cleanUrl;
        }
        throw new Error(json.msg || '图片上传失败');
    }

    // 上传图片到Gemini File API获取临时URI
    async function uploadToGeminiFileAPI(blob, apiKey, baseUrl) {
        try {
            const uploadUrl = `${baseUrl}/upload/v1beta/files?key=${apiKey}`;
            
            const formData = new FormData();
            formData.append('file', blob);
            
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Protocol': 'multipart'
                },
                body: formData
            });
            
            if (!response.ok) {
                return null;
            }
            
            const data = await response.json();
            if (data.file && data.file.uri) {
                return data.file.uri;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    // 在生成前统一处理本地图片：返回已上传的图片URL数组
    async function prepareImageUrlsForGeneration(baseUrl) {
        const localImages = uploadedImages.filter(Boolean);
        if (!localImages.length) {
            return [];
        }

        const results = [];
        const urlsToUpload = []; // 需要上传到TOS的URL（未编辑的图片：完整图+预览图）
        const urlIndexMap = [];  // 记录索引映射
        const editedImages = []; // 编辑后的图片（只需要上传预览图）
        const editedIndexMap = []; // 编辑图片的索引映射

        // 第一步：收集所有需要上传的URL
        for (let i = 0; i < uploadedImages.length; i++) {
            const imgData = uploadedImages[i];
            if (!imgData) continue;

            // 如果是编辑后的图片（完整图已在TOS）
            if (imgData.isFromEdit && imgData.highUrl) {
                // 编辑后的图片：完整图已在TOS
                // 清理URL中的反引号和空格
                const cleanHighUrl = String(imgData.highUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                let previewUrl = imgData.previewUrl;
                if (typeof previewUrl !== 'string') {
                    console.warn('[prepareImageUrlsForGeneration] isFromEdit previewUrl 不是字符串:', i, typeof previewUrl, previewUrl);
                    previewUrl = cleanHighUrl;
                }
                const cleanPreviewUrl = String(previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                
                // 检查预览图是否也已经上传过（有持久URL）
                if (imgData.isUploaded && cleanPreviewUrl && !cleanPreviewUrl.includes('x-tos-process')) {
                    // 预览图已经是持久URL，无需再次上传
                    results.push({
                        highUrl: cleanHighUrl,
                        previewUrl: cleanPreviewUrl
                    });
                } else {
                    // 预览图是实时处理URL，需要上传获取持久URL
                    editedImages.push({
                        previewUrl: cleanPreviewUrl,  // 实时处理URL（150px）
                        fullUrl: cleanHighUrl         // TOS持久URL（完整图）- 使用 highUrl
                    });
                    editedIndexMap.push({ index: i, resultIndex: results.length });
                    results.push(null); // 占位
                }
                continue;
            }
            
            // 如果是从任务卡片添加的参考图（已经是持久URL）
            if (imgData.isFromTask && imgData.highUrl) {
                // 直接使用已有的持久URL，无需上传
                // 清理URL中的反引号和空格
                const cleanHighUrl = String(imgData.highUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                let previewUrl = imgData.previewUrl;
                if (typeof previewUrl !== 'string') {
                    console.warn('[prepareImageUrlsForGeneration] isFromTask previewUrl 不是字符串:', i, typeof previewUrl, previewUrl);
                    previewUrl = cleanHighUrl;
                }
                const cleanPreviewUrl = String(previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                
                results.push({
                    highUrl: cleanHighUrl,      // 完整图（TOS持久URL）
                    previewUrl: cleanPreviewUrl || cleanHighUrl  // 预览图
                });
                continue;
            }
            
            // 获取highUrl（可能是实时处理URL）
            let imageUrl = imgData.highUrl || imgData.originalUrl;
            
            if (!imageUrl) {
                // 旧格式兼容
                if (imgData.dataUrl) {
                    imageUrl = imgData.dataUrl;
                } else if (typeof imgData === 'string') {
                    imageUrl = imgData;
                } else if (imgData.url) {
                    imageUrl = imgData.url;
                }
            }
            
            if (!imageUrl) continue;

            // 确保 imageUrl 是字符串
            if (typeof imageUrl !== 'string') {
                console.warn('[prepareImageUrlsForGeneration] imageUrl 不是字符串:', i, typeof imageUrl, imageUrl);
                continue;
            }

            // 如果是http URL（实时处理URL或永久URL）
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                // 检查是否已经上传过（有isUploaded标记且URL不是实时处理URL）
                if (imgData.isUploaded && imageUrl && !imageUrl.includes('x-tos-process')) {
                    // 已经上传过，直接使用
                    // console.log('[prepareImageUrlsForGeneration] 图片已上传，直接使用:', i);
                    // 确保 previewUrl 是字符串
                    let previewUrl = imgData.previewUrl;
                    if (typeof previewUrl !== 'string') {
                        console.warn('[prepareImageUrlsForGeneration] 已上传图片 previewUrl 不是字符串:', i, typeof previewUrl, previewUrl);
                        previewUrl = imageUrl;
                    }
                    results.push({
                        highUrl: imageUrl,
                        previewUrl: previewUrl || imageUrl
                    });
                } else {
                    // 需要上传到TOS
                    // 同时上传完整图和预览图
                    let previewUrl = imgData.previewUrl || imageUrl;
                    // 确保 previewUrl 是字符串
                    if (typeof previewUrl !== 'string') {
                        console.warn('[prepareImageUrlsForGeneration] previewUrl 不是字符串，使用 imageUrl:', i, typeof previewUrl, previewUrl);
                        previewUrl = imageUrl;
                    }
                    // 清理URL中的反引号和空格
                    const cleanImageUrl = String(imageUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                    const cleanPreviewUrl = String(previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                    
                    // console.log('[准备图片] 上传到TOS:', { 
                        // highUrl: cleanImageUrl, 
                        // previewUrl: cleanPreviewUrl,
                        // isSame: cleanImageUrl === cleanPreviewUrl 
                    // });
                    
                    urlsToUpload.push({
                        highUrl: cleanImageUrl,
                        previewUrl: cleanPreviewUrl
                    });
                    urlIndexMap.push({ index: i, resultIndex: results.length });
                    results.push(null); // 占位
                }
            } else {
                // base64图片，使用旧方式上传
                try {
                    const uploadedUrl = await uploadImageToVolcHost(imageUrl, { baseUrl });
                    results.push({
                        highUrl: uploadedUrl,
                        previewUrl: uploadedUrl
                    });
                    // 更新状态
                    if (uploadedImages[i]) {
                        uploadedImages[i].isUploaded = true;
                        uploadedImages[i].highUrl = uploadedUrl;
                        uploadedImages[i].previewUrl = uploadedUrl;
                        delete uploadedImages[i].previewDataUrl;
                        delete uploadedImages[i].dataUrl;
                    }
                } catch (err) {
                    console.error('[准备图片] 上传失败:', err);
                    throw err;
                }
            }
        }

        // 第二步：批量上传未编辑的图片到TOS获取永久URL
        if (urlsToUpload.length > 0) {
            try {
                const uploadRes = await fetch(getBackendUrl() + '/v1/image/upload-for-send', {
                    method: 'POST',
                      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrls: urlsToUpload })
                });
                
                if (!uploadRes.ok) {
                    throw new Error('图片上传失败');
                }
                
                const uploadResult = await uploadRes.json();
                if (uploadResult.code === 0 && uploadResult.data && uploadResult.data.urls) {
                    const permanentUrls = uploadResult.data.urls;
                    
                    // 填充结果
                    for (let i = 0; i < urlIndexMap.length; i++) {
                        const { index, resultIndex } = urlIndexMap[i];
                        const urlPair = permanentUrls[i];
                        // 后端返回的是 {highUrl, previewUrl} 对象
                        let highUrl = urlPair.highUrl || urlPair;
                        let previewUrl = urlPair.previewUrl || urlPair;
                        // 清理URL中的反引号和空格
                        highUrl = String(highUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                        previewUrl = String(previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                        
                        results[resultIndex] = {
                            highUrl: highUrl,
                            previewUrl: previewUrl
                        };
                        
                        // 更新 uploadedImages
                        if (uploadedImages[index]) {
                            uploadedImages[index].isUploaded = true;
                            uploadedImages[index].highUrl = highUrl;
                            uploadedImages[index].previewUrl = previewUrl;
                        }
                    }
                } else {
                    throw new Error(uploadResult.msg || '图片上传失败');
                }
            } catch (err) {
                console.error('[准备图片] 批量上传失败:', err);
                throw err;
            }
        }

        // 第三步：处理编辑后的图片（完整图已在TOS，预览图需要上传获取持久URL）
        if (editedImages.length > 0) {
            try {
                // 提取预览图URL（实时处理URL，需要上传到TOS获取持久URL）
                const previewUrls = editedImages.map((img, idx) => {
                    if (typeof img.previewUrl !== 'string') {
                        console.warn('[prepareImageUrlsForGeneration] editedImages[' + idx + '].previewUrl 不是字符串:', typeof img.previewUrl, img.previewUrl);
                        return img.fullUrl; // 使用完整图URL作为后备
                    }
                    // 清理URL中的反引号和空格
                    return String(img.previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                });
                
                const uploadRes = await fetch(getBackendUrl() + '/v1/image/upload-for-send', {
                    method: 'POST',
                      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrls: previewUrls })
                });
                
                if (!uploadRes.ok) {
                    throw new Error('预览图上传失败');
                }
                
                const uploadResult = await uploadRes.json();
                if (uploadResult.code === 0 && uploadResult.data && uploadResult.data.urls) {
                    const permanentPreviewUrls = uploadResult.data.urls;
                    
                    // 填充结果（完整图用已有的TOS URL，预览图用新上传的持久URL）
                    for (let i = 0; i < editedIndexMap.length; i++) {
                        const { index, resultIndex } = editedIndexMap[i];
                        const urlPair = permanentPreviewUrls[i];
                        // 后端返回的是 {highUrl, previewUrl} 对象，但这里只需要预览图
                        let permanentPreviewUrl = urlPair.previewUrl || urlPair;
                        // 清理URL中的反引号和空格
                        permanentPreviewUrl = String(permanentPreviewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                        const fullUrl = editedImages[i].fullUrl;
                        
                        results[resultIndex] = {
                            highUrl: fullUrl,              // 完整图（TOS持久URL，已有）
                            previewUrl: permanentPreviewUrl // 预览图（新上传的持久URL）
                        };
                        
                        // 更新 uploadedImages
                        if (uploadedImages[index]) {
                            uploadedImages[index].isUploaded = true;
                            uploadedImages[index].highUrl = fullUrl;
                            uploadedImages[index].previewUrl = permanentPreviewUrl;
                        }
                    }
                } else {
                    throw new Error(uploadResult.msg || '预览图上传失败');
                }
            } catch (err) {
                console.error('[准备图片] 编辑图片预览图上传失败:', err);
                throw err;
            }
        }

        // 清理所有URL中的反引号和空格，返回包含highUrl和previewUrl的完整对象
        const cleanedResults = results.filter(r => r !== null).map(r => {
            if (typeof r === 'string') {
                const cleanedUrl = r.trim().replace(/^[`\s]+|[`\s]+$/g, '');
                // 生成预览图URL：在uploaded后添加for-send，确保不重复添加
                const previewUrl = cleanedUrl.includes('/uploaded/for-send/') 
                    ? cleanedUrl 
                    : cleanedUrl.replace('/uploaded/', '/uploaded/for-send/');
                return {
                    highUrl: cleanedUrl,
                    previewUrl: previewUrl
                };
            } else if (typeof r === 'object' && r !== null && r.highUrl) {
                // 清理URL
                const highUrl = String(r.highUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                // 确保 previewUrl 是字符串并清理
                let previewUrl = r.previewUrl;
                if (typeof previewUrl !== 'string') {
                    console.warn('[prepareImageUrlsForGeneration] cleanedResults previewUrl 不是字符串:', typeof previewUrl, previewUrl);
                    previewUrl = highUrl;
                } else {
                    // 清理 previewUrl 中的反引号和空格
                    previewUrl = String(previewUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                }
                // 如果previewUrl不包含for-send，生成预览图URL
                if (!previewUrl.includes('/uploaded/for-send/')) {
                    previewUrl = highUrl.includes('/uploaded/for-send/') 
                        ? highUrl 
                        : highUrl.replace('/uploaded/', '/uploaded/for-send/');
                }
                return {
                    highUrl: highUrl,
                    previewUrl: previewUrl
                };
            }
            return r;
        });

        return cleanedResults;
    }

    // --- Generation Logic ---
    /**
     * 发起生成任务。参数由 PromptBar.getGenerationParams() 收集后通过 onGenerate 钩子传入。
     * 兼容旧版无参调用（从内联事件绑定触发时）：从本地状态变量收集参数。
     */
    async function startGeneration(params) {
        // 兼容旧版无参调用：从本地状态收集参数
        if (!params) {
            const baseUrl = (apiConfig && apiConfig.apis && currentApi && apiConfig.apis[currentApi] && apiConfig.apis[currentApi].endpoint) || '';
            params = {
                baseUrl,
                prompt: (typeof getPromptText === 'function' ? getPromptText().trim() : ''),
                model: currentModel,
                aspectRatio: currentAspect,
                imageSize: currentRes,
                imageUrls: (typeof PromptBar !== 'undefined' ? PromptBar.uploadedImages : uploadedImages).filter(Boolean).map(im => ({ highUrl: im.highUrl, previewUrl: im.previewUrl })),
                api: localStorage.getItem('nano_selected_model_api') || 'auto'
            };
        } else {
            // PromptBar 已在点击瞬间生成完整参数；保留这次提交快照，避免异步变化的全局状态覆盖用户选择。
            params = { ...params };
        }

        const { prompt, model: actualModel, imageUrls, api: savedModelApi } = params;

        if (!prompt) {
            alert(t('errorPrompt'));
            if (typeof PromptBar !== 'undefined' && PromptBar.el.promptInput) PromptBar.el.promptInput.focus();
            else if (promptInput) promptInput.focus();
            return;
        }
        // 注意：任务数量限制已移至后端，每个用户最多10个生成中的任务

        // 禁用生成按钮，防止重复点击
        const generateBtnEl = document.getElementById('generateBtn');
        if (generateBtnEl) {
            generateBtnEl.disabled = true;
            generateBtnEl.classList.add('loading');
            generateBtnEl.title = '图片上传中...';
        }

        // 先保存设置
        saveSettings();

        // 使用后端任务系统
        // 所有任务都使用后端任务系统
        if (typeof TaskClient === 'undefined') {
            alert('任务系统未初始化，请刷新页面重试');
            if (generateBtnEl) {
                generateBtnEl.disabled = false;
                generateBtnEl.classList.remove('loading');
            }
            return;
        }

        try {
            const task = await TaskClient.createTask(params);

            // 创建前端任务卡片（使用后端任务ID，标记为后端处理）
            createTaskCard(task.id, prompt, params, true);

            // 添加到活跃任务列表
            activeTasks.push({
                taskId: task.id,
                params,
                startTime: Date.now()
            });
        } catch (error) {
            alert('创建任务失败: ' + error.message);
        }

        // 恢复生成按钮
        if (generateBtnEl) {
            generateBtnEl.disabled = false;
            generateBtnEl.classList.remove('loading');
            generateBtnEl.title = t('generate');
        }
    }

    // 清理旧的任务卡片，保持内存使用在合理范围
    function cleanupOldTaskCards() {
        const taskCards = imagesGrid.querySelectorAll('.task-card');
        if (taskCards.length > MAX_TASK_CARDS) {
            const cardsToRemove = taskCards.length - MAX_TASK_CARDS;
            // 移除最旧的卡片（从后往前）
            for (let i = taskCards.length - 1; i >= taskCards.length - cardsToRemove; i--) {
                const card = taskCards[i];
                // 只移除已完成的卡片
                const isLoading = card.classList.contains('loading');
                const isProcessing = activeTasks.some(t => t.taskId === card.id.replace('task-', ''));
                if (!isLoading && !isProcessing) {
                    card.remove();
                }
            }
        }
    }

    function createTaskCard(taskId, prompt, params = null, isBackendTask = false) {
        // 创建新卡片前清理旧卡片
        cleanupOldTaskCards();

        const div = document.createElement('div');
        div.className = 'task-card loading';
        div.id = `task-${taskId}`;
        div.dataset.isBackendTask = isBackendTask ? 'true' : 'false'; // 标记是否为后端任务
        div.innerHTML =
            `<div class="task-image">
                <div class="task-loading-spinner"></div>
                <div class="favorite-star hidden">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </div>
            </div>
            <button class="icon-btn-action use-as-ref-btn" data-i18n-title="useAsRef" title="${t('useAsRef')}">
                <span data-i18n="useAsRef">${t('useAsRef')}</span>
            </button>
            <button class="icon-btn-action favorite-btn" data-i18n-title="favorite" title="收藏">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </button>
            <button class="icon-btn-action delete-btn" data-i18n-title="delete" title="${t('delete')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="task-overlay hidden">
                <button class="icon-btn-action edit-btn" data-i18n-title="editParams" title="${t('editParams')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="icon-btn-action dl-btn" data-i18n-title="titleDownload" title="${t('titleDownload')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </button>
                <button class="icon-btn-action regen-btn" data-i18n-title="regenerate" title="${t('regenerate')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
            </div>
            <div class="task-retry-overlay hidden">
                <button class="icon-btn-action retry-btn" data-i18n-title="retry" title="${t('retry')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                </button>
            </div>`
        ;
        
        imagesGrid.prepend(div);
        
        // 存储参数到dataset
        div.dataset.taskId = taskId; // 保存任务ID用于收藏关联
        if (params) {
            div.dataset.model = params.model || '';
            div.dataset.aspectRatio = params.aspectRatio || '';
            div.dataset.imageSize = params.imageSize || '';
            div.dataset.prompt = params.prompt || '';
            div.dataset.imageUrls = JSON.stringify(params.imageUrls || []);
            div.dataset.quality = params.quality || ''; // 保存画质档位
            div.dataset.api = params.api || currentApi; // 保存API信息
            div.dataset.mjParentTask = params.mjParentTask || ''; // 保存MJ父任务ID
            div.dataset.mjAction = params.mjAction || ''; // 保存MJ操作类型
            div.dataset.mjTaskId = params.mjTaskId || ''; // 保存MJ任务ID
        }
        
        // 下载按钮
        div.querySelector('.dl-btn').onclick = () => {
            const card = document.getElementById(`task-${taskId}`);
            const originalUrl = card.dataset.originalUrl;
            if (originalUrl) window.pxDownload(originalUrl, `nano-${taskId}`);
        };
        
        // 编辑参数按钮
        div.querySelector('.edit-btn').onclick = () => {
            const card = document.getElementById(`task-${taskId}`);
            fillParamsFromCard(card);
        };
        
        // 再次生成按钮
        div.querySelector('.regen-btn').onclick = async () => {
            const card = document.getElementById(`task-${taskId}`);
            
            // 使用任务卡片原有的API信息
            const cardApi = card.dataset.api || currentApi;
            
            // 从apiConfig获取接口配置
            const apiConfigData = apiConfig?.apis?.[cardApi];
            
            // baseUrl从apiConfig获取
            const baseUrl = apiConfigData?.endpoint || getCurrentApiBaseUrl();
            
            const newParams = {
                baseUrl: baseUrl,
                api: cardApi, // 保存API标识
                prompt: card.dataset.prompt || '',
                model: card.dataset.model || currentModel,
                aspectRatio: card.dataset.aspectRatio || currentAspect,
                imageSize: card.dataset.imageSize || currentRes,
                imageUrls: JSON.parse(card.dataset.imageUrls || '[]')
            };
            
            // 所有任务都使用后端任务系统
            if (typeof TaskClient === 'undefined') {
                alert('任务系统未初始化，请刷新页面重试');
                return;
            }
            
            try {
                const task = await TaskClient.createTask(newParams);
                createTaskCard(task.id, newParams.prompt, newParams, true);
                activeTasks.push({
                    taskId: task.id,
                    params: newParams,
                    startTime: Date.now()
                });
            } catch (error) {
                alert('创建任务失败: ' + error.message);
            }
        };

        // 收藏按钮
        const favoriteBtn = div.querySelector('.favorite-btn');
        const favoriteStar = div.querySelector('.favorite-star');
        
        // 检查是否已收藏
        const isFavorited = checkTaskFavorited(taskId);
        if (isFavorited) {
            favoriteBtn.classList.add('favorited');
            favoriteStar.classList.remove('hidden');
        }
        
        favoriteBtn.onclick = async () => {
            const currentlyFavorited = favoriteBtn.classList.contains('favorited');
            if (currentlyFavorited) {
                // 取消收藏
                favoriteBtn.classList.remove('favorited');
                favoriteStar.classList.add('hidden');
                await removeTaskFavorite(taskId);
            } else {
                // 添加收藏 - 从历史记录中获取完整数据
                favoriteBtn.classList.add('favorited');
                favoriteStar.classList.remove('hidden');
                
                // 从历史记录缓存中查找完整记录
                const fullRecord = historyRecordsCache.find(r => r.taskId === taskId);
                if (fullRecord) {
                    // 使用历史记录中的完整数据（包含 refs）
                    await addTaskFavorite(taskId, {
                        ...fullRecord,
                        timestamp: Date.now()
                    });
                } else {
                    // 如果找不到历史记录，使用当前数据
                    await addTaskFavorite(taskId, {
                        prompt: prompt,
                        params: params,
                        timestamp: Date.now()
                    });
                }
            }
        };

        // 删除按钮
        div.querySelector('.delete-btn').onclick = async () => {
            if (confirm(t('deleteConfirm') || '确定要删除此任务记录吗？')) {
                // 从历史记录中删除（优先使用recordId，如果没有则使用taskId）
                const recordId = div.dataset.recordId || taskId;
                await deleteTaskRecord(recordId);
                // 从DOM中删除卡片
                div.remove();
            }
        };

        // 作参考图按钮
        div.querySelector('.use-as-ref-btn').onclick = () => {
            // 直接使用 div 引用，避免 ID 变化导致的问题
            // 优先使用 dataset 中存储的预览图 URL（原始URL），而不是 img 标签的 src（可能是代理URL）
            const originalUrl = div.dataset.originalUrl;
            const actualThumbnailUrl = div.dataset.thumbnailUrl;
            if (originalUrl) {
                addImageAsReference(originalUrl, actualThumbnailUrl);
            }
        };

        const retryBtn = div.querySelector('.retry-btn');
        retryBtn.onclick = async () => {
            // 从内存或dataset获取参数
            let params = taskParams[taskId];
            
            // 如果内存中没有，尝试从dataset恢复
            if (!params) {
                const card = document.getElementById(`task-${taskId}`);
                if (card && card.dataset.prompt) {
                    params = {
                        baseUrl: getCurrentApiBaseUrl(),
                        prompt: card.dataset.prompt || '',
                        model: card.dataset.model || currentModel,
                        aspectRatio: card.dataset.aspectRatio || currentAspect,
                        imageSize: card.dataset.imageSize || currentRes,
                        imageUrls: JSON.parse(card.dataset.imageUrls || '[]')
                    };
                }
            }
            
            if (!params) {
                alert('任务参数已丢失，无法重试');
                return;
            }
            
            // 所有任务都使用后端任务系统
            if (typeof TaskClient === 'undefined') {
                alert('任务系统未初始化，请刷新页面重试');
                return;
            }
            
            try {
                const task = await TaskClient.createTask(params);
                
                // 更新卡片ID和状态
                div.id = `task-${task.id}`;
                div.classList.remove('loading');
                div.querySelector('.task-image').innerHTML = '<div class="task-loading-spinner"></div>';
                
                // 隐藏重试遮罩层和按钮
                div.querySelector('.task-retry-overlay').classList.add('hidden');
                retryBtn.classList.add('hidden');
                
                // 更新任务参数映射
                taskParams[task.id] = params;
                delete taskParams[taskId];
                
                // 更新活跃任务列表
                const index = activeTasks.findIndex(t => t.taskId === taskId);
                if (index !== -1) {
                    activeTasks[index].taskId = task.id;
                }
                
                // 标记为后端任务
                div.dataset.isBackendTask = 'true';
            } catch (error) {
                alert('创建任务失败: ' + error.message);
            }
        };

        updateCounter();
    }
    
    // 从任务卡片填充参数到输入区域
    // 后端脱敏后的模型展示名 → 真实模型 id（与服务端 MODEL_DISPLAY_MAP 保持一致）
    const MODEL_ID_BY_DISPLAY = {
        'Nano Banana 2.0': 'nano-banana-2',
        'Nano Banana 2.1': 'gemini-nano-banana-2.1',
        'Nano Banana 2.0 快速': 'nano-banana-lite',
        'Nano Banana Pro': 'nano-banana-pro',
        'GPT Image 2 标准': 'gpt-image-2',
        'GPT Image 2 Pro': 'gpt-image-2-vip',
        'GPT Image 2.5 快速': 'gpt-image-2.5-flare',
        'GPT Image 2.5 快速 Pro': 'gpt-image-2.5-flare-vip',
        'GPT Image 2.5': 'gpt-image-2.5-sunburst',
        'GPT Image 2.5 Pro': 'gpt-image-2.5-sunburst-vip',
        'Seedream 5.0': 'seedream-5-0-pro-260628',
        'Seedream 5.0 快速': 'seedream-5-0-260128'
    };
    function resolveDisplayModel(model) {
        return (model && MODEL_ID_BY_DISPLAY[model]) ? MODEL_ID_BY_DISPLAY[model] : model;
    }
    // 真实模型 id → 脱敏组名展示名（与服务端 MODEL_DISPLAY_MAP 保持一致）
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
    // 展示用模型名：优先脱敏组名，兼容展示名输入，查不到时回退配置名
    function getMaskedModelName(model) {
        if (!model) return '-';
        if (MODEL_DISPLAY_NAME[model]) return MODEL_DISPLAY_NAME[model];
        if (MODEL_ID_BY_DISPLAY[model]) return model;
        if (model.startsWith('mj-') || model === 'Midjourney') return 'Midjourney';
        const cfg = modelConfigMap[model];
        return (cfg && cfg.name) ? cfg.name : model;
    }
    // MJ 判断：同时兼容真实 id（mj- 前缀）与脱敏展示名（Midjourney）
    function isMjModelSafe(model) {
        return !!model && (model.startsWith('mj-') || model === 'Midjourney');
    }

    function fillParamsFromCard(card) {
        // 获取卡片保存的参数（model 可能是后端脱敏后的展示名，先转换回真实 id）
        const cardApi = card.dataset.api;
        const model = resolveDisplayModel(card.dataset.model);
        const aspectRatio = card.dataset.aspectRatio;
        const imageSize = card.dataset.imageSize;
        const prompt = card.dataset.prompt;
        const imageUrls = JSON.parse(card.dataset.imageUrls || '[]');
        const imagePreviews = JSON.parse(card.dataset.imagePreviews || '[]');
        const quality = card.dataset.quality || '';
        
        // 根据模型名称直接映射 API
        const targetApi = getApiForModel(model);
        // console.log(`[编辑任务] 模型 ${model}，映射到 ${targetApi} API`);
        localStorage.setItem('nano_selected_model_api', targetApi);
        currentApi = targetApi;
        
        // 填充参数
        fillParamsAfterApiSwitch(model, aspectRatio, imageSize, prompt, imageUrls, imagePreviews, quality);
    }
    
    // 在API切换后填充参数（或不需要切换时直接填充）
    function fillParamsAfterApiSwitch(model, aspectRatio, imageSize, prompt, imageUrls, imagePreviews = [], quality = '') {
        // 填充模型
        if (model) {
            // 根据模型名称确定正确的 API，确保模型验证使用正确的 API
            const correctApi = getApiForModel(model);
            currentApi = correctApi;
            
            // 验证模型是否存在于对应 API 的可用模型列表中
            let isValidModel = false;
            let targetModel = model;
            
            if (apiConfig && apiConfig.apis[correctApi]) {
                const apiModels = apiConfig.apis[correctApi].frontend?.models || apiConfig.apis[correctApi].models || [];
                const modelConfig = apiModels.find(m => m.id === model);
                if (modelConfig) {
                    isValidModel = true;
                }
            }
            
            // 如果模型不存在，检查是否是有效的模型
            if (!isValidModel) {
                // 兼容旧记录里的真实模型 id：先归一为展示名再判断
                const normEditModel = MODEL_DISPLAY_NAME[model] || model;
                if (normEditModel.startsWith('Nano Banana') || normEditModel.startsWith('GPT Image') || normEditModel.startsWith('Seedream')) {
                    // 家族内有效模型，归一为展示名保持原样
                    targetModel = normEditModel;
                    isValidModel = true;
                } else {
                    // 旧模型或其他无效模型，默认使用 Nano Banana Pro
                    targetModel = 'Nano Banana Pro';
                    isValidModel = true;
                }
            }
            
            if (targetModel === 'Nano Banana 2.1') nanoVersion = '2.1';
            else if (targetModel === 'Nano Banana 2.0') nanoVersion = '2.0';
            currentModel = targetModel;
            // 同步到主界面和 localStorage
            window.mainCurrentModel = targetModel;
            localStorage.setItem('nano_selected_model', targetModel);
            localStorage.setItem('nano_selected_model_api', correctApi);
            
            // 优先从对应 API 的模型列表获取显示名称
            let displayName = targetModel;
            if (apiConfig && apiConfig.apis[correctApi]) {
                const apiModels = apiConfig.apis[correctApi].frontend?.models || apiConfig.apis[correctApi].models || [];
                const modelConfig = apiModels.find(m => m.id === targetModel);
                if (modelConfig) {
                    displayName = modelConfig.name;
                }
            }
            // 如果对应 API 中没有找到，再从全局map中查找
            if (displayName === targetModel) {
                const modelConfig = modelConfigMap[targetModel];
                displayName = modelConfig?.name || targetModel;
            }
            // 家族统一显示总名字，子版本名（2.1/Lite/flare/sunburst 等）不上标题
            if (targetModel === 'Nano Banana 2.0' || targetModel === 'Nano Banana 2.0 快速' || targetModel === 'Nano Banana 2.1') {
                displayName = 'Nano Banana 2';
            } else if (targetModel && targetModel.startsWith('GPT Image 2.5')) {
                displayName = 'GPT Image 2.5';
            } else if (targetModel && targetModel.startsWith('GPT Image 2 ')) {
                displayName = 'GPT Image 2';
            }
            document.getElementById('modelLabel').textContent = displayName;
            document.querySelectorAll('.model-option').forEach(opt => {
                const fam = opt.dataset.value === 'Nano Banana 2.0' && isNano2FamilyModel(targetModel);
                opt.classList.toggle('selected', opt.dataset.value === targetModel || fam);
            });
            updateNanoVerButton();
            updateResolutionOptions(targetModel);
            // 更新价格显示
            updatePriceDisplay();
        }
        
        // 填充比例
        if (aspectRatio) {
            currentAspect = aspectRatio;
            document.querySelectorAll('.ratio-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === aspectRatio);
            });
        }
        
        // 填充分辨率
        if (imageSize) {
            currentRes = imageSize;
            document.querySelectorAll('.combo-option[data-type="size"]').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === imageSize);
            });
        }

        // 同步到 PromptBar（生成时从 PromptBar.getGenerationParams() 取参数）
        if (typeof PromptBar !== 'undefined') {
            PromptBar.currentModel = currentModel;
            PromptBar.currentAspect = currentAspect;
            PromptBar.currentRes = currentRes;
            document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.dataset.value === currentModel));
            document.querySelectorAll('.combo-option[data-type="size"]').forEach(o => o.classList.toggle('selected', o.dataset.value === currentRes));
            document.querySelectorAll('.ratio-option').forEach(o => o.classList.toggle('selected', o.dataset.value === currentAspect));
            if (typeof PromptBar._updateModelLabel === 'function') PromptBar._updateModelLabel();
            if (typeof PromptBar.updateResolutionOptions === 'function') PromptBar.updateResolutionOptions(currentModel);
            if (typeof PromptBar.updatePriceDisplay === 'function') PromptBar.updatePriceDisplay();
            if (quality) PromptBar.currentQuality = quality;
            if (typeof PromptBar.toggleGptQuality === 'function') PromptBar.toggleGptQuality(currentModel);
            if (typeof PromptBar.updateQuickModeButton === 'function') PromptBar.updateQuickModeButton(currentModel);
            if (typeof PromptBar.updateProModeButton === 'function') PromptBar.updateProModeButton(currentModel);
            if (typeof PromptBar.renderModelOptionsForApi === 'function') PromptBar.renderModelOptionsForApi(currentApi);
            if (typeof PromptBar._updateModelLabel === 'function') PromptBar._updateModelLabel();
        }

        // 填充参考图 - 直接使用URL，不需要下载为base64

        // 清空现有上传图片（保持与 PromptBar.uploadedImages 引用同步，避免生成时取不到参考图）
        if (typeof PromptBar !== 'undefined' && PromptBar.uploadedImages) {
            PromptBar.uploadedImages.fill(null);
            uploadedImages = PromptBar.uploadedImages;
        } else {
            uploadedImages = new Array(8).fill(null);
        }
        window.uploadedImages = uploadedImages;
        document.querySelectorAll('.ref-slot-mini').forEach(el => el.remove());
        
        if (imageUrls.length > 0) {
            // 直接使用URL，标记为已上传状态
            imageUrls.forEach((urlData, index) => {
                if (index >= 8) return;
                
                // 处理新旧格式兼容
                // 新格式: {highUrl, previewUrl}  旧格式: 字符串URL
                let highUrl, previewUrl;
                if (typeof urlData === 'object' && urlData.highUrl) {
                    // 清理URL中的空格和反引号
                    highUrl = String(urlData.highUrl).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                    // 生成预览图URL：在uploaded后添加for-send，确保不重复添加
                    previewUrl = highUrl.includes('/uploaded/for-send/')
                        ? highUrl
                        : highUrl.replace('/uploaded/', '/uploaded/for-send/');
                } else {
                    highUrl = String(urlData).trim().replace(/^[`\s]+|[`\s]+$/g, '');
                    // 生成预览图URL：在uploaded后添加for-send，确保不重复添加
                    previewUrl = highUrl.includes('/uploaded/for-send/')
                        ? highUrl
                        : highUrl.replace('/uploaded/', '/uploaded/for-send/');
                }
                
                // 保存为新的对象格式
                uploadedImages[index] = {
                    highUrl: highUrl,           // 高质量图URL
                    previewUrl: previewUrl,     // 预览图URL（小图）
                    isUploaded: true,           // 标记已上传
                    isFromEdit: true,           // 标记来自编辑
                    fileId: 'hist_' + index + '_' + highUrl    // 稳定 fileId，供 updateImageTags 追踪
                };
            });
            
            // 立即渲染所有参考图（使用预览图）
            window.renderRefs();
            
            // 异步加载缩略图显示（使用预览图URL）
            imageUrls.forEach((urlData, index) => {
                if (index >= 8) return;
                
                // 获取预览图URL
                let highUrl, previewUrl;
                if (typeof urlData === 'object' && urlData.highUrl) {
                    highUrl = urlData.highUrl;
                } else {
                    highUrl = urlData;
                }
                // 生成预览图URL：在uploaded后添加for-send，确保不重复添加
                if (highUrl.includes('/uploaded/for-send/')) {
                    previewUrl = highUrl;
                } else {
                    previewUrl = highUrl.replace('/uploaded/', '/uploaded/for-send/');
                }
                
                const proxyUrl = `${getBackendUrl()}/v1/image/proxy?url=${encodeURIComponent(previewUrl)}`;
                fetch(proxyUrl)
                    .then(r => r.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            uploadedImages[index].preview = e.target.result;
                            window.renderRefs();
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(err => {
                    });
            });
        } else {
            // 没有参考图时也要调用 renderRefs() 来更新 refsStrip 的 hidden 状态
            window.renderRefs();
        }
        
        // 填充提示词（在图片数据加载完成后）
        if (prompt) {
            setPromptText(prompt);
        }
        
        updateComboLabel();
    }

    const taskParams = {};

    // 使用 webhook 方式轮询获取结果
    // onSuccess: 成功回调
    // onFailure: 失败回调（用于触发重试）
    async function pollTaskResult(taskId, jobId, params, onSuccess, onFailure) {
        const resultEndpoint = `${params.baseUrl}/v1/draw/result`;
        const maxPollTime = 10 * 60 * 1000; // 最大轮询10分钟
        const pollInterval = 5000; // 每5秒轮询一次
        const startTime = Date.now();
        
        const doPoll = async () => {
            // 检查是否超过最大轮询时间
            if (Date.now() - startTime > maxPollTime) {
                onFailure('任务超时');
                return;
            }
            
            // 检查任务卡片是否还存在
            const card = document.getElementById(`task-${taskId}`);
            if (!card) {
                return;
            }
            
            try {
                const response = await fetch(resultEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${params.apiKey}`
                    },
                    body: JSON.stringify({ id: jobId })
                });
                
                if (!response.ok) {
                    throw new Error(`查询失败: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.code !== 0) {
                    throw new Error(result.msg || '查询失败');
                }
                
                const data = result.data;
                
                // 检查状态
                if (data.status === 'succeeded') {
                    // 成功
                    if (data.results && data.results.length > 0 && data.results[0].url) {
                        onSuccess(data.results[0].url);
                        return;
                    } else {
                        throw new Error('任务成功但没有返回图片');
                    }
                } else if (data.status === 'failed') {
                    // 失败 - 停止轮询，触发失败回调进行重试
                    onFailure(data.failure_reason || data.error || '生成失败');
                    return;
                } else {
                    // 仍在运行，继续轮询
                    setTimeout(doPoll, pollInterval);
                }
            } catch (err) {
                // 轮询出错，继续尝试
                setTimeout(doPoll, pollInterval);
            }
        };
        
        doPoll();
    }

    function runTask(taskId, params) {
        activeTasks.push({
            taskId: taskId,
            params: params,
            startTime: Date.now()
        });
        taskParams[taskId] = params;
        updateCounter();

        const MAX_RETRIES = 3;
        let retries = 0;

        const attempt = async () => {
            const card = document.getElementById(`task-${taskId}`);
            if (!card) return;

            // Nano Banana 绘画接口
            const endpoint = `${params.baseUrl}/v1/draw/nano-banana`;

            // 构建请求参数 - 使用 webhook 方式获取任务ID
            const payload = {
                model: params.model,
                prompt: params.prompt,
                aspectRatio: params.aspectRatio,
                imageSize: params.imageSize,
                urls: [],
                webHook: '-1', // 立即返回任务ID
                shutProgress: true // 关闭进度，直接返回结果
            };

            // 如果有参考图，添加URL或Base64
            if (params.imageUrls && params.imageUrls.length > 0) {
                for (const imgData of params.imageUrls) {
                    try {
                        // 处理字符串(dataUrl)或对象{url, file}
                        let dataUrl;
                        if (typeof imgData === 'string') {
                            dataUrl = imgData;
                        } else if (imgData && imgData.url) {
                            dataUrl = imgData.url;
                        } else {
                            continue;
                        }
                        
                        // 如果是base64 dataUrl，直接使用
                        if (dataUrl.startsWith('data:')) {
                            payload.urls.push(dataUrl);
                        } else {
                            // 外部URL
                            payload.urls.push(dataUrl);
                        }
                    } catch (err) {
                    }
                }
            }

            // 检查 payload 大小
            const payloadJson = JSON.stringify(payload);
            const payloadSize = new Blob([payloadJson]).size;
            
            if (payloadSize > 10 * 1024 * 1024) {
                throw new Error('请求体过大(>10MB)，请减少参考图数量或压缩图片');
            }

            // 30秒超时（获取任务ID应该很快）
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${params.apiKey}`
                    },
                    body: payloadJson,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`Server ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.code !== 0) {
                    throw new Error(result.msg || '请求失败');
                }
                
                const jobId = result.data?.id;
                if (!jobId) {
                    throw new Error('未获取到任务ID');
                }
                
                // 开始轮询结果，传入成功和失败回调
                pollTaskResult(
                    taskId, 
                    jobId, 
                    params,
                    // onSuccess
                    (imageUrl) => {
                        updateTaskSuccess(taskId, imageUrl);
                    },
                    // onFailure - 触发重试
                    (errorMsg) => {
                        handleFailure(errorMsg);
                    }
                );
                
            } catch (err) {
                clearTimeout(timeoutId);
                
                let errorMsg = err.message;
                if (err.name === 'AbortError') {
                    errorMsg = '请求超时';
                } else if (err.message && err.message.includes('Failed to fetch')) {
                    errorMsg = '网络错误：无法连接到服务器';
                }
                
                handleFailure(errorMsg);
            }

            function handleFailure(errorMsg) {
                retries++;
                if (retries < MAX_RETRIES) {
                    setTimeout(attempt, 1000);
                } else {
                    updateTaskFailed(taskId, errorMsg);
                }
            }
        };

        attempt();
    }

    async function updateTaskSuccess(taskId, url) {
        const card = document.getElementById(`task-${taskId}`);
        if (!card) {
            return;
        }
        if (card.dataset.uploaded === 'true') {
            return;
        }
        card.dataset.uploaded = 'true';
        
        // 检查是否为后端任务，如果是则不处理（后端会处理上传和保存）
        if (card.dataset.isBackendTask === 'true') {
            // 只更新UI显示
            card.classList.remove('loading');
            
            // 检查是否已收藏，保留星星
            const isFavorited = checkTaskFavorited(taskId);
            const starHtml = isFavorited ? 
                `<div class="favorite-star">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </div>` : 
                `<div class="favorite-star hidden">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </div>`;
            
            card.querySelector('.task-image').innerHTML = 
                `<img src="${url}" 
                     alt="Result" 
                     onclick="openFullscreenViewer('${url}', '${taskId}')"
                     style="cursor:pointer"
                     data-i18n-title="clickToView"
                     title="${t('clickToView')}">
                ${starHtml}`;
            card.querySelector('.task-overlay').classList.remove('hidden');
            card.querySelector('.task-retry-overlay').classList.add('hidden');
            activeTasks = activeTasks.filter(task => task.taskId !== taskId);
            updateCounter();
            return;
        }
        
        card.classList.remove('loading');
            
        // 调用后端接口上传生成图片到 nano-photo 服务
        
        try {
            const response = await fetch(`${getBackendUrl()}/v1/image/upload-generated`, {
                method: 'POST',
                headers: { ...authHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ imageUrl: url })
            });
            
            const data = await response.json();
            
            if (data.code === 0 && data.data) {
                const { originalUrl, thumbnailUrl } = data.data;
                
                // 存储正式图URL和预览图URL到dataset，供下载和作参考图使用
                card.dataset.originalUrl = originalUrl;
                card.dataset.thumbnailUrl = thumbnailUrl;
                
                // 检查是否已收藏，保留星星
                const isFavorited = checkTaskFavorited(taskId);
                const starHtml = isFavorited ? 
                    `<div class="favorite-star">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>` : 
                    `<div class="favorite-star hidden">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>`;
                
                // 显示预览图（使用存储服务缩略图），点击打开全屏查看
                card.querySelector('.task-image').innerHTML = 
                    `<img src="${thumbnailUrl}" 
                         alt="Result" 
                         onclick="openFullscreenViewer('${originalUrl}', '${taskId}')"
                         style="cursor:pointer"
                         data-i18n-title="clickToView"
                         title="${t('clickToView')}">
                    ${starHtml}`;
                
                // 生成成功，显示下载按钮，隐藏重试遮罩
                card.querySelector('.task-overlay').classList.remove('hidden');
                card.querySelector('.task-retry-overlay').classList.add('hidden');
                // 保存生成记录
                await saveGenerationRecord(taskId, originalUrl, thumbnailUrl, card);
                
                // 如果任务已收藏，更新收藏数据中的图片URL
                if (isFavorited) {
                    const favorites = getFavoriteTasks();
                    if (favorites[taskId]) {
                        favorites[taskId].originalUrl = originalUrl;
                        favorites[taskId].thumbnailUrl = thumbnailUrl;
                        try {
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                        } catch (e) {
                        }
                    }
                }
            } else {
                // 上传失败则显示原图
                await showOriginalImage(card, url, taskId);
            }
        } catch (err) {
            // 上传失败则显示原图
            await showOriginalImage(card, url, taskId);
        }
        
        activeTasks = activeTasks.filter(task => task.taskId !== taskId);
        updateCounter();
    }
    
    // 显示原图（上传失败时的降级方案）
    async function showOriginalImage(card, url, taskId) {
        card.dataset.originalUrl = url;
        card.dataset.thumbnailUrl = url;  // 使用原图作为预览图
        
        // 检查是否已收藏，保留星星
        const isFavorited = checkTaskFavorited(taskId);
        const starHtml = isFavorited ? 
            `<div class="favorite-star">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </div>` : 
            `<div class="favorite-star hidden">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </div>`;
        
        card.querySelector('.task-image').innerHTML = 
            `<img src="${url}" 
                 alt="Result" 
                 onclick="openFullscreenViewer('${url}', '${taskId}')"
                 style="cursor:pointer"
                 data-i18n-title="clickToView"
                 title="${t('clickToView')}">
            ${starHtml}`;
        
        // 生成成功但上传失败，仍然显示下载按钮
        card.querySelector('.task-overlay').classList.remove('hidden');
        card.querySelector('.task-retry-overlay').classList.add('hidden');

        // 保存记录（使用原图作为originalUrl和thumbnailUrl）
        await saveGenerationRecord(taskId, url, url, card);
        
        // 如果任务已收藏，更新收藏数据中的图片URL
        if (isFavorited) {
            const favorites = getFavoriteTasks();
            if (favorites[taskId]) {
                favorites[taskId].originalUrl = url;
                favorites[taskId].thumbnailUrl = url;
                try {
                    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                } catch (e) {
                }
            }
        }

        // 任务完成后，延迟清理旧卡片
        setTimeout(() => {
            cleanupOldTaskCards();
        }, 5000);
    }

    function updateTaskFailed(taskId, reason) {
        const card = document.getElementById(`task-${taskId}`);
        if (card) {
            card.classList.remove('loading');
            const errorMsg = reason ? reason : t('statusFailed');
            card.querySelector('.task-image').innerHTML = `<div style="color:var(--error)">${errorMsg}</div>`;
            card.querySelector('.task-retry-overlay').classList.remove('hidden');
            // 生成失败，隐藏下载按钮
            card.querySelector('.task-overlay').classList.add('hidden');
        }
        activeTasks = activeTasks.filter(task => task.taskId !== taskId);
        updateCounter();
    }

    function updateCounter() {
        // 保持显示价格，不显示任务数量
        updatePriceDisplay();
    }

    // --- Settings & Utils ---
    function loadSettings() {
        // 加载上次选择的API
        const savedApi = localStorage.getItem('nano_selected_api');
        if (savedApi && apiConfig && apiConfig.apis[savedApi]) {
            currentApi = savedApi;
            // 重新渲染模型列表（如果loadApiConfig已经渲染过，这里会再次渲染确保正确）
            renderModelOptionsForApi(savedApi);
        }
        
        // 确保设置面板中的API列表也更新
        renderSettingsModelList();
    }

    function saveSettings() {
        // 保存当前选择的模型
        if (currentModel) {
            localStorage.setItem('nano_selected_model', currentModel);
            // 同步到主界面的 currentModel
            window.mainCurrentModel = currentModel;
        }
    }

    // 保存生成记录到服务器
    // 支持两种调用方式:
    // 1. saveGenerationRecord(taskId, originalUrl, thumbnailUrl, card) - 旧方式
    // 2. saveGenerationRecord(recordData) - 新方式，传入对象
    async function saveGenerationRecord(arg1, arg2, arg3, arg4) {
        try {
            let record;
            
            // 判断调用方式
            if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
                // 新方式：直接传入记录对象
                // 注意：只保存originalUrl，thumbnailUrl通过前端替换路径生成（将original替换为preview）
                record = {
                    taskId: arg1.taskId,
                    imageUrl: (arg1.originalUrl && !arg1.originalUrl.startsWith('data:')) ? arg1.originalUrl : '',  // 过滤base64数据，只保存http/https URL
                    timestamp: arg1.timestamp || Date.now(),
                    api: arg1.api || '',
                    model: arg1.model || '',
                    aspectRatio: arg1.aspectRatio || '',
                    imageSize: arg1.imageSize || '',
                    prompt: arg1.prompt || '',
                    imageUrls: arg1.imageUrls || [],
                    refs: arg1.refs || uploadedImages.filter(img => img !== null).map(img => ({
                        url: img.url,
                        uuid: img.uuid
                    }))
                };
            } else {
                // 旧方式：分别传入参数
                const taskId = arg1;
                const originalUrl = arg2;
                const thumbnailUrl = arg3;
                const card = arg4;
                
                // 处理imageUrls，只保留URL，不保留base64数据
                let imageUrls = [];
                if (card && card.dataset) {
                    try {
                        const rawImageUrls = JSON.parse(card.dataset.imageUrls || '[]');
                        // 只保留http/https URL，过滤掉base64 dataUrl
                        imageUrls = rawImageUrls.filter(url => {
                            if (typeof url === 'string') {
                                return url.startsWith('http://') || url.startsWith('https://');
                            }
                            return false;
                        });
                    } catch (e) {
                        imageUrls = [];
                    }
                }
                
                // 创建新记录（精简数据）
                // 注意：只保存originalUrl，thumbnailUrl通过前端替换路径生成（将original替换为preview）
                const currentRefs = uploadedImages.filter(img => img !== null).map(img => ({
                    url: img.url,
                    uuid: img.uuid
                }));
                record = {
                    taskId: taskId,
                    imageUrl: (originalUrl && !originalUrl.startsWith('data:')) ? originalUrl : '',  // 过滤base64数据，只保存http/https URL
                    timestamp: Date.now(),
                    api: card?.dataset?.api || currentApi || '',
                    model: card?.dataset?.model || '',
                    aspectRatio: card?.dataset?.aspectRatio || '',
                    imageSize: card?.dataset?.imageSize || '',
                    prompt: card?.dataset?.prompt || '',
                    imageUrls: imageUrls,
                    refs: currentRefs
                };
            }
            
            // 保存到服务器
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            if (!user.id) {
                return;
            }
            
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    userId: user.id,
                    record: record
                })
            });
            
            const result = await response.json();
            if (result && result.code === 200) {
                // 将recordId更新到卡片上，以便后续删除使用
                const card = document.getElementById(`task-${record.taskId}`);
                if (card && result.data?.id) {
                    card.dataset.recordId = result.data.id;
                }
            } else {
            }
        } catch (err) {
        }
    }

    // 获取生成记录（支持分页）
    async function getGenerationRecords(page = 0, pageSize = HISTORY_PAGE_SIZE) {
        try {
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            // console.log('[历史记录] 当前用户:', user);
            if (!user.id) {
                // console.log('[历史记录] 用户未登录，无法获取记录');
                return { records: [], total: 0 };
            }
            
            const offset = page * pageSize;
            const url = `${API_CONFIG.baseUrl}/api/history?userId=${user.id}&limit=${pageSize}&offset=${offset}`;
            // console.log('[历史记录] 请求URL:', url);
            const response = await fetch(url, { headers: authHeaders() });
            const result = await response.json();
            // console.log('[历史记录] API响应:', result);
            
            if (result && result.code === 200 && result.data) {
                return {
                    records: result.data.records || [],
                    total: result.data.total || 0
                };
            }
            // console.log('[历史记录] API返回非200状态:', result);
            return { records: [], total: 0 };
        } catch (err) {
            console.error('[历史记录] 获取记录失败:', err);
            return { records: [], total: 0 };
        }
    }

    // 清空生成记录
    async function clearGenerationRecords(clearFavorites = false) {
        try {
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            if (!user.id) {
                return;
            }
            
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history/clear?userId=${user.id}&clearFavorites=${clearFavorites}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            
            const result = await response.json();
            if (result && result.code === 200) {
            } else {
            }
        } catch (err) {
        }
    }

    // 删除单条任务记录
    async function deleteTaskRecord(recordId) {
        try {
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            if (!user.id) {
                return;
            }
            
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history?userId=${user.id}&recordId=${recordId}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            
            const result = await response.json();
            if (result && result.code === 200) {
            } else {
            }
        } catch (err) {
        }
    }

    // 历史记录分页配置
const HISTORY_PAGE_SIZE = 70;
    let historyRecordsCache = [];
    let historyTotalCount = 0;
    let historyCurrentPage = 0;
    let historyAllLoaded = false;
    let historyScrollListenerAttached = false; // 标记滚动监听器是否已添加

    // 从后端恢复进行中的任务
    async function restoreActiveTasksFromBackend() {
        try {
            // 使用 TaskClient 恢复活跃任务
            if (typeof TaskClient !== 'undefined') {
                const tasks = await TaskClient.restoreActiveTasks();
                
                // 为每个恢复的任务创建卡片
                tasks.forEach(task => {
                    if (task.status === 'pending' || task.status === 'running') {
                        createTaskCardFromBackendTask(task);
                    }
                });
            }
        } catch (err) {
        }
    }

    // 从历史记录恢复任务卡片（分页加载）
    async function restoreTaskCardsFromHistory() {
        try {
            var _pxRl = function () { document.body.classList.remove('px-history-loading'); };
            setTimeout(_pxRl, 8000);
            // console.log('[历史记录] 开始恢复任务卡片...');
            const result = await getGenerationRecords(0);
            // console.log('[历史记录] 获取记录结果:', result);
            historyTotalCount = result.total;
            
            if (result.records.length === 0) {
                // console.log('[历史记录] 没有记录需要恢复');
                return;
            }

            // 只缓存当前页的记录
            historyRecordsCache = result.records;
            historyCurrentPage = 0;
            historyAllLoaded = result.records.length >= historyTotalCount;

            // console.log(`[历史记录] 恢复 ${result.records.length} 条记录，总共 ${result.total} 条`);
            
            // 加载第一页
            loadHistoryPage(0);
            
            // 设置滚动监听（只设置一次）
            if (!historyScrollListenerAttached) {
                setupHistoryScrollListener();
                historyScrollListenerAttached = true;
            }
        } catch (err) {
            console.error('[历史记录] 恢复任务卡片失败:', err);
        } finally {
            document.body.classList.remove('px-history-loading');
        }
    }

    // 加载指定页的历史记录（从服务器分页获取）
    async function loadHistoryPage(page) {
        // 如果缓存中有这一页的数据，直接使用缓存
        if (historyRecordsCache.length > page * HISTORY_PAGE_SIZE) {
            const start = page * HISTORY_PAGE_SIZE;
            const end = start + HISTORY_PAGE_SIZE;
            const pageRecords = historyRecordsCache.slice(start, end);
            
            if (pageRecords.length === 0) {
                historyAllLoaded = true;
                return;
            }

            // 分批处理，避免阻塞主线程
            const batchSize = 5;
            let index = 0;
            
            function processBatch() {
                const batch = pageRecords.slice(index, index + batchSize);
                if (batch.length === 0) return;
                
                batch.forEach(record => {
                    createTaskCardFromRecord(record, false); // false = append
                });
                
                index += batchSize;
                if (index < pageRecords.length) {
                    requestAnimationFrame(processBatch);
                }
            }
            
            processBatch();
            historyCurrentPage = page;
            
            // 如果这是最后一页
            if (end >= historyRecordsCache.length && historyRecordsCache.length >= historyTotalCount) {
                historyAllLoaded = true;
            }
            return;
        }

        // 缓存中没有，从服务器获取新的一页
        const result = await getGenerationRecords(page);
        
        if (result.records.length === 0) {
            historyAllLoaded = true;
            return;
        }

        // 更新缓存（追加或替换）
        if (page === 0) {
            historyRecordsCache = result.records;
        } else {
            historyRecordsCache = [...historyRecordsCache, ...result.records];
        }

        // 分批处理，避免阻塞主线程
        const batchSize = 5;
        let index = 0;
        
        function processBatch() {
            const batch = result.records.slice(index, index + batchSize);
            if (batch.length === 0) return;
            
            batch.forEach(record => {
                createTaskCardFromRecord(record, false); // false = append
            });
            
            index += batchSize;
            if (index < result.records.length) {
                requestAnimationFrame(processBatch);
            }
        }
        
        processBatch();
        historyCurrentPage = page;
        
        // 判断是否加载完成
        historyAllLoaded = historyRecordsCache.length >= historyTotalCount;
    }

    // 设置滚动监听，实现无限滚动
    function setupHistoryScrollListener() {
        const mainArea = document.querySelector('.main-area');
        if (!mainArea) return;

        let scrollRaf = null;
        let isLoading = false;
        mainArea.addEventListener('scroll', () => {
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(async () => {
                scrollRaf = null;
                if (historyAllLoaded || isLoading) return;
                const scrollTop = mainArea.scrollTop;
                const scrollHeight = mainArea.scrollHeight;
                const clientHeight = mainArea.clientHeight;
                if (scrollTop + clientHeight >= scrollHeight * 0.8) {
                    isLoading = true;
                    await loadHistoryPage(historyCurrentPage + 1);
                    isLoading = false;
                }
            });
        });
    }

    // 从历史记录创建任务卡片（不运行任务）
    function createTaskCardFromRecord(record, prepend = true) {
        // 优先使用原始 taskId，兼容旧数据使用 record.id
        const taskId = record.taskId || record.id;
        const prompt = record.prompt;

        // 检查是否已存在
        if (document.getElementById(`task-${taskId}`)) {
            return;
        }
        
        const div = document.createElement('div');
        div.className = 'task-card';
        div.id = `task-${taskId}`;
        // 处理图片URL - 兼容新旧格式
        // 注意：历史记录只保存imageUrl（完整图），预览图通过替换路径生成
        const originalUrl = record.imageUrl || record.originalUrl;
        // 生成预览图URL：将路径中的 /original/ 替换为 /preview/（兼容代理形态 URL：key 为 URL 编码）
        let thumbnailUrl = record.thumbnailUrl || (originalUrl ? originalUrl.replace('/original/', '/preview/') : '');
        if (!record.thumbnailUrl && thumbnailUrl) {
            if (thumbnailUrl.indexOf('%2Foriginal%2F') !== -1) {
                // 代理形态（桶私有化后 key 编码）：直接换 preview 对象，列表不再拉原图
                thumbnailUrl = thumbnailUrl.replace('k=generated%2Foriginal%2F', 'k=generated%2Fpreview%2F');
            } else if (thumbnailUrl.indexOf('/api/img?') !== -1 && thumbnailUrl.indexOf('x-tos-process') === -1) {
                // 无 preview 对象的上传原图等：叠加 TOS 图片处理出小图（服务端白名单校验后透传）
                thumbnailUrl += '&x-tos-process=' + encodeURIComponent('image/resize,w_600/format,webp');
            }
        }
        div.dataset.originalUrl = originalUrl;
        div.dataset.thumbnailUrl = thumbnailUrl;
        div.dataset.uploaded = 'true';
        div.dataset.recordId = record.id || ''; // 保存记录ID用于删除
        div.dataset.taskId = taskId; // 保存任务ID用于收藏关联
        div.dataset.isBackendTask = 'true'; // 历史记录中的任务都是后端处理的

        // 存储参数到dataset
        div.dataset.api = record.api || currentApi || '';  // 保存 API 信息
        div.dataset.model = record.model || '';
        div.dataset.aspectRatio = record.aspectRatio || '';
        div.dataset.imageSize = record.imageSize || '';
        div.dataset.prompt = record.prompt || '';
        // 处理参考图 - 优先使用 referenceImages（新结构），兼容 imageUrls（旧结构）
        const referenceImages = record.referenceImages || record.imageUrls || [];
        // 确保格式一致，提取 imageUrl 或 url 字段
        const imageUrls = referenceImages.map(img => {
            if (typeof img === 'string') {
                return img;
            } else if (img.imageUrl) {
                return img.imageUrl;
            } else if (img.url) {
                return img.url;
            }
            return '';
        }).filter(Boolean);
        // 提取预览图URL - 生成预览图URL：在uploaded后添加for-send，确保不重复添加
        const imagePreviews = imageUrls.map(url => {
            return url.includes('/uploaded/for-send/')
                ? url
                : url.replace('/uploaded/', '/uploaded/for-send/');
        });
        div.dataset.imageUrls = JSON.stringify(imageUrls);
        div.dataset.imagePreviews = JSON.stringify(imagePreviews);
        div.dataset.mjTaskId = record.mjTaskId || '';  // 保存 MJ 任务 ID
        div.dataset.mjParentTask = record.mjParentTask || '';  // 保存 MJ 父任务 ID
        div.dataset.mjAction = record.mjAction || '';  // 保存 MJ 操作类型

        // 检查是否为 MJ 模型
        const isMjModel = isMjModelSafe(record.model);
        // 检查是否为拆分/微调后的单图（有父任务）
        const isMjSingle = isMjModel && record.mjParentTask;

        // 检查是否已收藏
        const isFavorited = checkTaskFavorited(taskId);

        // 构建任务卡片 HTML
        let imageHtml;
        if (isMjSingle) {
            // MJ 拆分/微调后的单图 - 显示为普通图片
            div.dataset.mjStatus = 'single';
            imageHtml = `
                <div class="task-image">
                    <img class="task-card-blur-bg" src="${thumbnailUrl}" alt="" aria-hidden="true">
                    <img src="${thumbnailUrl}"
                         alt="MJ Single"
                         loading="lazy"
                         onclick="openFullscreenViewer('${originalUrl}', '${taskId}')"
                         onerror="if(!this.dataset.fallback){this.dataset.fallback='true';this.src='${originalUrl}';}"
                         style="cursor:pointer;width:100%;height:100%;object-fit:contain;border-radius:8px;"
                         data-i18n-title="clickToView"
                         title="${t('clickToView')}">
                    <div class="favorite-star ${isFavorited ? '' : 'hidden'}">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>
                </div>`;
        } else if (isMjModel) {
            // MJ 四宫格
            div.dataset.mjStatus = 'grid';
            imageHtml = `
                <div class="task-image">
                    <img class="task-card-blur-bg" src="${thumbnailUrl}" alt="" aria-hidden="true">
                    <div class="mj-grid-container" data-task-id="${taskId}">
                        <div class="mj-grid-image" data-task-id="${taskId}" onclick="openFullscreenViewer('${originalUrl}', '${taskId}')">
                            <img src="${thumbnailUrl}" decoding="async" alt="MJ Grid" onerror="if(!this.dataset.fallback){this.dataset.fallback='true';this.src='${originalUrl}';}">
                        </div>
                    </div>
                    <div class="favorite-star ${isFavorited ? '' : 'hidden'}">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>
                </div>`;
        } else {
            // 普通模型显示单图
            imageHtml = `
                <div class="task-image">
                    <img class="task-card-blur-bg" src="${thumbnailUrl}" alt="" aria-hidden="true">
                    <img src="${thumbnailUrl}"
                         alt="Result"
                         loading="lazy"
                         decoding="async"
                         onclick="openFullscreenViewer('${originalUrl}', '${taskId}')"
                         onerror="if(!this.dataset.fallback){this.dataset.fallback='true';this.src='${originalUrl}';}"
                         style="cursor:pointer"
                         data-i18n-title="clickToView"
                         title="${t('clickToView')}">
                    <div class="favorite-star ${isFavorited ? '' : 'hidden'}">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </div>
                </div>`;
        }

        div.innerHTML = imageHtml + `
            <button class="icon-btn-action use-as-ref-btn" data-i18n-title="useAsRef" title="${t('useAsRef')}">
                <span data-i18n="useAsRef">${t('useAsRef')}</span>
            </button>
            <button class="icon-btn-action favorite-btn ${isFavorited ? 'favorited' : ''}" data-i18n-title="favorite" title="收藏">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </button>
            <button class="icon-btn-action delete-btn" data-i18n-title="delete" title="${t('delete')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="task-overlay">
                <button class="icon-btn-action edit-btn" data-i18n-title="editParams" title="${t('editParams')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="icon-btn-action dl-btn" data-i18n-title="titleDownload" title="${t('titleDownload')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </button>
                <button class="icon-btn-action regen-btn" data-i18n-title="regenerate" title="${t('regenerate')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
            </div>
        `;

        // 根据参数决定是 prepend 还是 append
        if (prepend) {
            imagesGrid.prepend(div);
        } else {
            imagesGrid.append(div);
        }

        // 编辑参数按钮
        div.querySelector('.edit-btn').onclick = () => {
            const card = document.getElementById(`task-${taskId}`);
            fillParamsFromCard(card);
        };

        // 收藏按钮
        const favoriteBtn = div.querySelector('.favorite-btn');
        const favoriteStar = div.querySelector('.favorite-star');
        
        favoriteBtn.onclick = async () => {
            const currentlyFavorited = favoriteBtn.classList.contains('favorited');
            if (currentlyFavorited) {
                // 取消收藏
                favoriteBtn.classList.remove('favorited');
                favoriteStar.classList.add('hidden');
                await removeTaskFavorite(taskId);
            } else {
                // 添加收藏 - 直接使用历史记录中的完整数据
                favoriteBtn.classList.add('favorited');
                favoriteStar.classList.remove('hidden');
                await addTaskFavorite(taskId, {
                    ...record,
                    timestamp: Date.now()
                });
            }
        };

        // 删除按钮
        div.querySelector('.delete-btn').onclick = async () => {
            if (confirm(t('deleteConfirm') || '确定要删除此任务记录吗？')) {
                const recordId = div.dataset.recordId;
                if (recordId) {
                    await deleteTaskRecord(recordId);
                }
                div.remove();
            }
        };

        // 下载按钮
        div.querySelector('.dl-btn').onclick = () => {
            const card = document.getElementById(`task-${taskId}`);
            const originalUrl = card.dataset.originalUrl;
            if (originalUrl) window.pxDownload(originalUrl, `nano-${taskId}`);
        };

        // 再次生成按钮
        div.querySelector('.regen-btn').onclick = async () => {
            const card = document.getElementById(`task-${taskId}`);
            
            // 使用任务卡片原有的API信息
            const cardApi = card.dataset.api || currentApi;
            
            // 从apiConfig获取接口配置
            const apiConfigData = apiConfig?.apis?.[cardApi];
            
            // baseUrl从apiConfig获取
            const baseUrl = apiConfigData?.endpoint || getCurrentApiBaseUrl();
            
            // apiKey从localStorage获取对应接口的key
            const newParams = {
                baseUrl: baseUrl,
                api: cardApi, // 保存API标识
                prompt: card.dataset.prompt || '',
                model: card.dataset.model || currentModel,
                aspectRatio: card.dataset.aspectRatio || currentAspect,
                imageSize: card.dataset.imageSize || currentRes,
                imageUrls: JSON.parse(card.dataset.imageUrls || '[]')
            };
            
            // 所有任务都使用后端任务系统
            if (typeof TaskClient === 'undefined') {
                alert('任务系统未初始化，请刷新页面重试');
                return;
            }
            
            try {
                const task = await TaskClient.createTask(newParams);
                createTaskCard(task.id, newParams.prompt, newParams, true);
                activeTasks.push({
                    taskId: task.id,
                    params: newParams,
                    startTime: Date.now()
                });
            } catch (error) {
                alert('创建任务失败: ' + error.message);
            }
        };

        // 作参考图按钮
        div.querySelector('.use-as-ref-btn').onclick = () => {
            // 直接使用 div 引用，避免 ID 变化导致的问题
            const originalUrl = div.dataset.originalUrl;
            // 优先使用 dataset 中存储的预览图 URL（原始URL），而不是 img 标签的 src（可能是代理URL）
            const actualThumbnailUrl = div.dataset.thumbnailUrl;
            if (originalUrl) {
                addImageAsReference(originalUrl, actualThumbnailUrl);
            }
        };
    }

    // 从后端任务创建任务卡片（用于恢复运行中的任务）
    function createTaskCardFromBackendTask(task) {
        const taskId = task.id;
        const params = task.params;
        
        // 检查是否已存在
        if (document.getElementById(`task-${taskId}`)) {
            return;
        }
        
        const div = document.createElement('div');
        div.className = 'task-card loading';
        div.id = `task-${taskId}`;
        
        // 存储参数
        div.dataset.api = params.api || currentApi || ''; // 保存API信息
        div.dataset.model = params.model || '';
        div.dataset.aspectRatio = params.aspectRatio || '';
        div.dataset.imageSize = params.imageSize || '';
        div.dataset.prompt = params.prompt || '';
        div.dataset.imageUrls = JSON.stringify(params.imageUrls || []);
        div.dataset.backendTask = 'true';
        div.dataset.mjParentTask = params.mjParentTask || ''; // 保存MJ父任务ID
        div.dataset.mjAction = params.mjAction || ''; // 保存MJ操作类型
        div.dataset.mjTaskId = params.mjTaskId || ''; // 保存MJ任务ID
        
        div.innerHTML = `
            <div class="task-image">
                <div class="task-loading-spinner"></div>
            </div>
            <button class="icon-btn-action use-as-ref-btn" data-i18n-title="useAsRef" title="${t('useAsRef')}" style="display:none;">
                <span data-i18n="useAsRef">${t('useAsRef')}</span>
            </button>
            <button class="icon-btn-action delete-btn" data-i18n-title="delete" title="${t('delete')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="task-overlay hidden">
                <button class="icon-btn-action edit-btn" data-i18n-title="editParams" title="${t('editParams')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="icon-btn-action dl-btn" data-i18n-title="titleDownload" title="${t('titleDownload')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </button>
                <button class="icon-btn-action regen-btn" data-i18n-title="regenerate" title="${t('regenerate')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
            </div>
            <div class="task-retry-overlay hidden">
                <button class="icon-btn-action retry-btn" data-i18n-title="retry" title="${t('retry')}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                </button>
            </div>
        `;
        
        imagesGrid.prepend(div);
        
        // 删除按钮
        div.querySelector('.delete-btn').onclick = () => {
            if (confirm(t('deleteConfirm') || '确定要删除此任务吗？')) {
                // 删除后端任务
                if (typeof TaskClient !== 'undefined') {
                    TaskClient.deleteTask(taskId);
                }
                div.remove();
            }
        };
        
        // 如果任务已完成，立即更新显示
        if (task.status === 'completed' && task.result) {
            (async () => {
                await completeTaskCardFromBackend(task);
            })();
        } else if (task.status === 'failed') {
            updateTaskFailed(taskId, task.error || '任务失败');
        }
    }
    
    // 更新后端任务卡片状态
    async function updateTaskCardFromBackend(task) {
        const card = document.getElementById(`task-${task.id}`);
        if (!card) {
            return;
        }
        
        // 如果任务已完成，调用完成处理
        if (task.status === 'completed' && task.result) {
            // console.log('[updateTaskCardFromBackend] 任务已完成，调用 completeTaskCardFromBackend');
            await completeTaskCardFromBackend(task);
        } else if (task.status === 'failed') {
            updateTaskFailed(task.id, task.error || '任务失败');
        }
        // 更新进度（如果有）
        else if (task.progress > 0 && task.progress < 100) {
            // 可以在这里添加进度显示
        }
    }
    
    // 完成后端任务卡片
    async function completeTaskCardFromBackend(task) {
        const card = document.getElementById(`task-${task.id}`);
        if (!card) {
            return;
        }

        const result = task.result;
        if (!result) {
            updateTaskFailed(task.id, '生成结果无效');
            return;
        }

        // 检查卡片是否已经有图片URL
        let originalUrl = card.dataset.originalUrl;
        let thumbnailUrl = card.dataset.thumbnailUrl || card.dataset.originalUrl;
        
        // 首先尝试从task.result中获取imageUrl
        if (!originalUrl && (result.imageUrl || result.originalUrl)) {
            originalUrl = result.imageUrl || result.originalUrl;
            thumbnailUrl = result.thumbnailUrl || originalUrl;
            card.dataset.originalUrl = originalUrl;
            card.dataset.thumbnailUrl = thumbnailUrl;
            // console.log('[completeTaskCardFromBackend] 从task.result获取到图片URL');
        }
        
        // 如果没有图片URL，等待异步上传完成
        if (!originalUrl) {
            // console.log('[completeTaskCardFromBackend] 等待图片上传完成...');
            // 显示上传中状态
            const taskImage = card.querySelector('.task-image');
            taskImage.innerHTML = `
                <div class="task-loading-spinner"></div>
                <div style="text-align: center; margin-top: 10px; font-size: 12px;">图片上传中...</div>
            `;
            
            // 尝试从历史记录获取图片URL
            try {
                const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                if (user.id) {
                    // 等待一段时间后再次尝试
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // 获取最新的历史记录
                    const response = await fetch(`${API_CONFIG.baseUrl}/api/history?userId=${user.id}&limit=10&offset=0`, { headers: authHeaders() });
                    const historyResult = await response.json();
                    
                    if (historyResult && historyResult.code === 200 && historyResult.data && historyResult.data.records) {
                        // 查找对应任务的历史记录
                        const historyRecord = historyResult.data.records.find(record => 
                            record.prompt === card.dataset.prompt && 
                            record.model === card.dataset.model
                        );
                        
                        if (historyRecord && (historyRecord.imageUrl || historyRecord.originalUrl)) {
                            originalUrl = historyRecord.imageUrl || historyRecord.originalUrl;
                            // 生成预览图URL：将路径中的 /original/ 替换为 /preview/
                            thumbnailUrl = originalUrl ? originalUrl.replace('/original/', '/preview/') : '';
                            card.dataset.originalUrl = originalUrl;
                            card.dataset.thumbnailUrl = thumbnailUrl;
                            // console.log('[completeTaskCardFromBackend] 从历史记录获取到图片URL');
                        }
                    }
                }
            } catch (err) {
                console.error('[completeTaskCardFromBackend] 获取历史记录失败:', err);
            }
        }
        
        // 确保有图片URL
        if (!originalUrl) {
            updateTaskFailed(task.id, '生成结果无效');
            return;
        }

        // 更新卡片状态
        card.classList.remove('loading');
        card.dataset.uploaded = 'true';

        // 保存 MJ 任务 ID（如果有）
        if (result.mjTaskId) {
            card.dataset.mjTaskId = result.mjTaskId;
        }

        // 检查是否为 MJ 任务（通过模型或父任务判断）
        const isMjTask = isMjModelSafe(card.dataset.model) ||
                         (card.dataset.mjParentTask);
        const taskImage = card.querySelector('.task-image');
        
        // 检查是否已收藏，生成星星HTML
        const isFavorited = checkTaskFavorited(task.id);
        const starHtml = isFavorited ? 
            `<div class="favorite-star">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </div>` : 
            `<div class="favorite-star hidden">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
            </div>`;

        if (isMjTask) {
            // MJ 任务
            const mjAction = card.dataset.mjAction;
            const mjParentTask = card.dataset.mjParentTask;

            if (!mjParentTask) {
                // 原始四宫格任务
                card.dataset.mjStatus = 'grid';
                originalUrl = safeImageUrl(originalUrl); thumbnailUrl = safeImageUrl(thumbnailUrl);
                taskImage.innerHTML = createMjGridHtml(task.id, originalUrl, thumbnailUrl) + starHtml;
                bindMjGridEvents(card, task.id, originalUrl);
            } else if (mjAction === 'upscale' || mjAction === 'separate') {
                // 放大或拆分后的单图任务
                card.dataset.mjStatus = 'single';
                originalUrl = safeImageUrl(originalUrl); thumbnailUrl = safeImageUrl(thumbnailUrl);
                taskImage.innerHTML = createMjSingleHtml(task.id, originalUrl, thumbnailUrl, mjAction) + starHtml;
                bindMjSingleEvents(card, task.id, originalUrl, mjParentTask);
            } else {
                // V 操作（variation/vary）生成的是四宫格
                card.dataset.mjStatus = 'grid';
                originalUrl = safeImageUrl(originalUrl); thumbnailUrl = safeImageUrl(thumbnailUrl);
                taskImage.innerHTML = createMjGridHtml(task.id, originalUrl, thumbnailUrl) + starHtml;
                bindMjGridEvents(card, task.id, originalUrl);
            }
        } else {
            // 普通任务：显示单图
            taskImage.innerHTML = `
                <img src="${thumbnailUrl}"
                     alt="Result"
                     onclick="openFullscreenViewer('${originalUrl}', '${task.id}')"
                     style="cursor:pointer"
                     data-i18n-title="clickToView"
                     title="${t('clickToView')}">
                ${starHtml}
            `;
        }

        // 显示操作按钮
        card.querySelector('.task-overlay').classList.remove('hidden');
        card.querySelector('.use-as-ref-btn').style.display = '';

        // 绑定其他按钮事件（不包括"作参考图"按钮）
        bindTaskCardEvents(card, task.id, originalUrl);
        
        // 直接绑定"作参考图"按钮事件，使用当前的 thumbnailUrl
        // 注意：这必须在 bindTaskCardEvents 之后，否则会覆盖
        card.querySelector('.use-as-ref-btn').onclick = () => {
            // 优先使用 dataset 中存储的预览图 URL（原始URL），而不是 img 标签的 src（可能是代理URL）
            const actualThumbnailUrl = card.dataset.thumbnailUrl || thumbnailUrl;
            addImageAsReference(originalUrl, actualThumbnailUrl);
        };

        // 注意：后端任务的历史记录由后端保存，前端不再重复保存

        // 启动轮询检查TOS上传状态（防止重复启动）
        if (!card.dataset.pollingUpload) {
            card.dataset.pollingUpload = 'true';
            pollTosUploadStatus(task.id, card);
        }
    }

    // 创建 MJ 四宫格 HTML（简化版，只显示图片，操作按钮在大图界面）
    function createMjGridHtml(taskId, originalUrl, thumbnailUrl) {
        return `
            <div class="mj-grid-container" data-task-id="${taskId}">
                <div class="mj-grid-image" onclick="openFullscreenViewer('${originalUrl}', '${taskId}')">
                    <img src="${thumbnailUrl}" alt="MJ Grid">
                </div>
            </div>
        `;
    }

    // 创建 MJ 单图 HTML（拆分/微调后的单图）
    function createMjSingleHtml(taskId, originalUrl, thumbnailUrl, action) {
        // 拆分或微调后的单图只显示普通图片，不显示 U/V 操作按钮
        return `
            <div class="mj-single-container" data-task-id="${taskId}">
                <img src="${thumbnailUrl}"
                     alt="MJ Single"
                     onclick="openFullscreenViewer('${originalUrl}', '${taskId}')"
                     style="cursor:pointer;width:100%;height:100%;object-fit:contain;border-radius:8px;">
            </div>
        `;
    }

    // 绑定 MJ 单图事件
    function bindMjSingleEvents(card, taskId, imageUrl, parentTaskId) {
        const singleOverlay = card.querySelector('.mj-single-overlay');
        if (!singleOverlay) return;

        singleOverlay.querySelectorAll('.mj-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;

                try {
                    const requestBody = {
                        id: taskId
                    };

                    // vary 操作需要 type 参数
                    if (action === 'vary') {
                        requestBody.type = 'subtle'; // 默认轻微变化
                    } else if (action === 'upscale') {
                        requestBody.type = 'subtle'; // 默认高清放大
                    }

                    const response = await fetch(`${getBackendUrl()}/api/midjourney/${action}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    const data = await response.json();
                    if (data.status === 'Success' && data.data?.id) {
                        // 创建新任务卡片
                        const newParams = {
                            baseUrl: getCurrentApiBaseUrl(),
                            prompt: card.dataset.prompt || '',
                            model: card.dataset.model || '',
                            aspectRatio: card.dataset.aspectRatio || '',
                            imageSize: card.dataset.imageSize || '',
                            imageUrls: [],
                            api: 'midjourney',
                            mjParentTask: taskId,
                            mjAction: action,
                            mjFinal: true // 标记为最终单图
                        };
                        createTaskCard(data.data.id, newParams.prompt, newParams, true);
                    } else {
                        alert(`操作失败: ${data.message || '未知错误'}`);
                    }
                } catch (err) {
                    alert('操作失败: ' + err.message);
                }
            });
        });
    }

    // 绑定 MJ 四宫格事件
    function bindMjGridEvents(card, taskId, imageUrl) {
        const gridOverlay = card.querySelector('.mj-grid-overlay');
        if (!gridOverlay) return;

        gridOverlay.querySelectorAll('.mj-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const index = parseInt(btn.dataset.index);

                // 获取 MJ 任务 ID（优先使用 card.dataset.mjTaskId，否则使用 taskId）
                const mjTaskId = card.dataset.mjTaskId || taskId;

                try {
                    const response = await fetch(`${getBackendUrl()}/api/midjourney/${action}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            id: mjTaskId,
                            index: index
                        })
                    });

                    const data = await response.json();
                    if (data.status === 'Success' && data.data?.id) {

                        // 创建后端任务来跟踪 MJ 任务
                        const newParams = {
                            baseUrl: getCurrentApiBaseUrl(),
                            prompt: card.dataset.prompt || '',
                            model: card.dataset.model || '',
                            aspectRatio: card.dataset.aspectRatio || '',
                            imageSize: card.dataset.imageSize || '',
                            imageUrls: [],
                            api: 'midjourney',
                            mjParentTask: taskId,
                            mjAction: action,
                            mjIndex: index,
                            mjTaskId: data.data.id  // 保存 MJ 任务 ID
                        };

                        // 使用 TaskClient 创建后端任务
                        if (typeof TaskClient !== 'undefined') {
                            try {
                                const task = await TaskClient.createTask(newParams);
                                createTaskCard(task.id, newParams.prompt, newParams, true);
                            } catch (error) {
                                // 降级：直接创建前端任务卡片（无轮询）
                                createTaskCard(data.data.id, newParams.prompt, newParams, true);
                            }
                        } else {
                            // 降级：直接创建前端任务卡片（无轮询）
                            createTaskCard(data.data.id, newParams.prompt, newParams, true);
                        }
                    } else {
                        alert(`操作失败: ${data.message || '未知错误'}`);
                    }
                } catch (err) {
                    alert('操作失败: ' + err.message);
                }
            });
        });
    }
    
    // 轮询检查TOS上传状态
    async function pollTosUploadStatus(taskId, card) {
        const maxAttempts = 60; // 最多轮询60次（2分钟）
        const interval = 2000; // 每2秒检查一次
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await fetch(`${getBackendUrl()}/api/tasks/${taskId}/upload-status`, { headers: authHeaders() });
                const data = await response.json();
                
                if (data.code === 200 && data.data) {
                    const status = data.data;
                    
                    if (status.status === 'completed') {
                        // TOS上传完成，更新图片URL
                        
                        // 清理 URL 中的反引号和空格
                        const tosOriginalUrl = String(status.originalUrl || '').trim().replace(/^[`\s]+|[`\s]+$/g, '');
                        const tosThumbnailUrl = String(status.thumbnailUrl || '').trim().replace(/^[`\s]+|[`\s]+$/g, '');
                        
                        // 更新卡片数据
                        card.dataset.originalUrl = tosOriginalUrl;
                        card.dataset.thumbnailUrl = tosThumbnailUrl;  // 保存预览图URL
                        
                        // 更新图片显示（使用TOS缩略图）
                        const taskImage = card.querySelector('.task-image img');
                        if (taskImage) {
                            taskImage.src = tosThumbnailUrl;
                            taskImage.onclick = () => openFullscreenViewer(tosOriginalUrl, taskId);
                        }
                        
                        // 更新绑定的事件
                        bindTaskCardEvents(card, taskId, tosOriginalUrl);
                        
                        return; // 轮询结束
                    } else if (status.status === 'failed') {
                        return; // 上传失败，保持原URL
                    }
                    // status === 'uploading' 继续轮询
                }
            } catch (error) {
            }
            
            // 等待下一次轮询
            await new Promise(resolve => setTimeout(resolve, interval));
        }
    }
    
    // 绑定任务卡片事件
    function bindTaskCardEvents(card, taskId, imageUrl) {
        // 编辑参数按钮
        card.querySelector('.edit-btn').onclick = () => {
            fillParamsFromCard(card);
        };
        
        // 下载按钮
        card.querySelector('.dl-btn').onclick = () => {
            window.pxDownload(imageUrl, `nano-${taskId}`);
        };
        
        // 再次生成按钮
        card.querySelector('.regen-btn').onclick = async () => {
            // 使用任务卡片原有的API信息
            const cardApi = card.dataset.api || currentApi;
            
            // 从apiConfig获取接口配置
            const apiConfigData = apiConfig?.apis?.[cardApi];
            
            // baseUrl从apiConfig获取
            const baseUrl = apiConfigData?.endpoint || getCurrentApiBaseUrl();
            
            const newParams = {
                baseUrl: baseUrl,
                api: cardApi, // 保存API标识
                prompt: card.dataset.prompt || '',
                model: card.dataset.model || currentModel,
                aspectRatio: card.dataset.aspectRatio || currentAspect,
                imageSize: card.dataset.imageSize || currentRes,
                imageUrls: JSON.parse(card.dataset.imageUrls || '[]')
            };
            
            // 所有任务都使用后端任务系统
            if (typeof TaskClient === 'undefined') {
                alert('任务系统未初始化，请刷新页面重试');
                return;
            }
            
            try {
                const task = await TaskClient.createTask(newParams);
                createTaskCard(task.id, newParams.prompt, newParams, true);
                activeTasks.push({
                    taskId: task.id,
                    params: newParams,
                    startTime: Date.now()
                });
            } catch (error) {
                alert('创建任务失败: ' + error.message);
            }
        };
        
        // 作参考图按钮
        card.querySelector('.use-as-ref-btn').onclick = () => {
            // 点击时动态获取最新的 thumbnailUrl
            // 优先使用 dataset 中存储的预览图 URL（原始URL），而不是 img 标签的 src（可能是代理URL）
            const currentThumbnailUrl = card.dataset.thumbnailUrl;
            const currentOriginalUrl = card.dataset.originalUrl || imageUrl;
            addImageAsReference(currentOriginalUrl, currentThumbnailUrl);
        };
        
        // 收藏按钮
        const favoriteBtn = card.querySelector('.favorite-btn');
        const favoriteStar = card.querySelector('.favorite-star');
        
        if (favoriteBtn && favoriteStar) {
            favoriteBtn.onclick = async () => {
                const currentlyFavorited = favoriteBtn.classList.contains('favorited');
                if (currentlyFavorited) {
                    // 取消收藏
                    favoriteBtn.classList.remove('favorited');
                    favoriteStar.classList.add('hidden');
                    await removeTaskFavorite(taskId);
                } else {
                    // 添加收藏 - 从历史记录中获取完整数据
                    favoriteBtn.classList.add('favorited');
                    favoriteStar.classList.remove('hidden');
                    
                    // 从历史记录缓存中查找完整记录
                    const fullRecord = historyRecordsCache.find(r => r.taskId === taskId);
                    if (fullRecord) {
                        await addTaskFavorite(taskId, {
                            ...fullRecord,
                            timestamp: Date.now()
                        });
                    } else {
                        // 如果找不到历史记录，使用当前数据
                        await addTaskFavorite(taskId, {
                            prompt: card.dataset.prompt || '',
                            params: {
                                model: card.dataset.model || currentModel,
                                aspectRatio: card.dataset.aspectRatio || currentAspect,
                                imageSize: card.dataset.imageSize || currentRes,
                                api: card.dataset.api || currentApi
                            },
                            thumbnailUrl: imageUrl,
                            originalUrl: card.dataset.originalUrl || imageUrl,
                            timestamp: Date.now()
                        });
                    }
                }
            };
        }
    }

    // 历史记录弹窗分页配置
    const HISTORY_MODAL_FIRST_PAGE_SIZE = 32;
    const HISTORY_MODAL_PAGE_SIZE = 16;
    let historyModalRecordsCache = [];
    let historyModalCurrentPage = 0;
    let historyModalAllLoaded = false;

    // 渲染历史记录列表（分页懒加载）
    async function renderHistoryList() {
        // 清空列表
        historyList.innerHTML = '';
        historyModalRecordsCache = [];
        historyModalCurrentPage = 0;
        historyModalAllLoaded = false;
        
        // 加载第一页
        await loadHistoryModalPage(0);
        setupHistoryModalScrollListener();
    }

    // 加载历史记录弹窗指定页（从服务器分页获取）
    async function loadHistoryModalPage(page) {
        const pageSize = page === 0 ? HISTORY_MODAL_FIRST_PAGE_SIZE : HISTORY_MODAL_PAGE_SIZE;
        const offset = page === 0 ? 0 : HISTORY_MODAL_FIRST_PAGE_SIZE + (page - 1) * HISTORY_MODAL_PAGE_SIZE;
        
        // 从服务器获取分页数据
        const result = await getGenerationRecordsByOffset(offset, pageSize);
        const pageRecords = result.records;
        
        if (page === 0) {
            historyTotalCount = result.total;
            historyCount.textContent = `(${historyTotalCount})`;
            
            if (pageRecords.length === 0) {
                historyList.innerHTML = `<div class="history-empty">${t('noHistory') || '暂无生成记录'}</div>`;
                return;
            }
        }
        
        if (pageRecords.length === 0) {
            historyModalAllLoaded = true;
            return;
        }

        // 追加到缓存
        historyModalRecordsCache = [...historyModalRecordsCache, ...pageRecords];

        const html = pageRecords.map(record => {
            const date = new Date(record.timestamp);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
            const prompt = record.prompt || t('noPrompt');
            // 统一使用脱敏组名展示（后端已返回展示名时原样保留）
            const model = getMaskedModelName(record.model);
            const size = record.imageSize || '-';
            // 生成预览图URL：将路径中的 /original/ 替换为 /preview/
            const originalUrl = record.imageUrl || record.originalUrl;
            const thumbnailUrl = record.thumbnailUrl || (originalUrl ? originalUrl.replace('/original/', '/preview/') : '');
            
            return `
                <div class="history-item" onclick="openFullscreenViewer('${originalUrl}', '${record.taskId}')">
                    <img src="${thumbnailUrl}" alt="${prompt}" loading="lazy">
                    <div class="history-item-info">
                        <div class="history-item-prompt">${prompt}</div>
                        <div class="history-item-meta">
                            <span>${model}</span>
                            <span>${size}</span>
                            <span>${dateStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // 使用 insertAdjacentHTML 追加到列表
        historyList.insertAdjacentHTML('beforeend', html);
        
        historyModalCurrentPage = page;
        
        // 判断是否加载完成
        historyModalAllLoaded = historyModalRecordsCache.length >= historyTotalCount;
    }

    // 根据offset获取历史记录（用于弹窗分页）
    async function getGenerationRecordsByOffset(offset, limit) {
        try {
            const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
            if (!user.id) {
                return { records: [], total: 0 };
            }
            
            const response = await fetch(`${API_CONFIG.baseUrl}/api/history?userId=${user.id}&limit=${limit}&offset=${offset}`, { headers: authHeaders() });
            const result = await response.json();
            
            if (result && result.code === 200 && result.data) {
                return {
                    records: result.data.records || [],
                    total: result.data.total || 0
                };
            }
            return { records: [], total: 0 };
        } catch (err) {
            return { records: [], total: 0 };
        }
    }

    // 设置历史记录弹窗滚动监听
    function setupHistoryModalScrollListener() {
        const historyBody = document.querySelector('.history-body');
        if (!historyBody) return;

        // 移除旧的监听器（如果有）
        historyBody.removeEventListener('scroll', handleHistoryModalScroll);
        historyBody.addEventListener('scroll', handleHistoryModalScroll);
    }

    let historyModalScrollTimeout;
    let historyModalIsLoading = false;
    async function handleHistoryModalScroll() {
        if (historyModalAllLoaded || historyModalIsLoading) return;
        
        if (historyModalScrollTimeout) clearTimeout(historyModalScrollTimeout);
        historyModalScrollTimeout = setTimeout(async () => {
            const historyBody = document.querySelector('.history-body');
            if (!historyBody) return;
            
            const scrollTop = historyBody.scrollTop;
            const scrollHeight = historyBody.scrollHeight;
            const clientHeight = historyBody.clientHeight;
            
            // 当滚动到底部 80% 时加载更多
            if (scrollTop + clientHeight >= scrollHeight * 0.8) {
                historyModalIsLoading = true;
                await loadHistoryModalPage(historyModalCurrentPage + 1);
                historyModalIsLoading = false;
            }
        }, 100);
    }

    // HTML转义函数
    // URL协议白名单校验：仅允许 http/https/data:image，防止 javascript: 等危险协议注入
    function safeImageUrl(url) {
        if (typeof url !== 'string' || !url) return '';
        const trimmed = url.trim().toLowerCase();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return url;
        if (trimmed.startsWith('data:image/')) return url;
        if (trimmed.startsWith('blob:')) return url;
        if (trimmed.startsWith('/')) return url;
        return ''; // 其他协议一律拒绝
    }
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 收藏记录缓存
    let favoritesRecordsCache = [];

    // 渲染收藏列表
    async function renderFavoritesList() {
        // 从后端获取收藏记录
        const records = await getFavoriteRecordsFromBackend();
        favoritesRecordsCache = records;
        
        favoritesCount.textContent = `(${records.length})`;
        
        if (records.length === 0) {
            favoritesList.innerHTML = `<div class="history-empty">${t('noFavorites')}</div>`;
            return;
        }
        
        // 按收藏时间排序（最新的在前面）
        const sortedRecords = [...records].sort((a, b) => {
            const timeA = a.favoritedAt ? new Date(a.favoritedAt).getTime() : 0;
            const timeB = b.favoritedAt ? new Date(b.favoritedAt).getTime() : 0;
            return timeB - timeA;
        });
        
        // 清空列表
        favoritesList.innerHTML = '';
        
        // 渲染所有收藏记录
        const html = sortedRecords.map(record => {
            const date = new Date(record.favoritedAt || record.createdAt);
            const dateStr = date.toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // 获取图片URL - 历史记录只保存imageUrl（完整图），预览图通过路径替换生成
            let imageUrl = '';
            const originalUrl = record.imageUrl || record.originalUrl || (record.params && record.params.imageUrl);
            if (originalUrl) {
                // 生成预览图URL：将路径中的 /original/ 替换为 /preview/
                imageUrl = originalUrl.replace('/original/', '/preview/');
            }
            
            // 获取提示词
            const prompt = record.prompt || record.params?.prompt || t('noPrompt');
            const model = record.model || record.params?.model || t('unknownModel');
            
            return `
                <div class="history-item favorite-item" data-task-id="${record.taskId}">
                    <div class="history-item-image">
                        <img src="${imageUrl}" alt="收藏图片" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text fill=%22%23999%22 x=%2250%22 y=%2250%22 text-anchor=%22middle%22>加载失败</text></svg>'">
                        <div class="history-item-overlay">
                            <button class="history-item-btn use-btn" data-i18n="use" data-i18n-title="usePrompt" title="使用提示词" onclick="event.stopPropagation();">使用</button>
                            <button class="history-item-btn unfavorite-btn" data-i18n-title="unfavorite" title="取消收藏" onclick="event.stopPropagation();">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFD700" stroke="#FFD700" stroke-width="2">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="history-item-info">
                        <div class="history-item-prompt" title="${escapeHtml(prompt)}">${escapeHtml(prompt.substring(0, 50))}${prompt.length > 50 ? '...' : ''}</div>
                        <div class="history-item-meta">
                            <span class="history-item-model">${model}</span>
                            <span class="history-item-date">${dateStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        favoritesList.innerHTML = html;
        
        // 绑定事件
        bindFavoritesItemEvents();
    }

    // 绑定收藏列表项事件
    function bindFavoritesItemEvents() {
        const items = favoritesList.querySelectorAll('.favorite-item');
        items.forEach(item => {
            const taskId = item.dataset.taskId;
            const useBtn = item.querySelector('.use-btn');
            const unfavoriteBtn = item.querySelector('.unfavorite-btn');
            const img = item.querySelector('img');
            
            // 使用提示词
            if (useBtn) {
                useBtn.onclick = (e) => {
                    e.stopPropagation();
                    const record = favoritesRecordsCache.find(r => r.taskId === taskId);
                    if (record) {
                        const prompt = record.prompt || record.params?.prompt || '';
                        const model = record.model || record.params?.model || '';
                        const aspectRatio = record.aspectRatio || record.params?.aspectRatio || '';
                        const imageSize = record.imageSize || record.params?.imageSize || '';
                        
                        // 设置模型（标签统一家族总名字，子版本名不上标题）
                        const favModel = MODEL_DISPLAY_NAME[model] || model;
                        if (favModel && modelConfigMap[favModel]) {
                            currentModel = favModel;
                            if (favModel === 'Nano Banana 2.0' || favModel === 'Nano Banana 2.0 快速' || favModel === 'Nano Banana 2.1') {
                                modelLabel.textContent = 'Nano Banana 2';
                            } else if (favModel.startsWith('GPT Image 2.5')) {
                                modelLabel.textContent = 'GPT Image 2.5';
                            } else if (favModel.startsWith('GPT Image 2 ')) {
                                modelLabel.textContent = 'GPT Image 2';
                            } else {
                                modelLabel.textContent = modelConfigMap[favModel].name;
                            }
                        }

                        // 设置比例
                        if (aspectRatio) {
                            currentAspect = aspectRatio;
                            comboLabel.textContent = aspectRatio === 'auto' ? t('auto') : aspectRatio;
                        }

                        // 设置分辨率
                        if (imageSize) {
                            currentRes = imageSize;
                        }

                        // 同步到 PromptBar（生成时从 PromptBar.getGenerationParams() 取参数）
                        if (typeof PromptBar !== 'undefined') {
                            PromptBar.currentModel = currentModel;
                            PromptBar.currentAspect = currentAspect;
                            PromptBar.currentRes = currentRes;
                            document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.dataset.value === currentModel));
                            document.querySelectorAll('.combo-option[data-type="size"]').forEach(o => o.classList.toggle('selected', o.dataset.value === currentRes));
                            document.querySelectorAll('.ratio-option').forEach(o => o.classList.toggle('selected', o.dataset.value === currentAspect));
                            if (typeof PromptBar._updateModelLabel === 'function') PromptBar._updateModelLabel();
                            if (typeof PromptBar.updateResolutionOptions === 'function') PromptBar.updateResolutionOptions(currentModel);
                            if (typeof PromptBar.updatePriceDisplay === 'function') PromptBar.updatePriceDisplay();
                        }

                        // 加载参考图：兼容 referenceImages（后端新字段）和 imageUrls（前端旧字段）
                        const referenceImages = record.referenceImages || record.imageUrls || [];

                        // 清空现有参考图（保持与 PromptBar.uploadedImages 引用同步）
                        if (typeof PromptBar !== 'undefined' && PromptBar.uploadedImages) {
                            PromptBar.uploadedImages.fill(null);
                            uploadedImages = PromptBar.uploadedImages;
                        } else {
                            uploadedImages = new Array(8).fill(null);
                        }
                        window.uploadedImages = uploadedImages;
                        document.querySelectorAll('.ref-slot-mini').forEach(el => el.remove());

                        if (referenceImages.length > 0) {
                            // 加载参考图
                            referenceImages.forEach((urlData, index) => {
                                if (index >= 8) return;

                                // 处理多种格式：{highUrl,previewUrl} / {imageUrl} / 字符串
                                let highUrl, previewUrl;
                                if (typeof urlData === 'object') {
                                    highUrl = urlData.highUrl || urlData.imageUrl || urlData.url || '';
                                    previewUrl = urlData.previewUrl || highUrl;
                                } else {
                                    highUrl = urlData;
                                    previewUrl = urlData;
                                }
                                if (!highUrl) return;

                                uploadedImages[index] = {
                                    highUrl: highUrl,
                                    previewUrl: previewUrl,
                                    isUploaded: true,
                                    isFromEdit: true,
                                    fileId: 'fav_' + index + '_' + highUrl   // 稳定 fileId，供 updateImageTags 追踪
                                };
                            });
                        }
                        // 更新参考图显示（无论是否有参考图都要调用，以更新 refsStrip 的 hidden 状态）
                        window.renderRefs();

                        // 填充提示词（必须在参考图加载之后，createImageTagElement 才能取到 fileId）
                        setPromptText(prompt);

                        favoritesModal.classList.add('hidden');
                    }
                };
            }
            
            // 取消收藏
            if (unfavoriteBtn) {
                unfavoriteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        await removeTaskFavorite(taskId);
                        
                        // 同步更新主页面上的任务卡片收藏状态
                        const mainCard = document.getElementById(`task-${taskId}`);
                        if (mainCard) {
                            const mainFavoriteBtn = mainCard.querySelector('.favorite-btn');
                            const mainFavoriteStar = mainCard.querySelector('.favorite-star');
                            if (mainFavoriteBtn) {
                                mainFavoriteBtn.classList.remove('favorited');
                            }
                            if (mainFavoriteStar) {
                                mainFavoriteStar.classList.add('hidden');
                            }
                        }
                        
                        // 立即从DOM中移除
                        item.style.opacity = '0';
                        item.style.transform = 'scale(0.8)';
                        item.style.transition = 'all 0.2s ease';
                        setTimeout(() => {
                            item.remove();
                            // 更新计数
                            const remainingItems = favoritesList.querySelectorAll('.favorite-item');
                            favoritesCount.textContent = `(${remainingItems.length})`;
                            
                            if (remainingItems.length === 0) {
                                favoritesList.innerHTML = `<div class="history-empty">${t('noFavorites')}</div>`;
                            }
                        }, 200);
                    } catch (err) {
                    }
                };
            }
            
            // 点击图片查看大图（优先使用原图）
            if (img) {
                img.onclick = () => {
                    const record = favoritesRecordsCache.find(r => r.taskId === taskId);
                    if (record) {
                        // 历史记录只保存imageUrl（完整图），直接使用
                        const imageUrl = record.imageUrl || record.originalUrl || record.params?.imageUrl;
                        if (imageUrl && typeof openFullscreenViewer === 'function') {
                            openFullscreenViewer(imageUrl, taskId);
                        }
                    }
                };
            }
        });
    }

    // ===== 全屏图片查看 =====
    const fullscreenViewer = document.getElementById('fullscreenViewer');
    const viewerImage = fullscreenViewer?.querySelector('.viewer-image');
    const viewerClose = fullscreenViewer?.querySelector('.viewer-close');
    
    // 存储创建的悬停预览元素
    let hoverPreviews = [];

    window.openFullscreenViewer = function(url, taskId = null, mjGridIndex = null) {
        if (viewerImage && fullscreenViewer) {
            // 清理之前创建的悬停预览元素，防止内存泄漏
            hoverPreviews.forEach(preview => {
                if (preview && preview.parentNode) {
                    preview.parentNode.removeChild(preview);
                }
            });
            hoverPreviews = [];

            // 检查是否为 MJ 任务（四宫格或单图）
            let isMjGrid = false;
            let isMjSingle = false;
            let mjGridData = null;
            if (taskId) {
                const card = document.getElementById(`task-${taskId}`);
                if (card) {
                    // 检查是否为 MJ 四宫格
                    isMjGrid = card.dataset.mjStatus === 'grid';
                    // 检查是否为 MJ 单图（拆分/高清后的单图）
                    isMjSingle = card.dataset.mjStatus === 'single';

                    if (isMjGrid) {
                        mjGridData = {
                            taskId: taskId,
                            gridUrl: url,
                            currentIndex: mjGridIndex || 0
                        };
                    }
                }
            }

            // 如果是 MJ 四宫格且指定了索引，显示对应的单图区域
            if (isMjGrid && mjGridIndex) {
                showMjGridSingle(mjGridData, mjGridIndex);
            } else {
                viewerImage.src = url;
            }

            fullscreenViewer.classList.remove('hidden');

            // 显示参数信息
            const paramsPanel = fullscreenViewer.querySelector('.viewer-params');
            if (taskId && paramsPanel) {
                const card = document.getElementById(`task-${taskId}`);
                if (card) {
                    // 统一使用脱敏组名展示（如 Nano Banana 2.1 / GPT Image 2.5 快速 Pro）
                    document.getElementById('viewerModel').textContent = getMaskedModelName(card.dataset.model);
                    
                    // 判断是否为 MJ 模型（兼容真实 id 与脱敏展示名）
                    const isMjModel = isMjModelSafe(card.dataset.model);
                    
                    // 获取标签元素
                    const aspectLabel = document.getElementById('viewerAspectLabel');
                    const sizeLabel = document.getElementById('viewerSizeLabel');
                    
                    if (isMjModel) {
                        // MJ 模型显示画质
                        const qualityLabels = {
                            '0.5': '标清 (0.5)',
                            '1': '高清 (1)',
                            '2': '超清 (2)',
                            '4': '实验 (4)'
                        };
                        const quality = card.dataset.imageSize || '1';
                        // 隐藏比例行，修改分辨率标签为画质
                        if (aspectLabel) aspectLabel.parentElement.style.display = 'none';
                        if (sizeLabel) sizeLabel.textContent = '画质:';
                        document.getElementById('viewerAspect').textContent = '';
                        document.getElementById('viewerSize').textContent = qualityLabels[quality] || quality;
                    } else {
                        // 普通模型显示比例和分辨率
                        if (aspectLabel) {
                            aspectLabel.parentElement.style.display = 'flex';
                            aspectLabel.textContent = t('viewerAspectLabel');
                        }
                        if (sizeLabel) sizeLabel.textContent = t('viewerSizeLabel');
                        document.getElementById('viewerAspect').textContent = card.dataset.aspectRatio || '-';
                        document.getElementById('viewerSize').textContent = card.dataset.imageSize || '-';
                    }
                    document.getElementById('viewerPrompt').textContent = card.dataset.prompt || '-';

                    const imageUrls = JSON.parse(card.dataset.imageUrls || '[]');
                    const refCountText = imageUrls.length > 0
                        ? `${imageUrls.length}${t('viewerRefCount')}`
                        : t('viewerNoRef');
                    document.getElementById('viewerRefCount').textContent = refCountText;

                    // 显示参考图小图
                    const refImagesContainer = document.getElementById('viewerRefImagesContainer');
                    if (refImagesContainer) {
                        refImagesContainer.innerHTML = '';

                        // 辅助函数：将 original 路径转换为 preview 路径
                        function getViewerPreviewUrl(url) {
                            if (!url || typeof url !== 'string') return url;
                            // 如果 URL 包含 /original/，替换为 /preview/
                            if (url.includes('/original/')) {
                                return url.replace('/original/', '/preview/');
                            }
                            return url;
                        }

                        imageUrls.forEach((urlData, index) => {
                            // 处理新旧格式：新格式是 {highUrl, previewUrl}，旧格式是字符串URL
                            let previewUrl, highUrl;
                            if (typeof urlData === 'object' && urlData.previewUrl) {
                                previewUrl = urlData.previewUrl;
                                highUrl = urlData.highUrl || urlData.previewUrl;
                            } else if (typeof urlData === 'object' && urlData.highUrl) {
                                highUrl = urlData.highUrl;
                                // 如果没有 previewUrl，从 highUrl 生成
                                previewUrl = getViewerPreviewUrl(highUrl);
                            } else {
                                highUrl = urlData;
                                // 从 highUrl 生成 previewUrl
                                previewUrl = getViewerPreviewUrl(urlData);
                            }

                            const refImageItem = document.createElement('div');
                            refImageItem.className = 'ref-image-item';

                            const img = document.createElement('img');
                            img.src = previewUrl;  // 使用小预览图
                            img.alt = `Reference Image ${index + 1}`;

                            refImageItem.appendChild(img);
                            refImagesContainer.appendChild(refImageItem);

                            // 创建独立的悬停预览元素（使用原图，不是预览图）
                            const hoverPreview = document.createElement('div');
                            hoverPreview.className = 'hover-preview';
                            hoverPreview.style.backgroundImage = `url('${highUrl}')`;
                            document.body.appendChild(hoverPreview);

                            // 添加到悬停预览元素数组
                            hoverPreviews.push(hoverPreview);

                            // 添加鼠标事件
                            refImageItem.addEventListener('mousemove', (e) => {
                                hoverPreview.style.top = `${e.clientY + 10}px`;
                                hoverPreview.style.left = `${e.clientX + 10}px`;
                            });

                            refImageItem.addEventListener('mouseenter', () => {
                                hoverPreview.style.opacity = '1';
                                hoverPreview.style.visibility = 'visible';
                            });

                            refImageItem.addEventListener('mouseleave', () => {
                                hoverPreview.style.opacity = '0';
                                hoverPreview.style.visibility = 'hidden';
                            });
                        });
                    }

                    // 如果是 MJ 四宫格，添加四宫格切换控件
                    if (isMjGrid) {
                        addMjGridControls(card, url, taskId);
                    } else if (isMjSingle) {
                        // 如果是 MJ 单图，添加高清放大和微调变化按钮
                        addMjSingleControls(card, url, taskId);
                    } else {
                        removeMjGridControls();
                    }

                    paramsPanel.classList.remove('hidden');
                }
            } else if (paramsPanel) {
                // 清空参考图容器
                const refImagesContainer = document.getElementById('viewerRefImagesContainer');
                if (refImagesContainer) {
                    refImagesContainer.innerHTML = '';
                }
                removeMjGridControls();
                paramsPanel.classList.add('hidden');
            }
        }
    };

    // 显示 MJ 四宫格中的单图
    function showMjGridSingle(mjGridData, index) {
        // 使用 clip-path 或 object-position 来显示四宫格的特定区域
        const positions = [
            '0% 0%',      // 左上
            '100% 0%',    // 右上
            '0% 100%',    // 左下
            '100% 100%'   // 右下
        ];

        viewerImage.style.objectPosition = positions[index - 1];
        viewerImage.style.objectFit = 'cover';
        viewerImage.style.width = '200%';
        viewerImage.style.height = '200%';
        viewerImage.src = mjGridData.gridUrl;
    }

    // 添加 MJ 四宫格控件（在图片上显示 U/V 按钮）
    function addMjGridControls(card, url, taskId) {
        removeMjGridControls();

        const viewerContent = fullscreenViewer.querySelector('.viewer-content');
        if (!viewerContent) return;

        // 创建一个包装器来包裹图片和覆盖层
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'mj-image-wrapper';

        // 将图片移动到包装器中
        if (viewerImage && viewerImage.parentNode === viewerContent) {
            viewerContent.insertBefore(imageWrapper, viewerImage);
            imageWrapper.appendChild(viewerImage);
        }

        // 创建四宫格操作覆盖层
        const gridOverlay = document.createElement('div');
        gridOverlay.className = 'mj-viewer-grid-overlay';
        gridOverlay.innerHTML = `
            <div class="mj-viewer-cell" data-index="1">
                <button class="mj-viewer-action-btn mj-upscale-btn" data-action="separate" data-index="1" title="拆分 U1">U1</button>
                <button class="mj-viewer-action-btn mj-variation-btn" data-action="variation" data-index="1" title="微调 V1">V1</button>
            </div>
            <div class="mj-viewer-cell" data-index="2">
                <button class="mj-viewer-action-btn mj-upscale-btn" data-action="separate" data-index="2" title="拆分 U2">U2</button>
                <button class="mj-viewer-action-btn mj-variation-btn" data-action="variation" data-index="2" title="微调 V2">V2</button>
            </div>
            <div class="mj-viewer-cell" data-index="3">
                <button class="mj-viewer-action-btn mj-upscale-btn" data-action="separate" data-index="3" title="拆分 U3">U3</button>
                <button class="mj-viewer-action-btn mj-variation-btn" data-action="variation" data-index="3" title="微调 V3">V3</button>
            </div>
            <div class="mj-viewer-cell" data-index="4">
                <button class="mj-viewer-action-btn mj-upscale-btn" data-action="separate" data-index="4" title="拆分 U4">U4</button>
                <button class="mj-viewer-action-btn mj-variation-btn" data-action="variation" data-index="4" title="微调 V4">V4</button>
            </div>
        `;

        imageWrapper.appendChild(gridOverlay);

        // 阻止覆盖层点击事件冒泡（防止关闭大图查看器）
        gridOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 绑定 U/V 按钮事件
        gridOverlay.querySelectorAll('.mj-viewer-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const index = parseInt(btn.dataset.index);

                // 获取 MJ 任务 ID（优先使用 card.dataset.mjTaskId，否则使用 taskId）
                const mjTaskId = card.dataset.mjTaskId || taskId;

                try {
                    const response = await fetch(`${getBackendUrl()}/api/midjourney/${action}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            id: mjTaskId,
                            index: index
                        })
                    });

                    const data = await response.json();
                    if (data.status === 'Success' && data.data?.id) {
                        // 关闭大图查看器
                        fullscreenViewer.classList.add('hidden');
                        removeMjGridControls();

                        // 创建后端任务来跟踪 MJ 任务
                        const newParams = {
                            baseUrl: getCurrentApiBaseUrl(),
                            prompt: card.dataset.prompt || '',
                            model: card.dataset.model || '',
                            aspectRatio: card.dataset.aspectRatio || '',
                            imageSize: card.dataset.imageSize || '',
                            imageUrls: [],
                            api: 'midjourney',
                            mjParentTask: taskId,
                            mjAction: action,
                            mjIndex: index,
                            mjTaskId: data.data.id  // 保存 MJ 任务 ID
                        };

                        // 使用 TaskClient 创建后端任务
                        if (typeof TaskClient !== 'undefined') {
                            try {
                                const task = await TaskClient.createTask(newParams);
                                createTaskCard(task.id, newParams.prompt, newParams, true);
                            } catch (error) {
                                // 降级：直接创建前端任务卡片（无轮询）
                                createTaskCard(data.data.id, newParams.prompt, newParams, true);
                            }
                        } else {
                            // 降级：直接创建前端任务卡片（无轮询）
                            createTaskCard(data.data.id, newParams.prompt, newParams, true);
                        }
                    } else {
                        alert(`操作失败: ${data.message || '未知错误'}`);
                    }
                } catch (err) {
                    alert('操作失败: ' + err.message);
                }
            });
        });

        // 绑定单元格点击事件（查看单图）
        gridOverlay.querySelectorAll('.mj-viewer-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                // 阻止事件冒泡，防止关闭大图查看器
                e.stopPropagation();
                // 如果点击的是按钮，不执行查看操作
                if (e.target.classList.contains('mj-viewer-action-btn')) return;

                const index = parseInt(cell.dataset.index);
                showMjGridSingle({ gridUrl: url }, index);

                // 高亮当前选中的单元格
                gridOverlay.querySelectorAll('.mj-viewer-cell').forEach(c => c.classList.remove('active'));
                cell.classList.add('active');
            });
        });
    }

    // 移除 MJ 四宫格控件
    function removeMjGridControls() {
        const existingOverlay = fullscreenViewer.querySelector('.mj-viewer-grid-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        // 恢复图片到原来的位置（从包装器中移出）
        const imageWrapper = fullscreenViewer.querySelector('.mj-image-wrapper');
        if (imageWrapper && viewerImage) {
            const viewerContent = fullscreenViewer.querySelector('.viewer-content');
            if (viewerContent) {
                viewerContent.insertBefore(viewerImage, imageWrapper);
            }
            imageWrapper.remove();
        }

        // 重置图片样式
        if (viewerImage) {
            viewerImage.style.objectPosition = 'center';
            viewerImage.style.objectFit = 'contain';
            viewerImage.style.width = '';
            viewerImage.style.height = '';
        }

        // 移除单图控制按钮
        const existingSingleControls = fullscreenViewer.querySelector('.mj-single-controls');
        if (existingSingleControls) {
            existingSingleControls.remove();
        }
    }

    // 添加 MJ 单图控制按钮（高清放大、微调变化）
    function addMjSingleControls(card, url, taskId) {
        removeMjGridControls(); // 先清除可能存在的四宫格控件

        // 获取参数面板
        const paramsPanel = fullscreenViewer.querySelector('.viewer-params');
        if (!paramsPanel) return;

        // 判断是否为高清放大后的图（upscale 操作）
        const isUpscaled = card.dataset.mjAction === 'upscale';

        // 创建控制按钮容器
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'mj-single-controls';

        // 如果是高清放大后的图，只显示微调按钮
        if (isUpscaled) {
            controlsContainer.innerHTML = `
                <div class="mj-controls-row">
                    <button class="mj-single-action-btn mj-vary-strong-btn" data-action="vary" data-type="strong" title="整体微调 - 强烈变化">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        <span>整体微调</span>
                    </button>
                    <button class="mj-single-action-btn mj-vary-subtle-btn" data-action="vary" data-type="subtle" title="细节微调 - 轻微变化">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                        </svg>
                        <span>细节微调</span>
                    </button>
                </div>
            `;
        } else {
            // 普通单图显示全部四个按钮，分两行
            controlsContainer.innerHTML = `
                <div class="mj-controls-row">
                    <button class="mj-single-action-btn mj-upscale-subtle-btn" data-action="upscale" data-type="subtle" title="原图高清 - 保留原图细节">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                            <line x1="21" y1="3" x2="14" y2="10"></line>
                            <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                        <span>原图高清</span>
                    </button>
                    <button class="mj-single-action-btn mj-upscale-creative-btn" data-action="upscale" data-type="creative" title="细节高清 - 添加新细节">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                        </svg>
                        <span>细节高清</span>
                    </button>
                </div>
                <div class="mj-controls-row">
                    <button class="mj-single-action-btn mj-vary-strong-btn" data-action="vary" data-type="strong" title="整体微调 - 强烈变化">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        <span>整体微调</span>
                    </button>
                    <button class="mj-single-action-btn mj-vary-subtle-btn" data-action="vary" data-type="subtle" title="细节微调 - 轻微变化">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                        </svg>
                        <span>细节微调</span>
                    </button>
                </div>
            `;
        }

        // 将按钮添加到参数面板的最上方
        paramsPanel.insertBefore(controlsContainer, paramsPanel.firstChild);

        // 绑定按钮事件
        controlsContainer.querySelectorAll('.mj-single-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const type = btn.dataset.type;
                const actionName = btn.querySelector('span').textContent;

                try {
                    // 获取 MJ 任务 ID
                    const mjTaskId = card.dataset.mjTaskId || taskId;

                    const requestBody = {
                        id: mjTaskId,
                        type: type // 使用按钮指定的类型
                    };

                    const response = await fetch(`${getBackendUrl()}/api/midjourney/${action}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    const data = await response.json();
                    if (data.status === 'Success' && data.data?.id) {
                        // 关闭大图查看器
                        fullscreenViewer.classList.add('hidden');
                        removeMjGridControls();

                        // 创建后端任务来跟踪 MJ 任务
                        const newParams = {
                            baseUrl: getCurrentApiBaseUrl(),
                            prompt: card.dataset.prompt || '',
                            model: card.dataset.model || '',
                            aspectRatio: card.dataset.aspectRatio || '',
                            imageSize: card.dataset.imageSize || '',
                            imageUrls: [],
                            api: 'midjourney',
                            mjParentTask: taskId,
                            mjAction: action,
                            mjTaskId: data.data.id  // 保存 MJ 任务 ID
                        };

                        // 使用 TaskClient 创建后端任务
                        if (typeof TaskClient !== 'undefined') {
                            try {
                                const task = await TaskClient.createTask(newParams);
                                createTaskCard(task.id, newParams.prompt, newParams, true);
                            } catch (error) {
                                createTaskCard(data.data.id, newParams.prompt, newParams, true);
                            }
                        } else {
                            createTaskCard(data.data.id, newParams.prompt, newParams, true);
                        }
                    } else {
                        alert(`操作失败: ${data.message || '未知错误'}`);
                    }
                } catch (err) {
                    alert('操作失败: ' + err.message);
                }
            });
        });
    }

    // 复制提示词按钮事件
    const copyPromptBtn = document.getElementById('copyPromptBtn');
    if (copyPromptBtn) {
        copyPromptBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const promptText = document.getElementById('viewerPrompt')?.textContent;
            if (promptText && promptText !== '-') {
                try {
                    // 尝试使用现代 Clipboard API
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(promptText);
                    } else {
                        // 降级方案：使用 textarea 复制
                        const textarea = document.createElement('textarea');
                        textarea.value = promptText;
                        textarea.style.position = 'fixed';
                        textarea.style.left = '-9999px';
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                    }
                    
                    // 临时改变按钮文字显示复制成功
                    const originalHTML = copyPromptBtn.innerHTML;
                    copyPromptBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span>' + t('copied') + '</span>';
                    copyPromptBtn.style.background = 'rgba(0, 255, 0, 0.2)';
                    copyPromptBtn.style.borderColor = 'rgba(0, 255, 0, 0.5)';
                    setTimeout(() => {
                        copyPromptBtn.innerHTML = originalHTML;
                        copyPromptBtn.style.background = 'rgba(196, 241, 123, 0.1)';
                        copyPromptBtn.style.borderColor = 'rgba(196, 241, 123, 0.3)';
                    }, 80);
                    
                    // 复制成功后关闭大图
                    setTimeout(() => {
                        fullscreenViewer.classList.add('hidden');
                    }, 50);
                } catch (err) {
                    alert(t('copyFailed'));
                }
            }
        });
    }

    // 关闭全屏查看
    if (viewerClose) {
        viewerClose.addEventListener('click', (e) => {
            e.stopPropagation();
            fullscreenViewer.classList.add('hidden');
            // 清理悬停预览元素
            hoverPreviews.forEach(preview => {
                if (preview && preview.parentNode) {
                    preview.parentNode.removeChild(preview);
                }
            });
            hoverPreviews = [];
        });
    }

    if (fullscreenViewer) {
        fullscreenViewer.addEventListener('click', () => {
            fullscreenViewer.classList.add('hidden');
            // 清理悬停预览元素
            hoverPreviews.forEach(preview => {
                if (preview && preview.parentNode) {
                    preview.parentNode.removeChild(preview);
                }
            });
            hoverPreviews = [];
        });
    }
    
    // 暴露函数给 image-editor.js 使用
    // 当 PromptBar 已加载时，renderRefs 委托给 PromptBar.renderRefs()，确保参考图槽位的事件处理逻辑（拖拽排序、点击编辑等）由统一模块管理。
    window.renderRefs = function() {
        if (typeof PromptBar !== 'undefined' && PromptBar._inited) {
            // 同步当前模型：PromptBar.renderRefs 的 maxSlots（MJ 限 3 张）依赖它，各路径改模型后未必同步
            PromptBar.currentModel = currentModel;
            PromptBar.renderRefs();
        } else {
            renderRefs();
        }
    };
});

