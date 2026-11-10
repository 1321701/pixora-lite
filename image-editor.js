    // --- Image Editor ---
    const imageEditorModal = document.getElementById('imageEditorModal');
    const editorCanvas = document.getElementById('editorCanvas');
    const brushCanvas = document.getElementById('brushCanvas');
    const closeEditorBtn = document.getElementById('closeEditorBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    // 顶部工具辅助区域控件
    const moveToolOptions = document.getElementById('moveToolOptions');
    const brushToolOptions = document.getElementById('brushToolOptions');
    const textToolOptions = document.getElementById('textToolOptions');
    const cropToolOptions = document.getElementById('cropToolOptions');
    const resetViewBtn = document.getElementById('resetViewBtn');
    const colorPicker = document.getElementById('colorPicker');
    const brushSize = document.getElementById('brushSize');
    const brushSizeLabel = document.getElementById('brushSizeLabel');
    const brushModeButtons = document.querySelectorAll('.brush-mode-btn');
    const cropOverlay = document.getElementById('cropOverlay');
    const cropBox = document.getElementById('cropBox');
    const visualCanvasOverlay = document.getElementById('visualCanvasOverlay');
    const textAreaLayer = document.getElementById('textAreaLayer');
    const textSidebar = document.getElementById('textSidebar');
    const textInput = document.getElementById('textInput');
    const textSize = document.getElementById('textSize');
    const textSizeLabel = document.getElementById('textSizeLabel');
    const cropRatioButtons = document.querySelectorAll('.crop-ratio-btn');
    const textColorPresetButtons = document.querySelectorAll('.text-color-preset-btn');
    const textSubButtons = document.querySelectorAll('.text-sub-btn, .text-sub-tool');
    const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');

    let currentTool = 'select';
    let currentTextSubTool = 'text'; // text, arrow
    let currentTextColor = '#ffffff'; // 当前文字/形状颜色
    let ctx = null;
    // 使用 window 对象共享变量，确保 script.js 和 image-editor.js 使用同一变量
    window.brushCtx = window.brushCtx || null;
    window.originalImage = window.originalImage || null;
    window.isImageLoaded = window.isImageLoaded || false; // 图片是否加载完成
    let brushCtx = window.brushCtx;
    let originalImage = window.originalImage;
    let isImageLoaded = window.isImageLoaded;
    let currentImageIndex = null;
    let isDrawing = false;
    let brushLeftCanvas = false; // 画笔工具：标记是否离开了画布
    let lastX = 0;
    let lastY = 0;
    let scale = 1;
    let textAreaScale = 1; // Scale factor for text/shape elements
    let baseScale = 1; // Base scale for fitting image to editor (used for min/max limits)
    let offsetX = 0;
    let offsetY = 0;
    let wheelAccumulator = 0; // Accumulator for wheel delta to improve zoom sensitivity
    let wheelAnimationFrame = null; // Animation frame for smooth wheel zoom
    let initialScale = 1; // Initial scale when image is first loaded
    let initialOffsetX = 0; // Initial offsetX when image is first loaded
    let initialOffsetY = 0; // Initial offsetY when image is first loaded
    // Text area dimensions: fixed base size 1000x1000, short side adjusted by image ratio
    let textAreaWidth = 1000; // Base width for text area
    let textAreaHeight = 1000; // Base height for text area
    
    // Initialize textAreaScale based on initial scale
    textAreaScale = scale * (editorCanvas.width / textAreaWidth);
    let imageToTextRatio = 1; // Ratio to convert image coordinates to text area coordinates
    let isDragging = false;
    let isContainerDrag = false; // Track if drag started from container
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartOffsetX = 0;
    let dragStartOffsetY = 0;
    let textElements = [];
    let currentTextElement = null;
    let isDraggingText = false;
    let textDragStartX = 0;
    let textDragStartY = 0;
    let textDragOffsetX = 0;
    let textDragOffsetY = 0;
    let selectedTextElement = null;
    let draggingTextBoxElement = null; // 保存正在拖动的文字框DOM引用
    let dragEndTime = 0; // 拖动结束时间，用于安全延迟
    const DRAG_END_SAFE_DELAY = 300; // 拖动结束后 0.3秒内禁止选中文字
    // 箭头和方框绘制相关变量
    // 使用 window 对象共享变量，确保 script.js 和 image-editor.js 使用同一变量
    window.isDrawingShape = window.isDrawingShape || false;
    window.shapeStartX = window.shapeStartX || 0;
    window.shapeStartY = window.shapeStartY || 0;
    window.tempShapeCanvas = window.tempShapeCanvas || null;
    window.currentTempShape = window.currentTempShape || null;
    window.shapeElements = window.shapeElements || [];
    window.shapeBaseStrokeWidth = window.shapeBaseStrokeWidth || 3;
    window.shapeBaseArrowLength = window.shapeBaseArrowLength || 15;
    let isDrawingShape = window.isDrawingShape;
    let shapeStartX = window.shapeStartX;
    let shapeStartY = window.shapeStartY;
    let tempShapeCanvas = window.tempShapeCanvas; // 临时画布用于实时显示绘制中的形状
    let currentTempShape = window.currentTempShape; // 当前正在绘制的临时形状
    let shapeElements = window.shapeElements; // 存储已绘制的箭头和方框
    let shapeBaseStrokeWidth = window.shapeBaseStrokeWidth;   // 线条基准粗细
    let shapeBaseArrowLength = window.shapeBaseArrowLength;  // 箭头头长度基准
    // Hidden textarea used to precisely measure text box size
    let textMeasureElement = null;
    let cropStartX = 0;
    let cropStartY = 0;
    let cropEndX = 0;
    let cropEndY = 0;
    let isCropping = false;
    // 裁切比例模式: 'free' | '1:1' | '4:3' | '3:4' | '9:16' | '16:9'
    let cropAspectMode = 'free';
    // 记住"固定比例模式"下的基准裁切框尺寸，用于避免频繁切换比例时裁切框越来越小
    let cropAspectBaseWidth = null;
    let cropAspectBaseHeight = null;
    const CROP_BOX_MARGIN = 4; // 裁切框相对于视觉区域的内边距（像素）（不含四个小方块手柄）
    const CROP_BOX_HANDLE_SAFE = 8; // 角上小方块手柄向外伸出的安全预留（像素），需与CSS ".crop-box::before/::after 保持一致
    let brushStrokes = [];
    // 画笔当前模式: 'brush' | 'eraser'
    let brushMode = 'brush';
    let history = [];
    let historyIndex = -1;
    const MAX_HISTORY = 50;
    // 图片编辑器键盘快捷键处理函数（用于 Ctrl+Z / Ctrl+Y / 工具切换等）
    let editorKeydownHandler = null;
    let lastEscTime = 0;

    // --- 辅助函数 ---
    function removeElement(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function removeElementsBySelector(selectors, parent = document) {
        if (!Array.isArray(selectors)) {
            selectors = [selectors];
        }
        selectors.forEach(selector => {
            parent.querySelectorAll(selector).forEach(removeElement);
        });
    }

    function textAreaToScreen(x, y) {
        return {
            x: offsetX + x * textAreaScale,
            y: offsetY + y * textAreaScale
        };
    }

    function setAttributes(el, attrs) {
        Object.entries(attrs).forEach(([key, value]) => {
            el.setAttribute(key, value);
        });
    }

    // 更新视觉画布蓝色虚线区域：始终框住整个「黑色画布区域」(.editor-canvas-container)
    function getCropContainer() {
        // 统一裁切相关计算使用的容器，保证与蓝色虚线区域一致
        const container = document.querySelector('.editor-canvas-container');
        return container || (editorCanvas ? editorCanvas.parentElement : null);
    }

    // 更新视觉画布蓝色虚线区域：始终框住整个「黑色画布区域」(.editor-canvas-container)
    function updateVisualCanvasOverlay() {
        if (!visualCanvasOverlay) return;
        const container = getCropContainer();
        if (!container) return;

        // 视觉区域 = 整个黑色背景区域，因此直接覆盖容器本身
        visualCanvasOverlay.style.left = '0px';
        visualCanvasOverlay.style.top = '0px';
        visualCanvasOverlay.style.width = container.clientWidth + 'px';
        visualCanvasOverlay.style.height = container.clientHeight + 'px';
    }


    brushSize.addEventListener('input', (e) => {
        brushSizeLabel.textContent = e.target.value + t('unitPx');
    });

    // 颜色选择器：选中后更新外圈颜色（反色）
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            updateColorPickerBorder(e.target.value);
        });
        // 初始化时设置外圈颜色
        updateColorPickerBorder(colorPicker.value);
    }

    // 更新颜色选择器外圈（反色）
    function updateColorPickerBorder(color) {
        if (!colorPicker) return;
        // 计算反色
        const r = 255 - parseInt(color.slice(1, 3), 16);
        const g = 255 - parseInt(color.slice(3, 5), 16);
        const b = 255 - parseInt(color.slice(5, 7), 16);
        const inverseColor = `rgb(${r}, ${g}, ${b})`;
        void inverseColor;
        colorPicker.style.boxShadow = '0 0 0 2px #141518, 0 0 0 3px rgba(255, 255, 255, 0.35)';
    }

    // 画笔模式切换：画笔/橡皮
    if (brushModeButtons && brushModeButtons.length) {
        brushModeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode === 'eraser' ? 'eraser' : 'brush';
                brushMode = mode;
                brushModeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    // 右侧文字面板已隐藏，这里的监听仅用于兼容（当前逻辑中不会再主动展示该面板）
    if (textSize && textSizeLabel) {
        textSize.addEventListener('input', (e) => {
            textSizeLabel.textContent = e.target.value + 'px';
            if (selectedTextElement) {
                selectedTextElement.fontSize = parseInt(e.target.value);
                // fontSize will be set by updateTextBoxPosition() using textAreaScale
                updateTextBoxSize(selectedTextElement);
                updateTextBoxPosition(selectedTextElement);
                redrawCanvas();
            }
        });
    }
    
    if (textInput) {
        textInput.addEventListener('input', (e) => {
            if (selectedTextElement && selectedTextElement.input) {
                selectedTextElement.text = e.target.value;
                selectedTextElement.input.value = e.target.value;
                selectedTextElement._userSetHeight = false;
                updateTextBoxSize(selectedTextElement);
                updateTextBoxPosition(selectedTextElement);
                redrawCanvas();
            }
        });
    }

    // 顶部辅助区域：根据当前工具切换不同控件
    function updateToolOptionsVisibility() {
        const groups = [moveToolOptions, brushToolOptions, textToolOptions, cropToolOptions];
        groups.forEach(g => {
            if (!g) return;
            g.classList.remove('active');
        });

        // 更新工具栏的 class，用于控制子工具按钮显示
        const toolbar = document.querySelector('.editor-toolbar');
        if (toolbar) {
            toolbar.classList.remove('text-mode', 'brush-mode', 'crop-mode', 'select-mode');
            toolbar.classList.add(currentTool + '-mode');
        }

        if (currentTool === 'select' && moveToolOptions) {
            moveToolOptions.classList.add('active');
        } else if (currentTool === 'brush' && brushToolOptions) {
            brushToolOptions.classList.add('active');
        } else if (currentTool === 'text' && textToolOptions) {
            textToolOptions.classList.add('active');
            // 更新子工具按钮状态
            updateTextSubToolButtons();
        } else if (currentTool === 'crop' && cropToolOptions) {
            cropToolOptions.classList.add('active');
        }
    }

    // 更新文字颜色预设按钮的激活状态
    function updateTextColorPresets() {
        if (!textColorPresetButtons || textColorPresetButtons.length === 0) return;
        // 优先使用已选文字的颜色，否则使用当前工具颜色（箭头/方框模式下）
        const currentColor = selectedTextElement?.color || currentTextColor || '#ffffff';
        textColorPresetButtons.forEach(btn => {
            const btnColor = btn.dataset.color;
            if (btnColor === currentColor) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // 更新文字子工具按钮的选中状态
    function updateTextSubToolButtons() {
        if (!textSubButtons || textSubButtons.length === 0) return;
        textSubButtons.forEach(btn => {
            const subTool = btn.dataset.subtool;
            if (subTool === currentTextSubTool) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
    
    // 文字子工具按钮点击事件
    if (textSubButtons && textSubButtons.length > 0) {
        textSubButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const subTool = btn.dataset.subtool;
                currentTextSubTool = subTool;
                updateTextSubToolButtons();
                
                // 取消文字选中状态
                deselectTextElement();
                
                // 确保当前工具是文字工具
                if (currentTool !== 'text') {
                    currentTool = 'text';
                    // 更新工具按钮选中状态
                    toolBtns.forEach(b => b.classList.remove('active'));
                    const textBtn = Array.from(toolBtns).find(b => b.dataset.tool === 'text');
                    if (textBtn) textBtn.classList.add('active');
                    updateCanvasCursor();
                    updateToolOptionsVisibility();
                    updateTextLayersInteraction();
                }
            });
        });
    }

    // 初始化一次，根据默认工具状态更新UI
    updateToolOptionsVisibility();
    updateTextColorPresets();
    updateTextLayersInteraction();
    
    // 只对真正的"工具按钮"（有 data-tool 属性）做工具切换，
    // 撤销/重做按钮虽然外观一致，但不作为工具，不会改变 currentTool
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Finish any active operations
            if (currentTextElement && currentTextElement.input) {
                currentTextElement.input.blur();
            }
            if (isDrawing) {
                isDrawing = false;
            }
            if (isDragging) {
                isDragging = false;
                isContainerDrag = false;
                editorCanvas.style.cursor = 'grab';
            }
            
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 处理文字子工具：text-arrow 算作 text 工具
            const tool = btn.dataset.tool;
            if (tool === 'text-arrow') {
                currentTool = 'text';
                // 设置箭头子工具
                currentTextSubTool = 'arrow';
                // 更新子工具按钮的选中状态
                updateTextSubToolButtons();
                // 取消文字选中状态
                deselectTextElement();
            } else if (tool === 'text-rect') {
                currentTool = 'text';
                // 设置方框子工具
                currentTextSubTool = 'rect';
                // 更新子工具按钮的选中状态
                updateTextSubToolButtons();
                // 取消文字选中状态
                deselectTextElement();
            } else {
                currentTool = tool;
                // 如果是普通文字工具，重置为文字子工具
                if (currentTool === 'text') {
                    currentTextSubTool = 'text';
                    updateTextSubToolButtons();
                }
            }
            
            updateCanvasCursor();
            updateToolOptionsVisibility();
            
            // Text 工具不再弹出右侧面板，只重置视图
            if (currentTool === 'text') {
                scale = initialScale;
                offsetX = initialOffsetX;
                offsetY = initialOffsetY;
                updateCanvasTransform();
            } else {
                textSidebar.classList.add('hidden');
                // 取消文字选中
                deselectTextElement();
                // 取消形状选中
                if (selectedShapeElement) {
                    deselectShapeElement(selectedShapeElement);
                }
            }

            // 画笔工具下隐藏所有箭头控制点，避免遮挡导致笔画断开
            if (currentTool === 'brush') {
                document.querySelectorAll('.arrow-control-point, .arrow-start-delete-btn, .arrow-select-line, .arrow-hit-area').forEach(el => {
                    if (el) el.style.display = 'none';
                });
            } else if (currentTool === 'text' && (currentTextSubTool === 'arrow' || currentTextSubTool === 'rect')) {
                // 切换回箭头/方框工具时，恢复显示已选中形状的控制点
                if (selectedShapeElement && selectedShapeElement.type === 'arrow') {
                    if (selectedShapeElement.selectLine) {
                        selectedShapeElement.selectLine.style.display = 'block';
                    }
                    if (selectedShapeElement.arrowControlPoint) {
                        selectedShapeElement.arrowControlPoint.style.display = 'block';
                        selectedShapeElement.arrowControlPoint.style.pointerEvents = 'auto';
                    }
                    if (selectedShapeElement.startDeleteBtn) {
                        selectedShapeElement.startDeleteBtn.style.display = 'block';
                    }
                }
                if (selectedShapeElement && selectedShapeElement.type === 'rect') {
                    if (selectedShapeElement.selectLineSvg) {
                        selectedShapeElement.selectLineSvg.style.display = 'block';
                    }
                    if (selectedShapeElement.selectLine) {
                        selectedShapeElement.selectLine.style.display = 'block';
                    }
                    if (selectedShapeElement.controlPoints) {
                        selectedShapeElement.controlPoints.forEach(cp => {
                            cp.style.display = 'block';
                        });
                    }
                    if (selectedShapeElement.startDeleteBtn) {
                        selectedShapeElement.startDeleteBtn.style.display = 'block';
                    }
                }
            }

            // 进入裁切工具时，也将图片恢复到初始缩放和位置，方便从"默认视图"开始裁切
            if (currentTool === 'crop') {
                scale = initialScale;
                offsetX = initialOffsetX;
                offsetY = initialOffsetY;
                updateCanvasTransform();
                // 同步更新视觉画布蓝色虚线
                updateVisualCanvasOverlay();
                // 默认使用"自由"裁切比例
                cropAspectMode = 'free';
                if (cropRatioButtons && cropRatioButtons.length) {
                    cropRatioButtons.forEach(b => b.classList.remove('active'));
                    const freeBtn = Array.from(cropRatioButtons).find(b => b.dataset.ratio === 'free');
                    if (freeBtn) freeBtn.classList.add('active');
                }
            }
            
            // 更新文字层的交互状态（根据当前模式）
            updateTextLayersInteraction();
            
            // 关键：切换工具后重新绘制画布，确保箭头元素的 pointerEvents 被正确更新
            redrawCanvas();
            
            if (currentTool === 'crop') {
                cropOverlay.classList.remove('hidden');
                cropOverlay.classList.add('active');
                if (visualCanvasOverlay) {
                    visualCanvasOverlay.classList.remove('hidden');
                    updateVisualCanvasOverlay();
                }
                // 进入裁切工具时，显示一个固定位置的裁切框（不跟随图片缩放/拖动）
                setupFixedCropBox();
            } else {
                cropOverlay.classList.add('hidden');
                cropOverlay.classList.remove('active');
                if (visualCanvasOverlay) {
                    visualCanvasOverlay.classList.add('hidden');
                }
                isCropping = false;
            }
        });
    });

    closeEditorBtn.addEventListener('click', closeEditor);
    cancelEditBtn.addEventListener('click', closeEditor);
    saveEditBtn.addEventListener('click', saveEditedImage);
    
    // Undo/Redo buttons（仅作为操作按钮，不改变 currentTool）
    // 注意：顶栏也有画布的 undoBtn/redoBtn，编辑器内按钮使用独立 id（editorUndoBtn/editorRedoBtn）
    const undoBtn = document.getElementById('editorUndoBtn');
    const redoBtn = document.getElementById('editorRedoBtn');
    
    undoBtn.addEventListener('click', () => {
        if (historyIndex > 0) {
            historyIndex--;
            restoreState(history[historyIndex]);
        }
        updateUndoRedoButtons();
    });
    
    redoBtn.addEventListener('click', () => {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            restoreState(history[historyIndex]);
        }
        updateUndoRedoButtons();
    });
    
    function updateUndoRedoButtons() {
        undoBtn.disabled = historyIndex <= 0;
        redoBtn.disabled = historyIndex >= history.length - 1;
        undoBtn.style.opacity = undoBtn.disabled ? '0.5' : '1';
        redoBtn.style.opacity = redoBtn.disabled ? '0.5' : '1';
    }

    function openImageEditor(imageData, imageIndex) {
        currentImageIndex = imageIndex;
        window._imageEditorOriginalUrl = imageData;  // 供 onSave 回调读取原图 URL
        isImageLoaded = false; // 重置加载状态
        
        // 显示加载状态
        imageEditorModal.classList.remove('hidden');
        removeElementsBySelector('#image-editor-loading');
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'image-editor-loading';
        loadingDiv.className = 'editor-loading';
        loadingDiv.textContent = '图片加载中...';
        (document.querySelector('.editor-canvas-container') || imageEditorModal).appendChild(loadingDiv);
        // 加载期间先清空上一张图，避免旧画面闪一下
        editorCanvas.style.visibility = 'hidden';
        brushCanvas.style.visibility = 'hidden';
        
        // 定义图片初始化函数
        function initializeEditor() {
            
            // 移除加载状态
            const loading = document.getElementById('image-editor-loading');
            if (loading) loading.remove();
            editorCanvas.style.visibility = '';
            brushCanvas.style.visibility = '';
            
            // 标记图片已加载
            isImageLoaded = true;
            window.isImageLoaded = true;  // 同时更新 window 对象上的变量
            
            // Reset state
            textElements = [];
            brushStrokes = [];
            shapeElements = [];
            history = [];
            historyIndex = -1;
            currentTextElement = null;
            selectedTextElement = null;
            isCropping = false;
            isDrawing = false;
            isDragging = false;
            isContainerDrag = false;
            isDraggingText = false;
            
            // Set canvas size
            editorCanvas.width = originalImage.width;
            editorCanvas.height = originalImage.height;
            ctx = editorCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // Initialize brush canvas with same size
            brushCanvas.width = originalImage.width;
            brushCanvas.height = originalImage.height;
            brushCtx = brushCanvas.getContext('2d');
            window.brushCtx = brushCtx;  // 同步到 window 对象
            brushCtx.imageSmoothingEnabled = true;
            brushCtx.imageSmoothingQuality = 'high';
        }
        
        originalImage = new Image();
        window.originalImage = originalImage;  // 同步到 window 对象
        originalImage.crossOrigin = 'anonymous';
        const loadingImage = originalImage;
        originalImage.onerror = () => {
            if (originalImage !== loadingImage) return; // 已经换了另一张图
            console.error('[ImageEditor] 图片加载失败');
            closeEditor();
            alert('图片加载失败，请稍后重试');
        };
        originalImage.onload = () => {
            if (originalImage !== loadingImage) return;
            initializeEditor();
            
            // Calculate text area dimensions based on image ratio
            // Base size: 1000x1000, longest side = 1000, short side adjusted by ratio
            const imageWidth = originalImage.width;
            const imageHeight = originalImage.height;
            const imageRatio = imageWidth / imageHeight;
            
            if (imageWidth >= imageHeight) {
                // Horizontal or square image: width = 1000, height = 1000 * (height/width)
                textAreaWidth = 1000;
                textAreaHeight = 1000 / imageRatio;
            } else {
                // Vertical image: height = 1000, width = 1000 * (width/height)
                textAreaHeight = 1000;
                textAreaWidth = 1000 * imageRatio;
            }
            
            // Calculate ratio to convert image coordinates to text area coordinates
            // This ratio is used to map image pixel positions to text area positions
            imageToTextRatio = Math.max(textAreaWidth / imageWidth, textAreaHeight / imageHeight);
            
            // Show modal first to ensure container has correct dimensions
            imageEditorModal.classList.remove('hidden');
            cropOverlay.classList.add('hidden');
            
            // Use double requestAnimationFrame to ensure layout is complete
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Calculate initial scale to fit canvas - maximize to show full image
                    const container = editorCanvas.parentElement;
                    // Get container dimensions including padding
                    const containerRect = container.getBoundingClientRect();
                    const containerWidth = containerRect.width;
                    const containerHeight = containerRect.height;
                    // Padding is 2rem = 32px
                    const padding = 64;
                    const maxWidth = containerWidth - padding;
                    const maxHeight = containerHeight - padding;
                    
                    const scaleX = maxWidth / originalImage.width;
                    const scaleY = maxHeight / originalImage.height;
                    // Use the smaller scale to fit the image completely
                    const fitScale = Math.min(scaleX, scaleY);
                    // Save base scale (this will be used for min/max limits)
                    baseScale = fitScale;
                    // Set initial scale to fit scale (no limits here)
                    scale = fitScale;
                    
                    // Center canvas - offset is relative to container's top-left corner
                    const canvasWidth = originalImage.width * scale;
                    const canvasHeight = originalImage.height * scale;
                    offsetX = (containerWidth - canvasWidth) / 2;
                    offsetY = (containerHeight - canvasHeight) / 2;
                    
                    // Save initial values for text tool reset
                    initialScale = scale;
                    initialOffsetX = offsetX;
                    initialOffsetY = offsetY;
                    
                    // Reset tool to select
                    toolBtns.forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-tool="select"]').classList.add('active');
                    currentTool = 'select';
                    updateCanvasCursor();
                    updateTextLayersInteraction();
                    
                    redrawCanvas();
                    updateCanvasTransform();
                    saveState();
                    updateUndoRedoButtons();

                    // 注册键盘快捷键：Ctrl+Z / Ctrl+Y / S / T / B / C
                    if (!editorKeydownHandler) {
                        editorKeydownHandler = (e) => {
                            // 仅在图片编辑器可见时响应
                            if (!imageEditorModal || imageEditorModal.classList.contains('hidden')) return;

                            const activeEl = document.activeElement;
                            const tagName = activeEl && activeEl.tagName ? activeEl.tagName.toLowerCase() : '';
                            const isTyping =
                                tagName === 'input' ||
                                tagName === 'textarea' ||
                                (activeEl && activeEl.isContentEditable);

                            if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                if (selectedTextElement || isTyping) {
                                    if (activeEl && activeEl.blur) activeEl.blur();
                                    deselectTextElement();
                                    return;
                                }
                                if (selectedShapeElement) {
                                    deselectShapeElement(selectedShapeElement);
                                    return;
                                }
                                const now = Date.now();
                                if (historyIndex > 0 && now - lastEscTime > 2500) {
                                    lastEscTime = now;
                                    if (typeof window.pxToast === 'function') window.pxToast('再按一次 Esc 放弃修改并关闭', { duration: 2500 });
                                    return;
                                }
                                closeEditor();
                                return;
                            }

                            // 在输入框或可编辑区域中时，不抢占 Ctrl+Z/Ctrl+Y 等快捷键
                            if (isTyping) return;

                            const key = e.key.toLowerCase();

                            // 撤销 / 重做：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
                            if (e.ctrlKey || e.metaKey) {
                                if (key === 'z') {
                                    e.preventDefault();
                                    // Ctrl+Shift+Z 作为重做
                                    if (e.shiftKey) {
                                        if (redoBtn && !redoBtn.disabled) {
                                            redoBtn.click();
                                        }
                                    } else {
                                        if (undoBtn && !undoBtn.disabled) {
                                            undoBtn.click();
                                        }
                                    }
                                    return;
                                }

                                if (key === 'y') {
                                    e.preventDefault();
                                    if (redoBtn && !redoBtn.disabled) {
                                        redoBtn.click();
                                    }
                                    return;
                                }
                            }

                            // 工具切换：S(选择) / T(文字) / B(画笔) / C(裁切)
                            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                                let targetTool = null;
                                if (key === 's') targetTool = 'select';
                                else if (key === 't') targetTool = 'text';
                                else if (key === 'b') targetTool = 'brush';
                                else if (key === 'c') targetTool = 'crop';
                                else if (key === 'delete' || key === 'backspace') {
                                    // 删除选中的形状（不能删除临时形状）
                                    if (selectedShapeElement && !selectedShapeElement.isTemp) {
                                        e.preventDefault();
                                        deleteShapeElement(selectedShapeElement);
                                    }
                                }

                                if (targetTool) {
                                    const targetBtn = document.querySelector(`.tool-btn[data-tool="${targetTool}"]`);
                                    if (targetBtn) {
                                        e.preventDefault();
                                        targetBtn.click();
                                    }
                                }
                            }
                        };

                        window.addEventListener('keydown', editorKeydownHandler);
                    }
                });
            });
        };
        
        // 外部 URL（如 TOS）通过后端代理加载，避免 CORS 污染 canvas
        let imgSrc = imageData;
        if (imgSrc && imgSrc.startsWith('http') && !imgSrc.includes(window.location.hostname)) {
            const backendUrl = (typeof getBackendUrl === 'function') ? getBackendUrl() : (window.location.origin);
            imgSrc = `${backendUrl}/v1/image/proxy?url=${encodeURIComponent(imageData)}`;
        }
        originalImage.src = imgSrc;
        
        // 如果图片已经从缓存加载完成（同步加载），立即初始化
        if (originalImage.complete && originalImage.naturalWidth > 0) {
            initializeEditor();
        } else {
        }
    }
    
    function redrawCanvas() {
        if (!ctx || !originalImage) return;
        
        ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
        ctx.drawImage(originalImage, 0, 0);
        
        // Clear and redraw brush strokes on brush canvas
        if (brushCtx) {
            brushCtx.clearRect(0, 0, brushCanvas.width, brushCanvas.height);
            brushStrokes.forEach(stroke => {
                if (stroke.points.length === 0) return;
                
                // 将基准值转换为画布像素值（类似文字层的保存逻辑）
                // stroke.width 存储的是基准值（基于textAreaWidth）
                // 需要转换为画布像素：canvasWidth = baseWidth * (editorCanvas.width / textAreaWidth)
                const canvasBrushWidth = stroke.width * (editorCanvas.width / textAreaWidth);
                
                if (stroke.points.length === 1) {
                    // Single point - draw / erase a dot
                    brushCtx.save();
                    if (stroke.mode === 'eraser') {
                        brushCtx.globalCompositeOperation = 'destination-out';
                        brushCtx.fillStyle = 'rgba(0,0,0,1)';
                    } else {
                        brushCtx.globalCompositeOperation = 'source-over';
                        brushCtx.fillStyle = stroke.color;
                    }
                    brushCtx.beginPath();
                    brushCtx.arc(stroke.points[0].x, stroke.points[0].y, canvasBrushWidth / 2, 0, Math.PI * 2);
                    brushCtx.fill();
                    brushCtx.restore();
                } else {
                    // Multiple points - draw / erase line
                    // 跳过带有 break 标记的点（断开处）
                    brushCtx.save();
                    if (stroke.mode === 'eraser') {
                        brushCtx.globalCompositeOperation = 'destination-out';
                        brushCtx.strokeStyle = 'rgba(0,0,0,1)';
                    } else {
                        brushCtx.globalCompositeOperation = 'source-over';
                        brushCtx.strokeStyle = stroke.color;
                    }
                    brushCtx.lineWidth = canvasBrushWidth;
                    brushCtx.lineCap = 'round';
                    brushCtx.lineJoin = 'round';
                    
                    // 分段绘制，处理断开处
                    let segmentStart = 0;
                    for (let i = 1; i < stroke.points.length; i++) {
                        if (stroke.points[i].break) {
                            // 遇到断点，绘制之前的段落
                            if (i - segmentStart > 1) {
                                brushCtx.beginPath();
                                brushCtx.moveTo(stroke.points[segmentStart].x, stroke.points[segmentStart].y);
                                for (let j = segmentStart + 1; j < i; j++) {
                                    brushCtx.lineTo(stroke.points[j].x, stroke.points[j].y);
                                }
                                brushCtx.stroke();
                            }
                            segmentStart = i;
                        }
                    }
                    // 绘制最后一段
                    if (stroke.points.length - segmentStart > 1) {
                        brushCtx.beginPath();
                        brushCtx.moveTo(stroke.points[segmentStart].x, stroke.points[segmentStart].y);
                        for (let i = segmentStart + 1; i < stroke.points.length; i++) {
                            brushCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
                        }
                        brushCtx.stroke();
                    }
                    brushCtx.restore();
                }
            });
        }
        
        // Text elements are now displayed as DOM elements, not drawn on canvas
        // But we still need to create/update DOM elements for saved texts
        textElements.forEach(textObj => {
            if (textObj.text && !textObj.element) {
                createTextBoxElement(textObj);
            } else if (textObj.text && textObj.element) {
                updateTextBoxElement(textObj);
            }
        });
        
        // 形状元素现在是 DOM 元素，不需要在 canvas 上绘制
        // 确保所有形状都是 DOM 元素
        const container = editorCanvas.parentElement;
        
        // 先清理 container 中所有的形状元素（包括箭头的 SVG 和方框的 shape-box）
        // 这样可以避免重复创建的问题
        const existingShapes = container.querySelectorAll('.shape-svg, .shape-box');
        existingShapes.forEach(el => {
            if (el.parentNode === container) {
                container.removeChild(el);
            }
        });
        
        // 然后为每个形状创建 DOM 元素
        shapeElements.forEach((shapeObj, index) => {
            createShapeElement(shapeObj);
        });
        
        // 更新文字层的交互状态（根据当前模式）
        updateTextLayersInteraction();
    }
    
    function saveState() {
        // Remove future states if we're not at the end
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        
        // Save current state
        const state = {
            brushStrokes: JSON.parse(JSON.stringify(brushStrokes)),
            textElements: textElements.filter(t => t.text).map(t => ({
                x: t.x,
                y: t.y,
                text: t.text,
                color: t.color,
                fontSize: t.fontSize,
                width: t.width,
                height: t.height
            })),
            shapeElements: JSON.parse(JSON.stringify(shapeElements))
        };
        
        history.push(state);
        if (history.length > MAX_HISTORY) {
            history.shift();
        } else {
            historyIndex++;
        }
        updateUndoRedoButtons();
    }
    
    function restoreState(state) {
        // 强制清理页面上所有的箭头/方框 SVG，防止残留
        // 注意：先尝试清理页面上所有可能的残留元素，不管它们在哪里
        removeElementsBySelector(['.shape-svg', '.temp-shape-svg']);
        
        // 清理添加到 document.body 的箭头控制元素
        removeElementsBySelector(['.arrow-control-point', '.arrow-start-delete-btn', '.arrow-select-line', '.arrow-hit-area']);
        
        const container = editorCanvas.parentElement;
        // 再清理 container 中的元素，确保没有遗漏
        removeElementsBySelector(['.shape-svg', '.temp-shape-svg'], container);
        
        // Remove existing text box elements
        textElements.forEach(textObj => {
            removeElement(textObj.element);
        });
        
        // Remove existing shape elements from DOM
        // 先直接尝试清理，即使 element 不在 container 中也要清理引用
        shapeElements.forEach(shapeObj => {
            removeElement(shapeObj.element);
            removeElement(shapeObj.controlPoint);
            removeElement(shapeObj.deleteBtn);
            removeElement(shapeObj.startDeleteBtn);
            removeElement(shapeObj.selectLine);
            removeElement(shapeObj.arrowControlPoint);
            removeElement(shapeObj.hitArea);
            removeElement(shapeObj.selectLineSvg);
            if (shapeObj.controlPoints && Array.isArray(shapeObj.controlPoints)) {
                shapeObj.controlPoints.forEach(cp => removeElement(cp));
            }
        });
        
        brushStrokes = JSON.parse(JSON.stringify(state.brushStrokes));
        textElements = state.textElements.map(t => ({
            x: t.x,
            y: t.y,
            text: t.text,
            color: t.color || '#ffffff', // Default to white if not set
            fontSize: t.fontSize || 18,
            width: t.width || 100,
            height: t.height || 30,
            element: null,
            input: null,
            isEditing: false
        }));
        
        // Recreate text box elements
        textElements.forEach(textObj => {
            if (textObj.text) {
                createTextBoxElement(textObj);
            }
        });
        
        // 恢复形状元素 - 先设为空，让 redrawCanvas 重新创建 DOM
        if (state.shapeElements) {
            shapeElements = JSON.parse(JSON.stringify(state.shapeElements));
            // 确保所有 shapeObj 的 DOM 元素引用都清除，强制重新创建
            shapeElements.forEach(shapeObj => {
                shapeObj.element = null;
                // 清除箭头相关 DOM 元素引用，强制重新创建
                shapeObj.arrowControlPoint = null;
                shapeObj.startDeleteBtn = null;
                shapeObj.selectLine = null;
                shapeObj.hitArea = null;
                shapeObj.svg = null;
                shapeObj.path = null;
                // 清除方框相关 DOM 元素引用，强制重新创建
                shapeObj.selectLineSvg = null;
                shapeObj.controlPoints = null;
                // 重置选中状态，确保撤回时不显示控制点和删除按钮
                shapeObj.isSelected = false;
            });
        } else {
            shapeElements = [];
        }

        redrawCanvas();

        // 撤销操作后，确保清理所有选中状态的显示元素
        // 重置选中状态，防止撤销后仍然显示虚线和控制点
        selectedShapeElement = null;

        // 清理页面上可能残留的方框选中元素
        removeElementsBySelector(['.rect-select-line-svg', '.rect-control-point', '.arrow-start-delete-btn.rect-delete-btn']);
    }

    function closeEditor() {
        imageEditorModal.classList.add('hidden');
        cropOverlay.classList.add('hidden');
        textSidebar.classList.add('hidden');
        isCropping = false;
        isDrawing = false;
        isDragging = false;
        isContainerDrag = false;
        isDraggingText = false;
        currentTextElement = null;
        selectedTextElement = null;
        
        // 重置工具设置为初始状态
        currentTool = 'select';
        currentTextSubTool = 'text';
        
        // 重置画笔设置
        if (brushModeButtons) {
            brushModeButtons.forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.mode === 'brush') {
                    btn.classList.add('active');
                }
            });
        }
        brushMode = 'brush';
        if (brushSize) brushSize.value = 5;
        if (brushSizeLabel) brushSizeLabel.textContent = '5' + t('unitPx');
        if (colorPicker) {
            colorPicker.value = '#ffffff';
            if (typeof updateColorPickerBorder === 'function') updateColorPickerBorder('#ffffff');
        }
        currentTextColor = '#ffffff';
        updateTextSubToolButtons();
        updateTextColorPresets();
        removeElementsBySelector('#image-editor-loading');
        lastEscTime = 0;
        
        // 重置工具按钮选中状态
        if (toolBtns) {
            toolBtns.forEach(b => b.classList.remove('active'));
            const selectBtn = Array.from(toolBtns).find(b => b.dataset.tool === 'select');
            if (selectBtn) selectBtn.classList.add('active');
        }
        
        // 重置视图设置
        scale = initialScale;
        offsetX = initialOffsetX;
        offsetY = initialOffsetY;
        
        // 更新 UI 状态
        updateCanvasCursor();
        updateToolOptionsVisibility();

        // 移除图片编辑器的全局键盘监听，避免影响主界面
        if (editorKeydownHandler) {
            window.removeEventListener('keydown', editorKeydownHandler);
            editorKeydownHandler = null;
        }
        
        // Remove any remaining text input overlays
        document.querySelectorAll('.text-input-overlay').forEach(el => {
            if (document.body.contains(el)) {
                document.body.removeChild(el);
            }
        });
        
        // Clean up text box elements
        const container = editorCanvas.parentElement;
        textElements.forEach(textObj => {
            if (textObj.element && container.contains(textObj.element)) {
                container.removeChild(textObj.element);
            }
        });
        
        // 清理箭头和方框相关的 DOM 元素
        shapeElements.forEach(shapeObj => {
            // 清理添加 到 body 上的元素
            if (shapeObj.arrowControlPoint && shapeObj.arrowControlPoint.parentNode) {
                shapeObj.arrowControlPoint.parentNode.removeChild(shapeObj.arrowControlPoint);
            }
            if (shapeObj.startDeleteBtn && shapeObj.startDeleteBtn.parentNode) {
                shapeObj.startDeleteBtn.parentNode.removeChild(shapeObj.startDeleteBtn);
            }
            if (shapeObj.selectLine && shapeObj.selectLine.parentNode) {
                shapeObj.selectLine.parentNode.removeChild(shapeObj.selectLine);
            }
            
            // 清理 shapeBox 和 shape-svg
            if (shapeObj.element && container.contains(shapeObj.element)) {
                container.removeChild(shapeObj.element);
            }
            // 清理 hitArea
            if (shapeObj.hitArea && container.contains(shapeObj.hitArea)) {
                container.removeChild(shapeObj.hitArea);
            }
        });
        
        // 清空 shapeElements 数组
        shapeElements = [];
    }

    function updateCanvasCursor() {
        // 选择工具和裁切工具下，都允许拖动画面，显示手型光标
        if (currentTool === 'select' || currentTool === 'crop') {
            editorCanvas.style.cursor = isDragging ? 'grabbing' : 'grab';
            editorCanvasContainer.style.cursor = isDragging ? 'grabbing' : 'grab';
            brushCanvas.classList.remove('brush-active');
            hideBrushCursor();
        } else if (currentTool === 'text') {
            // 文字工具下：箭头和方框用crosshair，文字用text
            editorCanvas.style.cursor = (currentTextSubTool === 'arrow' || currentTextSubTool === 'rect') ? 'crosshair' : 'text';
            editorCanvasContainer.style.cursor = 'default';
            brushCanvas.classList.remove('brush-active');
            hideBrushCursor();
        } else {
            editorCanvas.style.cursor = currentTool === 'brush' ? 'none' : 'default';
            editorCanvasContainer.style.cursor = 'default';
            // Enable brush canvas interaction only when brush tool is active
            if (currentTool === 'brush') {
                brushCanvas.classList.add('brush-active');
            } else {
                brushCanvas.classList.remove('brush-active');
                hideBrushCursor();
            }
        }
    }
    
    // 创建自定义画笔光标（圆圈）
    // 使用 window 对象共享画笔光标变量，确保 script.js 和 image-editor.js 使用同一变量
    window.brushCursorElement = window.brushCursorElement || null;
    let brushCursorElement = window.brushCursorElement;
    
    function createBrushCursor() {
        if (brushCursorElement) return brushCursorElement;
        
        brushCursorElement = document.createElement('div');
        window.brushCursorElement = brushCursorElement;
        brushCursorElement.id = 'brush-cursor';
        brushCursorElement.style.cssText = 'position: fixed; border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 50%; pointer-events: none; z-index: 99999999999; display: none; transform: translate(-50%, -50%); box-shadow: 0 0 4px rgba(0, 0, 0, 0.5); mix-blend-mode: difference;';
        document.body.appendChild(brushCursorElement);
        return brushCursorElement;
    }

    function updateBrushCursor(x, y, size) {
        const cursor = createBrushCursor();
        cursor.style.display = 'block';
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
        cursor.style.width = size + 'px';
        cursor.style.height = size + 'px';
        
        // 隐藏系统鼠标光标
        editorCanvas.style.cursor = 'none';
        brushCanvas.style.cursor = 'none';
    }
    
    function hideBrushCursor() {
        if (brushCursorElement) {
            brushCursorElement.style.display = 'none';
        }
        // 恢复系统鼠标光标
        editorCanvas.style.cursor = '';
        brushCanvas.style.cursor = '';
    }
    
    // 画笔/橡皮移动时更新光标
    function handleBrushCursorMove(e) {
        if (currentTool !== 'brush') {
            hideBrushCursor();
            return;
        }
        
        // 计算画笔大小（转换为屏幕像素）
        const baseBrushSize = parseInt(brushSize.value);
        const canvasBrushSize = baseBrushSize * (editorCanvas.width / textAreaWidth);
        const screenBrushSize = canvasBrushSize * scale;
        
        updateBrushCursor(e.clientX, e.clientY, screenBrushSize);
    }
    
    // 暴露到 window 对象，供 script.js 调用
    window.createBrushCursor = createBrushCursor;
    window.updateBrushCursor = updateBrushCursor;
    window.hideBrushCursor = hideBrushCursor;
    window.handleBrushCursorMove = handleBrushCursorMove;

    // 更新文字层和形状层的交互状态
    // 文字工具下可交互，其他工具下禁用以免阻挡画笔/裁切
    function updateTextLayersInteraction() {
        const enable = (currentTool === 'text');
        // 箭头/方框模式下也允许文字层交互，方便用户选中和编辑文字

        // 文字元素
        textElements.forEach(t => {
            if (!t.element) return;
            t.element.style.pointerEvents = enable ? 'auto' : 'none';
            if (t.input) {
                t.input.style.pointerEvents = enable ? 'auto' : 'none';
            }
            // 删除按钮永远可点
            if (t.deleteBtn) {
                t.deleteBtn.style.pointerEvents = 'auto';
            }
        });

        // 形状框（箭头 / 方框）
        shapeElements.forEach(s => {
            if (!s.element) return;
            // 箭头使用 hitArea 处理点击，SVG 本身应该不阻挡事件
            // 方框使用 shapeBox
            if (s.type === 'arrow') {
                // 箭头：SVG 不阻挡事件，由 hitArea 处理
                s.element.style.pointerEvents = 'none';
                // 关键：箭头的 hitArea 也需要同步更新 pointerEvents
                if (s.hitArea) {
                    s.hitArea.style.pointerEvents = enable ? 'auto' : 'none';
                }
                // 关键：箭头控制点也需要同步更新 pointerEvents
                if (s.arrowControlPoint) {
                    s.arrowControlPoint.style.pointerEvents = enable ? 'auto' : 'none';
                }
            } else {
                s.element.style.pointerEvents = enable ? 'auto' : 'none';
            }
            if (s.deleteBtn) {
                s.deleteBtn.style.pointerEvents = 'auto';
            }
            if (s.resizeHandle) {
                s.resizeHandle.style.pointerEvents = enable ? 'auto' : 'none';
            }
        });
    }

    // 绘制形状时，临时禁用所有文字框和形状框的鼠标事件，避免断触
    function disableTextLayersForDrawing() {
        textElements.forEach(t => {
            if (t.element) t.element.style.pointerEvents = 'none';
            if (t.input) t.input.style.pointerEvents = 'none';
        });
        shapeElements.forEach(s => {
            if (s.element) s.element.style.pointerEvents = 'none';
        });
    }

    // 绘制形状结束后，恢复文字框和形状框的交互状态
    function restoreTextLayersInteraction() {
        updateTextLayersInteraction();
    }

    function updateTextAreaLayer() {
        if (!textAreaLayer || !originalImage || !editorCanvas) return;
        
        // 文字区域覆盖整个图片
        // 文字区域在图片坐标系中从 (0,0) 开始，覆盖整个图片尺寸
        const imageCoords = { x: 0, y: 0 };
        
        // 文字区域在图片坐标系中的尺寸就是整个图片的尺寸
        const textAreaImageWidth = editorCanvas.width;
        const textAreaImageHeight = editorCanvas.height;
        
        // 转换为屏幕坐标（与图片同步缩放和移动）
        const screenX = offsetX + imageCoords.x * scale;
        const screenY = offsetY + imageCoords.y * scale;
        const screenWidth = textAreaImageWidth * scale;
        const screenHeight = textAreaImageHeight * scale;
        
        // 更新文字区域层的位置和大小
        textAreaLayer.style.left = screenX + 'px';
        textAreaLayer.style.top = screenY + 'px';
        textAreaLayer.style.width = screenWidth + 'px';
        textAreaLayer.style.height = screenHeight + 'px';
    }
    
    function updateCanvasTransform() {
        // Update textAreaScale
        textAreaScale = scale * (editorCanvas.width / textAreaWidth);
        
        editorCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        editorCanvas.style.transformOrigin = '0 0';
        brushCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        brushCanvas.style.transformOrigin = '0 0';
        updateTextBoxes();
        updateTextAreaLayer();
        updateShapeBoxes();
        
        // 更新临时形状位置（如果在绘制中）
        if (currentTempShape) {
            updateTempShapeElement(currentTempShape);
        }
        
        // 任何缩放/拖动画布后，同步更新视觉画布蓝色虚线区域
        if (currentTool === 'crop' && visualCanvasOverlay && !visualCanvasOverlay.classList.contains('hidden')) {
            updateVisualCanvasOverlay();
        }
    }

    // Canvas event handlers
    editorCanvas.addEventListener('mousedown', handleMouseDown);
    editorCanvas.addEventListener('mousemove', handleMouseMove);
    editorCanvas.addEventListener('mouseup', handleMouseUp);
    editorCanvas.addEventListener('mouseleave', (e) => {
        // 拖动文字时，忽略 mouseleave 事件，避免拖动中断开
        // 绘制箭头/方框时也忽略，避免拖动过程中断开
        if (isDraggingText || isDrawingShape) {
            return;
        }
        handleMouseUp(e);
    });
    
    // 全局箭头控制点拖动变量
    let isArrowControlDragging = false;
    let arrowControlDragShape = null;
    let arrowControlStartX, arrowControlStartY;
    let arrowControlOrigEndX, arrowControlOrigEndY;
    
    // 全局方框拖动/控制点拖动变量
    let isRectDragging = false;
    let isRectControlDragging = false;
    let rectDragShape = null;
    
    // 全局箭头控制点拖动处理
    document.addEventListener('arrowControlDragStart', function(e) {
        const shapeObj = e.detail.shapeObj;
        
        isArrowControlDragging = true;
        arrowControlDragShape = shapeObj;
        
        const textCoords = getTextAreaCoordinates(e.detail);
        arrowControlStartX = textCoords.x;
        arrowControlStartY = textCoords.y;
        arrowControlOrigEndX = shapeObj.endX;
        arrowControlOrigEndY = shapeObj.endY;
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isArrowControlDragging || !arrowControlDragShape) return;
        
        const textCoords = getTextAreaCoordinates(e);
        const dx = textCoords.x - arrowControlStartX;
        const dy = textCoords.y - arrowControlStartY;
        
        arrowControlDragShape.endX = arrowControlOrigEndX + dx;
        arrowControlDragShape.endY = arrowControlOrigEndY + dy;
        
        updateShapeSvgPath(arrowControlDragShape);
        updateShapeBoxPosition(arrowControlDragShape);
    });
    
    document.addEventListener('mouseup', function(e) {
        if (isArrowControlDragging) {
            isArrowControlDragging = false;
            arrowControlDragShape = null;
            saveState();
        }
    });
    
    // 画笔工具：阻止右键菜单弹出（画布内）
    brushCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // 画笔工具：阻止右键菜单弹出（editorCanvas）
    editorCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // 画笔工具：全局阻止右键菜单和手势（画布外拖动时）
    document.addEventListener('contextmenu', (e) => {
        if (currentTool === 'brush') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });
    
    // Brush canvas event handlers (for brush tool) - 使用 Pointer Events 支持触控
    brushCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // 触控笔或左键：绘画（对于鼠标，isPrimary 可能不可靠，pointerType 应该可靠）
        if (e.pointerType === 'pen' || e.pointerType === 'mouse' || e.pointerType === 'touch') {
            // 使用 button 检测右键 (button === 2 表示右键)
            if ((e.button === 0) || e.pointerType === 'pen') {
                // 左键或触控笔：触发 handleMouseDown 进行绘画
                handleMouseDown(e);
            }
            // 右键 document 级别处理
        }
    });
    
    brushCanvas.addEventListener('pointermove', (e) => {
        // 对于鼠标事件，isPrimary 可能不可靠，改用 buttons 属性检测
        // 右键拖动（使用专门的标记）
        if (isRightClickDragging && isDragging && isContainerDrag) {
            handleContainerMouseMove(e);
        } else {
            // 绘画或移动光标
            handleMouseMove(e);
            handleBrushCursorMove(e);
        }
    });
    
    brushCanvas.addEventListener('pointerup', (e) => {
        // 对于鼠标事件，isPrimary 可能不可靠，移除检测
        // 如果是右键拖动结束，恢复画笔工具
        if (previousToolForRightClick === 'brush') {
            isDragging = false;
            isContainerDrag = false;
            isRightClickDragging = false;  // 清除右键拖动标记
            brushCanvas.style.cursor = 'none';
            editorCanvas.style.pointerEvents = '';  // 恢复图片层接收事件
            currentTool = 'brush';
            previousToolForRightClick = null;
            // 恢复画笔光标
            const brushCursor = document.getElementById('brushCursor');
            if (brushCursor) brushCursor.style.display = 'block';
            return;
        }
        
        if (isDragging && isContainerDrag && currentTool === 'brush') {
            isDragging = false;
            isContainerDrag = false;
            brushCanvas.style.cursor = 'none';
        }
        handleMouseUp(e);
    });
    
    brushCanvas.addEventListener('pointerleave', (e) => {
        if (currentTool === 'brush') {
            brushLeftCanvas = true;
        }
    });
    
    brushCanvas.addEventListener('pointerenter', (e) => {
        if (currentTool === 'brush' && brushLeftCanvas && isDrawing) {
            if (brushStrokes.length > 0) {
                const currentStroke = brushStrokes[brushStrokes.length - 1];
                if (currentStroke && currentStroke.points.length > 0) {
                    const coords = getCanvasCoordinates(e);
                    currentStroke.points.push({ x: coords.x, y: coords.y, break: true });
                }
            }
            brushLeftCanvas = false;
        }
    });
    
    // 保留旧的 mouse 事件作为后备（主要用于非 Pointer Events 浏览器）
    brushCanvas.addEventListener('mousedown', handleMouseDown);
    brushCanvas.addEventListener('mousemove', (e) => {
        handleMouseMove(e);
        handleBrushCursorMove(e);
    });
    brushCanvas.addEventListener('mouseup', handleMouseUp);
    
    // Wheel event on container so it works everywhere in the editor
    const editorCanvasContainer = document.querySelector('.editor-canvas-container');
    editorCanvasContainer.addEventListener('wheel', handleWheel, { passive: false });

    // 中键拖动画布：任何工具下都可用，捕获阶段处理，避免触发绘画/文字/形状等逻辑
    let isMiddlePanning = false;
    let midStartX = 0, midStartY = 0, midStartOffX = 0, midStartOffY = 0;
    editorCanvasContainer.addEventListener('pointerdown', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        isMiddlePanning = true;
        midStartX = e.clientX;
        midStartY = e.clientY;
        midStartOffX = offsetX;
        midStartOffY = offsetY;
        editorCanvasContainer.style.cursor = 'grabbing';
        hideBrushCursor();
    }, true);
    // 阻止中键的浏览器自动滚动 / 中键点击
    ['mousedown', 'auxclick'].forEach(type => {
        editorCanvasContainer.addEventListener(type, (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
    });
    document.addEventListener('pointermove', (e) => {
        if (!isMiddlePanning) return;
        e.preventDefault();
        offsetX = midStartOffX + (e.clientX - midStartX);
        offsetY = midStartOffY + (e.clientY - midStartY);
        constrainOffset();
        updateCanvasTransform();
    });
    const endMiddlePan = () => {
        if (!isMiddlePanning) return;
        isMiddlePanning = false;
        editorCanvasContainer.style.cursor = '';
        updateCanvasCursor();
    };
    document.addEventListener('pointerup', endMiddlePan);
    document.addEventListener('pointercancel', endMiddlePan);
    window.addEventListener('blur', endMiddlePan);
    
    // 画笔工具：使用 pointerdown 处理右键拖动（确保在 canvas 上也能触发）
    // 右键按下时临时切换到 select 工具，松开后恢复
    let previousToolForRightClick = null;
    let isRightClickDragging = false;  // 专门用于画笔工具的右键拖动标记
    editorCanvasContainer.addEventListener('pointerdown', (e) => {
        // 如果已经由 brushCanvas 处理过（previousToolForRightClick 已设置），则跳过
        if (previousToolForRightClick === 'brush') {
            return;
        }
        
        if (currentTool === 'brush' && e.button === 2) {
            // 阻止浏览器默认手势
            e.preventDefault();
            e.stopPropagation();
            
            // 临时切换到 select 工具以使用其拖动功能
            previousToolForRightClick = 'brush';
            currentTool = 'select';
            isRightClickDragging = true;  // 设置右键拖动标记
            
            // 启动拖动
            isDragging = true;
            isContainerDrag = true;
            const containerRect = editorCanvasContainer.getBoundingClientRect();
            dragStartX = e.clientX - containerRect.left;
            dragStartY = e.clientY - containerRect.top;
            dragStartOffsetX = offsetX;
            dragStartOffsetY = offsetY;
            editorCanvasContainer.style.cursor = 'grabbing';
        }
    });
    
    // 右键松开时恢复画笔工具
    editorCanvasContainer.addEventListener('pointerup', (e) => {
        if (previousToolForRightClick === 'brush') {
            e.preventDefault();
            e.stopPropagation();
            
            // 停止拖动
            isDragging = false;
            isContainerDrag = false;
            isRightClickDragging = false;  // 清除右键拖动标记
            editorCanvasContainer.style.cursor = '';
            editorCanvas.style.pointerEvents = '';  // 恢复图片层接收事件            
            // 恢复画笔工具
            currentTool = 'brush';
            previousToolForRightClick = null;
            // 恢复画笔光标
            const brushCursor = document.getElementById('brushCursor');
            if (brushCursor) brushCursor.style.display = 'block';
        }
    });
    
    // Also allow dragging on container (black background area) when using select / crop tool
    editorCanvasContainer.addEventListener('mousedown', (e) => {
        // In text tool mode, deselect text when clicking on container
        // 箭头/方框模式下不取消文字选中，让事件继续传递以便启动绘制
        if (currentTool === 'text' && e.target === editorCanvasContainer) {
            deselectTextElement();
            // 直接 return，让事件继续传递
        }
        // Only handle if clicking on container itself (not canvas or other elements)
        // 在裁切模式下，点击裁切层空白区域或裁切框内部都视为拖动画布
        // 裁切框右下角 16x16 像素用于缩放，在 cropBox 的 mousedown 中已 stopPropagation，不会触发这里
        const isContainerTarget = (
            e.target === editorCanvasContainer ||
            e.target === cropOverlay ||
            e.target === cropBox
        );
        // 画笔工具下，点击 editorCanvas 或 brushCanvas 也视为容器拖动目标
        const isBrushCanvasTarget = (
            (currentTool === 'brush' || previousToolForRightClick === 'brush') &&
            (e.target === editorCanvas || e.target === brushCanvas)
        );
        if (isContainerTarget && (currentTool === 'select' || currentTool === 'crop')) {
            handleContainerMouseDown(e);
        }
        
        // 画笔工具下，右键或中键点击画布区域也可以拖动画布
        // 注意：这里用 previousToolForRightClick 来判断，因为 pointerdown 可能已经切换了 currentTool
        if (previousToolForRightClick === 'brush' && (e.button === 2 || e.button === 1) && (isContainerTarget || isBrushCanvasTarget)) {
            e.preventDefault();
            
            // 临时切换到 select 工具以使用其拖动功能（如果还没有切换的话）
            if (currentTool !== 'select') {
                previousToolForRightClick = 'brush';
                currentTool = 'select';
            }
            
            isDragging = true;
            isContainerDrag = true;
            isRightClickDragging = true;  // 确保设置右键拖动标记
            const containerRect = editorCanvasContainer.getBoundingClientRect();
            dragStartX = e.clientX - containerRect.left;
            dragStartY = e.clientY - containerRect.top;
            dragStartOffsetX = offsetX;
            dragStartOffsetY = offsetY;
            editorCanvasContainer.style.cursor = 'grabbing';
        }
    });
    
    // Update cursor when mouse moves over container
    editorCanvasContainer.addEventListener('mousemove', (e) => {
        // 画笔工具下更新自定义光标
        if (currentTool === 'brush') {
            handleBrushCursorMove(e);
            return;
        }
        if (currentTool === 'text') return;
        if (e.target === editorCanvasContainer && currentTool === 'select' && !isDragging) {
            editorCanvasContainer.style.cursor = 'grab';
        }
    });
    
    // 离开容器时隐藏画笔光标
    editorCanvasContainer.addEventListener('mouseleave', () => {
        hideBrushCursor();
    });
    
    // Global mousemove and mouseup for container dragging
    // 文字工具下禁用图片移动（currentTool === 'text'时不会进入这些分支）
    document.addEventListener('mousemove', (e) => {
        if (isDragging && (currentTool === 'select' || currentTool === 'crop')) {
            handleContainerMouseMove(e);
        }
        // 画笔工具：右键拖动画布（使用专门的标记）
        if (isRightClickDragging && isDragging && isContainerDrag) {
            handleContainerMouseMove(e);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (isDragging && (currentTool === 'select' || currentTool === 'crop')) {
            handleContainerMouseUp(e);
        }
        // 画笔工具：右键/中键拖动结束，恢复画笔工具
        if (previousToolForRightClick === 'brush') {
            isDragging = false;
            isContainerDrag = false;
            isRightClickDragging = false;  // 清除右键拖动标记
            editorCanvasContainer.style.cursor = 'default';
            currentTool = 'brush';
            previousToolForRightClick = null;
            // 恢复画笔光标
            const brushCursor = document.getElementById('brushCursor');
            if (brushCursor) brushCursor.style.display = 'block';
        }
        if (isDraggingText) {
            handleMouseUp(e);
        }
    });
    
    // 全局 Pointer Events 用于支持触控笔和跨元素拖动
    document.addEventListener('pointermove', (e) => {
        // 画笔工具：右键拖动画布（使用专门的标记）
        if (isRightClickDragging && isDragging && isContainerDrag) {
            handleContainerMouseMove(e);
        }
    });
    
    document.addEventListener('pointerup', (e) => {
        // 画笔工具：右键/中键拖动结束（使用专门的标记）
        if (isRightClickDragging && isDragging && isContainerDrag) {
            isDragging = false;
            isContainerDrag = false;
            isRightClickDragging = false;
            editorCanvasContainer.style.cursor = 'default';
            editorCanvas.style.pointerEvents = '';  // 恢复图片层接收事件
            // 恢复画笔工具
            if (previousToolForRightClick === 'brush') {
                currentTool = 'brush';
                previousToolForRightClick = null;
            }
            // 恢复画笔光标
            const brushCursor = document.getElementById('brushCursor');
            if (brushCursor) brushCursor.style.display = 'block';
        }
    });
    
    // 全局 mousemove/mouseup 用于箭头/方框绘制（确保拖动时不丢失事件）
    document.addEventListener('mousemove', (e) => {
        //
        
        // 画笔工具：右键拖动画布（使用专门的标记）
        if (previousToolForRightClick === 'brush' && isRightClickDragging) {
            // 只有在已经开始了拖动时才处理移动
            if (isDragging && isContainerDrag) {
                handleContainerMouseMove(e);
            } else {
            }
            return;
        }
        
        // 画笔工具：右键拖动画布（使用位运算检测右键）- 作为备用
        if (currentTool === 'brush' && (e.buttons & 2)) {
            // 只有在已经开始了拖动时才处理移动
            if (isDragging && isContainerDrag) {
                handleContainerMouseMove(e);
            }
            return;
        }
        
        if (currentTool === 'text' && isDrawingShape && currentTempShape) {
            handleMouseMove(e);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        // 画笔工具：右键拖动结束时停止拖动（使用专门的标记）
        if (previousToolForRightClick === 'brush' && isRightClickDragging) {
            isDragging = false;
            isContainerDrag = false;
            isRightClickDragging = false;
            editorCanvasContainer.style.cursor = 'default';
            editorCanvas.style.pointerEvents = '';  // 恢复图片层接收事件
            currentTool = 'brush';
            previousToolForRightClick = null;
            return;
        }
        
        // 画笔工具：右键拖动（拖动结束时停止备用条件）
        if (currentTool === 'brush' && isDragging && isContainerDrag) {
            isDragging = false;
            isContainerDrag = false;
            editorCanvas.style.pointerEvents = '';  // 恢复图片层接收事件
            // 如果同时也在绘画，停止绘制
            if (isDrawing) {
                handleMouseUp(e);
            }
        }
        // 画笔工具：确保在画布外松开也能停止绘制
        else if (currentTool === 'brush' && isDrawing) {
            handleMouseUp(e);
        }
        if (currentTool === 'text' && isDrawingShape) {
            handleMouseUp(e);
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDraggingText) {
            handleMouseMove(e);
        }
    });

    // Convert image canvas coordinates to text area coordinates
    function imageToTextAreaCoords(imageX, imageY) {
        // Map image coordinates to text area coordinates based on ratio
        const textX = (imageX / editorCanvas.width) * textAreaWidth;
        const textY = (imageY / editorCanvas.height) * textAreaHeight;
        return { x: textX, y: textY };
    }
    
    // Convert text area coordinates to image canvas coordinates
    function textAreaToImageCoords(textX, textY) {
        // Map text area coordinates back to image coordinates
        const imageX = (textX / textAreaWidth) * editorCanvas.width;
        const imageY = (textY / textAreaHeight) * editorCanvas.height;
        return { x: imageX, y: imageY };
    }
    
    function getCanvasCoordinates(e) {
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // Get mouse position relative to container
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;
        
        // Convert to canvas coordinates
        // Canvas is positioned at offsetX, offsetY and scaled by scale
        const x = (mouseX - offsetX) / scale;
        const y = (mouseY - offsetY) / scale;
        
        return { 
            x: Math.max(0, Math.min(editorCanvas.width, x)), 
            y: Math.max(0, Math.min(editorCanvas.height, y))
        };
    }
    
    // Get text area coordinates from mouse event
    function getTextAreaCoordinates(e) {
        const canvasCoords = getCanvasCoordinates(e);
        const textCoords = imageToTextAreaCoords(canvasCoords.x, canvasCoords.y);
        // 去除坐标限制，允许文字放置在任意位置
        return {
            x: textCoords.x,
            y: textCoords.y
        };
    }

    function handleMouseDown(e) {
        // 画笔工具下，右键或中键点击 canvas 时让事件传播到容器处理（用于拖动画布）
        // 直接返回，不在 canvas 层面处理，让容器的 mousedown 来处理
        if (currentTool === 'brush' && (e.button === 2 || e.button === 1)) {
            return;
        }
        
        // 如果是右键且正在使用右键拖动模式（画笔工具右键），不处理
        if (e.button === 2 && isRightClickDragging) {
            return;
        }
        
        // 如果是右键（非画笔工具），select/crop 工具允许右键拖动
        if (e.button === 2 && currentTool !== 'select' && currentTool !== 'crop') {
            return;
        }
        
        // select/crop 工具下，右键也可以拖动
        if (e.button === 2 && (currentTool === 'select' || currentTool === 'crop')) {
            isDragging = true;
            isContainerDrag = false;
            const container = editorCanvas.parentElement;
            const containerRect = container.getBoundingClientRect();
            dragStartX = e.clientX - containerRect.left;
            dragStartY = e.clientY - containerRect.top;
            dragStartOffsetX = offsetX;
            dragStartOffsetY = offsetY;
            editorCanvas.style.cursor = 'grabbing';
            return;
        }
        
        // 如果点击的是已完成的方框（不是临时形状），直接返回，不触发绘制
        // 使用多种选择器确保能检测到方框及其子元素
        const clickedShapeBox = e.target.closest('.shape-box');
        const clickedShapeSvg = e.target.closest('.shape-svg');
        
        // 检查是否是已完成的方框
        if (clickedShapeBox && !clickedShapeBox.classList.contains('temp-shape-box')) {
            // 尝试选中方框
            const shapeObj = shapeElements.find(s => s.element === clickedShapeBox);
            if (shapeObj) {
                selectShapeElement(shapeObj);
                // 确保文字元素被取消选中
                if (selectedTextElement) {
                    selectedTextElement.element.classList.remove('selected');
                    if (selectedTextElement.deleteBtn) {
                        selectedTextElement.deleteBtn.style.display = 'none';
                    }
                    selectedTextElement = null;
                }
            }
            return;
        }
        
        // 检查是否是已完成的箭头 SVG
        if (clickedShapeSvg && !clickedShapeSvg.classList.contains('temp-shape-svg')) {
            // 尝试选中箭头
            const shapeObj = shapeElements.find(s => s.element === clickedShapeSvg);
            if (shapeObj) {
                selectShapeElement(shapeObj);
                // 确保文字元素被取消选中
                if (selectedTextElement) {
                    selectedTextElement.element.classList.remove('selected');
                    if (selectedTextElement.deleteBtn) {
                        selectedTextElement.deleteBtn.style.display = 'none';
                    }
                    selectedTextElement = null;
                }
            }
            return;
        }
        
        // 点击箭头控制点时不取消选中
        if (e.target.classList.contains('arrow-control-point')) {
            return;
        }

        // 点击方框控制点时不取消选中
        if (e.target.classList.contains('rect-control-point')) {
            return;
        }
        
        // 点击箭头起始点删除按钮时不取消选中
        if (e.target.classList.contains('arrow-start-delete-btn')) {
            return;
        }
        
        // 点击空白区域时，取消形状选中
        if (currentTool === 'text' && selectedShapeElement) {
            deselectShapeElement(selectedShapeElement);
        }
        
        e.preventDefault();
        const coords = getCanvasCoordinates(e);
        
        // 画笔工具：右键或中键按下时启动拖动画布，左键才是绘制
        if (currentTool === 'brush' && (e.button === 2 || e.button === 1)) {
            // 右键或中键拖动画布
            isDragging = true;
            isContainerDrag = false;
            const container = editorCanvas.parentElement;
            const containerRect = container.getBoundingClientRect();
            dragStartX = e.clientX - containerRect.left;
            dragStartY = e.clientY - containerRect.top;
            dragStartOffsetX = offsetX;
            dragStartOffsetY = offsetY;
            editorCanvas.style.cursor = 'grabbing';
            return;
        }
        
        // 文字工具下禁用图片移动
        if (currentTool === 'select' || currentTool === 'crop') {
            isDragging = true;
            isContainerDrag = false; // Drag started from canvas
            const container = editorCanvas.parentElement;
            const containerRect = container.getBoundingClientRect();
            dragStartX = e.clientX - containerRect.left;
            dragStartY = e.clientY - containerRect.top;
            dragStartOffsetX = offsetX;
            dragStartOffsetY = offsetY;
            editorCanvas.style.cursor = 'grabbing';
        } else if (currentTool === 'brush') {
            // 检查图片是否已加载（直接从 window 对象读取）
            const windowIsImageLoaded = window.isImageLoaded;
            const windowBrushCtx = window.brushCtx;
            if (!windowIsImageLoaded || !windowBrushCtx) {
                console.warn('[ImageEditor] 图片未加载完成，无法使用画笔', { isImageLoaded: windowIsImageLoaded, hasBrushCtx: !!windowBrushCtx });
                return;
            }
            
            isDrawing = true;
            lastX = coords.x;
            lastY = coords.y;
            // 画笔大小存储为基准值（基于textAreaWidth，类似文字层的fontSize）
            // 用户输入的值理解为在基准坐标系（1000）中的大小
            const baseBrushSize = parseInt(brushSize.value);
            brushStrokes.push({
                color: colorPicker.value,
                width: baseBrushSize, // 存储基准大小
                mode: brushMode,      // 'brush' 或 'eraser'
                points: [{ x: lastX, y: lastY }]
            });
            // 不在这里 saveState，只在 handleMouseUp 中保存（避免多余的历史记录）
        } else if (currentTool === 'text') {
            // Get text area coordinates instead of canvas coordinates
            const textCoords = getTextAreaCoordinates(e);
            
            // 检查是否是箭头子工具
            if (currentTextSubTool === 'arrow' || currentTextSubTool === 'rect') {
                // 点击空白区域时，先取消之前的形状选中
                if (selectedShapeElement) {
                    deselectShapeElement(selectedShapeElement);
                }
                
                // 开始绘制形状（箭头/方框）
                isDrawingShape = true;
                // 禁用文字框和形状框的鼠标事件，避免绘制时断触
                disableTextLayersForDrawing();
                shapeStartX = textCoords.x;
                shapeStartY = textCoords.y;
                
                // 创建临时形状对象
                const tempShapeObj = {
                    type: currentTextSubTool,
                    startX: shapeStartX,
                    startY: shapeStartY,
                    endX: shapeStartX,
                    endY: shapeStartY,
                    color: currentTextColor,
                    strokeWidth: shapeBaseStrokeWidth,
                    arrowLength: shapeBaseArrowLength,
                    element: null,
                    isSelected: false,
                    isTemp: true
                };
                
                // 创建临时 DOM 元素用于实时显示
                createTempShapeElement(tempShapeObj);
                currentTempShape = tempShapeObj;
                
                return;
            }
            
            // 原有文字工具逻辑
            // Check if clicking on an existing text box
            const clickedText = findTextAtPosition(textCoords.x, textCoords.y);
            if (clickedText) {
                selectTextElement(clickedText);
            } else {
                // 点空白处：完成当前文字（如有）并在点击位置新建
                if (selectedTextElement) {
                    deselectTextElement();
                }
                addTextElement(textCoords.x, textCoords.y);
            }
        }
    }

    function handleMouseMove(e) {
        // Handle text box dragging
        if (isDraggingText) {
            // Find the textObj from draggingTextBoxElement
            let draggedTextObj = null;
            if (draggingTextBoxElement) {
                draggedTextObj = textElements.find(textObj => textObj.element === draggingTextBoxElement);
            }
            // Fallback to selectedTextElement if draggingTextBoxElement is not set
            if (!draggedTextObj && selectedTextElement) {
                draggedTextObj = selectedTextElement;
            }
            
            if (draggedTextObj) {
                // Calculate delta in screen pixels, then convert to text area coordinates
                const deltaXScreen = e.clientX - textDragStartX;
                const deltaYScreen = e.clientY - textDragStartY;
                // Convert screen pixel delta to text area coordinate delta
                // Need to account for the ratio between image coordinates and text area coordinates
                const widthRatio = editorCanvas.width / textAreaWidth;
                const heightRatio = editorCanvas.height / textAreaHeight;
                const deltaX = (deltaXScreen / scale) / widthRatio;
                const deltaY = (deltaYScreen / scale) / heightRatio;

                // 去除拖动限制，允许文字框移动到任意位置
                draggedTextObj.x = textDragOffsetX + deltaX;
                draggedTextObj.y = textDragOffsetY + deltaY;
                
                updateTextBoxPosition(draggedTextObj);
                redrawCanvas();
                return;
            }
        }
        
        const coords = getCanvasCoordinates(e);
        
        // Skip canvas drag handling if drag started from container
        // 文字工具下禁用图片移动（currentTool === 'text'时不会进入这个分支）
        // 裁切模式与选择模式下，在画布上按住拖动都可以移动图片
        if ((currentTool === 'select' || currentTool === 'crop') && isDragging && !isContainerDrag) {
            const container = editorCanvas.parentElement;
            const containerRect = container.getBoundingClientRect();
            const newOffsetX = dragStartOffsetX + (e.clientX - containerRect.left - dragStartX);
            const newOffsetY = dragStartOffsetY + (e.clientY - containerRect.top - dragStartY);
            
            offsetX = newOffsetX;
            offsetY = newOffsetY;
            
            // Apply constraints to keep image visible
            constrainOffset();
            
            updateCanvasTransform();
            updateTextBoxes();
        } else if (currentTool === 'brush' && isDrawing) {
            // 检查图片是否已加载
            if (!isImageLoaded || !brushCtx) {
                return;
            }
            
            // 检查是否需要断开连线（从画布外回到画布的情况）
            const currentStroke = brushStrokes[brushStrokes.length - 1];
            const needsBreak = currentStroke && currentStroke.points.length > 0 && 
                              currentStroke.points[currentStroke.points.length - 1].break;
            
            // Clamp coordinates to canvas bounds
            const clampedX = Math.max(0, Math.min(editorCanvas.width, coords.x));
            const clampedY = Math.max(0, Math.min(editorCanvas.height, coords.y));
            
            if (currentStroke) {
                // 如果需要断开，先移动到新位置再开始画
                if (needsBreak) {
                    lastX = clampedX;
                    lastY = clampedY;
                }
                currentStroke.points.push({ x: clampedX, y: clampedY });
                
                // 将基准值转换为画布像素值（类似文字层的保存逻辑）
                // stroke.width 存储的是基准值（基于textAreaWidth）
                // 需要转换为画布像素：canvasWidth = baseWidth * (editorCanvas.width / textAreaWidth)
                const canvasBrushWidth = currentStroke.width * (editorCanvas.width / textAreaWidth);
                
                brushCtx.save();
                // 橡皮擦模式：在 brushCanvas 上擦除之前的笔画
                if (currentStroke.mode === 'eraser') {
                    brushCtx.globalCompositeOperation = 'destination-out';
                    brushCtx.strokeStyle = 'rgba(0,0,0,1)';
                } else {
                    brushCtx.globalCompositeOperation = 'source-over';
                    brushCtx.strokeStyle = currentStroke.color;
                }
                brushCtx.lineWidth = canvasBrushWidth;
                brushCtx.lineCap = 'round';
                brushCtx.lineJoin = 'round';
                brushCtx.beginPath();
                brushCtx.moveTo(lastX, lastY);
                brushCtx.lineTo(clampedX, clampedY);
                brushCtx.stroke();
                brushCtx.restore();
                
                lastX = clampedX;
                lastY = clampedY;
            }
        } else if (currentTool === 'crop' && isCropping) {
            cropEndX = coords.x;
            cropEndY = coords.y;
            updateCropBox(cropEndX, cropEndY);
        } else if (currentTool === 'text' && isDrawingShape && currentTempShape) {
            // 实时绘制形状预览 - 更新临时形状元素
            const textCoords = getTextAreaCoordinates(e);
            currentTempShape.endX = textCoords.x;
            currentTempShape.endY = textCoords.y;
            updateTempShapeElement(currentTempShape);
        }
    }

    function handleMouseUp(e) {
        // 文字工具：箭头/方框绘制完成（放在最前面，确保先停止绘制）
        if (currentTool === 'text' && isDrawingShape) {
            isDrawingShape = false;
            // 恢复文字框和形状框的交互状态
            restoreTextLayersInteraction();
            const textCoords = getTextAreaCoordinates(e);
            finishShape(textCoords.x, textCoords.y);
        }
        
        if (isDraggingText) {
            // 释放指针捕获
            if (draggingTextBoxElement && draggingTextBoxElement.releasePointerCapture && e.pointerId !== undefined) {
                try {
                    draggingTextBoxElement.releasePointerCapture(e.pointerId);
                } catch (err) {
                    // 忽略释放捕获时的错误
                }
            }
            
            // 找到被拖动的 textObj 并保存状态
            let draggedTextObj = null;
            if (draggingTextBoxElement) {
                draggedTextObj = textElements.find(textObj => textObj.element === draggingTextBoxElement);
            }
            if (!draggedTextObj && selectedTextElement) {
                draggedTextObj = selectedTextElement;
            }
            
            isDraggingText = false;
            draggingTextBoxElement = null;
            
            // 记录拖动结束时间，用于安全延迟
            dragEndTime = Date.now();
            
            // 如果找到了被拖动的文字元素，保存状态
            if (draggedTextObj) {
                saveState();
            }
        }
        if (currentTool === 'select' || currentTool === 'crop') {
            isDragging = false;
            isContainerDrag = false;
            editorCanvas.style.cursor = 'grab';
        } else if (currentTool === 'brush') {
            // 处理画笔绘制结束
            if (isDrawing) {
                isDrawing = false;
                // Check if brushCtx is initialized（直接从 window 对象读取）
                if (!window.brushCtx) {
                    console.warn('[ImageEditor] 画笔上下文未初始化，忽略绘制');
                    return;
                }
                // Only save state if stroke has multiple points
                const currentStroke = brushStrokes[brushStrokes.length - 1];
                if (currentStroke && currentStroke.points.length > 1) {
                    saveState();
                } else if (currentStroke && currentStroke.points.length === 1) {
                    // Single point - draw a dot on brush canvas
                    // 将基准值转换为画布像素值（类似文字层的保存逻辑）
                    const canvasBrushWidth = currentStroke.width * (editorCanvas.width / textAreaWidth);
                    window.brushCtx.save();
                    if (currentStroke.mode === 'eraser') {
                        // 橡皮擦单点：擦掉这个区域
                        window.brushCtx.globalCompositeOperation = 'destination-out';
                        window.brushCtx.fillStyle = 'rgba(0,0,0,1)';
                    } else {
                        window.brushCtx.globalCompositeOperation = 'source-over';
                        window.brushCtx.fillStyle = currentStroke.color;
                    }
                    window.brushCtx.beginPath();
                    window.brushCtx.arc(currentStroke.points[0].x, currentStroke.points[0].y, canvasBrushWidth / 2, 0, Math.PI * 2);
                    window.brushCtx.fill();
                    window.brushCtx.restore();
                    saveState();
                }
            }
            // 处理右键/中键拖动结束
            if (isDragging) {
                isDragging = false;
                isContainerDrag = false;
                editorCanvas.style.cursor = 'crosshair';
            }
        } else if (currentTool === 'crop') {
            isCropping = false;
        }
    }
    
    // Container dragging handlers (for black background area)
    function handleContainerMouseDown(e) {
        e.preventDefault();
        isDragging = true;
        isContainerDrag = true; // Drag started from container
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        dragStartX = e.clientX - containerRect.left;
        dragStartY = e.clientY - containerRect.top;
        dragStartOffsetX = offsetX;
        dragStartOffsetY = offsetY;
        editorCanvas.style.cursor = 'grabbing';
        editorCanvasContainer.style.cursor = 'grabbing';
    }
    
    function handleContainerMouseMove(e) {
        e.preventDefault();
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        const newOffsetX = dragStartOffsetX + (e.clientX - containerRect.left - dragStartX);
        const newOffsetY = dragStartOffsetY + (e.clientY - containerRect.top - dragStartY);
        
        offsetX = newOffsetX;
        offsetY = newOffsetY;
        
        // Apply constraints to keep image visible
        constrainOffset();
        
        updateCanvasTransform();
    }

    // 创建临时画布用于实时显示绘制中的形状
    function createTempShapeCanvas() {
        if (!tempShapeCanvas) {
            tempShapeCanvas = document.createElement('canvas');
            tempShapeCanvas.className = 'temp-shape-canvas';
            tempShapeCanvas.style.position = 'absolute';
            tempShapeCanvas.style.pointerEvents = 'none';
            tempShapeCanvas.style.zIndex = '100';
        }
        
        // 设置画布大小与编辑器画布相同
        tempShapeCanvas.width = editorCanvas.width;
        tempShapeCanvas.height = editorCanvas.height;
        
        // 将临时画布添加到编辑器画布容器中
        const container = editorCanvas.parentElement;
        if (container && !container.contains(tempShapeCanvas)) {
            container.appendChild(tempShapeCanvas);
        }
        
        return tempShapeCanvas;
    }

    // 创建临时形状元素（直接用 SVG，不使用中间 box 容器）
    function createTempShapeElement(shapeObj) {
        const container = editorCanvas.parentElement;
        
        // 直接创建 SVG 作为容器，设置位置和尺寸
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'shape-svg temp-shape-svg');
        svg.style.position = 'absolute';
        svg.style.overflow = 'visible';
        svg.style.zIndex = '100';
        // SVG 本身不阻挡事件，让事件穿透到 path
        svg.style.pointerEvents = 'none';
        
        // 临时形状使用和最终形状完全相同的结构
        if (shapeObj.type === 'arrow') {
            // 箭头使用 path 元素（和最终形状一样）
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            // path 本身响应鼠标事件，用于绘制
            path.style.pointerEvents = 'stroke';
            svg.appendChild(path);
            shapeObj.path = path;
        }
        
        // 方框临时形状也使用和最终形状一样的结构
        if (shapeObj.type === 'rect') {
            const rectPath = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rectPath.setAttribute('fill', 'none');
            rectPath.setAttribute('stroke-linecap', 'round');
            rectPath.setAttribute('stroke-linejoin', 'round');
            // rect 本身响应鼠标事件
            rectPath.style.pointerEvents = 'visible';
            svg.appendChild(rectPath);
            shapeObj.path = rectPath;
        }
        
        // 直接将 svg 作为 element，不再使用中间的 box 容器
        shapeObj.element = svg;
        shapeObj.svg = svg;
        
        // 添加到页面
        container.appendChild(svg);
        
        // 设置初始位置
        updateTempShapeElement(shapeObj);
        
        return shapeObj;
    }
    
    // 更新临时形状元素（使用和最终形状完全相同的绘制逻辑）
    function updateTempShapeElement(shapeObj) {
        if (!shapeObj.element) return;
        
        const shapeBox = shapeObj.element;
        
        if (shapeObj.type === 'arrow') {
            // 箭头：svg 位置设为 0,0，覆盖整个编辑区
            shapeBox.style.position = 'absolute';
            shapeBox.style.left = '0';
            shapeBox.style.top = '0';
            shapeBox.style.width = '100%';
            shapeBox.style.height = '100%';
        } else {
            // 方框：计算边界（文字区域坐标）
            const minX = Math.min(shapeObj.startX, shapeObj.endX);
            const minY = Math.min(shapeObj.startY, shapeObj.endY);
            const width = Math.abs(shapeObj.endX - shapeObj.startX);
            const height = Math.abs(shapeObj.endY - shapeObj.startY);
            
            // 文字区域坐标 -> 屏幕坐标
            const screenX = offsetX + minX * textAreaScale;
            const screenY = offsetY + minY * textAreaScale;
            
            // 确保最小尺寸
            const boxWidth = Math.max(width * textAreaScale, 1);
            const boxHeight = Math.max(height * textAreaScale, 1);
            
            shapeBox.style.position = 'absolute';
            shapeBox.style.left = screenX + 'px';
            shapeBox.style.top = screenY + 'px';
            shapeBox.style.width = boxWidth + 'px';
            shapeBox.style.height = boxHeight + 'px';
        }
        
        // 确保临时形状有颜色
        if (!shapeObj.color) {
            shapeObj.color = currentTextColor;
        }
        
        // 使用 updateShapeSvgPath 完全相同的绘制逻辑
        updateShapeSvgPath(shapeObj);
    }

    // 绘制箭头
    function drawArrow(ctx, fromX, fromY, toX, toY) {
        const headLength = shapeBaseArrowLength; // 箭头头部长度
        const angle = Math.atan2(toY - fromY, toX - fromX);
        
        // 绘制主线
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        
        // 绘制箭头头部
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLength * Math.cos(angle - Math.PI / 6),
            toY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLength * Math.cos(angle + Math.PI / 6),
            toY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
    }

    // 完成形状绘制（简化版 - 现在 handleMouseDown 已经创建正式元素）
    // 完成形状绘制
    function finishShape(endX, endY) {
        // 防止重复调用
        if (!currentTempShape) return;
        
        // 移除临时画布
        if (tempShapeCanvas && tempShapeCanvas.parentNode) {
            tempShapeCanvas.parentNode.removeChild(tempShapeCanvas);
            tempShapeCanvas = null;
        }
        
        // 检查是否有有效的绘制区域
        const minSize = 5;
        if (Math.abs(endX - shapeStartX) < minSize && Math.abs(endY - shapeStartY) < minSize) {
            // 移除形状元素
            if (currentTempShape.element && currentTempShape.element.parentNode) {
                currentTempShape.element.parentNode.removeChild(currentTempShape.element);
            }
            currentTempShape = null;
            return;
        }
        
        // 更新坐标
        currentTempShape.endX = endX;
        currentTempShape.endY = endY;
        
        // 更新临时元素的路径
        updateShapeSvgPath(currentTempShape);
        
        // ======== 方案 A：复用临时箭头元素 ========
        // 只有箭头工具复用临时元素，方框工具保持原来的逻辑
        if (currentTempShape.type === 'arrow') {
            const svg = currentTempShape.element;
            
            // 去掉临时 class，添加正式 class
            svg.classList.remove('temp-shape-svg');
            svg.classList.add('shape-svg');
            
            // 更新 z-index（正式箭头）
            svg.style.zIndex = '200';
            
            // 补充缺失的元素（选中线、控制点等）
            createShapeElement(currentTempShape);
        } else {
            // 方框工具保持原来的逻辑：删除临时元素，重新创建正式元素
            // 强制删除临时箭头 DOM
            const tempElement = currentTempShape.element;
            removeElement(tempElement);
            
            // 同时清理 container 中可能残留的所有临时形状 SVG
            const container = editorCanvas.parentElement;
            removeElementsBySelector(['.temp-shape-svg', '.temp-shape-box'], container);
            
            // 清除临时引用的所有 DOM 相关属性
            currentTempShape.element = null;
            currentTempShape.svg = null;
            currentTempShape.path = null;
            currentTempShape.hitArea = null;
            
            // 标记为非临时形状（在创建元素之前）
            currentTempShape.isTemp = false;
            
            // 创建正式 DOM 元素
            createShapeElement(currentTempShape);
        }
        
        // 标记为非临时形状
        if (currentTempShape.type === 'arrow') {
            currentTempShape.isTemp = false;
        }
        
        // 添加到数组
        shapeElements.push(currentTempShape);
        
        // 选中形状
        selectShapeElement(currentTempShape);
        
        // 保持当前子工具状态，不强制切换到文字模式
        updateTextSubToolButtons();
        updateTextLayersInteraction();
        updateCanvasCursor();
        
        currentTempShape = null;
        saveState();
    }
    
    // 设置箭头控制点拖动
    function setupArrowControlDrag(shapeObj) {
        if (shapeObj._arrowControlSetup) return;
        shapeObj._arrowControlSetup = true;
        
        document.addEventListener('arrowControlDragStart', function(e) {
            const textCoords = getTextAreaCoordinates(e.detail);
            arrowControlDragShape = e.detail.shapeObj;
            arrowControlStartX = textCoords.x;
            arrowControlStartY = textCoords.y;
            arrowControlOrigEndX = e.detail.shapeObj.endX;
            arrowControlOrigEndY = e.detail.shapeObj.endY;
            isArrowControlDragging = true;
        });
    }
    
    // 创建形状 DOM 元素
    function createShapeElement(shapeObj) {
        const container = editorCanvas.parentElement;
        
        // 检查是否已经有 DOM 元素（从临时形状复用 - 仅用于箭头）
        const existingElement = shapeObj.element;
        
        // 只有在以下所有条件都满足时才复用
        // 1. 元素存在
        // 2. 元素是箭头类型
        // 3. svg 和 path 都存在且有效
        // 4. svg 中确实有 path 子元素
        const canReuse = !!(existingElement && 
                         shapeObj.type === 'arrow' && 
                         container.contains(existingElement) && 
                         shapeObj.svg && 
                         shapeObj.path &&
                         shapeObj.svg.contains(shapeObj.path));
        
        // 如果可以复用，只补充缺失的元素
        if (canReuse) {
            // 已经有完整的 SVG，获取它
            let svg = shapeObj.svg;
            let path = shapeObj.path;

            // 对于箭头：完全清理旧的控制元素并重新创建（避免事件监听器混乱）
            if (shapeObj.type === 'arrow') {
                // 关键：将 path 的 pointer-events 改为 none，让 hitArea 处理事件
                // 临时箭头使用 pointer-events: stroke，正式箭头使用 hitArea
                if (path) {
                    path.style.pointerEvents = 'none';
                }
                
                // 清理旧的箭头控制元素并重新创建
                // 这样可以确保事件监听器不会重复绑定
                // 清理 arrowControlPoint
                removeElement(shapeObj.arrowControlPoint);
                shapeObj.arrowControlPoint = null;

                // 清理 startDeleteBtn
                removeElement(shapeObj.startDeleteBtn);
                shapeObj.startDeleteBtn = null;

                // 清理 selectLine（从 svg 中）
                removeElement(shapeObj.selectLine);
                shapeObj.selectLine = null;

                // 清理 hitArea（从 svg 中）
                removeElement(shapeObj.hitArea);
                shapeObj.hitArea = null;

                // 重新创建 hitArea
                const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                hitArea.setAttribute('class', 'arrow-hit-area');
                hitArea.style.fill = 'transparent';
                hitArea.style.stroke = 'transparent';
                hitArea.style.strokeWidth = '30';
                hitArea.style.cursor = 'pointer';
                hitArea.style.pointerEvents = 'auto';
                svg.appendChild(hitArea);
                shapeObj.hitArea = hitArea;
                
                // 添加事件处理
                const handleArrowDragMove = function(e) {
                        if (!isDragging) return;
                        const textCoords = getTextAreaCoordinates(e);
                        const dx = textCoords.x - startTextX;
                        const dy = textCoords.y - startTextY;
                        shapeObj.startX = origStartX + dx;
                        shapeObj.startY = origStartY + dy;
                        shapeObj.endX = origEndX + dx;
                        shapeObj.endY = origEndY + dy;
                        updateShapeSvgPath(shapeObj);
                        updateShapeBoxPosition(shapeObj);
                    };
                    
                    const handleArrowDragUp = function(e) {
                        if (isDragging) {
                            isDragging = false;
                            shapeObj._isDraggingArrow = false;
                            document.removeEventListener('mousemove', handleArrowDragMove);
                            document.removeEventListener('mouseup', handleArrowDragUp);
                            saveState();
                        }
                    };
                    
                    shapeObj._arrowDragMoveHandler = handleArrowDragMove;
                    shapeObj._arrowDragUpHandler = handleArrowDragUp;
                    
                    const arrowMousedownHandler = (e) => {
                        if (currentTool !== 'text') return;
                        if (shapeObj._isDraggingArrow) return;
                        shapeObj._isDraggingArrow = true;
                        
                        e.stopPropagation();
                        if (selectedShapeElement !== shapeObj) {
                            selectShapeElement(shapeObj);
                        }
                        
                        isDragging = true;
                        const textCoords = getTextAreaCoordinates(e);
                        startTextX = textCoords.x;
                        startTextY = textCoords.y;
                        origStartX = shapeObj.startX;
                        origStartY = shapeObj.startY;
                        origEndX = shapeObj.endX;
                        origEndY = shapeObj.endY;
                        
                        document.addEventListener('mousemove', handleArrowDragMove);
                        document.addEventListener('mouseup', handleArrowDragUp);
                        e.preventDefault();
                    };
                    
                    shapeObj._arrowMousedownHandler = arrowMousedownHandler;
                    hitArea.addEventListener('mousedown', arrowMousedownHandler);
                }
                
                // 补充选中虚线（如果还没有）
                if (!shapeObj.selectLine) {
                    const selectLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    selectLine.setAttribute('class', 'arrow-select-line');
                    selectLine.style.display = 'none';
                    svg.appendChild(selectLine);
                    shapeObj.selectLine = selectLine;
                }
                
                // 补充箭头控制点（如果还没有）
                if (!shapeObj.arrowControlPoint) {
                    const arrowControlPoint = document.createElement('div');
                    arrowControlPoint.className = 'arrow-control-point';
                    arrowControlPoint.style.display = 'none';
                    arrowControlPoint.style.position = 'fixed';
                    arrowControlPoint.style.zIndex = '100000';
                    arrowControlPoint.style.pointerEvents = 'auto';
                    arrowControlPoint.style.userSelect = 'none';
                    document.body.appendChild(arrowControlPoint);
                    shapeObj.arrowControlPoint = arrowControlPoint;
                    
                    // 绑定控制点拖动事件
                    arrowControlPoint.onmousedown = function(e) {
                        e = e || window.event;
                        e.stopPropagation();
                        e.preventDefault();
                        window.getSelection().removeAllRanges();
                        
                        const event = new CustomEvent('arrowControlDragStart', {
                            detail: {
                                shapeObj: shapeObj,
                                clientX: e.clientX,
                                clientY: e.clientY
                            }
                        });
                        document.dispatchEvent(event);
                    };
                }
                
                // 补充起始点删除按钮（如果还没有）
                if (!shapeObj.startDeleteBtn) {
                    const startDeleteBtn = document.createElement('button');
                    startDeleteBtn.className = 'arrow-start-delete-btn';
                    startDeleteBtn.innerHTML = '×';
                    startDeleteBtn.title = t('delete');
                    startDeleteBtn.style.display = 'none';
                    startDeleteBtn.style.position = 'fixed';
                    startDeleteBtn.style.zIndex = '100000';
                    startDeleteBtn.style.left = '0px';
                    startDeleteBtn.style.top = '0px';
                    document.body.appendChild(startDeleteBtn);
                    shapeObj.startDeleteBtn = startDeleteBtn;

                    startDeleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteShapeElement(shapeObj);
                    });
                }

                // 设置位置
                updateShapeBoxPosition(shapeObj);

                // 箭头事件需要在 svg 上处理
                setupArrowSvgEvents(shapeObj);

                // 绑定全局箭头控制点拖动事件
                setupArrowControlDrag(shapeObj);

                // 确保在箭头选中时正确显示控制点
                if (shapeObj.isSelected) {
                    if (shapeObj.selectLine) {
                        shapeObj.selectLine.style.display = 'block';
                    }
                    if (shapeObj.arrowControlPoint) {
                        shapeObj.arrowControlPoint.style.display = 'block';
                        shapeObj.arrowControlPoint.style.pointerEvents = 'auto';
                    }
                    if (shapeObj.startDeleteBtn) {
                        shapeObj.startDeleteBtn.style.display = 'block';
                    }
                    // 启用 hitArea 的点击响应
                    if (shapeObj.hitArea) {
                        shapeObj.hitArea.style.pointerEvents = 'auto';
                    }
                } else {
                    if (shapeObj.selectLine) {
                        shapeObj.selectLine.style.display = 'none';
                    }
                    if (shapeObj.arrowControlPoint) {
                        shapeObj.arrowControlPoint.style.display = 'none';
                    }
                    if (shapeObj.startDeleteBtn) {
                        shapeObj.startDeleteBtn.style.display = 'none';
                    }
                }
            
            // 更新 dataset
            if (shapeObj.element.dataset) {
                shapeObj.element.dataset.shapeIndex = shapeElements.length;
            }
            
            return;
        }
        
        // 以下是完全没有 DOM 元素时的创建逻辑（保持不变）
        
        // 如果已有 DOM 元素，先清理旧的 DOM 引用（对所有形状都适用）
        // 移除旧的选中线
        if (shapeObj.selectLine) {
            try {
                if (shapeObj.selectLine.parentNode) {
                    shapeObj.selectLine.parentNode.removeChild(shapeObj.selectLine);
                }
            } catch (e) {}
        }
        // 移除旧的箭头控制点
        if (shapeObj.arrowControlPoint) {
            try {
                if (shapeObj.arrowControlPoint.parentNode) {
                    shapeObj.arrowControlPoint.parentNode.removeChild(shapeObj.arrowControlPoint);
                }
            } catch (e) {}
        }
        // 移除旧的起始点删除按钮
        if (shapeObj.startDeleteBtn) {
            try {
                if (shapeObj.startDeleteBtn.parentNode) {
                    shapeObj.startDeleteBtn.parentNode.removeChild(shapeObj.startDeleteBtn);
                }
            } catch (e) {}
        }
        // 移除旧的 SVG（不管它是否在 DOM 中，先尝试从任何可能的父节点中移除）
        if (shapeObj.element) {
            try {
                if (shapeObj.element.parentNode) {
                    shapeObj.element.parentNode.removeChild(shapeObj.element);
                }
            } catch (e) {}
            // 还要尝试从 container 中移除（以防 element 的 parentNode 不是 container）
            try {
                if (container.contains(shapeObj.element)) {
                    container.removeChild(shapeObj.element);
                }
            } catch (e) {}
        }
        // 清除引用
        shapeObj.element = null;
        shapeObj.svg = null;
        shapeObj.path = null;
        shapeObj.hitArea = null;
        shapeObj.selectLine = null;
        shapeObj.arrowControlPoint = null;
        shapeObj.startDeleteBtn = null;
        
        // 创建 SVG 用于绘制
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'shape-svg');
        svg.style.position = 'absolute';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.overflow = 'visible';
        
        // 根据类型创建不同的 SVG 元素和容器
        let path;
        let shapeBox; // 只用于方框
        
        if (shapeObj.type === 'arrow') {
            // 箭头：直接用 svg 作为容器，不使用中间的 shapeBox
            svg.style.pointerEvents = 'none'; // 让点击穿透到 canvas
            svg.style.zIndex = '200'; // 箭头在正式层，比临时箭头(100)高
            // 确保 svg 覆盖整个编辑区域
            svg.style.left = '0';
            svg.style.top = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            
            // 清空 SVG 中可能存在的所有子元素，避免重复
            while (svg.firstChild) {
                svg.removeChild(svg.firstChild);
            }
            
            // 箭头使用 path 元素
            path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            svg.appendChild(path);
            shapeObj.path = path;
            updateShapeSvgPath(shapeObj);
            
            // 创建透明的点击响应区域
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitArea.setAttribute('class', 'arrow-hit-area');
            hitArea.style.fill = 'transparent';
            hitArea.style.stroke = 'transparent';
            hitArea.style.strokeWidth = '30';
            hitArea.style.cursor = 'pointer';
            hitArea.style.pointerEvents = 'auto';
            svg.appendChild(hitArea);
            shapeObj.hitArea = hitArea;
            
            // 先清除旧的事件处理器，避免重复绑定
            if (shapeObj._arrowMousedownHandler) {
                hitArea.removeEventListener('mousedown', shapeObj._arrowMousedownHandler);
            }
            
            // 创建拖动处理函数
            const handleArrowDragMove = function(e) {
                if (!isDragging) return;
                
                const textCoords = getTextAreaCoordinates(e);
                const dx = textCoords.x - startTextX;
                const dy = textCoords.y - startTextY;
                
                shapeObj.startX = origStartX + dx;
                shapeObj.startY = origStartY + dy;
                shapeObj.endX = origEndX + dx;
                shapeObj.endY = origEndY + dy;
                
                updateShapeSvgPath(shapeObj);
                updateShapeBoxPosition(shapeObj);
            };
            
            const handleArrowDragUp = function(e) {
                if (isDragging) {
                    isDragging = false;
                    // 重置拖动标志
                    shapeObj._isDraggingArrow = false;
                    document.removeEventListener('mousemove', handleArrowDragMove);
                    document.removeEventListener('mouseup', handleArrowDragUp);
                    saveState();
                }
            };
            
            // 保存处理函数引用，用于清理
            shapeObj._arrowDragMoveHandler = handleArrowDragMove;
            shapeObj._arrowDragUpHandler = handleArrowDragUp;
            
            const arrowMousedownHandler = (e) => {
                if (currentTool !== 'text') return;
                // 防止重复触发 - 检查是否已经在拖动
                if (shapeObj._isDraggingArrow) return;
                shapeObj._isDraggingArrow = true;
                
                e.stopPropagation();
                // 如果不是当前选中的形状，则选中
                if (selectedShapeElement !== shapeObj) {
                    selectShapeElement(shapeObj);
                }
                
                // 添加全局事件处理拖动
                isDragging = true;
                const textCoords = getTextAreaCoordinates(e);
                startTextX = textCoords.x;
                startTextY = textCoords.y;
                origStartX = shapeObj.startX;
                origStartY = shapeObj.startY;
                origEndX = shapeObj.endX;
                origEndY = shapeObj.endY;
                
                // 添加全局鼠标移动和松开事件
                document.addEventListener('mousemove', handleArrowDragMove);
                document.addEventListener('mouseup', handleArrowDragUp);
                
                e.preventDefault();
            };
            
            // 保存 mousedown 处理函数引用
            shapeObj._arrowMousedownHandler = arrowMousedownHandler;
            hitArea.addEventListener('mousedown', arrowMousedownHandler);
            
            // 创建虚线线段（选中时显示）
            const selectLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            selectLine.setAttribute('class', 'arrow-select-line');
            selectLine.style.display = shapeObj.isSelected ? 'block' : 'none';
            svg.appendChild(selectLine);
            shapeObj.selectLine = selectLine;
            
            // 创建箭头末端控制点（直接添加到容器，使用 fixed 定位）
            const arrowControlPoint = document.createElement('div');
            arrowControlPoint.className = 'arrow-control-point';
            arrowControlPoint.style.display = shapeObj.isSelected ? 'block' : 'none';
            arrowControlPoint.style.position = 'fixed';
            arrowControlPoint.style.zIndex = '100000';
            arrowControlPoint.style.pointerEvents = 'auto';
            arrowControlPoint.style.userSelect = 'none';
            arrowControlPoint.style.webkitUserSelect = 'none';
            arrowControlPoint.style.mozUserSelect = 'none';
            arrowControlPoint.style.msUserSelect = 'none';
            arrowControlPoint.dataset.shapeIndex = shapeElements.indexOf(shapeObj);
            document.body.appendChild(arrowControlPoint);
            shapeObj.arrowControlPoint = arrowControlPoint;
            
            // 创建箭头起始点删除按钮
            const startDeleteBtn = document.createElement('button');
            startDeleteBtn.className = 'arrow-start-delete-btn';
            startDeleteBtn.innerHTML = '×';
            startDeleteBtn.title = t('delete');
            startDeleteBtn.style.display = shapeObj.isSelected ? 'block' : 'none';
            startDeleteBtn.style.position = 'fixed';
            startDeleteBtn.style.zIndex = '100000';
            // 初始化位置，避免显示在左上角
            startDeleteBtn.style.left = '0px';
            startDeleteBtn.style.top = '0px';
            // 删除按钮的事件绑定移动到 setupArrowSvgEvents 中统一处理
            document.body.appendChild(startDeleteBtn);
            shapeObj.startDeleteBtn = startDeleteBtn;
            
            // 箭头不需要删除按钮和调整手柄
            shapeObj.deleteBtn = null;
            shapeObj.resizeHandle = null;
            
            // 直接添加 svg 到容器
            container.appendChild(svg);
            
            // 先设置 element 引用，再设置位置（避免 updateShapeBoxPosition 重复创建）
            shapeObj.element = svg;
            shapeObj.svg = svg;
            
            // 设置位置
            updateShapeBoxPosition(shapeObj);
            
            // 箭头的事件需要在 svg 上处理
            setupArrowSvgEvents(shapeObj);
            
            // 设置当前模式
            if (currentTool !== 'text') {
                hitArea.style.pointerEvents = 'none';
            }
        } else {
            // 方框：仍然使用 shapeBox（用于调整大小、删除等）
            shapeBox = document.createElement('div');
            shapeBox.className = 'shape-box shape-rect';
            shapeBox.dataset.shapeIndex = shapeElements.indexOf(shapeObj);
            
            // 方框固定在最下层 (z-index = 10)
            shapeBox.style.zIndex = '10';
            
            svg.style.pointerEvents = 'none';
            shapeBox.appendChild(svg);
            
            // 方框使用 rect 元素
            path = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(path);
            
            shapeObj.path = path;
            updateShapeSvgPath(shapeObj);
            
            // 创建方框选中虚线（独立的 SVG，覆盖在方框上方）
            const selectLineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            selectLineSvg.setAttribute('class', 'rect-select-line-svg');
            selectLineSvg.style.position = 'absolute';
            selectLineSvg.style.width = '100%';
            selectLineSvg.style.height = '100%';
            selectLineSvg.style.pointerEvents = 'none';
            selectLineSvg.style.zIndex = '100';
            selectLineSvg.style.display = shapeObj.isSelected ? 'block' : 'none';
            
            const selectLine = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            selectLine.setAttribute('class', 'rect-select-line');
            selectLine.setAttribute('fill', 'none');
            selectLine.setAttribute('stroke', '#4a90d9');
            selectLine.setAttribute('stroke-width', '1');
            selectLine.setAttribute('stroke-dasharray', '4,4');
            selectLineSvg.appendChild(selectLine);
            shapeBox.appendChild(selectLineSvg);
            shapeObj.selectLineSvg = selectLineSvg;
            shapeObj.selectLine = selectLine;
            
            // 创建方框控制点（只保留右下角）
            const controlPoints = [];
            const controlPointPositions = [
                { x: 1, y: 1, corner: 'se' }     // 右下
            ];
            
            controlPointPositions.forEach((pos, index) => {
                const controlPoint = document.createElement('div');
                controlPoint.className = 'rect-control-point';
                controlPoint.dataset.corner = pos.corner;
                controlPoint.dataset.shapeIndex = shapeElements.indexOf(shapeObj);
                controlPoint.style.display = shapeObj.isSelected ? 'block' : 'none';
                controlPoint.style.position = 'absolute';
                controlPoint.style.zIndex = '100000';
                controlPoint.style.pointerEvents = 'auto';
                controlPoint.style.userSelect = 'none';
                controlPoint.style.transform = 'translate(-50%, -50%)';
                shapeBox.appendChild(controlPoint);
                controlPoints.push(controlPoint);
            });
            shapeObj.controlPoints = controlPoints;
            
            // 创建方框起始点删除按钮
            const startDeleteBtn = document.createElement('button');
            startDeleteBtn.className = 'arrow-start-delete-btn rect-delete-btn';
            startDeleteBtn.innerHTML = '×';
            startDeleteBtn.title = t('delete');
            startDeleteBtn.style.display = shapeObj.isSelected ? 'block' : 'none';
            startDeleteBtn.style.position = 'absolute';
            startDeleteBtn.style.zIndex = '100000';
            startDeleteBtn.style.transform = 'translate(-50%, -50%)';
            startDeleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteShapeElement(shapeObj);
            });
            shapeBox.appendChild(startDeleteBtn);
            shapeObj.startDeleteBtn = startDeleteBtn;

            // 隐藏默认的删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'shape-delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = t('delete');
            deleteBtn.style.display = 'none';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                // 不能删除临时形状
                if (!shapeObj.isTemp) {
                    deleteShapeElement(shapeObj);
                }
            });
            shapeBox.appendChild(deleteBtn);
            shapeObj.deleteBtn = deleteBtn;
            
            // 创建调整大小的手柄（保留以兼容其他功能）
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'shape-resize-handle';
            resizeHandle.style.display = 'none';
            resizeHandle.dataset.shapeIndex = shapeElements.indexOf(shapeObj);
            shapeBox.appendChild(resizeHandle);
            shapeObj.resizeHandle = resizeHandle;
            
            shapeObj.element = shapeBox;
            shapeObj.svg = svg;
            
            // 为方框添加点击选中事件
            shapeBox.addEventListener('click', (e) => {
                e.stopPropagation();
                selectShapeElement(shapeObj);
            });
            
            container.appendChild(shapeBox);
            
            updateShapeBoxPosition(shapeObj);
            setupRectEvents(shapeObj);
            
            if (currentTool !== 'text') {
                shapeBox.style.pointerEvents = 'none';
            }
        }
    }
    
    // 更新所有形状元素位置（用于缩放/拖动时）
    function updateShapeBoxes() {
        shapeElements.forEach(shapeObj => {
            updateShapeBoxPosition(shapeObj);
        });
    }
    
    // 更新形状元素位置
    function updateShapeBoxPosition(shapeObj) {
        // 防止无限递归的守卫标记
        if (shapeObj._isUpdatingPosition) return;
        shapeObj._isUpdatingPosition = true;
        
        try {
            if (!shapeObj || !shapeObj.element) {
                // 如果元素不存在，先创建
                if (shapeObj && shapeObj.type) {
                    createShapeElement(shapeObj);
                } else {
                    return;
                }
            }
        } finally {
            shapeObj._isUpdatingPosition = false;
        }
        
        const shapeBox = shapeObj.element;
        const minX = Math.min(shapeObj.startX, shapeObj.endX);
        const minY = Math.min(shapeObj.startY, shapeObj.endY);
        const width = Math.abs(shapeObj.endX - shapeObj.startX);
        const height = Math.abs(shapeObj.endY - shapeObj.startY);
        
        // 文字区域坐标 -> 屏幕坐标（和文字框完全一致）
        const screenPos = textAreaToScreen(minX, minY);
        
        if (shapeObj.type === 'arrow') {
            // 箭头 svg 覆盖整个编辑区域，位置设为0,0
            shapeBox.style.left = '0';
            shapeBox.style.top = '0';
            shapeBox.style.width = '100%';
            shapeBox.style.height = '100%';
        } else {
            // 方框使用 shapeBox，需要设置完整的定位和尺寸
            shapeBox.style.left = screenPos.x + 'px';
            shapeBox.style.top = screenPos.y + 'px';
            shapeBox.style.width = (width * textAreaScale) + 'px';
            shapeBox.style.height = (height * textAreaScale) + 'px';
        }
        
        // 更新 SVG 路径
        if (shapeObj.path) {
            updateShapeSvgPath(shapeObj);
        }
        
        // 更新箭头选中线、控制点和起始点删除按钮位置
        if (shapeObj.type === 'arrow') {
            updateArrowSelectLine(shapeObj);
            updateArrowControlPointPosition(shapeObj);
            updateArrowStartDeletePosition(shapeObj);
        }
        
        // 更新方框选中线、控制点和删除按钮位置
        if (shapeObj.type === 'rect') {
            updateRectSelectElements(shapeObj);
        }
    }
    
    // 更新箭头选中虚线线段
    function updateArrowSelectLine(shapeObj) {
        if (!shapeObj.selectLine) return;
        
        // 箭头 svg 位置为0,0，需要加上offset
        const startScreen = textAreaToScreen(shapeObj.startX, shapeObj.startY);
        const endScreen = textAreaToScreen(shapeObj.endX, shapeObj.endY);
        
        const d = `M ${startScreen.x} ${startScreen.y} L ${endScreen.x} ${endScreen.y}`;
        setAttributes(shapeObj.selectLine, {
            'd': d,
            'stroke': '#4a90d9',
            'stroke-width': '1',
            'stroke-dasharray': '4,4',
            'fill': 'none'
        });
        
        // 同时更新点击区域
        if (shapeObj.hitArea) {
            shapeObj.hitArea.setAttribute('d', d);
        }
    }
    
    // 更新箭头末端控制点位置
    function updateArrowControlPointPosition(shapeObj) {
        if (!shapeObj.arrowControlPoint) return;
        
        // 使用 fixed 定位，需要计算相对于视口的位置
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // 计算箭头末端的屏幕坐标
        const screenX = containerRect.left + offsetX + shapeObj.endX * textAreaScale;
        const screenY = containerRect.top + offsetY + shapeObj.endY * textAreaScale;
        
        shapeObj.arrowControlPoint.style.left = (screenX - 6) + 'px';
        shapeObj.arrowControlPoint.style.top = (screenY - 6) + 'px';
    }
    
    // 更新箭头起始点删除按钮位置
    function updateArrowStartDeletePosition(shapeObj) {
        if (!shapeObj.startDeleteBtn) return;
        
        // 使用 fixed 定位，需要计算相对于视口的位置
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // 计算箭头起始点的屏幕坐标
        const screenX = containerRect.left + offsetX + shapeObj.startX * textAreaScale;
        const screenY = containerRect.top + offsetY + shapeObj.startY * textAreaScale;
        
        shapeObj.startDeleteBtn.style.left = (screenX - 10) + 'px';
        shapeObj.startDeleteBtn.style.top = (screenY - 10) + 'px';
    }
    
    // 更新方框选中虚线和控制点位置
    function updateRectSelectElements(shapeObj) {
        if (!shapeObj || shapeObj.type !== 'rect') return;
        
        // 计算实际的边界（考虑从任意方向拉框的情况）
        const minX = Math.min(shapeObj.startX, shapeObj.endX);
        const minY = Math.min(shapeObj.startY, shapeObj.endY);
        const maxX = Math.max(shapeObj.startX, shapeObj.endX);
        const maxY = Math.max(shapeObj.startY, shapeObj.endY);
        
        const width = maxX - minX;
        const height = maxY - minY;
        
        const widthPx = width * textAreaScale;
        const heightPx = height * textAreaScale;
        
        // 更新选中虚线（使用 shapeBox 局部坐标，从 0,0 开始）
        if (shapeObj.selectLine) {
            shapeObj.selectLine.setAttribute('x', 0);
            shapeObj.selectLine.setAttribute('y', 0);
            shapeObj.selectLine.setAttribute('width', widthPx);
            shapeObj.selectLine.setAttribute('height', heightPx);
        }
        
        // 更新控制点位置（始终在右下角）
        if (shapeObj.controlPoints && shapeObj.controlPoints.length > 0) {
            const cp = shapeObj.controlPoints[0]; // 右下角
            cp.style.left = widthPx + 'px';
            cp.style.top = heightPx + 'px';
        }
        
        // 更新删除按钮位置（右上角）
        if (shapeObj.startDeleteBtn) {
            shapeObj.startDeleteBtn.style.left = widthPx + 'px';
            shapeObj.startDeleteBtn.style.top = '0px';
        }
    }
    
    // 更新形状 SVG 路径
    function updateShapeSvgPath(shapeObj) {
        if (!shapeObj.path) return;
        
        const minX = Math.min(shapeObj.startX, shapeObj.endX);
        const minY = Math.min(shapeObj.startY, shapeObj.endY);
        const width = Math.abs(shapeObj.endX - shapeObj.startX);
        const height = Math.abs(shapeObj.endY - shapeObj.startY);
        
        // 使用每个形状自己的线宽和箭头长度
        const strokeWidth = (shapeObj.strokeWidth ?? shapeBaseStrokeWidth) * textAreaScale;
        const arrowLength = (shapeObj.arrowLength ?? shapeBaseArrowLength) * textAreaScale;
        
        // 箭头 svg 位置为0,0，需要加上offset 才能正确显示
        if (shapeObj.type === 'arrow') {
            const svgStartX = offsetX + shapeObj.startX * textAreaScale;
            const svgStartY = offsetY + shapeObj.startY * textAreaScale;
            const svgEndX = offsetX + shapeObj.endX * textAreaScale;
            const svgEndY = offsetY + shapeObj.endY * textAreaScale;
            
            const dx = svgEndX - svgStartX;
            const dy = svgEndY - svgStartY;
            const angle = Math.atan2(dy, dx);
            const arrowAngle = Math.PI / 6;
            
            const arrowPoint1X = svgEndX - arrowLength * Math.cos(angle - arrowAngle);
            const arrowPoint1Y = svgEndY - arrowLength * Math.sin(angle - arrowAngle);
            const arrowPoint2X = svgEndX - arrowLength * Math.cos(angle + arrowAngle);
            const arrowPoint2Y = svgEndY - arrowLength * Math.sin(angle + arrowAngle);
            
            const d = `M ${svgStartX} ${svgStartY} L ${svgEndX} ${svgEndY} M ${arrowPoint1X} ${arrowPoint1Y} L ${svgEndX} ${svgEndY} L ${arrowPoint2X} ${arrowPoint2Y}`;
            
            shapeObj.path.setAttribute('d', d);
            shapeObj.path.setAttribute('stroke', shapeObj.color);
            shapeObj.path.setAttribute('stroke-width', strokeWidth);
            shapeObj.path.setAttribute('fill', 'none');
            shapeObj.path.setAttribute('stroke-linecap', 'round');
            shapeObj.path.setAttribute('stroke-linejoin', 'round');
        }
        
        // 方框处理
        if (shapeObj.type === 'rect') {
            const svgStartX = (shapeObj.startX - minX) * textAreaScale;
            const svgStartY = (shapeObj.startY - minY) * textAreaScale;
            const svgEndX = (shapeObj.endX - minX) * textAreaScale;
            const svgEndY = (shapeObj.endY - minY) * textAreaScale;
            
            const rectX = Math.min(svgStartX, svgEndX);
            const rectY = Math.min(svgStartY, svgEndY);
            const rectWidth = Math.abs(svgEndX - svgStartX);
            const rectHeight = Math.abs(svgEndY - svgStartY);
            
            // 检查是否是 rect 元素
            if (shapeObj.path.tagName === 'rect') {
                shapeObj.path.setAttribute('x', rectX);
                shapeObj.path.setAttribute('y', rectY);
                shapeObj.path.setAttribute('width', rectWidth);
                shapeObj.path.setAttribute('height', rectHeight);
                shapeObj.path.setAttribute('stroke', shapeObj.color);
                shapeObj.path.setAttribute('stroke-width', strokeWidth);
                shapeObj.path.setAttribute('fill', 'none');
                shapeObj.path.setAttribute('stroke-linecap', 'round');
                shapeObj.path.setAttribute('stroke-linejoin', 'round');
                shapeObj.path.setAttribute('stroke-linejoin', 'round');
            } else {
                // 兼容旧代码：使用 path
                const d = `M ${rectX} ${rectY} L ${rectX + rectWidth} ${rectY} L ${rectX + rectWidth} ${rectY + rectHeight} L ${rectX} ${rectY + rectHeight} Z`;
                shapeObj.path.setAttribute('d', d);
                shapeObj.path.setAttribute('stroke', shapeObj.color);
                shapeObj.path.setAttribute('stroke-width', strokeWidth);
                shapeObj.path.setAttribute('fill', 'none');
                shapeObj.path.setAttribute('stroke-linecap', 'round');
                shapeObj.path.setAttribute('stroke-linejoin', 'round');
            }
        }
    }
    
    // 选中形状元素
    window.selectedShapeElement = window.selectedShapeElement || null;
    let selectedShapeElement = window.selectedShapeElement;
    
    function selectShapeElement(shapeObj) {
        // 不能选择临时形状
        if (!shapeObj || shapeObj.isTemp) return;
        
        // 取消之前的文字选中
        if (selectedTextElement) {
            selectedTextElement.element.classList.remove('selected');
            selectedTextElement.element.classList.remove('editing');
            if (selectedTextElement.deleteBtn) {
                selectedTextElement.deleteBtn.style.display = 'none';
            }
            if (selectedTextElement.input) {
                // 清除文字选中状态
                try {
                    selectedTextElement.input.setSelectionRange(0, 0);
                } catch (e) {
                    // 某些情况下 setSelectionRange 可能失败，忽略错误
                }
                selectedTextElement.input.blur();
            }
            selectedTextElement = null;
            currentTextElement = null;
        }
        
        // 取消之前的形状选中
        if (selectedShapeElement && selectedShapeElement !== shapeObj) {
            deselectShapeElement(selectedShapeElement);
        }
        
        selectedShapeElement = shapeObj;
        shapeObj.isSelected = true;
        
        if (shapeObj.element) {
            shapeObj.element.classList.add('selected');
            // 提升选中形状 z-index，确保其选中元素在最上层
            // 方框选中 z-index = 15，箭头选中 z-index = 200（比临时箭头100高）
            if (shapeObj.type === 'rect') {
                shapeObj.element.style.zIndex = '15';
            } else if (shapeObj.type === 'arrow') {
                shapeObj.element.style.zIndex = '250';
            }
            if (shapeObj.deleteBtn) {
                shapeObj.deleteBtn.style.display = 'block';
            }
            // 箭头的特殊选中元素
            if (shapeObj.type === 'arrow') {
                // 强制隐藏大方框
                shapeObj.element.style.outline = 'none';
                
                // 确保 hitArea 可以响应点击
                if (shapeObj.hitArea) {
                    shapeObj.hitArea.style.pointerEvents = 'auto';
                }
                
                if (shapeObj.selectLine) {
                    shapeObj.selectLine.style.display = 'block';
                    updateArrowSelectLine(shapeObj);
                }
                if (shapeObj.arrowControlPoint) {
                    shapeObj.arrowControlPoint.style.display = 'block';
                    shapeObj.arrowControlPoint.style.pointerEvents = 'auto';
                    shapeObj.arrowControlPoint.style.zIndex = '100000';
                    updateArrowControlPointPosition(shapeObj);
                    
                    // 先清除旧的事件处理器，避免重复绑定
                    shapeObj.arrowControlPoint.onmousedown = null;
                    
                    // 直接绑定事件监听器
                    shapeObj.arrowControlPoint.onmousedown = function(e) {
                        e = e || window.event;
                        e.stopPropagation();
                        e.preventDefault();
                        window.getSelection().removeAllRanges();
                        
                        // 通知父函数进行拖动
                        const event = new CustomEvent('arrowControlDragStart', {
                            detail: {
                                shapeObj: shapeObj,
                                clientX: e.clientX,
                                clientY: e.clientY
                            }
                        });
                        document.dispatchEvent(event);
                    };
                }
                if (shapeObj.startDeleteBtn) {
                    shapeObj.startDeleteBtn.style.display = 'block';
                    updateArrowStartDeletePosition(shapeObj);
                }
                // 隐藏默认的删除按钮（箭头使用起始点删除按钮）
                if (shapeObj.deleteBtn) {
                    shapeObj.deleteBtn.style.display = 'none';
                }
            }
            // 方框的特殊选中元素
            if (shapeObj.type === 'rect') {
                // 启用 shapeBox 的点击响应，以便选中
                if (shapeObj.element) {
                    shapeObj.element.style.pointerEvents = 'auto';
                }
                
                // 显示选中虚线
                if (shapeObj.selectLineSvg) {
                    shapeObj.selectLineSvg.style.display = 'block';
                }
                if (shapeObj.selectLine) {
                    shapeObj.selectLine.style.display = 'block';
                    updateRectSelectElements(shapeObj);
                }
                // 显示控制点
                if (shapeObj.controlPoints) {
                    shapeObj.controlPoints.forEach(cp => {
                        cp.style.display = 'block';
                    });
                    updateRectSelectElements(shapeObj);
                }
                // 显示删除按钮
                if (shapeObj.startDeleteBtn) {
                    shapeObj.startDeleteBtn.style.display = 'block';
                    updateRectSelectElements(shapeObj);
                }
                // 隐藏默认的删除按钮
                if (shapeObj.deleteBtn) {
                    shapeObj.deleteBtn.style.display = 'none';
                }
            }
        }
        
        // 更新颜色预设
        currentTextColor = shapeObj.color;
        updateTextColorPresets();
        
        // 确保当前工具是文字工具，并且子工具与选中的形状类型匹配
        if (currentTool !== 'text') {
            currentTool = 'text';
            // 更新工具按钮选中状态
            toolBtns.forEach(b => b.classList.remove('active'));
            const textBtn = Array.from(toolBtns).find(b => b.dataset.tool === 'text');
            if (textBtn) textBtn.classList.add('active');
            updateToolOptionsVisibility();
        }
        // 切换到对应的子工具
        currentTextSubTool = shapeObj.type;
        updateTextSubToolButtons();
    }
    
    // 取消选中形状
    function deselectShapeElement(shapeObj) {
        if (!shapeObj) return;
        
        shapeObj.isSelected = false;
        if (shapeObj.element) {
            shapeObj.element.classList.remove('selected');
            if (shapeObj.deleteBtn) {
                shapeObj.deleteBtn.style.display = 'none';
            }
            if (shapeObj.resizeHandle) {
                shapeObj.resizeHandle.style.display = 'none';
            }
            // 箭头的特殊选中元素隐藏
            if (shapeObj.type === 'arrow') {
                if (shapeObj.selectLine) {
                    shapeObj.selectLine.style.display = 'none';
                }
                if (shapeObj.arrowControlPoint) {
                    shapeObj.arrowControlPoint.style.display = 'none';
                }
                if (shapeObj.startDeleteBtn) {
                    shapeObj.startDeleteBtn.style.display = 'none';
                }
            }
            // 方框的特殊选中元素隐藏
            if (shapeObj.type === 'rect') {
                // 恢复 shapeBox 的点击响应
                if (shapeObj.element) {
                    shapeObj.element.style.pointerEvents = 'auto';
                }
                
                if (shapeObj.selectLineSvg) {
                    shapeObj.selectLineSvg.style.display = 'none';
                }
                if (shapeObj.selectLine) {
                    shapeObj.selectLine.style.display = 'none';
                }
                if (shapeObj.controlPoints) {
                    shapeObj.controlPoints.forEach(cp => {
                        cp.style.display = 'none';
                    });
                }
                if (shapeObj.startDeleteBtn) {
                    shapeObj.startDeleteBtn.style.display = 'none';
                }
            }
        }
        
        if (selectedShapeElement === shapeObj) {
            selectedShapeElement = null;
        }
    }
    
    // 删除形状元素
    function deleteShapeElement(shapeObj) {
        if (!shapeObj) return;
        
        const index = shapeElements.indexOf(shapeObj);
        if (index > -1) {
            shapeElements.splice(index, 1);
        }
        
        // 删除主元素（svg 或 shapeBox）
        removeElement(shapeObj.element);
        
        // 删除选中线
        removeElement(shapeObj.selectLine);
        
        // 删除箭头控制点
        removeElement(shapeObj.arrowControlPoint);
        
        // 删除箭头起始点删除按钮
        removeElement(shapeObj.startDeleteBtn);
        
        if (selectedShapeElement === shapeObj) {
            selectedShapeElement = null;
        }
        
        saveState();
    }
    
    // 设置箭头元素事件（没有 shapeBox 的版本）
    function setupArrowSvgEvents(shapeObj) {
        const svg = shapeObj.element;
        if (!svg) return;
        
        let isArrowControlDragging = false;
        let startTextX, startTextY;
        let origEndX, origEndY;
        
        // 箭头控制点事件
        if (shapeObj.arrowControlPoint) {
            // 确保样式正确
            shapeObj.arrowControlPoint.style.pointerEvents = 'auto';
            shapeObj.arrowControlPoint.style.zIndex = '100000';
            shapeObj.arrowControlPoint.style.userSelect = 'none';
            
            // 先清除旧的事件监听器，避免重复绑定
            if (shapeObj._arrowControlMousedownHandler) {
                shapeObj.arrowControlPoint.removeEventListener('mousedown', shapeObj._arrowControlMousedownHandler);
            }
            
            const controlMousedownHandler = function(e) {
                e.stopPropagation();
                e.preventDefault();
                
                // 防止文本选择
                window.getSelection().removeAllRanges();
                
                isArrowControlDragging = true;
                const textCoords = getTextAreaCoordinates(e);
                startTextX = textCoords.x;
                startTextY = textCoords.y;
                origEndX = shapeObj.endX;
                origEndY = shapeObj.endY;
                
                // 添加全局事件处理拖动
                document.addEventListener('mousemove', handleArrowControlMouseMove);
                document.addEventListener('mouseup', handleArrowControlMouseUp);
            };
            
            // 保存处理函数引用，用于清理
            shapeObj._arrowControlMousedownHandler = controlMousedownHandler;
            shapeObj.arrowControlPoint.addEventListener('mousedown', controlMousedownHandler);
        }
        
        // 箭头起始点删除按钮事件
        if (shapeObj.startDeleteBtn) {
            // 使用 click 事件处理删除，mousedown 只阻止冒泡
            shapeObj.startDeleteBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            
            // 移除可能存在的重复 click 事件监听器，避免删除错误的箭头
            if (shapeObj._arrowDeleteClickHandler) {
                shapeObj.startDeleteBtn.removeEventListener('click', shapeObj._arrowDeleteClickHandler);
            }
            
            const deleteClickHandler = (e) => {
                e.stopPropagation();
                e.preventDefault();
                // 不能删除临时形状
                if (!shapeObj.isTemp) {
                    deleteShapeElement(shapeObj);
                }
            };
            
            shapeObj._arrowDeleteClickHandler = deleteClickHandler;
            shapeObj.startDeleteBtn.addEventListener('click', deleteClickHandler);
        }
        
        // 全局拖动处理函数
        function handleArrowControlMouseMove(e) {
            if (!isArrowControlDragging) return;
            
            const textCoords = getTextAreaCoordinates(e);
            const dx = textCoords.x - startTextX;
            const dy = textCoords.y - startTextY;
            
            shapeObj.endX = origEndX + dx;
            shapeObj.endY = origEndY + dy;
            
            updateShapeSvgPath(shapeObj);
            updateShapeBoxPosition(shapeObj);
        }
        
        function handleArrowControlMouseUp(e) {
            if (isArrowControlDragging) {
                isArrowControlDragging = false;
                document.removeEventListener('mousemove', handleArrowControlMouseMove);
                document.removeEventListener('mouseup', handleArrowControlMouseUp);
                saveState();
            }
        }
    }
    
    // 设置方框元素事件
    function setupRectEvents(shapeObj) {
        const shapeBox = shapeObj.element;
        if (!shapeBox) return;
        
        let isRectDragging = false;
        let isRectControlDragging = false;
        let dragCorner = null;
        let startTextX, startTextY;
        let origStartX, origStartY, origEndX, origEndY;
        
        // 方框拖动事件
        shapeBox.addEventListener('mousedown', (e) => {
            // 如果点击的是控制点或删除按钮，不触发拖动
            if (e.target.classList.contains('rect-control-point') || 
                e.target.classList.contains('arrow-start-delete-btn')) {
                return;
            }
            
            e.stopPropagation();
            
            // 立即选中方框（而不是等待 click 事件）
            selectShapeElement(shapeObj);
            
            isRectDragging = true;
            
            const textCoords = getTextAreaCoordinates(e);
            startTextX = textCoords.x;
            startTextY = textCoords.y;
            origStartX = shapeObj.startX;
            origStartY = shapeObj.startY;
            origEndX = shapeObj.endX;
            origEndY = shapeObj.endY;
            
            document.addEventListener('mousemove', handleRectDragMove);
            document.addEventListener('mouseup', handleRectDragUp);
        });
        
        function handleRectDragMove(e) {
            if (!isRectDragging) return;
            
            const textCoords = getTextAreaCoordinates(e);
            const dx = textCoords.x - startTextX;
            const dy = textCoords.y - startTextY;
            
            shapeObj.startX = origStartX + dx;
            shapeObj.startY = origStartY + dy;
            shapeObj.endX = origEndX + dx;
            shapeObj.endY = origEndY + dy;
            
            updateShapeSvgPath(shapeObj);
            updateShapeBoxPosition(shapeObj);
            updateRectSelectElements(shapeObj);
        }
        
        function handleRectDragUp(e) {
            if (isRectDragging) {
                isRectDragging = false;
                document.removeEventListener('mousemove', handleRectDragMove);
                document.removeEventListener('mouseup', handleRectDragUp);
                saveState();
            }
        }
        
        // 方框控制点事件 - 始终控制右下角
        if (shapeObj.controlPoints) {
            shapeObj.controlPoints.forEach(cp => {
                cp.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.getSelection().removeAllRanges();
                    
                    isRectControlDragging = true;
                    // 始终是右下角
                    dragCorner = 'se';
                    
                    const textCoords = getTextAreaCoordinates(e);
                    startTextX = textCoords.x;
                    startTextY = textCoords.y;
                    
                    // 保存实际的右下角坐标
                    const minX = Math.min(shapeObj.startX, shapeObj.endX);
                    const minY = Math.min(shapeObj.startY, shapeObj.endY);
                    const maxX = Math.max(shapeObj.startX, shapeObj.endX);
                    const maxY = Math.max(shapeObj.startY, shapeObj.endY);
                    origStartX = minX;
                    origStartY = minY;
                    origEndX = maxX;
                    origEndY = maxY;
                    
                    // 添加全局事件处理拖动
                    document.addEventListener('mousemove', handleRectControlMouseMove);
                    document.addEventListener('mouseup', handleRectControlMouseUp);
                });
            });
        }
        
        // 方框删除按钮事件
        if (shapeObj.startDeleteBtn) {
            shapeObj.startDeleteBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
        }
        
        // 全局拖动处理函数 - 始终控制右下角
        function handleRectControlMouseMove(e) {
            if (!isRectControlDragging) return;
            
            const textCoords = getTextAreaCoordinates(e);
            const dx = textCoords.x - startTextX;
            const dy = textCoords.y - startTextY;
            
            // 始终更新右下角坐标
            // 同时确保 startX/startY 始终是左上角
            const newEndX = origEndX + dx;
            const newEndY = origEndY + dy;
            
            // 确保 startX <= endX, startY <= endY
            if (newEndX > origStartX) {
                shapeObj.startX = origStartX;
                shapeObj.endX = newEndX;
            } else {
                shapeObj.startX = newEndX;
                shapeObj.endX = origStartX;
            }
            
            if (newEndY > origStartY) {
                shapeObj.startY = origStartY;
                shapeObj.endY = newEndY;
            } else {
                shapeObj.startY = newEndY;
                shapeObj.endY = origStartY;
            }
            
            updateShapeSvgPath(shapeObj);
            updateShapeBoxPosition(shapeObj);
            updateRectSelectElements(shapeObj);
        }
        
        function handleRectControlMouseUp(e) {
            if (isRectControlDragging) {
                isRectControlDragging = false;
                document.removeEventListener('mousemove', handleRectControlMouseMove);
                document.removeEventListener('mouseup', handleRectControlMouseUp);
                saveState();
            }
        }
    }
    
    // 设置形状元素事件
    function setupShapeBoxEvents(shapeObj) {
        const shapeBox = shapeObj.element;
        if (!shapeBox) return;
        
        let isDragging = false;
        let isResizing = false;
        let isArrowControlDragging = false;
        let startTextX, startTextY;
        let origStartX, origStartY, origEndX, origEndY;
        
        // 箭头控制点事件
        if (shapeObj.type === 'arrow' && shapeObj.arrowControlPoint) {
            shapeObj.arrowControlPoint.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                isArrowControlDragging = true;
                const textCoords = getTextAreaCoordinates(e);
                startTextX = textCoords.x;
                startTextY = textCoords.y;
                origEndX = shapeObj.endX;
                origEndY = shapeObj.endY;
                
                e.preventDefault();
            });
        }
        
        // 箭头起始点删除按钮事件
        if (shapeObj.type === 'arrow' && shapeObj.startDeleteBtn) {
            shapeObj.startDeleteBtn.addEventListener('mousedown', (e) => {
                // 删除按钮的点击事件在创建时已经添加，这里只需要阻止冒泡
                e.stopPropagation();
            });
        }
        
        // 箭头类型：只让 hitArea 响应点击，不响应 shapeBox 整体点击
        if (shapeObj.type !== 'arrow') {
            shapeBox.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('shape-resize-handle')) {
                    return; // 调整大小手柄单独处理
                }
                if (e.target.classList.contains('shape-delete-btn')) {
                    return; // 删除按钮单独处理
                }
                if (e.target.classList.contains('arrow-control-point')) {
                    return; // 箭头控制点单独处理
                }
                if (e.target.classList.contains('arrow-start-delete-btn')) {
                    return; // 箭头起始点删除按钮单独处理
                }
                if (currentTool !== 'text') return;
                
                e.stopPropagation();
                selectShapeElement(shapeObj);
                
                isDragging = true;
                // 使用文字区域坐标
                const textCoords = getTextAreaCoordinates(e);
                startTextX = textCoords.x;
                startTextY = textCoords.y;
                origStartX = shapeObj.startX;
                origStartY = shapeObj.startY;
                origEndX = shapeObj.endX;
                origEndY = shapeObj.endY;
                
                e.preventDefault();
            });
        }
        
        // 调整大小手柄事件
        const resizeHandle = shapeObj.resizeHandle;
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                if (currentTool !== 'text') return;
                
                e.stopPropagation();
                isResizing = true;
                const textCoords = getTextAreaCoordinates(e);
                startTextX = textCoords.x;
                startTextY = textCoords.y;
                origStartX = shapeObj.startX;
                origStartY = shapeObj.startY;
                origEndX = shapeObj.endX;
                origEndY = shapeObj.endY;
                
                e.preventDefault();
            });
        }
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging && !isResizing && !isArrowControlDragging) return;
            
            // 使用文字区域坐标计算偏移
            const textCoords = getTextAreaCoordinates(e);
            const dx = textCoords.x - startTextX;
            const dy = textCoords.y - startTextY;
            
            if (isDragging) {
                shapeObj.startX = origStartX + dx;
                shapeObj.startY = origStartY + dy;
                shapeObj.endX = origEndX + dx;
                shapeObj.endY = origEndY + dy;
            } else if (isResizing) {
                shapeObj.endX = origEndX + dx;
                shapeObj.endY = origEndY + dy;
            } else if (isArrowControlDragging) {
                // 箭头控制点拖动：只移动末端，起始点固定
                shapeObj.endX = origEndX + dx;
                shapeObj.endY = origEndY + dy;
            }
            
            // 更新 SVG
            updateShapeSvgPath(shapeObj);
            updateShapeBoxPosition(shapeObj);
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging || isResizing || isArrowControlDragging) {
                isDragging = false;
                isResizing = false;
                isArrowControlDragging = false;
                saveState();
            }
        });
    }
    
    // 更新形状 SVG
    function updateShapeSvg(shapeObj) {
        if (!shapeObj.path) return;
        
        if (shapeObj.type === 'arrow') {
            const dx = shapeObj.endX - shapeObj.startX;
            const dy = shapeObj.endY - shapeObj.startY;
            const angle = Math.atan2(dy, dx);
            const arrowLength = shapeBaseArrowLength;
            const arrowAngle = Math.PI / 6;
            
            const endX = shapeObj.endX;
            const endY = shapeObj.endY;
            const arrowPoint1X = endX - arrowLength * Math.cos(angle - arrowAngle);
            const arrowPoint1Y = endY - arrowLength * Math.sin(angle - arrowAngle);
            const arrowPoint2X = endX - arrowLength * Math.cos(angle + arrowAngle);
            const arrowPoint2Y = endY - arrowLength * Math.sin(angle + arrowAngle);
            
            const d = `M ${shapeObj.startX} ${shapeObj.startY} L ${endX} ${endY} M ${arrowPoint1X} ${arrowPoint1Y} L ${endX} ${endY} L ${arrowPoint2X} ${arrowPoint2Y}`;
            
            shapeObj.path.setAttribute('d', d);
        }
    }

    function handleContainerMouseUp(e) {
        isDragging = false;
        isContainerDrag = false;
        editorCanvas.style.cursor = 'grab';
        editorCanvasContainer.style.cursor = 'grab';
    }

    function constrainOffset() {
        const container = getCropContainer();
        if (!container) return;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const canvasWidth = editorCanvas.width * scale;
        const canvasHeight = editorCanvas.height * scale;

        // 在裁切模式下：保证整张图片完全覆盖裁切框区域，裁切框内绝不出现空白
        if (currentTool === 'crop' && cropBox && !cropOverlay.classList.contains('hidden')) {
            const containerRect = container.getBoundingClientRect();
            const cropRect = cropBox.getBoundingClientRect();

            const cropLeft = cropRect.left - containerRect.left;
            const cropTop = cropRect.top - containerRect.top;
            const cropRight = cropLeft + cropRect.width;
            const cropBottom = cropTop + cropRect.height;

            // 约束条件：图片矩形必须完全包含裁切框矩形
            // imageLeft <= cropLeft  &&  imageRight >= cropRight
            // imageTop  <= cropTop   &&  imageBottom >= cropBottom
            const minOffsetX = cropRight - canvasWidth;
            const maxOffsetX = cropLeft;
            const minOffsetY = cropBottom - canvasHeight;
            const maxOffsetY = cropTop;

            // 理论上此时 canvas 尺寸一定大于裁切框（handleWheel / autoScaleToFillCropBox 已加安全系数），
            // 直接按照“图片完全包住裁切框”的约束进行夹紧，避免退回到通用逻辑造成裁切框内露出空白
            offsetX = Math.max(minOffsetX, Math.min(maxOffsetX, offsetX));
            offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, offsetY));
            return;
        }

        // 通用模式下：只保证图片不会完全拖出视口，至少保留一小块可见区域
        const minVisible = 50; // Minimum pixels that must be visible

        const maxOffsetX = containerWidth - minVisible;
        const minOffsetX = -canvasWidth + minVisible;
        offsetX = Math.max(minOffsetX, Math.min(maxOffsetX, offsetX));

        const maxOffsetY = containerHeight - minVisible;
        const minOffsetY = -canvasHeight + minVisible;
        offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, offsetY));
    }
    
    function handleWheel(e) {
        // 文本工具下：滚轮缩放当前选中文字大小（文字和框一起放大）
        if (currentTool === 'text' && selectedTextElement) {
            e.preventDefault();
            if (isDraggingText) return;

            const step = 2;
            const direction = e.deltaY > 0 ? -1 : 1;
            const minFont = 12;
            const maxFontHard = 200; // 安全硬上限
            const prevFontSize = selectedTextElement.fontSize;

            let newFontSize = prevFontSize + direction * step;
            newFontSize = Math.max(minFont, Math.min(maxFontHard, newFontSize));

            if (newFontSize === prevFontSize) return;

            selectedTextElement.fontSize = newFontSize;
            
            // 清除用户手动设置的高度标记，让框自动适应文字大小
            selectedTextElement._userSetHeight = false;
            
            // 重新计算文字框大小，确保25字符宽度与字体大小保持正确比例
            // 这样文字和文字框会按相同比例缩放，不会触发换行
            updateTextBoxSize(selectedTextElement);
            updateTextBoxPosition(selectedTextElement);

            redrawCanvas();
            return;
        }
        
        // 文字工具下：选中形状时，滚轮调整该形状的线条粗细
        if (currentTool === 'text' && selectedShapeElement) {
            e.preventDefault();

            const direction = e.deltaY > 0 ? -1 : 1;
            const target = selectedShapeElement;

            const baseStroke = target.strokeWidth ?? shapeBaseStrokeWidth;
            const baseArrow  = target.arrowLength ?? shapeBaseArrowLength;

            // 更新当前形状自己的参数
            target.strokeWidth = Math.max(1, Math.min(20, baseStroke + direction));
            target.arrowLength = Math.max(5, Math.min(60, baseArrow + direction * 2));

            // 顺便更新默认值，让后面新画的继承这个粗细
            shapeBaseStrokeWidth = target.strokeWidth;
            shapeBaseArrowLength = target.arrowLength;

            updateShapeBoxPosition(target);
            if (currentTempShape) {
                updateTempShapeElement(currentTempShape);
            }
            return;
        }

        // 文字工具下禁用图片缩放
        if (currentTool === 'text') {
            e.preventDefault();
            return;
        }

        // 其他工具下：滚轮缩放画布
        if (isDrawing || isCropping) return;

        e.preventDefault();
        const container = editorCanvas.parentElement;
        const containerRect = container.getBoundingClientRect();

        // Get mouse position relative to container
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        // Calculate mouse position relative to canvas origin (before zoom)
        const canvasMouseX = (mouseX - offsetX) / scale;
        const canvasMouseY = (mouseY - offsetY) / scale;

        // 计算极限值
        let minScale = baseScale * 0.5;
        const maxScale = baseScale * 5;

        // 在裁切模式下：最小缩放不能小于让整张图片至少覆盖裁切框的比例
        if ((currentTool === 'crop') && cropBox && editorCanvas) {
            const cropWidth = cropBox.offsetWidth;
            const cropHeight = cropBox.offsetHeight;
            if (cropWidth > 0 && cropHeight > 0) {
                const requiredScaleX = cropWidth / editorCanvas.width;
                const requiredScaleY = cropHeight / editorCanvas.height;
                const SAFE_CROP_SCALE = 1.005;
                const cropMinScale = Math.max(requiredScaleX, requiredScaleY) * SAFE_CROP_SCALE;
                minScale = Math.max(minScale, cropMinScale);
            }
        }

        // 检查是否已达到缩放极限
        const isAtMin = scale <= minScale;
        const isAtMax = scale >= maxScale;
        // wheelAccumulator > 0 是向下滚动（缩小），< 0 是向上滚动（放大）
        const isScrollingDown = e.deltaY > 0;
        const isScrollingUp = e.deltaY < 0;
        
        // 如果已经达到极限方向，不再处理
        if ((isAtMin && isScrollingDown) || (isAtMax && isScrollingUp)) {
            wheelAccumulator = 0; // 重置累加器
            return;
        }

        // 累积滚轮增量
        wheelAccumulator += e.deltaY;
        
        // 设置阈值
        const threshold = 30;
        if (Math.abs(wheelAccumulator) < threshold) {
            return;
        }

        // 计算缩放因子
        const direction = wheelAccumulator < 0 ? 1 : -1;
        const cappedAccumulator = Math.max(-50, Math.min(50, wheelAccumulator));
        const zoomFactor = Math.pow(1.05, direction * Math.abs(cappedAccumulator) / threshold * 2);
        const clampedZoomFactor = Math.max(0.7, Math.min(1.3, zoomFactor));

        const newScale = scale * clampedZoomFactor;
        
        // 再次检查极限，确保不会超出
        const finalScale = Math.max(minScale, Math.min(maxScale, newScale));
        
        // 如果缩放值没有变化，则不重绘
        if (finalScale === scale) {
            wheelAccumulator = 0;
            return;
        }

        offsetX = mouseX - canvasMouseX * finalScale;
        offsetY = mouseY - canvasMouseY * finalScale;

        scale = finalScale;
        
        // 重置累加器
        wheelAccumulator = 0;

        constrainOffset();
        updateCanvasTransform();
    }

    function addTextElement(x, y) {
        // Deselect any selected text
        if (selectedTextElement) {
            selectedTextElement.element.classList.remove('selected');
            if (selectedTextElement.input) {
                // 清除文字选中状态
                try {
                    selectedTextElement.input.setSelectionRange(0, 0);
                } catch (e) {
                    // 某些情况下 setSelectionRange 可能失败，忽略错误
                }
                selectedTextElement.input.blur();
            }
            selectedTextElement = null;
        }
        
        // Create new text element with default white color
        // x and y are now in text area coordinates (允许超出文字区域)
        const textObj = {
            x: x,
            y: y,
            text: '',
            color: currentTextColor || '#ffffff',
            fontSize: parseInt(textSize.value) || 30,
            width: 200,
            height: 30,
            element: null,
            input: null,
            isEditing: true
        };
        
        textElements.push(textObj);
        currentTextElement = textObj;
        selectedTextElement = textObj;
        
        // Create text box element immediately on the image
        createTextBoxElement(textObj);
        
        // Focus the input for immediate editing
        if (textObj.input) {
            textObj.input.focus();
            textObj.input.select();
        }

        // 新建文字时更新颜色预设按钮状态
        updateTextColorPresets();
    }
    
    function deselectTextElement() {
        if (selectedTextElement) {
            selectedTextElement.element.classList.remove('selected');
            selectedTextElement.element.classList.remove('editing');
            if (selectedTextElement.input) {
                // 清除文字选中状态
                try {
                    selectedTextElement.input.setSelectionRange(0, 0);
                } catch (e) {
                    // 某些情况下 setSelectionRange 可能失败，忽略错误
                }
                selectedTextElement.input.blur();
            }
            // 隐藏删除按钮
            if (selectedTextElement.deleteBtn) {
                selectedTextElement.deleteBtn.style.display = 'none';
            }
            selectedTextElement = null;
            currentTextElement = null;
        }
        updateTextColorPresets();
    }
    
    function findTextAtPosition(x, y) {
        // Check if click is on any existing text box
        // x and y are now in text area coordinates
        for (let textObj of textElements) {
            if (textObj.element && textObj.text) {
                // Check if click is within text box bounds (in text area coordinates)
                if (x >= textObj.x && x <= textObj.x + textObj.width &&
                    y >= textObj.y && y <= textObj.y + textObj.height) {
                    return textObj;
                }
            }
        }
        return null;
    }
    
    function selectTextElement(textObj) {
        // 检查是否在拖动结束后的安全延迟期内
        const timeSinceDragEnd = Date.now() - dragEndTime;
        if (timeSinceDragEnd < DRAG_END_SAFE_DELAY) {
            return; // 在安全延迟期内，禁止选中文字
        }
        
        // Deselect previous
        if (selectedTextElement && selectedTextElement !== textObj) {
            selectedTextElement.element.classList.remove('selected');
            selectedTextElement.element.classList.remove('editing');
            if (selectedTextElement.input) {
                // 清除文字选中状态
                try {
                    selectedTextElement.input.setSelectionRange(0, 0);
                } catch (e) {
                    // 某些情况下 setSelectionRange 可能失败，忽略错误
                }
                selectedTextElement.input.blur();
            }
        }
        
        // 取消形状选中
        if (selectedShapeElement) {
            deselectShapeElement(selectedShapeElement);
        }
        
        selectedTextElement = textObj;
        textObj.element.classList.add('selected');
        currentTextElement = textObj;
        
        // 切换到文字工具和文字子工具
        if (currentTool !== 'text' || currentTextSubTool !== 'text') {
            currentTool = 'text';
            currentTextSubTool = 'text';
            // 更新工具按钮选中状态
            toolBtns.forEach(b => b.classList.remove('active'));
            const textBtn = Array.from(toolBtns).find(b => b.dataset.tool === 'text');
            if (textBtn) textBtn.classList.add('active');
            updateCanvasCursor();
            updateToolOptionsVisibility();
            updateTextSubToolButtons();
        }
        
        // 显示删除按钮
        if (textObj.deleteBtn) {
            textObj.deleteBtn.style.display = 'block';
        }
        
        // Focus input for editing
        if (textObj.input) {
            textObj.isEditing = true;
            textObj.element.classList.add('editing');
            // 恢复文字选择功能
            textObj.input.style.userSelect = 'text';
            textObj.input.focus();
        }
        updateTextColorPresets();
    }
    
    function deleteTextElement(textObj) {
        // Remove from textElements array
        const index = textElements.indexOf(textObj);
        if (index > -1) {
            textElements.splice(index, 1);
        }
        
        // Remove from DOM
        if (textObj.element && textObj.element.parentElement) {
            textObj.element.parentElement.removeChild(textObj.element);
        }
        
        // Clear selection if this was the selected element
        if (selectedTextElement === textObj) {
            selectedTextElement = null;
            currentTextElement = null;
        }
        
        // Save state and redraw
        saveState();
        redrawCanvas();
    }
    
    
    function createTextBoxElement(textObj) {
        const container = editorCanvas.parentElement;
        const textBox = document.createElement('div');
        textBox.className = 'text-box';
        if (textObj.isEditing) {
            textBox.classList.add('editing');
        }
        // Add selected class if this text element is selected
        if (selectedTextElement === textObj) {
            textBox.classList.add('selected');
        }
        textObj.element = textBox;
        
        // Create editable input/textarea
        const input = document.createElement('textarea');
        input.className = 'text-box-input';
        input.value = textObj.text;
        // Ensure color is set (default to white if not set)
        input.style.color = textObj.color || '#ffffff';
        // fontSize will be set by updateTextBoxPosition() using textAreaScale
        input.style.fontWeight = 'bold';
        input.style.fontFamily = 'Arial, sans-serif';
        input.style.background = 'transparent';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.resize = 'none';
        input.style.overflow = 'hidden';
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.padding = '4px'; // Fixed padding for consistent margins
        input.style.margin = '0';
        input.style.boxSizing = 'border-box';
        input.placeholder = '输入文字...';
        textObj.input = input;
        textBox.appendChild(input);
        
        // Create delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'text-box-delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = t('delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            deleteTextElement(textObj);
        });
        textBox.appendChild(deleteBtn);
        textObj.deleteBtn = deleteBtn;
        
        container.appendChild(textBox);
        
        // Calculate initial size
        updateTextBoxSize(textObj);
        
        // Position the box
        updateTextBoxPosition(textObj);
        
        // 根据当前模式设置交互状态
        if (currentTool !== 'text') {
            textBox.style.pointerEvents = 'none';
            if (input) {
                input.style.pointerEvents = 'none';
            }
            // 删除按钮始终可用
            if (deleteBtn) {
                deleteBtn.style.pointerEvents = 'auto';
            }
        }
        
        // Add event listeners
        setupTextBoxEvents(textObj);
        
        // Auto-resize textarea and sync with sidebar
        const updateTextSize = () => {
            // 确保textObj.input被正确设置
            textObj.input = input;
            textObj.text = input.value;
            // Update sidebar if this text element is selected
            if (selectedTextElement === textObj) {
                textInput.value = textObj.text;
            }
            // 当文字内容改变时，清除高度的手动设置标记，让高度自动适应新的内容
            textObj._userSetHeight = false;
            updateTextBoxSize(textObj);
            updateTextBoxPosition(textObj);
            redrawCanvas();
        };
        
        // 监听input事件，当输入框的值变化时更新高度
        input.addEventListener('input', (e) => {
            updateTextSize();
        });
        
        // 监听回车键，确保换行时能正确更新高度
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
                // 阻止默认行为，手动处理换行
                e.preventDefault();
                // 在输入框中插入换行符
                const start = input.selectionStart;
                const end = input.selectionEnd;
                input.value = input.value.substring(0, start) + '\n' + input.value.substring(end);
                // 更新光标位置
                input.selectionStart = input.selectionEnd = start + 1;
                // 触发input事件，更新高度
                const inputEvent = new Event('input', { bubbles: true });
                input.dispatchEvent(inputEvent);
                // 再次触发input事件，确保高度能正确更新
                setTimeout(() => {
                    const inputEvent2 = new Event('input', { bubbles: true });
                    input.dispatchEvent(inputEvent2);
                }, 0);
            }
        });
        
        // Save on blur (when clicking outside)
        input.addEventListener('blur', () => {
            textObj.isEditing = false;
            textBox.classList.remove('editing');
            if (textObj.text.trim()) {
                saveState();
            } else {
                // Remove empty text if it's a new element
                const index = textElements.indexOf(textObj);
                if (index > -1 && !textObj.text) {
                    textElements.splice(index, 1);
                    textBox.remove();
                }
            }
        });
    }
    
    // 文字框排版常量（基准坐标，1000 长边体系）：与保存时完全一致
    const TEXT_PAD = 4;
    const TEXT_PAD_RIGHT = 20;
    const TEXT_LINE_HEIGHT = 1.2;
    let _textMeasureCtx = null;
    function measureTextLines(text, fontSize) {
        if (!_textMeasureCtx) _textMeasureCtx = document.createElement('canvas').getContext('2d');
        _textMeasureCtx.font = 'bold 100px Arial, sans-serif';
        const lines = String(text ?? '').split(/\r?\n/);
        let maxW = 0;
        lines.forEach(line => {
            const w = _textMeasureCtx.measureText(line).width;
            if (w > maxW) maxW = w;
        });
        return { lines, width: maxW * fontSize / 100 };
    }

    function updateTextBoxSize(textObj) {
        if (!textObj.input) return;
        const text = textObj.input.value;
        const fs = textObj.fontSize;
        const m = measureTextLines(text || textObj.input.placeholder || '', fs);
        // 预留少量余量，避免屏幕渲染与 canvas 测量的亚像素差异导致内容被裁
        textObj.width = m.width + fs * 0.15 + TEXT_PAD + TEXT_PAD_RIGHT;
        textObj.height = m.lines.length * fs * TEXT_LINE_HEIGHT + TEXT_PAD * 2;
        if (textObj.element) {
            textObj.element.style.padding = '0';
            textObj.element.style.boxSizing = 'border-box';
            updateTextBoxPosition(textObj);
        }
    }

    function updateTextBoxElement(textObj) {
        if (!textObj.element) return;
        
        const input = textObj.input || textObj.element.querySelector('.text-box-input');
        if (input) {
            input.value = textObj.text;
            input.style.color = textObj.color;
            // fontSize will be set by updateTextBoxPosition() using textAreaScale
            textObj.input = input;
        }
        
        updateTextBoxSize(textObj);
        updateTextBoxPosition(textObj);
    }
    
    function updateTextBoxPosition(textObj) {
        if (!textObj.element) return;
        
        const container = editorCanvas.parentElement;
        
        // Convert text area coordinates to image canvas coordinates
        const imageCoords = textAreaToImageCoords(textObj.x, textObj.y);
        
        // Position relative to container (not page coordinates)
        // Canvas position in container: offsetX, offsetY
        // Image coordinates: imageCoords.x, imageCoords.y
        // Scale: scale
        // Note: textObj.x and textObj.y are in text area coordinates (0 to textAreaWidth/Height)
        // We need to map them to image coordinates first, then to screen coordinates
        const screenX = offsetX + imageCoords.x * scale;
        const screenY = offsetY + imageCoords.y * scale;
        
        // 计算文字区域的scale
        // fontSize 存储的是在文字区域基准（1000）下的字体大小
        // 要将文字区域单位转换为图片像素，需要乘以 (editorCanvas.width / textAreaWidth)
        // 然后再乘以scale转换为屏幕像素
        // 所以 textAreaScale = scale * (editorCanvas.width / textAreaWidth)
        // 这样无论图片像素多大，相同fontSize值的文字显示大小都一致
        
        // 位置跟随图片缩放
        textObj.element.style.left = screenX + 'px';
        textObj.element.style.top = screenY + 'px';
        // 文字框尺寸和字体大小使用文字区域的scale，而不是图片的scale
        // 这样确保不同像素的图片上，相同fontSize的文字显示大小一致
        textObj.element.style.width = (textObj.width * textAreaScale) + 'px';
        textObj.element.style.height = (textObj.height * textAreaScale) + 'px';
        
        // 字体大小使用文字区域的scale，确保在不同像素的图片上显示大小一致
        const scaledFontSize = textObj.fontSize * textAreaScale;
        textObj.element.style.fontSize = scaledFontSize + 'px';
        if (textObj.input) {
            textObj.input.style.fontSize = scaledFontSize + 'px';
            textObj.input.style.lineHeight = (scaledFontSize * TEXT_LINE_HEIGHT) + 'px';
            const p = TEXT_PAD * textAreaScale;
            textObj.input.style.padding = `${p}px ${TEXT_PAD_RIGHT * textAreaScale}px ${p}px ${p}px`;
            // 只按回车换行，不自动折行：编辑态与保存结果逐行一致
            textObj.input.style.whiteSpace = 'pre';
            textObj.input.style.overflow = 'hidden';
            textObj.input.scrollLeft = 0;
            textObj.input.scrollTop = 0;
        }
    }
    
    function setupTextBoxEvents(textObj) {
        const textBox = textObj.element;
        const input = textObj.input;
        
        // Click to select and edit
        textBox.addEventListener('click', (e) => {
            // 非文字模式下，不处理点击事件
            if (currentTool !== 'text') {
                return;
            }
            e.stopPropagation();
            // 检查是否在拖动结束后的安全延迟期内
            const timeSinceDragEnd = Date.now() - dragEndTime;
            if (timeSinceDragEnd < DRAG_END_SAFE_DELAY) {
                return; // 在安全延迟期内，禁止选中文字
            }
            selectTextElement(textObj);
        });

        // 右键菜单已移除，不再处理右键事件
        
        // Track mouse movement to distinguish between drag and click-to-select
        // 规则");        // - 未选中状态下：在 textarea 上按下只允许「拖动」或「单击选中");避免误触文字选择)
        // - 已选中状态下：textarea 交还浏览器原生行为（光标/选字），拖动请从边框/空白区域
        let mouseDownX = 0;
        let mouseDownY = 0;
        const DRAG_THRESHOLD = 5; // pixels
        
        // Handle mousedown on input - allow dragging if mouse moves
        input.addEventListener('mousedown', (e) => {
            // 非文字模式下，不处理鼠标按下事件
            if (currentTool !== 'text') {
                return;
            }
            e.stopPropagation();
            // 记录点击之前是否有选中的文字框（在 selectTextElement 之前）
            const wasPreviouslySelected = selectedTextElement !== null && selectedTextElement === textObj;

            // 已选中：交还浏览器原生选字/光标行为，避免“水平移动误判”导致闪烁
            if (wasPreviouslySelected) {
                return;
            }

            // 未选中：禁止文字选择，避免拖动时选中文字
            e.preventDefault();
            input.style.userSelect = 'none';

            // 先不选中，等确认是单击还是拖动后再决定
            mouseDownX = e.clientX;
            mouseDownY = e.clientY;

            // 使用局部变量跟踪是否发生了拖动
            let hasDragged = false;

            const checkDrag = (moveEvent) => {
                const deltaX = Math.abs(moveEvent.clientX - mouseDownX);
                const deltaY = Math.abs(moveEvent.clientY - mouseDownY);

                if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
                    hasDragged = true;
                    input.blur();
                    input.style.userSelect = 'none';

                    isDraggingText = true;
                    // 拖动时不选中文字框（避免 selected 样式来回切换造成闪烁）
                    if (selectedTextElement === textObj) {
                        selectedTextElement = null;
                        textBox.classList.remove('selected');
                        // 隐藏删除按键
                        if (textObj.deleteBtn) {
                            textObj.deleteBtn.style.display = 'none';
                        }
                    }
                    // 拖动文本时取消箭头工具的选中状态并隐藏操作点
                    if (selectedShapeElement) {
                        selectedShapeElement.isSelected = false;
                        selectedShapeElement = null;
                        // 隐藏所有箭头控制元素
                        document.querySelectorAll('.arrow-control-point, .arrow-start-delete-btn, .arrow-select-line, .arrow-hit-area').forEach(el => {
                            if (el) el.style.display = 'none';
                        });
                    }
                    draggingTextBoxElement = textBox;

                    textDragStartX = mouseDownX;
                    textDragStartY = mouseDownY;
                    textDragOffsetX = textObj.x;
                    textDragOffsetY = textObj.y;

                    document.removeEventListener('mousemove', checkDrag);
                    document.removeEventListener('mouseup', cleanup);

                    // 使用 setPointerCapture 确保即使鼠标移出元素也能继续捕获事件
                    if (textBox.setPointerCapture && moveEvent.pointerId !== undefined) {
                        try {
                            textBox.setPointerCapture(moveEvent.pointerId);
                        } catch (err) {
                            // 如果 setPointerCapture 失败，继续使用常规鼠标事件
                        }
                    }
                }
            };

            const cleanup = (upEvent) => {
                document.removeEventListener('mousemove', checkDrag);
                document.removeEventListener('mouseup', cleanup);

                // 如果发生了拖动，不选中文字
                if (hasDragged || isDraggingText) {
                    return;
                }

                // 单击：选中文字框，并恢复文字选择能力
                const deltaX = Math.abs(upEvent.clientX - mouseDownX);
                const deltaY = Math.abs(upEvent.clientY - mouseDownY);
                if (deltaX < DRAG_THRESHOLD && deltaY < DRAG_THRESHOLD) {
                    input.style.userSelect = 'text';
                    selectTextElement(textObj);
                }
            };

            document.addEventListener('mousemove', checkDrag);
            document.addEventListener('mouseup', cleanup);
        });
        
        // Drag (works when clicking anywhere on text box except input)
        textBox.addEventListener('mousedown', (e) => {
            // 非文字模式下，不处理鼠标按下事件
            if (currentTool !== 'text') {
                return;
            }
            // If clicking on input, let input handler deal with it
            if (e.target === input) return;
            // If clicking on delete button, let delete handler deal with it
            if (e.target === textObj.deleteBtn || e.target.closest('.text-box-delete-btn')) return;
            
            e.stopPropagation();
            const boxMouseDownX = e.clientX;
            const boxMouseDownY = e.clientY;
            const DRAG_THRESHOLD_BOX = 5; // pixels
            
            // 先不选中，等确认是单击还是拖动后再决定
            isDraggingText = false;
            draggingTextBoxElement = textBox;
            
            // 使用局部变量跟踪是否发生了拖动
            let hasDragged = false;
            
            // 设置拖动检查
            const checkBoxDrag = (moveEvent) => {
                const deltaX = Math.abs(moveEvent.clientX - boxMouseDownX);
                const deltaY = Math.abs(moveEvent.clientY - boxMouseDownY);
                
                // 如果移动超过阈值，触发拖动
                if (deltaX > DRAG_THRESHOLD_BOX || deltaY > DRAG_THRESHOLD_BOX) {
                    // 标记为已拖动
                    hasDragged = true;
                    // 拖动时不选中文字
                    isDraggingText = true;
                    if (selectedTextElement === textObj) {
                        selectedTextElement = null;
                        textBox.classList.remove('selected');
                        // 隐藏删除按键
                        if (textObj.deleteBtn) {
                            textObj.deleteBtn.style.display = 'none';
                        }
                    }
                    // 拖动文本时取消箭头工具的选中状态并隐藏操作点
                    if (selectedShapeElement) {
                        selectedShapeElement.isSelected = false;
                        selectedShapeElement = null;
                        // 隐藏所有箭头控制元素
                        document.querySelectorAll('.arrow-control-point, .arrow-start-delete-btn, .arrow-select-line, .arrow-hit-area').forEach(el => {
                            if (el) el.style.display = 'none';
                        });
                    }
                    
                    textDragStartX = boxMouseDownX;
                    textDragStartY = boxMouseDownY;
                    textDragOffsetX = textObj.x;
                    textDragOffsetY = textObj.y;
                    
                    document.removeEventListener('mousemove', checkBoxDrag);
                    document.removeEventListener('mouseup', cleanupBox);
                    
                    // 使用 setPointerCapture 确保即使鼠标移出元素也能继续捕获事件
                    if (textBox.setPointerCapture && moveEvent.pointerId !== undefined) {
                        try {
                            textBox.setPointerCapture(moveEvent.pointerId);
                        } catch (err) {
                            // 如果 setPointerCapture 失败，继续使用常规鼠标事件
                        }
                    }
                }
            };
            
            const cleanupBox = (upEvent) => {
                document.removeEventListener('mousemove', checkBoxDrag);
                document.removeEventListener('mouseup', cleanupBox);
                
                // 如果发生了拖动，不选中文字
                if (hasDragged || isDraggingText) {
                    return;
                }
                
                // 如果鼠标没有移动（单击），才选中文字
                const deltaX = Math.abs(upEvent.clientX - boxMouseDownX);
                const deltaY = Math.abs(upEvent.clientY - boxMouseDownY);
                if (deltaX < DRAG_THRESHOLD_BOX && deltaY < DRAG_THRESHOLD_BOX) {
                    // 这是单击，选中文字
                    selectTextElement(textObj);
                }
            };
            
            document.addEventListener('mousemove', checkBoxDrag);
            document.addEventListener('mouseup', cleanupBox);
        });
        
        // Handle wheel event on text box to scale text size
        textBox.addEventListener('wheel', (e) => {
            // Only handle if this text element is selected and text tool is active
            if (currentTool === 'text' && selectedTextElement === textObj) {
                handleWheel(e);
            }
        }, { passive: false });
        
        // Also handle wheel event on input element
        input.addEventListener('wheel', (e) => {
            // Only handle if this text element is selected and text tool is active
            if (currentTool === 'text' && selectedTextElement === textObj) {
                handleWheel(e);
            }
        }, { passive: false });
        
    }
    
    function updateTextBoxes() {
        textElements.forEach(textObj => {
            if (textObj.element) {
                // 文字框尺寸以基准坐标计算，缩放时同步刷新
                updateTextBoxSize(textObj);
                updateTextBoxPosition(textObj);
            }
        });
    }

    function drawTextOnCanvas(textObj) {
        if (!textObj.text) return;
        ctx.save();
        ctx.fillStyle = textObj.color;
        ctx.font = 'bold 24px Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        // Add text shadow for better visibility
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.fillText(textObj.text, textObj.x, textObj.y);
        ctx.restore();
    }

    function startCrop(x, y) {
        cropStartX = Math.max(0, Math.min(editorCanvas.width, x));
        cropStartY = Math.max(0, Math.min(editorCanvas.height, y));
        cropEndX = cropStartX;
        cropEndY = cropStartY;
        isCropping = true;
        cropOverlay.classList.remove('hidden');
        cropOverlay.classList.add('active');
        updateCropBox(cropStartX, cropStartY);
    }

    function updateCropBox(x, y) {
        const container = getCropContainer();
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        
        // Clamp coordinates 到图片范围内，防止选区超出图片本身
        const clampedX = Math.max(0, Math.min(editorCanvas.width, x));
        const clampedY = Math.max(0, Math.min(editorCanvas.height, y));
        
        // Calculate screen positions（转换到容器坐标系）
        const startX = cropStartX * scale + offsetX;
        const startY = cropStartY * scale + offsetY;
        const endX = clampedX * scale + offsetX;
        const endY = clampedY * scale + offsetY;
        
        let boxLeft = Math.min(startX, endX);
        let boxTop = Math.min(startY, endY);
        let boxWidth = Math.max(10, Math.abs(endX - startX));
        let boxHeight = Math.max(10, Math.abs(endY - startY));
        let boxRight = boxLeft + boxWidth;
        let boxBottom = boxTop + boxHeight;

        // 像右下角拖拽时一样，把四条边都限制在蓝色虚线区域");        // 这里使用“裁切框边缘 + 手柄”一起的安全边界，避免小方块手柄超出蓝色虚线
        const boundsLeft = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsTop = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsRight = containerRect.width - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);
        const boundsBottom = containerRect.height - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);

        // 使用“中心点 + 宽高”方式整体约束，避免先调整一侧再调整另一侧导致左上角漂出边界
        const boundsWidth = boundsRight - boundsLeft;
        const boundsHeight = boundsBottom - boundsTop;

        // 如果选框比可用区域还大，直接缩小到刚好放进可用区域
        boxWidth = Math.min(boxWidth, boundsWidth);
        boxHeight = Math.min(boxHeight, boundsHeight);

        let centerX = (boxLeft + boxRight) / 2;
        let centerY = (boxTop + boxBottom) / 2;
        const halfW = boxWidth / 2;
        const halfH = boxHeight / 2;

        if (centerX - halfW < boundsLeft) {
            centerX = boundsLeft + halfW;
        }
        if (centerX + halfW > boundsRight) {
            centerX = boundsRight - halfW;
        }
        if (centerY - halfH < boundsTop) {
            centerY = boundsTop + halfH;
        }
        if (centerY + halfH > boundsBottom) {
            centerY = boundsBottom - halfH;
        }

        boxLeft = centerX - halfW;
        boxRight = centerX + halfW;
        boxTop = centerY - halfH;
        boxBottom = centerY + halfH;

        cropBox.style.left = boxLeft + 'px';
        cropBox.style.top = boxTop + 'px';
        cropBox.style.width = (boxRight - boxLeft) + 'px';
        cropBox.style.height = (boxBottom - boxTop) + 'px';
    }

    // 固定裁切层：根据「画布可见区域」创建一个居中的固定裁切框
    function setupFixedCropBox() {
        if (!editorCanvas) return;
        const container = getCropContainer();
        if (!container) return;

        // 如果裁切框已有有效尺寸，则保持原状，不重复重置
        if (cropBox.offsetWidth > 10 && cropBox.offsetHeight > 10) {
            return;
        }

        // 使用 requestAnimationFrame 确保布局已经稳定
        requestAnimationFrame(() => {
            setupFixedCropBoxInternal();
        });
    }
    
    function setupFixedCropBoxInternal() {
        if (!editorCanvas) return;
        const container = getCropContainer();
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        const canvasRect = editorCanvas.getBoundingClientRect();

        // 画布在容器坐标系中的位置和尺寸
        const canvasWidth = canvasRect.width;
        const canvasHeight = canvasRect.height;
        const canvasOffsetLeft = canvasRect.left - containerRect.left;
        const canvasOffsetTop = canvasRect.top - containerRect.top;

        // 根据图片本身的宽高比来生成裁切框，使裁切框与图片同比
        const imgWidth = editorCanvas.width;
        const imgHeight = editorCanvas.height;
        if (!imgWidth || !imgHeight) return;
        const imgAspect = imgWidth / imgHeight; // w / h

        // 在不超过「画布」的前提下，尽量大地放置一个与图片等比的裁切框
        const maxBoxWidth = canvasWidth * 0.9;
        const maxBoxHeight = canvasHeight * 0.9;
        let boxWidth = maxBoxWidth;
        let boxHeight = boxWidth / imgAspect;

        if (boxHeight > maxBoxHeight) {
            boxHeight = maxBoxHeight;
            boxWidth = boxHeight * imgAspect;
        }

        // 让裁切框在“画布矩形内部”居中，而不是在整个容器里居中
        let left = canvasOffsetLeft + (canvasWidth - boxWidth) / 2;
        let top = canvasOffsetTop + (canvasHeight - boxHeight) / 2;

        // 裁切框必须完全落在“视觉画布区域”内，并向内缩进几个像素（包含四个角的手柄）
        const visualLeft = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const visualTop = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const visualRight = containerRect.width - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);
        const visualBottom = containerRect.height - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);

        // 如果裁切框比视觉区域还大，按比例缩小到刚好放得下
        const maxVisualWidth = visualRight - visualLeft;
        const maxVisualHeight = visualBottom - visualTop;
        const widthScale = maxVisualWidth / boxWidth;
        const heightScale = maxVisualHeight / boxHeight;
        const scaleLimit = Math.min(1, widthScale, heightScale);
        if (scaleLimit < 1) {
            boxWidth *= scaleLimit;
            boxHeight *= scaleLimit;
            left = canvasOffsetLeft + (canvasWidth - boxWidth) / 2;
            top = canvasOffsetTop + (canvasHeight - boxHeight) / 2;
        }

        // 再次确保四条边都在视觉区域内部（含内边距）
        let boxLeft = left;
        let boxTop = top;
        let boxRight = boxLeft + boxWidth;
        let boxBottom = boxTop + boxHeight;

        const visualWidth = visualRight - visualLeft;
        const visualHeight = visualBottom - visualTop;

        // 如果裁切框比视觉区域还大，缩小到刚好放进视觉区域
        boxWidth = Math.min(boxWidth, visualWidth);
        boxHeight = Math.min(boxHeight, visualHeight);

        let centerX = (boxLeft + boxRight) / 2;
        let centerY = (boxTop + boxBottom) / 2;
        const halfW = boxWidth / 2;
        const halfH = boxHeight / 2;

        if (centerX - halfW < visualLeft) {
            centerX = visualLeft + halfW;
        }
        if (centerX + halfW > visualRight) {
            centerX = visualRight - halfW;
        }
        if (centerY - halfH < visualTop) {
            centerY = visualTop + halfH;
        }
        if (centerY + halfH > visualBottom) {
            centerY = visualBottom - halfH;
        }

        boxLeft = centerX - halfW;
        boxRight = centerX + halfW;
        boxTop = centerY - halfH;
        boxBottom = centerY + halfH;

        // cropBox 相对于容器（或覆盖层）绝对定位，尺寸与图片保持同一比例
        cropBox.style.left = boxLeft + 'px';
        cropBox.style.top = boxTop + 'px';
        cropBox.style.width = (boxRight - boxLeft) + 'px';
        cropBox.style.height = (boxBottom - boxTop) + 'px';

        // 初始化一次偏移约束，避免一开始就有空白
        constrainOffset();

        // 记录当前裁切框尺寸作为"基准尺寸"，用于后续切换比例时避免越切越小
        cropAspectBaseWidth = boxRight - boxLeft;
        cropAspectBaseHeight = boxBottom - boxTop;
    }

    // --- 裁切框右下角拖拽调整大小 ---
    let isResizingCropBox = false;
    // 记录拖拽开始时裁切框的四个边（相对于容器坐标）
    let cropResizeStartLeft = 0;
    let cropResizeStartTop = 0;
    let cropResizeStartRight = 0;
    let cropResizeStartBottom = 0;

    // 允许点击裁切框右下角一块较大的区域进行缩放（增大热区，方便点击）
    cropBox.addEventListener('mousedown', (e) => {
        if (currentTool !== 'crop') return;
        // 只有“自由”裁切模式允许拖动右下角调整大小，其余固定比例模式下尺寸锁定
        if (cropAspectMode !== 'free') return;

        const rect = cropBox.getBoundingClientRect();
        const handleSize = 28; // 放大可点击区域
        const inRight = e.clientX >= rect.right - handleSize && e.clientX <= rect.right;
        const inBottom = e.clientY >= rect.bottom - handleSize && e.clientY <= rect.bottom;

        if (inRight && inBottom) {
            e.stopPropagation();
            e.preventDefault();
            isResizingCropBox = true;
            const container = getCropContainer();
            if (!container) return;
            const containerRect = container.getBoundingClientRect();

            const boxRect = cropBox.getBoundingClientRect();
            // 记录拖拽开始时裁切框的四条边（容器坐标）
            cropResizeStartLeft = boxRect.left - containerRect.left;
            cropResizeStartTop = boxRect.top - containerRect.top;
            cropResizeStartRight = cropResizeStartLeft + boxRect.width;
            cropResizeStartBottom = cropResizeStartTop + boxRect.height;

            document.body.style.cursor = 'nwse-resize';
        }
    });

    // 根据当前裁切比例模式返回宽高比（w / h）
    function getCropAspectValue() {
        switch (cropAspectMode) {
            case '1:1': return 1;
            case '4:3': return 4 / 3;
            case '3:4': return 3 / 4;
            case '9:16': return 9 / 16;
            case '16:9': return 16 / 9;
            default: return null; // free
        }
    }

    document.addEventListener('mousemove', (e) => {
        if (!isResizingCropBox) return;
        const container = getCropContainer();
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const currentX = e.clientX - containerRect.left;
        const currentY = e.clientY - containerRect.top;

        // 鼠标拖动右下角：右下角跟随鼠标移动，左上角按相反方向同距离移动
        const dx = currentX - cropResizeStartRight;
        const dy = currentY - cropResizeStartBottom;

        let newRight = cropResizeStartRight + dx;
        let newBottom = cropResizeStartBottom + dy;
        let newLeft = cropResizeStartLeft - dx;
        let newTop = cropResizeStartTop - dy;

        // 保证最小尺寸
        const minSize = 40;
        let width = newRight - newLeft;
        let height = newBottom - newTop;

        if (width < minSize) {
            const adjust = (minSize - width) / 2;
            newLeft -= adjust;
            newRight += adjust;
            width = minSize;
        }
        if (height < minSize) {
            const adjust = (minSize - height) / 2;
            newTop -= adjust;
            newBottom += adjust;
            height = minSize;
        }

        // 按比例锁定裁切框（非“自由”模式）
        const aspect = getCropAspectValue();
        if (aspect) {
            const centerX = (newLeft + newRight) / 2;
            const centerY = (newTop + newBottom) / 2;
            let newWidth = width;
            let newHeight = height;
            const currentAspect = width / height;

            if (currentAspect > aspect) {
                // 太宽，收窄宽度
                newWidth = height * aspect;
            } else {
                // 太高，收窄高度
                newHeight = width / aspect;
            }

            // 再次保证最小尺寸
            if (newWidth < minSize) {
                newWidth = minSize;
                newHeight = newWidth / aspect;
            }
            if (newHeight < minSize) {
                newHeight = minSize;
                newWidth = newHeight * aspect;
            }

            newLeft = centerX - newWidth / 2;
            newRight = centerX + newWidth / 2;
            newTop = centerY - newHeight / 2;
            newBottom = centerY + newHeight / 2;
            width = newWidth;
            height = newHeight;
        }

        // 保证裁切框不会跑出“视觉画布区域”（即黑色背景区域），并向内缩进 CROP_BOX_MARGIN 像素
        // 同时考虑角上小方块手柄的外延，把“裁切框 + 手柄”整体限制在蓝色虚线内
        const boundsLeft = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsTop = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsRight = containerRect.width - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);
        const boundsBottom = containerRect.height - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);

        const boundsWidth = boundsRight - boundsLeft;
        const boundsHeight = boundsBottom - boundsTop;

        // 如果按比例最小尺寸计算出的裁切框比可用区域还大，缩小到刚好放进可用区域
        width = Math.min(width, boundsWidth);
        height = Math.min(height, boundsHeight);

        // 使用中心点整体平移方式约束在边界内，防止“先调一边再调另一边”导致左上角点漂出去
        let centerX = (newLeft + newRight) / 2;
        let centerY = (newTop + newBottom) / 2;
        const halfW = width / 2;
        const halfH = height / 2;

        if (centerX - halfW < boundsLeft) {
            centerX = boundsLeft + halfW;
        }
        if (centerX + halfW > boundsRight) {
            centerX = boundsRight - halfW;
        }
        if (centerY - halfH < boundsTop) {
            centerY = boundsTop + halfH;
        }
        if (centerY + halfH > boundsBottom) {
            centerY = boundsBottom - halfH;
        }

        newLeft = centerX - halfW;
        newRight = centerX + halfW;
        newTop = centerY - halfH;
        newBottom = centerY + halfH;

        // 更新裁切框位置和尺寸
        cropBox.style.left = newLeft + 'px';
        cropBox.style.top = newTop + 'px';
        cropBox.style.width = (newRight - newLeft) + 'px';
        cropBox.style.height = (newBottom - newTop) + 'px';

        // 裁切框变大可能导致图片不再完全覆盖裁切区域，这里自动放大图片并重新约束偏移
        autoScaleToFillCropBox();
        constrainOffset();
        updateCanvasTransform();
    });

    document.addEventListener('mouseup', () => {
        if (isResizingCropBox) {
            isResizingCropBox = false;
            document.body.style.cursor = '';

            // 拖拽结束后，把当前裁切框尺寸记录为新的基准尺寸
            if (cropBox) {
                cropAspectBaseWidth = cropBox.offsetWidth;
                cropAspectBaseHeight = cropBox.offsetHeight;
            }
        }
    });

    // 顶部“还原视图”按钮：重置缩放与位置
    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', () => {
            scale = initialScale;
            offsetX = initialOffsetX;
            offsetY = initialOffsetY;
            constrainOffset();
            updateCanvasTransform();
        });
    }

    // 文字颜色预设按钮
    if (textColorPresetButtons && textColorPresetButtons.length > 0) {
        textColorPresetButtons.forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                currentTextColor = color; // 保存当前颜色，用于文字、箭头和方框
                
                if (currentTool === 'text' && selectedShapeElement) {
                    // 选中形状时，更新形状颜色
                    selectedShapeElement.color = color;
                    if (selectedShapeElement.path) {
                        selectedShapeElement.path.setAttribute('stroke', color);
                    }
                    updateTextColorPresets();
                    saveState();
                    redrawCanvas();
                } else if (currentTool === 'text' && selectedTextElement) {
                    selectedTextElement.color = color;
                    if (selectedTextElement.input) {
                        selectedTextElement.input.style.color = color;
                    }
                    updateTextColorPresets();
                    if (selectedTextElement.text && selectedTextElement.text.trim()) saveState();
                    redrawCanvas();
                } else if (currentTool === 'text' && currentTextElement) {
                    // 如果正在创建新文字，设置默认颜色
                    currentTextElement.color = color;
                    if (currentTextElement.input) {
                        currentTextElement.input.style.color = color;
                    }
                    updateTextColorPresets();
                    redrawCanvas();
                } else {
                    // 没有选中任何元素：只更新当前颜色，下一个文字/箭头/方框使用它
                    updateTextColorPresets();
                }
            });
        });
    }

    // 裁切比例按钮
    if (cropRatioButtons && cropRatioButtons.length) {
        cropRatioButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const ratio = btn.dataset.ratio || 'free';
                cropAspectMode = ratio;
                // 激活样式
                cropRatioButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (!cropBox || currentTool !== 'crop') {
                    return;
                }

                // “自由”模式：仅记录当前尺寸为基准尺寸，后续切到固定比例时以此为基础
                if (ratio === 'free') {
                    cropAspectBaseWidth = cropBox.offsetWidth;
                    cropAspectBaseHeight = cropBox.offsetHeight;
                    return;
                }

                // 固定比例模式：如果还没有基准尺寸，用当前尺寸初始化
                if (!cropAspectBaseWidth || !cropAspectBaseHeight) {
                    cropAspectBaseWidth = cropBox.offsetWidth;
                    cropAspectBaseHeight = cropBox.offsetHeight;
                }

                // 立即按新比例调整当前裁切框
                applyAspectRatioToCurrentCropBox();
                autoScaleToFillCropBox();
                constrainOffset();
                updateCanvasTransform();
            });
        });
    }

    function autoScaleToFillCropBox() {
        if (!editorCanvas || !cropBox) return;
        const container = getCropContainer();
        const containerRect = container.getBoundingClientRect();
        const cropRect = cropBox.getBoundingClientRect();

        const cropWidth = cropRect.width;
        const cropHeight = cropRect.height;
        if (cropWidth <= 0 || cropHeight <= 0) return;

        const requiredScaleX = cropWidth / editorCanvas.width;
        const requiredScaleY = cropHeight / editorCanvas.height;
        // 与滚轮缩放保持一致，加一个非常小的安全系数，确保图片略大于裁切框
        const SAFE_CROP_SCALE = 1.02;
        const requiredScale = Math.max(requiredScaleX, requiredScaleY) * SAFE_CROP_SCALE;

        // 最终缩放不能小于基础最小缩放
        const minScale = Math.max(baseScale * 0.5, requiredScale);
        if (scale >= minScale) return; // 当前缩放已足够覆盖裁切框

        // 围绕裁切框中心进行放大，保持裁切区域内的内容大致不变
        const cropCenterX = cropRect.left - containerRect.left + cropWidth / 2;
        const cropCenterY = cropRect.top - containerRect.top + cropHeight / 2;

        const canvasMouseX = (cropCenterX - offsetX) / scale;
        const canvasMouseY = (cropCenterY - offsetY) / scale;

        const newScale = minScale;
        offsetX = cropCenterX - canvasMouseX * newScale;
        offsetY = cropCenterY - canvasMouseY * newScale;
        scale = newScale;
    }

    // 根据当前比例模式，立即调整现有裁切框到固定比例
    function applyAspectRatioToCurrentCropBox() {
        if (!editorCanvas || !cropBox) return;
        const aspect = getCropAspectValue();
        if (!aspect) return;

        const container = getCropContainer();
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
    
        const boundsLeft = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsTop = CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE;
        const boundsRight = containerRect.width - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);
        const boundsBottom = containerRect.height - (CROP_BOX_MARGIN + CROP_BOX_HANDLE_SAFE);

        const maxWidth = boundsRight - boundsLeft;
        const maxHeight = boundsBottom - boundsTop;

        // 有固定比例时，让裁切框“长边尽量顶满”蓝色虚线区域
        // 根据比例判断长边，并优先让长边贴满对应方向的可用空间
        let newWidth;
        let newHeight;
        if (aspect >= 1) {
            // 宽边更长，优先让宽度顶满
            newWidth = maxWidth;
            newHeight = newWidth / aspect;
            // 如果高度超出，则退而求其次让高度顶满
            if (newHeight > maxHeight) {
                newHeight = maxHeight;
                newWidth = newHeight * aspect;
            }
        } else {
            // 高边更长，优先让高度顶满
            newHeight = maxHeight;
            newWidth = newHeight * aspect;
            // 如果宽度超出，则退而求其次让宽度顶满
            if (newWidth > maxWidth) {
                newWidth = maxWidth;
                newHeight = newWidth / aspect;
            }
        }

        // 最小尺寸限制
        const minSize = 40;
        if (newWidth < minSize) {
            newWidth = minSize;
            newHeight = newWidth / aspect;
        }
        if (newHeight < minSize) {
            newHeight = minSize;
            newWidth = newHeight * aspect;
        }

        // 在视觉区域内居中放置裁切
        const visualWidth = boundsRight - boundsLeft;
        const visualHeight = boundsBottom - boundsTop;
        const newLeft = boundsLeft + (visualWidth - newWidth) / 2;
        const newTop = boundsTop + (visualHeight - newHeight) / 2;

        cropBox.style.left = newLeft + 'px';
        cropBox.style.top = newTop + 'px';
        cropBox.style.width = newWidth + 'px';
        cropBox.style.height = newHeight + 'px';

        // 更新基准尺寸为当前尺寸，避免后续切换时越切越小
        cropAspectBaseWidth = newWidth;
        cropAspectBaseHeight = newHeight;

        // 切换比例后，可能导致裁切框变大，为避免出现空白，这里自动放大图片并重新约束偏移
        autoScaleToFillCropBox();
        constrainOffset();
        updateCanvasTransform();
    }

    async function saveEditedImage() {
        // Check if originalImage is loaded（直接从 window 对象读取）
        const windowOriginalImage = window.originalImage;
        if (!windowOriginalImage || !windowOriginalImage.complete) {
            console.error('[ImageEditor] 原图未加载完成，无法保存');
            alert('图片未加载完成，请稍后重试');
            return;
        }
        
        // Redraw everything on a fresh canvas
        const tempCanvas = document.createElement('canvas');
        let finalWidth = editorCanvas.width;
        let finalHeight = editorCanvas.height;
        let sx = 0, sy = 0, sw = editorCanvas.width, sh = editorCanvas.height;
        
        // 固定裁切层：根据裁切框在屏幕中的位置 + 当前缩放/偏移，反推在图片上的裁切区域
        const container = getCropContainer();
        if (container && cropBox) {
            const containerRect = container.getBoundingClientRect();
            const cropRect = cropBox.getBoundingClientRect();
            const cropWidthScreen = cropRect.width;
            const cropHeightScreen = cropRect.height;

            if (cropWidthScreen > 10 && cropHeightScreen > 10) {
                // 裁切框左上角在容器中的坐标
                const leftInContainer = cropRect.left - containerRect.left;
                const topInContainer = cropRect.top - containerRect.top;

                // 裁切框四个角在画布坐标系中的位置（反推缩放和平移）
                const x1 = (leftInContainer - offsetX) / scale;
                const y1 = (topInContainer - offsetY) / scale;
                const x2 = (leftInContainer + cropWidthScreen - offsetX) / scale;
                const y2 = (topInContainer + cropHeightScreen - offsetY) / scale;

                sx = Math.min(x1, x2);
                sy = Math.min(y1, y2);
                sw = Math.abs(x2 - x1);
                sh = Math.abs(y2 - y1);

                // Clamp to canvas bounds，确保不会超出图片范围
                sx = Math.max(0, Math.min(editorCanvas.width, sx));
                sy = Math.max(0, Math.min(editorCanvas.height, sy));
                sw = Math.min(editorCanvas.width - sx, sw);
                sh = Math.min(editorCanvas.height - sy, sh);

                finalWidth = sw;
                finalHeight = sh;
            }
        }
        
        tempCanvas.width = finalWidth;
        tempCanvas.height = finalHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';

        // Draw original image (cropped if needed)
        tempCtx.drawImage(windowOriginalImage, sx, sy, sw, sh, 0, 0, finalWidth, finalHeight);

        // 直接从 brushCanvas 复制绘制内容（而不是重新绘制 brushStrokes）
        // 这样可以确保所有的绘制效果（抗锯齿、半透明等）都被正确保存
        if (brushCanvas) {
            tempCtx.drawImage(brushCanvas, sx, sy, sw, sh, 0, 0, finalWidth, finalHeight);
        } else {
            // 备选方案：从 brushStrokes 重新绘制
            brushStrokes.forEach((stroke, idx) => {
                if (stroke.points.length === 0) return;

                const canvasBrushWidth = stroke.width * (editorCanvas.width / textAreaWidth);

                tempCtx.save();
                if (stroke.mode === 'eraser') {
                    tempCtx.globalCompositeOperation = 'destination-out';
                    tempCtx.strokeStyle = 'rgba(0,0,0,1)';
                } else {
                    tempCtx.globalCompositeOperation = 'source-over';
                    tempCtx.strokeStyle = stroke.color;
                }
                tempCtx.lineWidth = canvasBrushWidth;
                tempCtx.lineCap = 'round';
                tempCtx.lineJoin = 'round';
                tempCtx.beginPath();

                let firstPoint = true;
                stroke.points.forEach(point => {
                    const adjustedX = point.x - sx;
                    const adjustedY = point.y - sy;

                    if (adjustedX >= 0 && adjustedY >= 0 && adjustedX < finalWidth && adjustedY < finalHeight) {
                        if (firstPoint) {
                            tempCtx.moveTo(adjustedX, adjustedY);
                            firstPoint = false;
                        } else {
                            tempCtx.lineTo(adjustedX, adjustedY);
                        }
                    }
                });

                if (!firstPoint) {
                    tempCtx.stroke();
                }
                tempCtx.restore();
            });
        }
        
        // Draw text elements (adjusted for crop，支持换自动换行)
        // textObj.x/y 是文字区域坐标，需要转换为图片坐标
        // textObj.fontSize 存储的是文字区域基准（1000）下的字体大小
        // 需要转换为画布像素值：fontSize * (editorCanvas.width / textAreaWidth)
        // 这样文字在保存的图片中的大小和在编辑器中的显示大小一致（不考虑scale，因为保存的是画布像素）

        textElements.forEach(textObj => {
            if (textObj.text) {
                // Convert text area coordinates to image coordinates
                const imageCoords = textAreaToImageCoords(textObj.x, textObj.y);
                const textX = imageCoords.x - sx;
                const textY = imageCoords.y - sy;
                
                tempCtx.save();
                tempCtx.fillStyle = textObj.color;
                // fontSize 存储的是文字区域基准（1000）下的字体大小，需要转换为画布像素值
                // 注意：这里不使用scale，因为保存的是画布像素，不是屏幕像素
                // 显示时：scaledFontSize = textObj.fontSize * scale * (editorCanvas.width / textAreaWidth)
                // 保存时：canvasFontSize = textObj.fontSize * (editorCanvas.width / textAreaWidth)
                const canvasFontSize = (textObj.fontSize || 18) * (editorCanvas.width / textAreaWidth);
                const lineHeight = canvasFontSize * 1.2;
                tempCtx.font = `bold ${canvasFontSize}px Arial, sans-serif`;
                // 必须先设为 alphabetic 再测量，fontBoundingBox* 是相对当前基线的
                tempCtx.textBaseline = 'alphabetic';
                tempCtx.textAlign = 'left';
                const ratio = (editorCanvas.width / textAreaWidth);

                // 与编辑器一致：只按换行符分行
                const lines = String(textObj.text).split(/\r?\n/);
                // 与 CSS 行盒一致的基线位置：半行距 + 字体 ascent
                const fm = tempCtx.measureText('Mg');
                const asc = fm.fontBoundingBoxAscent || canvasFontSize * 0.905;
                const desc = fm.fontBoundingBoxDescent || canvasFontSize * 0.212;
                const baselineOffset = (lineHeight - (asc + desc)) / 2 + asc;
                const padPx = TEXT_PAD * ratio;

                // 估算整块文字区域尺寸（用于与图片区域做相交判断）
                let maxLineWidth = 0;
                lines.forEach(line => {
                    const metrics = tempCtx.measureText(line || ' ');
                    if (metrics.width > maxLineWidth) {
                        maxLineWidth = metrics.width;
                    }
                });
                const textWidth = maxLineWidth;
                const textHeight = lineHeight * lines.length;

                // Check if text box intersects with image bounds (with margin for shadow)
                const margin = 10; // Margin for shadow and text overflow
                const textRight = textX + textWidth + margin;
                const textBottom = textY + textHeight + margin;
                const textLeft = textX - margin;
                const textTop = textY - margin;

                // Draw text if it intersects with the image area
                // Canvas will automatically clip anything outside bounds, so我们可以宽松一些
                if (textRight > 0 && textBottom > 0 && textLeft < finalWidth && textTop < finalHeight) {
                    tempCtx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                    tempCtx.shadowBlur = 2;
                    tempCtx.shadowOffsetX = 1;
                    tempCtx.shadowOffsetY = 1;
                    // 逐行绘制，保留换行
                    lines.forEach((line, index) => {
                        const lineY = textY + padPx + index * lineHeight + baselineOffset;
                        tempCtx.fillText(line, textX + padPx, lineY);
                    });
                }
                tempCtx.restore();
            }
        });
        
        // 绘制箭头和方框到画布
        const ratio = editorCanvas.width / textAreaWidth;
        const strokeWidthRatio = (shapeBaseStrokeWidth || 3) * ratio;
        const arrowLengthRatio = (shapeBaseArrowLength || 15) * ratio;
        
        shapeElements.forEach(shapeObj => {
            if (shapeObj.startX == null || shapeObj.endX == null) return;
            
            // 转换为画布坐标
            const imgStartX = shapeObj.startX * ratio;
            const imgStartY = shapeObj.startY * ratio;
            const imgEndX = shapeObj.endX * ratio;
            const imgEndY = shapeObj.endY * ratio;
            
            tempCtx.save();
            tempCtx.strokeStyle = shapeObj.color || '#ff0000';
            tempCtx.lineWidth = (shapeObj.strokeWidth || 3) * ratio;
            tempCtx.lineCap = 'round';
            tempCtx.lineJoin = 'round';
            
            if (shapeObj.type === 'arrow') {
                // 绘制箭头主线
                tempCtx.beginPath();
                tempCtx.moveTo(imgStartX - sx, imgStartY - sy);
                tempCtx.lineTo(imgEndX - sx, imgEndY - sy);
                tempCtx.stroke();
                
                // 绘制箭头头部
                const dx = imgEndX - imgStartX;
                const dy = imgEndY - imgStartY;
                const angle = Math.atan2(dy, dx);
                const arrowAngle = Math.PI / 6;
                const arrowLen = (shapeObj.arrowLength || 15) * ratio;
                
                const arrowPoint1X = imgEndX - arrowLen * Math.cos(angle - arrowAngle);
                const arrowPoint1Y = imgEndY - arrowLen * Math.sin(angle - arrowAngle);
                const arrowPoint2X = imgEndX - arrowLen * Math.cos(angle + arrowAngle);
                const arrowPoint2Y = imgEndY - arrowLen * Math.sin(angle + arrowAngle);
                
                tempCtx.beginPath();
                tempCtx.moveTo(arrowPoint1X - sx, arrowPoint1Y - sy);
                tempCtx.lineTo(imgEndX - sx, imgEndY - sy);
                tempCtx.lineTo(arrowPoint2X - sx, arrowPoint2Y - sy);
                tempCtx.stroke();
            } else if (shapeObj.type === 'rect') {
                // 绘制方框
                const rectX = Math.min(imgStartX, imgEndX) - sx;
                const rectY = Math.min(imgStartY, imgEndY) - sy;
                const rectWidth = Math.abs(imgEndX - imgStartX);
                const rectHeight = Math.abs(imgEndY - imgStartY);
                
                tempCtx.beginPath();
                tempCtx.rect(rectX, rectY, rectWidth, rectHeight);
                tempCtx.stroke();
            }
            
            tempCtx.restore();
        });
        
        // 将编辑后的图片转为Blob，使用JPEG格式并控制质量
        // 使用 toDataURL 然后转换为 Blob，确保格式正确
        const getCanvasBlob = (canvas, quality = 1) => {
            return new Promise((resolve) => {
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const byteString = atob(dataUrl.split(',')[1]);
                const mimeString = 'image/jpeg';
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mimeString });
                resolve(blob);
            });
        };

        // 生成编辑后的图片Blob
        let editedBlob = await getCanvasBlob(tempCanvas, 1);

        // 画布等外部场景的保存钩子：若设置了回调则交给回调处理，跳过默认的主页参考图逻辑
        if (typeof window.imageEditorOnSave === 'function') {
            const payload = {
                blob: editedBlob,
                originalUrl: window._imageEditorOriginalUrl || null,
                imageIndex: currentImageIndex,
                canvas: tempCanvas
            };
            // 先关闭编辑器，再异步执行回调（回调内部上传图片可能耗时几秒）
            // 这样用户点击保存后编辑框立即关闭，由画布侧显示"上传中"节点
            closeEditor();
            try {
                await window.imageEditorOnSave(payload);
            } catch (e) {
                console.error('[ImageEditor] 外部 onSave 回调出错:', e);
            }
            return;
        }

        // 同步保存并关闭
        // 确保 window.uploadedImages 与 PromptBar.uploadedImages 引用同步(避免 setReferenceImages 等断开引用)
        if (typeof PromptBar !== 'undefined' && PromptBar.uploadedImages) {
            window.uploadedImages = PromptBar.uploadedImages;
        }
        // 保留原来的 fileId,让 @ 标签能继续跟踪(updateImageTags 用 fileId 定位)
        const oldFileId = (window.uploadedImages[currentImageIndex] && window.uploadedImages[currentImageIndex].fileId) || '';
        window.uploadedImages[currentImageIndex] = {
            fileId: oldFileId,
            loading: true  // 标记为上传中，显示加载动画
        };
        window.renderRefs();
        closeEditor();

        // 自动上传编辑后的图片到TOS
        (async () => {
            try {
                // 获取后端URL
                const getBackendUrl = window.getBackendUrl || function() {
                    const host = window.location.hostname;
                    const port = 3001;
                    return `http://${host}:${port}`;
                };
                const backendUrl = getBackendUrl();

                // 使用已经生成的 editedBlob
                const formData = new FormData();
                formData.append('file', editedBlob, 'edited_image.jpg');
                if (window.PxThumb) await window.PxThumb.attach(formData, editedBlob);

                // 使用 upload-edited-reference 接口上传（完整图上传到TOS）
                // 后端接口要求登录鉴权，必须携带 Authorization 头
                const uploadHeaders = {};
                try {
                    const user = JSON.parse(localStorage.getItem('nano_user') || '{}');
                    if (user.token) uploadHeaders['Authorization'] = 'Bearer ' + user.token;
                } catch (e) {}
                const uploadRes = await fetch(`${backendUrl}/v1/image/upload-edited-reference`, {
                    method: 'POST',
                    headers: uploadHeaders,
                    body: formData
                });

                if (!uploadRes.ok) {
                    throw new Error(`上传失败 (${uploadRes.status})`);
                }

                const result = await uploadRes.json();
                if (result.code === 0 && result.data && result.data.fullUrl) {
                    // 上传成功，更新图片数据
                    if (window.uploadedImages[currentImageIndex] &&
                        window.uploadedImages[currentImageIndex].fileId === oldFileId) {
                        window.uploadedImages[currentImageIndex] = {
                            highUrl: result.data.fullUrl,          // TOS持久URL（完整图）- 使用 highUrl 保持一致性
                            previewUrl: result.data.previewUrl,    // 实时处理URL（150px预览图）
                            fullKey: result.data.fullKey,          // TOS key
                            isUploaded: true,
                            isFromEdit: true,                      // 标记为编辑后的图片
                            fileId: oldFileId,                     // 保留原 fileId,@ 标签继续跟踪
                            loading: false
                        };
                        // 预加载完整图
                        const preloadImg = new Image();
                        preloadImg.src = result.data.fullUrl;
                        window.uploadedImages[currentImageIndex].preloadedImg = preloadImg;
                        window.renderRefs();

                        // 更新提示词内的图片标签预览图
                        if (window.updateImageTags) {
                            window.updateImageTags();
                        }
                    }
                } else {
                    throw new Error(result.msg || '上传失败');
                }
            } catch (err) {
                console.error('[编辑图片上传] 失败:', err);
                // 上传失败，显示错误状态
                if (window.uploadedImages[currentImageIndex] &&
                    window.uploadedImages[currentImageIndex].fileId === oldFileId) {
                    window.uploadedImages[currentImageIndex].loading = false;
                    window.uploadedImages[currentImageIndex].error = true;
                    window.renderRefs();
                }
            }
        })();
    }

    // 窗口或编辑区尺寸变化：按新尺寸重新适配并居中
    function refitEditorView() {
        if (!isImageLoaded || !originalImage || imageEditorModal.classList.contains('hidden')) return;
        const container = editorCanvas.parentElement;
        const rect = container.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        const fitScale = Math.min((rect.width - 64) / originalImage.width, (rect.height - 64) / originalImage.height);
        if (!(fitScale > 0)) return;
        baseScale = fitScale;
        initialScale = fitScale;
        initialOffsetX = (rect.width - originalImage.width * fitScale) / 2;
        initialOffsetY = (rect.height - originalImage.height * fitScale) / 2;
        scale = initialScale;
        offsetX = initialOffsetX;
        offsetY = initialOffsetY;
        updateCanvasTransform();
        if (currentTool === 'crop') {
            updateVisualCanvasOverlay();
            setupFixedCropBox();
        }
    }
    let refitTimer = null;
    let lastContainerSize = '';
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver((entries) => {
            const r = entries[0].contentRect;
            const key = Math.round(r.width) + 'x' + Math.round(r.height);
            if (key === lastContainerSize) return;
            const first = !lastContainerSize || lastContainerSize === '0x0';
            lastContainerSize = key;
            if (first) return; // 打开编辑器时的首次布局由 openImageEditor 处理
            clearTimeout(refitTimer);
            refitTimer = setTimeout(refitEditorView, 80);
        }).observe(editorCanvas.parentElement);
    }

    window.openImageEditor = openImageEditor;
    
    // 暴露形状相关函数到 window 对象，供 script.js 调用
    window.createTempShapeElement = createTempShapeElement;
    window.updateTempShapeElement = updateTempShapeElement;
    window.finishShape = finishShape;
    window.createShapeElement = createShapeElement;
    window.updateShapeSvgPath = updateShapeSvgPath;
    window.updateShapeBoxPosition = updateShapeBoxPosition;
    window.updateArrowSelectLine = updateArrowSelectLine;
    window.updateArrowControlPointPosition = updateArrowControlPointPosition;
    window.selectShapeElement = selectShapeElement;
    window.deselectShapeElement = deselectShapeElement;
    window.deleteShapeElement = deleteShapeElement;

