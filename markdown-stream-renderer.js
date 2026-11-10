/**
 * 基于 marked 的流式 Markdown 渲染器
 * 利用 marked 的 lexer 解析 tokens，实现可靠的流式渲染
 */

// HTML净化：剥离危险标签、事件属性和危险协议，防止XSS
// 挂到 window 上供主页 renderMarkdown 等其他渲染路径复用
function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    let s = html;
    // 移除危险标签及其内容
    s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '');
    s = s.replace(/<object[\s\S]*?<\/object\s*>/gi, '');
    s = s.replace(/<embed[\s\S]*?>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
    s = s.replace(/<form[\s\S]*?>/gi, '');
    // 移除自闭合的危险标签
    s = s.replace(/<(script|iframe|object|embed|link|meta|base)[^>]*\/?>/gi, '');
    // 移除所有 on 开头的事件属性
    s = s.replace(/\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)/gi, '');
    // 移除 javascript: 和 data:text/html 协议的链接
    s = s.replace(/(href|src|action|formaction)\s*=\s*(\"\s*(javascript|data:text\/html)[^\"]*\"|'\s*(javascript|data:text\/html)[^']*'|=\s*(javascript|data:text\/html)[^\s>]*)/gi, '$1="#"');
    return s;
}
if (typeof window !== 'undefined') {
    window.sanitizeHtml = sanitizeHtml;
}

class StreamMarkdownRenderer {
    constructor(container) {
        this.container = container;
        this.accumulatedText = '';
        this.renderedHTML = '';
        this.pendingText = '';
        this.isComplete = false;

        // 配置 marked - 使用最宽松的解析规则
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false,
            sanitize: false,
            smartLists: true,
            smartypants: false,
            xhtml: false
        });
    }

    /**
     * 逐字符流入
     */
    push(char) {
        this.accumulatedText += char;
        this.pendingText += char;
        
        // 尝试渲染
        this.tryRender();
    }

    /**
     * 尝试渲染当前累积的文本
     * 策略：
     * 1. 每 N 个字符渲染一次，保持流式效果
     * 2. 遇到换行符时渲染
     * 3. 遇到完整的 Markdown 语法时渲染
     * 4. 缓冲区太大时强制渲染
     */
    tryRender() {
        const text = this.pendingText;
        
        // 如果文本为空，不渲染
        if (!text || text.length === 0) return;
        
        // 检查是否有未闭合的 Markdown 语法（除了代码块）
        const hasUnclosedSyntax = this.hasUnclosedMarkdown(text);
        
        // 在代码块中也要定期渲染（每 100 字符或遇到换行）
        const inCodeBlock = this.isInCodeBlock(this.accumulatedText);
        const shouldRenderInCodeBlock = inCodeBlock && (text.length > 100 || text.endsWith('\n'));
        
        // 检查是否有完整的加粗/斜体语法
        const hasCompleteBold = /\*\*[\s\S]*?\*\*/.test(text);
        const hasCompleteItalic = /\*[^\*\s]+\*/.test(text);
        
        // 渲染条件：
        // 1. 没有未闭合的语法
        // 2. 缓冲区太大
        // 3. 遇到空行
        // 4. 在代码块中且满足渲染条件
        // 5. 有完整的加粗或斜体语法
        if (!hasUnclosedSyntax || text.length > 1000 || text.endsWith('\n\n') || shouldRenderInCodeBlock || hasCompleteBold || hasCompleteItalic) {
            this.render();
        }
    }
    
    /**
     * 检查是否在代码块中
     */
    isInCodeBlock(text) {
        const codeBlockMatches = (text.match(/```/g) || []).length;
        return codeBlockMatches % 2 !== 0;
    }

    /**
     * 检查文本中是否有未闭合的 Markdown 语法
     */
    hasUnclosedMarkdown(text) {
        // 检查未闭合的代码块
        const codeBlockMatches = (text.match(/```/g) || []).length;
        if (codeBlockMatches % 2 !== 0) return true;
        
        // 检查未闭合的行内代码
        const inlineCodeMatches = (text.match(/`/g) || []).length;
        if (inlineCodeMatches % 2 !== 0) return true;
        
        // 检查未闭合的链接
        const linkTextMatches = (text.match(/\[/g) || []).length;
        const linkTextEndMatches = (text.match(/\]/g) || []).length;
        if (linkTextMatches !== linkTextEndMatches) return true;
        
        const linkUrlMatches = (text.match(/\(/g) || []).length;
        const linkUrlEndMatches = (text.match(/\)/g) || []).length;
        if (linkUrlMatches !== linkUrlEndMatches) return true;
        
        // 检查未闭合的公式
        const mathMatches = (text.match(/\$\$/g) || []).length;
        if (mathMatches % 2 !== 0) return true;
        
        // 注意：不检查加粗/斜体的闭合状态，因为流式输入时
        // **text** 可能分批到达，导致中间状态被认为未闭合
        // marked 会正确处理不完整的语法
        
        return false;
    }

    /**
     * 渲染当前文本
     */
    render() {
        try {
            // 使用累积的所有文本进行渲染
            let processedText = this.accumulatedText;
            
            // 在流式渲染时，如果存在未闭合的加粗标记，临时闭合它以获得正确的渲染
            let tempText = processedText;
            const boldMatches = (tempText.match(/\*\*/g) || []).length;
            const hasUnclosedBold = boldMatches % 2 !== 0;
            
            if (hasUnclosedBold && !this.isComplete) {
                // 临时添加闭合标记用于渲染
                tempText = tempText + '**';
            }
            
            // 使用 marked 解析临时文本
            let html = marked.parse(tempText);
            
            // 处理所有未被 marked 解析的 **...** 格式（匹配不包含**的内容）
            // 使用惰性匹配，确保只匹配到最近的 **
            html = html.replace(/\*\*([^\*]+?)\*\*/g, '<strong>$1</strong>');
            
            // 给加粗文字左右添加空格，避免粘连（使用半角空格）
            // 先给所有 strong 后面加空格
            html = html.replace(/(<strong>[^<]+)(<\/strong>)/g, '$1&ensp;$2');
            // 再给前面加空格（除了行首的情况：前面是>）
            html = html.replace(/(<\/[^>]+>|.)(<strong>)/g, function(match, p1, p2) {
                // 如果前面是标签结束符>，不加空格
                if (p1 === '>') return match;
                // 其他情况都加空格
                return p1 + '&ensp;' + p2;
            });
            
            // 如果临时添加了闭合标记，需要修复 HTML
            if (hasUnclosedBold && !this.isComplete) {
                // 将临时闭合产生的 </strong> 替换为光标，保留 <strong> 开始标签
                const lastStrongEnd = html.lastIndexOf('</strong>');
                if (lastStrongEnd !== -1) {
                    html = html.substring(0, lastStrongEnd) + '<span class="typing-cursor"></span>' + html.substring(lastStrongEnd + 9);
                }
            }
            
            // 将颜色代码转换为色块显示
            html = this.renderColorSwatches(html);
            
            // 更新容器内容
            this.container.innerHTML = sanitizeHtml(html);
            
            // 应用代码高亮
            this.highlightCode();
            
            // 渲染数学公式
            this.renderMath();
            
            // 清空待处理文本
            this.pendingText = '';
            this.renderedHTML = html;
        } catch (e) {
            console.error('Markdown 渲染错误:', e);
        }
    }
    
    /**
     * 渲染数学公式
     */
    renderMath() {
        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            MathJax.typesetPromise([this.container]).catch((err) => {
                console.error('MathJax 渲染错误:', err);
            });
        }
    }

    /**
     * 应用代码高亮
     */
    highlightCode() {
        if (typeof hljs !== 'undefined') {
            this.container.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }
    
    /**
     * 将颜色代码转换为色块显示
     */
    renderColorSwatches(html) {
        // 匹配 #RRGGBB 或 #RGB 格式的颜色代码
        return html.replace(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g, function(match, colorCode) {
            let color = '#' + colorCode;
            // 补全三位颜色为六位
            if (colorCode.length === 3) {
                color = '#' + colorCode[0] + colorCode[0] + colorCode[1] + colorCode[1] + colorCode[2] + colorCode[2];
            }
            return '<span class="color-swatch" style="display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; margin-bottom: 2px;"><span style="display: inline-block; width: 16px; height: 16px; background-color: ' + color + '; border: 1px solid rgba(255,255,255,0.3); border-radius: 3px; flex-shrink: 0;"></span><span style="font-family: monospace; line-height: 16px;">' + color + '</span></span>';
        });
    }

    /**
     * 强制刷新（输入结束时调用）
     */
    flush() {
        this.isComplete = true;
        this.pendingText = this.accumulatedText; // 确保所有待处理文本都被渲染
        // 最终渲染，确保所有内容都显示
        this.render();
        // 移除打字机光标
        const cursor = this.container.querySelector('.typing-cursor');
        if (cursor) {
            cursor.remove();
        }
    }

    /**
     * 获取累积的原始文本
     */
    getAccumulatedText() {
        return this.accumulatedText;
    }
}

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StreamMarkdownRenderer;
}
