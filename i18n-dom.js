/**
 * i18n-dom.js —— 全站硬编码中文兜底翻译
 * 依赖：i18n.js（提供 getCurrentLang / onLangChange）、zh2en.map.js（window.__PX_ZH_EN）
 * 原理：切到英文时，按「中文原文 → 英文」词典精确匹配界面文本节点与常用属性；
 *       用户输入、AI 回复、提示词等区域不参与翻译。切回中文时还原原文。
 */
(function () {
    'use strict';

    var CJK = /[\u4e00-\u9fa5]/;
    var MAP = window.__PX_ZH_EN || {};
    var ATTRS = ['placeholder', 'title', 'alt', 'aria-label', 'data-placeholder', 'data-drop-text', 'data-drop-hint', 'data-tip', 'value'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var UNIT_EN = { '图片': 'Image', '张': 'Image', '视频': 'Video', '音频': 'Audio', '秒': 's' };
    var FRAME_EN = { '首帧': 'first frame', '尾帧': 'last frame' };
    var SKIP = [
        '#chatMessages', '.markdown-content', '.markdown-body', '.message-content',
        '.history-item-prompt', '.task-prompt', '#taskPrompt', '.prompt-text',
        '.user-prompt', '.detail-prompt', '.px-no-i18n', '[data-no-i18n]',
        'textarea', 'pre', 'code', 'kbd', 'samp',
        '[contenteditable=""]', '[contenteditable="true"]'
    ].join(',');

    // 动态文案（含数字/变量），{0} 对应正则捕获组
    var RULES = [
        [/^该模型最多支持\s*(\d+)\s*张参考图$/, 'This model supports up to {0} reference images'],
        [/^该模型最多支持\s*(\d+)\s*段参考视频$/, 'This model supports up to {0} reference videos'],
        [/^该模型最多支持\s*(\d+)\s*段参考音频$/, 'This model supports up to {0} reference audios'],
        [/^图片\s*(\d+)$/, 'Image {0}'],
        [/^\[图片\s*(\d+)\]$/, '[Image {0}]'],
        [/^音频\s*(\d+)$/, 'Audio {0}'],
        [/^视频\s*(\d+)$/, 'Video {0}'],
        [/^视频链接已失效$/, 'Video link expired'],
        [/^自适应\s*\/\s*(\d+)s$/, 'Auto / {0}s'],
        [/^图片处理中\s*\((\d+)\)\.\.\.$/, 'Processing images ({0})...'],
        [/^图片上传失败\s*\((\d+)\)$/, 'Image upload failed ({0})'],
        [/^上传失败[:：]\s*(.+)$/, 'Upload failed: {0}'],
        [/^操作失败[:：]\s*(.+)$/, 'Operation failed: {0}'],
        [/^查询失败[:：]\s*(.+)$/, 'Query failed: {0}'],
        [/^创建任务失败[:：]\s*(.+)$/, 'Failed to create task: {0}'],
        [/^图片宽高不能超过\s*30000px\s*\(当前:\s*(.+)\)$/, 'Image dimensions cannot exceed 30000px (current: {0})'],
        [/^webp格式图片宽高不能超过\s*16383px\s*\(当前:\s*(.+)\)$/, 'WebP dimensions cannot exceed 16383px (current: {0})'],
        [/^图片总像素不能超过\s*2\.5亿\s*\(当前:\s*(.+)\)$/, 'Total pixels cannot exceed 250 million (current: {0})'],
        [/^([\d,]+(?:\.\d+)?)\s*积分$/, '{0} Credits'],
        [/^([\d,]+(?:\.\d+)?)\s*\/\s*(?:图片|张)$/, '{0}/Image'],
        [/^([\d,]+(?:\.\d+)?)\s*元$/, '{0} CNY'],
        [/^累计返利\s*([\d,]+)\s*积分$/, 'Total rebate {0} Credits'],
        [/^已邀请\s*(\d+)\s*人$/, '{0} invited'],
        [/^剩余\s*(\d+)\s*人$/, '{0} remaining'],
        [/^(\d+)\s*个文件…$/, '{0} files…'],
        [/^已下载\s*(\d+)\s*个文件$/, 'Downloaded {0} files'],
        [/^下载中…\s*(\d+)\/(\d+)\s*个文件…$/, 'Downloading… {0}/{1} files…'],
        [/^切换到\s*([\d.]+)\s*版本$/, 'Switch to {0}'],
        [/^网络错误[:：]\s*(.+)$/, 'Network error: {0}'],
        [/^登录失败[:：]\s*(.+)$/, 'Sign-in failed: {0}'],
        [/^注册失败[:：]\s*(.+)$/, 'Sign-up failed: {0}'],
        [/^密码重置失败[:：]\s*(.+)$/, 'Password reset failed: {0}'],
        [/^删除失败[:：]\s*(.+)$/, 'Delete failed: {0}'],
        [/^新建会话失败[:：]\s*(.+)$/, 'Failed to create chat: {0}'],
        [/^下载出错[:：]\s*(.+)$/, 'Download error: {0}'],
        [/^图片处理失败[:：]?\s*(.*)$/, 'Image processing failed: {0}'],
        [/^下载失败[（(](.+)[）)]$/, 'Download failed ({0})'],
        [/^充值成功，到账\s*([\d.]+)\s*元，当前余额\s*([\d.]+)\s*元$/, 'Recharge successful. {0} CNY added, balance {1} CNY'],
        [/^充值成功，到账\s*([\d.]+)\s*元$/, 'Recharge successful. {0} CNY added'],
        // ---- 充值弹窗（在线充值 / 礼品卡兑换）----
        [/^充值成功，到账\s*([\d,]+)\s*积分$/, 'Recharge successful. {0} Credits added'],
        [/^兑换成功，到账\s*([\d,]+)\s*积分，当前余额\s*([\d,.-]+)\s*积分$/, 'Redeemed successfully. {0} Credits added, balance {1} Credits'],
        [/^微信支付\s*¥\s*([\d.]+)$/, 'Pay ¥{0} with WeChat'],
        [/^约\s*¥\s*([\d.]+)\s*\/\s*积分$/, '≈ ¥{0}/Credit'],
        [/^剩余\s*(\d{1,2}:\d{2})$/, '{0} left'],
        [/^支付下单失败[:：]\s*(.+)$/, 'Payment order failed: {0}'],
        [/^到账\s*([\d.]+)\s*元$/, '{0} CNY added'],
        [/^当前余额\s*([\d.]+)\s*元$/, 'Current balance {0} CNY'],
        [/^(\d+)\s*秒后重发$/, '{0}s to resend'],
        [/^(\d+)\s*秒后重试$/, '{0}s to retry'],
        [/^拆分\s*(U\d+)$/, 'Split {0}'],
        [/^微调\s*(V\d+)$/, 'Adjust {0}'],
        [/^(\d+)\s*秒前$/, '{0}s ago'],
        [/^(\d+)\s*分钟前$/, '{0}m ago'],
        [/^(\d+)\s*小时前$/, '{0}h ago'],
        [/^(\d+)\s*天前$/, '{0}d ago'],
        // 画布页面动态文案
        [/^图片\s*(\d+)$/, 'Image {0}'],
        [/^剩余\s*(\d+)\s*天$/, '{0}d left'],
        [/^(\d+)\s*秒$/, '{0}s'],
        [/^\[图片\s*(\d+)\]$/, '[Image {0}]'],
        [/^分组\s*(\d+)\s*个节点$/, 'Group of {0} nodes'],
        [/^是否删除组和组内\s*(\d+)\s*个节点？$/, 'Delete the group and its {0} nodes?'],
        [/^共\s*(\d+)\s*条生成记录$/, '{0} generations'],
        [/^生成记录[（(]\s*(\d+)\s*[）)]$/, 'Generation history ({0})'],
        [/^素材已满：该节点最多\s*(\d+)\s*张参考图$/, 'Asset slots full: this node supports up to {0} reference images'],
        [/^该生成节点最多支持\s*(\d+)\s*张参考图，已自动连接前\s*(\d+)\s*个，跳过\s*(\d+)\s*个。$/, 'This generation node supports up to {0} reference images; connected the first {1} and skipped {2}.'],
        [/^(\d+)\s*张参考图，其余图片仅添加到画布$/, '{0} reference images; the rest were added to the canvas only'],
        [/^上传失败\s*[（(]\s*(\d+)\s*[）)]$/, 'Upload failed ({0})'],
        [/^导出中\s*(\d+)%$/, 'Exporting {0}%'],
        [/^视频时长不足\s*([\d.]+)\s*秒，无法修剪$/, 'Video is only {0}s long and cannot be trimmed'],
        [/^音频时长不足\s*([\d.]+)\s*秒，无法修剪$/, 'Audio is only {0}s long and cannot be trimmed'],
        [/^音频加载失败[:：]\s*(.+)$/, 'Audio load failed: {0}'],
        [/^音频裁剪失败[:：]\s*(.+)$/, 'Audio trim failed: {0}'],
        [/^确定删除画布「(.+)」？删除后不可恢复。$/, 'Delete canvas "{0}"? This cannot be undone.'],
        [/^点击记录设为当前视频，并恢复当时的提示词和设置$/, 'Click a record to set it as the current video and restore its prompt and settings'],
        [/^点击记录设为当前图片，并恢复当时的提示词和设置$/, 'Click a record to set it as the current image and restore its prompt and settings'],
        [/^点击上传视频$/, 'Click to upload video'],
        [/^点击上传音频$/, 'Click to upload audio'],
        [/^文字位置：(最后|最前)$/, 'Text position: {0}'],
        // ---- v5 补充：画布节点默认名 / 价格单位 / 派生名称 ----
        [/^图片节点\s*(\d+)$/, 'Image Node {0}'],
        [/^视频节点\s*(\d+)$/, 'Video Node {0}'],
        [/^文本节点\s*(\d+)$/, 'Text Node {0}'],
        [/^音频节点\s*(\d+)$/, 'Audio Node {0}'],
        [/^(\d+)\s*节点$/, '{0} nodes'],
        [/^([\d,]+(?:\.\d+)?)\s*\/\s*视频$/, '{0}/Video'],
        [/^([\d,]+(?:\.\d+)?)\s*\/\s*音频$/, '{0}/Audio'],
        [/^-\s*(图片|张|视频|音频)$/, function (m) { return '-' + UNIT_EN[m[1]]; }],
        [/^文本：([\s\S]*)$/, 'Text: {0}'],
        [/^(.+)-编辑$/, '{0}-edit'],
        [/^(.+) 截帧$/, '{0} frame'],
        [/^(.+) 视频修剪$/, '{0} trimmed'],
        [/^(.+)_副本$/, '{0}_copy'],
        [/^正在截取(首帧|尾帧)…$/, function (m) { return 'Capturing ' + FRAME_EN[m[1]] + '…'; }],
        [/^截取(首帧|尾帧)失败[：:]\s*(.*)$/, function (m, sub) { return 'Failed to capture ' + FRAME_EN[m[1]] + ': ' + sub(m[2]); }],
        [/^参考素材时长至少\s*2\s*秒（当前约\s*([\d.]+)\s*秒）$/, 'Reference media must be at least 2s long (currently about {0}s)'],
        [/^首尾帧模式需要 1–2 张参考图（1 张为首帧，2 张为首帧 \+ 尾帧），当前已选\s*(\d+)\s*张$/, 'First/last frame mode needs 1–2 reference images (1 = first frame, 2 = first + last frame); {0} selected'],
        [/^该生成节点最多支持\s*(\d+)\s*张参考图$/, 'This generation node supports up to {0} reference images'],
        [/^当前模型最多支持\s*(\d+)\s*张参考图$/, 'The current model supports up to {0} reference images'],
        [/^素材已满：该节点最多\s*(\d+)\s*张参考图，其余图片仅添加到画布$/, 'Asset slots full: this node supports up to {0} reference images; the rest were added to the canvas only'],
        [/^GPT Image 2\.5 快速(.*)$/, 'GPT Image 2.5 Fast{0}'],
        // ---- 下载 / 头像 / 日期 ----
        [/^正在下载\s*(\d+)\s*个文件…$/, 'Downloading {0} files…'],
        [/^已下载\s*(\d+)\s*个，另有\s*(\d+)\s*个已在新标签页打开，请在新页面中保存$/, 'Downloaded {0}; {1} opened in new tabs — please save them there'],
        [/^下载失败[（(](\d+)[）)]，请稍后重试$/, 'Download failed ({0}). Please try again later'],
        [/^头像\s*(\d+)$/, 'Avatar {0}'],
        [/^抱歉，(.+)$/, 'Sorry, {0}'],
        [/^(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})?$/, function (m) { return MONTHS[+m[1] - 1] + ' ' + (+m[2]) + (m[3] ? ' ' + m[3] : ''); }],
        [/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})?$/, function (m) { return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] + (m[4] ? ' ' + m[4] : ''); }],
        // ---- 服务端返回的带参数提示 ----
        [/^操作过于频繁，请\s*(\d+)\s*秒后再试$/, 'Too many requests. Please try again in {0}s'],
        [/^积分不足（本次生成需要\s*([\d.]+)\s*积分，当前余额\s*([\d.]+)），请充值后再生成$/, 'Insufficient credits (this generation needs {0}, balance {1}). Please recharge first'],
        [/^(.+)，已获赠\s*(\d+)\s*积分$/, '{0}, {1} bonus credits received'],
        [/^该邀请码已达\s*(\d+)\s*人邀请上限$/, 'This invite code has reached its limit of {0} invites'],
        [/^视频生成超时（超过\s*(\d+)\s*分钟）[：:]\s*(.*)$/, 'Video generation timed out (over {0} min): {1}'],
        [/^(Seedance|MiniMax H3) 提交失败\((\d+)\)[：:]\s*(.*)$/, '{0} submission failed ({1}): {2}'],
        [/^(Seedance|MiniMax H3) 提交失败[：:]\s*(.*)$/, '{0} submission failed: {1}'],
        [/^(Seedance|MiniMax H3) 生成失败[：:]\s*(.*)$/, '{0} generation failed: {1}'],
        [/^视频任务查询失败\((\d+)\)[：:]\s*(.*)$/, 'Video task query failed ({0}): {1}'],
        [/^GPT Image 2 API错误 \((\d+)\)[：:]\s*(.*)$/, 'GPT Image 2 API error ({0}): {1}'],
        [/^HTTP错误[：:]\s*(.*)$/, 'HTTP error: {0}'],
        [/^缺少\s*(\S+)\s*参数$/, 'Missing {0} parameter'],
        [/^API \[(.+)\] 已禁用$/, 'API [{0}] is disabled'],
        // ---- 角色库 ----
        [/^已按上限选取前\s*(\d+)\s*张角色参考图$/, 'Reference limit reached: used the first {0} character reference images'],
        [/^(\d+)\s*张参考图$/, '{0} reference images'],
        [/^保存失败[:：]\s*(.+)$/, 'Save failed: {0}'],
        [/^请求失败[:：]\s*(\d+)$/, 'Request failed: {0}'],
        [/^确定删除角色「([\s\S]+)」？画布中已有的角色节点会保留快照。$/, function (m) { return 'Delete character "' + m[1] + '"? Character nodes already on canvases keep a snapshot.'; }],
        // ---- 角色库 v2 / 提示词栏角色聚合项 ----
        [/^(\d+)\s*个造型$/, '{0} outfits'],
        [/^(\d+)\s*张$/, '{0} imgs'],
        [/^图片\s*(\d+)-(\d+)$/, 'Images {0}-{1}'],
        [/^已计入\s*(\d+)\/(\d+)\s*张$/, '{0}/{1} counted'],
        [/^共\s*(\d+)\s*张参考图$/, '{0} reference images'],
        [/^模型上限：仅计入前\s*(\d+)\s*张，其余\s*(\d+)\s*张未计入$/, 'Model limit: only the first {0} are counted; {1} not counted'],
        [/^角色：([\s\S]*) · (\d+) 张参考图$/, function (m) { return 'Character: ' + m[1] + ' · ' + m[2] + ' reference images'; }],
        [/^角色：([\s\S]*) · 已计入 (\d+)\/(\d+) 张参考图（超出模型上限）$/, function (m) { return 'Character: ' + m[1] + ' · ' + m[2] + '/' + m[3] + ' reference images counted (model limit)'; }],
        [/^@([\s\S]+)（(\d+)张）$/, function (m) { return '@' + m[1] + ' (' + m[2] + ' imgs)'; }],
        // ---- 角色库逐张入库素材库状态 ----
        [/^已入库素材库 (\d+)\/(\d+) 张$/, 'Saved to asset library: {0}/{1} images'],
        [/^入库中… (\d+)\/(\d+) 张已完成$/, 'Saving to library… {0}/{1} done'],
        [/^(\d+) 张入库失败$/, function (m) { return m[1] + (m[1] === '1' ? ' image' : ' images') + ' failed to save to library'; }],
        [/^素材入库失败：([\s\S]*)$/, 'Failed to save to asset library: {0}'],
        [/^（(\d+)张）$/, '({0} imgs)'],
        // ---- 导演台（单复数：1 shot / 2 shots）----
        [/^(\d+)\s*个镜头$/, function (m) { return m[1] + (m[1] === '1' ? ' shot' : ' shots'); }],
        [/^已生成\s*(\d+)\s*个镜头$/, function (m) { return 'Created ' + m[1] + (m[1] === '1' ? ' shot' : ' shots'); }],
        [/^批量生成完成：(\d+)\s*个镜头$/, function (m) { return 'Batch complete: ' + m[1] + (m[1] === '1' ? ' shot' : ' shots'); }],
        [/^批量生成结束：(\d+)\s*个完成，(\d+)\s*个失败$/, 'Batch finished: {0} done, {1} failed'],
        [/^已停止，(\d+)\s*个排队中的镜头已取消（已提交的继续生成）$/, function (m) { return 'Stopped. ' + m[1] + (m[1] === '1' ? ' queued shot was' : ' queued shots were') + ' cancelled (submitted ones keep generating)'; }],
        [/^积分不足，已停止批量生成（(\d+)\s*个镜头未提交）$/, function (m) { return 'Insufficient credits. Batch stopped (' + m[1] + (m[1] === '1' ? ' shot' : ' shots') + ' not submitted)'; }],
        [/^(\d+)\s*个勾选的镜头尚未完成，将被跳过$/, function (m) { return m[1] + (m[1] === '1' ? ' checked shot is' : ' checked shots are') + ' not finished and will be skipped'; }],
        [/^(\d+)\s*个镜头提示词为空，已跳过$/, function (m) { return m[1] + (m[1] === '1' ? ' shot has' : ' shots have') + ' an empty prompt and ' + (m[1] === '1' ? 'was' : 'were') + ' skipped'; }],
        [/^同时最多\s*(\d+)\s*个镜头并行生成；积分在每个镜头提交时预扣，失败自动返还$/, 'Up to {0} shots generate in parallel; credits are reserved per shot on submit and refunded on failure'],
        [/^最多\s*(\d+)\s*个镜头$/, 'Up to {0} shots'],
        [/^已选\s*(\d+)\s*个$/, '{0} selected'],
        [/^镜头\s*(\d+)$/, 'Shot {0}'],
        [/^镜头(\d+) · ([\s\S]+)$/, function (m) { return 'Shot ' + m[1] + ' · ' + m[2]; }],
        [/^成片 · ([\s\S]*)$/, function (m) { return 'Film · ' + m[1]; }],
        [/^台词建议时长\s*≥\s*(\d+)s$/, 'Dialogue needs ≥ {0}s'],
        [/^前方\s*(\d+)\s*个任务$/, '{0} ahead in queue'],
        [/^剧本超过\s*(\d+)\s*字，已截断$/, 'Script exceeds {0} characters and was truncated'],
        // ---- 导演台 · 批量续传 / 分段拆分 / 漏台词补全 ----
        [/^有\s*(\d+)\s*个镜头等待生成$/, function (m) { return m[1] + (m[1] === '1' ? ' shot is' : ' shots are') + ' waiting to generate'; }],
        [/^继续生成\s*(\d+)\s*个镜头$/, function (m) { return 'Resuming ' + m[1] + (m[1] === '1' ? ' shot' : ' shots'); }],
        [/^余额不足：继续生成需要\s*([\d,]+)\s*积分，当前余额\s*([\d,]+)$/, 'Insufficient credits: resuming needs {0} credits, balance {1}'],
        [/^正在拆分 第\s*(\d+)\/(\d+)\s*段…$/, 'Storyboarding part {0}/{1}…'],
        [/^已自动补回\s*(\d+)\s*句漏掉的台词$/, function (m) { return 'Restored ' + m[1] + (m[1] === '1' ? ' missing line' : ' missing lines') + ' of dialogue'; }],
        // ---- 导演台 · AI 写剧本（单复数：1 char / 2 chars）----
        [/^([\d,]+)\s*字$/, function (m) { return m[1] + (m[1] === '1' ? ' char' : ' chars'); }],
        [/^预计\s*([\d:]+)$/, 'Est. {0}'],
        [/^(剧本已生成|续写完成|润色完成|扩写完成|精简完成)：([\d,]+)\s*字，预计\s*([\d:]+)$/, function (m) {
            var lb = { '剧本已生成': 'Script ready', '续写完成': 'Continued', '润色完成': 'Polished', '扩写完成': 'Expanded', '精简完成': 'Shortened' }[m[1]];
            return lb + ': ' + m[2] + (m[2] === '1' ? ' char' : ' chars') + ', est. ' + m[3];
        }],
        [/^续写约\s*(\d+)\s*秒$/, 'Continue ~{0}s'],
        [/^扩写到\s*([\d:]+)$/, 'Expand to {0}'],
        [/^精简到\s*([\d:]+)$/, 'Shorten to {0}'],
        // ---- AI 助手（单复数：1 node / 2 nodes）----
        [/^(创建了|正在创建)\s*(\d+)\s*个(图片生成节点|视频生成节点|文本节点|参考图节点|节点)$/, function (m) {
            var k = { '图片生成节点': ' image node', '视频生成节点': ' video node', '文本节点': ' text node', '参考图节点': ' reference node', '节点': ' node' }[m[3]];
            return (m[1] === '创建了' ? 'Created ' : 'Creating ') + m[2] + k + (m[2] === '1' ? '' : 's');
        }],
        [/^(找到|修改了|删除了|整理了|选中了|定位到|打组了|读取了)\s*(\d+)\s*个节点(详情)?$/, function (m) {
            var v = { '找到': 'Found', '修改了': 'Updated', '删除了': 'Deleted', '整理了': 'Arranged', '选中了': 'Selected', '定位到': 'Located', '打组了': 'Grouped', '读取了': 'Read' }[m[1]];
            return v + ' ' + m[2] + (m[2] === '1' ? ' node' : ' nodes') + (m[3] ? ' in detail' : '');
        }],
        [/^(连接了|断开了)\s*(\d+)\s*条连线$/, function (m) { return (m[1] === '连接了' ? 'Connected ' : 'Removed ') + m[2] + (m[2] === '1' ? ' link' : ' links'); }],
        [/^读取了角色库（(\d+)\s*个角色）$/, function (m) { return 'Read the character library (' + m[1] + (m[1] === '1' ? ' character)' : ' characters)'); }],
        [/^(\d+)\s*个节点$/, function (m) { return m[1] + (m[1] === '1' ? ' node' : ' nodes'); }],
        [/^执行了\s*(\d+)\s*个操作$/, function (m) { return 'Ran ' + m[1] + (m[1] === '1' ? ' action' : ' actions'); }],
        [/^已选\s*(\d+)\s*个节点$/, function (m) { return m[1] + (m[1] === '1' ? ' node selected' : ' nodes selected'); }],
        [/^删除\s*(\d+)\s*个节点？$/, function (m) { return 'Delete ' + m[1] + (m[1] === '1' ? ' node?' : ' nodes?'); }],
        [/^确认生成\s*(\d+)\s*个任务$/, function (m) { return 'Confirm ' + m[1] + (m[1] === '1' ? ' generation' : ' generations'); }],
        [/^(\d+)\s*个节点已跳过$/, function (m) { return m[1] + (m[1] === '1' ? ' node was' : ' nodes were') + ' skipped'; }],
        [/^排队\s*(\d+)$/, '{0} queued'],
        [/^失败\s*(\d+)$/, '{0} failed'],
        [/^积分不足，已停止生成（(\d+)\s*个未提交）$/, 'Insufficient credits. Generation stopped ({0} not submitted)'],
        // ---- AI 助手 · 技能导入识别 / 兼容适配（_SKILLFIX_20261028，单复数：1 reference / 2 references）----
        [/^含\s*(\d+)\s*处不兼容$/, function (m) { return m[1] + (m[1] === '1' ? ' incompatible reference' : ' incompatible references'); }],
        [/^name 已转为小写连字符：(.+)$/, 'Name converted to lowercase with hyphens: {0}'],
        [/^description 超长（(\d+) 字），已截断到 1024 字$/, 'Description was too long ({0} chars) and was truncated to 1024'],
        [/^缺少 name，已用文件名生成：(.+)$/, 'Missing name — generated from the file name: {0}'],
        [/^name「([\s\S]+)」无可用字符，已用文件名生成：(.+)$/, function (m) { return 'Name “' + m[1] + '” has no usable characters — generated from the file name: ' + m[2]; }],
        [/^无法从内容或文件名生成名称，已随机命名：(.+)$/, 'Could not derive a name from the content or file name — randomly named: {0}'],
        [/^已存在同名技能，已另存为：(.+)$/, 'A skill with the same name exists — saved as: {0}'],
        [/^已存在同名技能：(.+)$/, 'A skill with this name already exists: {0}'],
        [/^frontmatter 中的 (.+) 字段在画布助手中不生效，已忽略$/, 'Frontmatter field(s) {0} have no effect in the canvas assistant and were ignored'],
        [/^技能引用了附属文件（([\s\S]+)），仅导入了 \.md 正文$/, function (m) { return 'The skill references extra files (' + m[1].split('、').join(', ') + '); only the .md body was imported'; }],
        [/^技能数量已达上限（(\d+)），需先删除部分技能才能导入$/, 'Skill limit reached ({0}). Delete some skills before importing'],
        [/^技能数量已达上限（(\d+)）$/, 'Skill limit reached ({0})'],
        [/^技能正文超过 50KB（当前约 (\d+)KB），请精简后再导入$/, 'The skill body exceeds 50KB (about {0}KB). Please shorten it before importing'],
        // ---- 第四期：360 全景 / 角色多视角（单复数：1 credit / 2 credits）----
        [/^当前模型不支持 360° 全景，请切换到全景模型（如 ([\s\S]+)）$/, 'This model doesn\'t support 360° panoramas. Switch to a panorama model (e.g. {0})'],
        [/^接缝分数 0-100，越低越好；≥ (\d+) 建议修复$/, 'Seam score 0–100, lower is better; ≥ {0} is worth fixing'],
        [/^接缝已修复，分数 (\d+) → (\d+)$/, 'Seam fixed, score {0} → {1}'],
        [/^已写回节点（新版本）。图片尺寸 (\d+)×(\d+) 保持不变$/, 'Written back to the node (new version). Size {0}×{1} unchanged'],
        [/^已设为场景「([\s\S]+)」的参考图$/, function (m) { return 'Set as the reference for scene “' + m[1] + '”'; }],
        [/^(\d+) 张参考图将作为外观参考$/, function (m) { return m[1] + (m[1] === '1' ? ' reference image' : ' reference images') + ' will guide the appearance'; }],
        [/^已裁切为 (\d+) 张，按 0°→315° 顺时针排列；存入角色卡后可 360° 拖拽查看$/, function (m) { return 'Split into ' + m[1] + ' images, 0°→315° clockwise. Save to the character card to view with 360° drag'; }],
        [/^全景节点(\d+)$/, 'Panorama {0}'],
        [/^机位 (\d+)$/, 'Shot {0}'],
        [/^全景 · ([\s\S]+)$/, function (m) { return 'Panorama · ' + m[1]; }],
        [/^([\s\S]+) · (转身设定图|8 视角序列)$/, function (m) { return m[1] + ' · ' + (m[2] === '转身设定图' ? 'Turnaround Sheet' : '8-View Sequence'); }],
        [/^(机位上传失败|截取失败|接缝修复失败|保存失败)：([\s\S]*)$/, function (m, sub) { var k = { '机位上传失败': 'Shot upload failed', '截取失败': 'Capture failed', '接缝修复失败': 'Seam fix failed', '保存失败': 'Save failed' }[m[1]]; return k + ': ' + sub(m[2]); }],
        // ---- 3D 片场（单复数：1 actor / 2 actors）----
        [/^(人偶|对象|机位)最多 (\d+) 个$/, function (m) { var k = { '人偶': ['actor', 'actors'], '对象': ['object', 'objects'], '机位': ['camera', 'cameras'] }[m[1]]; return 'Up to ' + m[2] + ' ' + (m[2] === '1' ? k[0] : k[1]); }],
        [/^正在渲染机位「([\s\S]+)」…$/, function (m) { return 'Rendering camera “' + m[1] + '”…'; }],
        [/^已发送到导演台镜头 ?(\d*)$/, function (m) { return m[1] ? 'Sent to Director shot ' + m[1] : 'Sent to the Director'; }],
        [/^布置 3D 片场：(\d+) 项操作$/, function (m) { return 'Set up the 3D stage: ' + m[1] + (m[1] === '1' ? ' operation' : ' operations'); }],
        [/^([\s\S]+) · (\d+)mm · ([\d.:]+)（双击名称重命名）$/, function (m, sub) { return sub(m[1]) + ' · ' + m[2] + 'mm · ' + m[3] + ' (double-click the name to rename)'; }],
        [/^3D 片场(\d+)$/, '3D Stage {0}'],
        [/^3D 片场 · ([\s\S]+)$/, function (m, sub) { return '3D Stage · ' + sub(m[1]); }],
        [/^人偶 (\d+)$/, 'Actor {0}'],
        // ---- 特价视频线路：比例限制 / 参考视频时长 ----
        [/^该模型仅支持\s*([\d:\s/]+?)\s*画面比例$/, 'This model only supports {0} aspect ratios'],
        [/^该模型参考视频合计时长不能超过\s*(\d+)\s*秒$/, 'Reference videos for this model cannot exceed {0}s in total'],
        [/^([\s\S]+?) 仅支持 ([\d:\s/]+?) 画幅，已切换为 ([\d:]+)$/, function (m, sub) { return sub(m[1]) + ' only supports ' + m[2] + ' aspect ratios; switched to ' + m[3]; }],
        [/^([\s\S]+?) 仅支持 ([\d:\s/]+?) 画幅$/, function (m, sub) { return sub(m[1]) + ' only supports ' + m[2] + ' aspect ratios'; }],
    ];

    var ORIG_TEXT = (typeof WeakMap === 'function') ? new WeakMap() : null;
    var trackedNodes = [];
    var seenNodes = new WeakSet();
    var ORIG_ATTR = (typeof WeakMap === 'function') ? new WeakMap() : null;
    var trackedAttrs = [];
    var origTitle = null;
    var origDesc = null;
    var applying = false;
    var cache = {};

    // 变量部分：能翻就翻（含规则/组合），翻不了保留原文
    function sub(part) {
        var t = String(part == null ? '' : part).trim();
        if (!t || !CJK.test(t)) return part || '';
        return lookup(t) || part;
    }

    // 组合兜底：「A：B」「A，B」「A。B」等由已知片段拼成的句子；仅当所有中文片段都能翻译时才生效
    var SEPS = [['：', ': '], [': ', ': '], ['，', ', '], ['。', '. '], ['；', '; '], ['！', '! '], ['？', '? '], [' · ', ' · ']];
    var END_PUNCT = { '。': '.', '！': '!', '？': '?' };
    function compose(key) {
        if (key.length > 300) return null;
        var last = key.charAt(key.length - 1);
        if (END_PUNCT[last] && key.length > 2) {
            var b = lookup(key.slice(0, -1).trim());
            if (b) return b.replace(/[.!?。！？]$/, '') + END_PUNCT[last];
        }
        var prefixOnly = null;
        for (var s = 0; s < SEPS.length; s++) {
            var sep = SEPS[s][0];
            var idx = key.indexOf(sep);
            while (idx > 0 && idx < key.length - sep.length) {
                var L = key.slice(0, idx).trim(), R = key.slice(idx + sep.length).trim();
                var tl = CJK.test(L) ? lookup(L) : L;
                if (tl) {
                    var tr = CJK.test(R) ? lookup(R) : R;
                    if (tr) return tl.replace(/[.。]$/, '') + SEPS[s][1] + tr;
                    // 「已知前缀：未知详情」（如服务端/上游返回的错误原因）——至少把前缀翻译出来
                    if (s < 2 && prefixOnly == null && CJK.test(L) && L.length <= 20) prefixOnly = tl.replace(/[.。]$/, '') + ': ' + R;
                }
                idx = key.indexOf(sep, idx + 1);
            }
        }
        return prefixOnly;
    }

    function lookup(key) {
        if (!key || !CJK.test(key)) return null;
        if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
        cache[key] = null; // 防止组合查询时递归到自身
        var out = null;
        if (Object.prototype.hasOwnProperty.call(MAP, key)) {
            out = MAP[key];
        } else {
            for (var i = 0; i < RULES.length; i++) {
                var m = key.match(RULES[i][0]);
                if (m) {
                    var tpl = RULES[i][1];
                    out = typeof tpl === 'function' ? tpl(m, sub) : tpl.replace(/\{(\d)\}/g, function (_, idx) {
                        return sub(m[Number(idx) + 1] || '');
                    });
                    break;
                }
            }
            if (out == null) out = compose(key);
        }
        cache[key] = out;
        return out;
    }

    function translateText(node) {
        var raw = node.nodeValue;
        if (!raw || !CJK.test(raw)) return;
        var key = raw.trim();
        var en = lookup(key);
        if (!en) return;
        var lead = raw.slice(0, raw.indexOf(key));
        var trail = raw.slice(raw.indexOf(key) + key.length);
        if (ORIG_TEXT) ORIG_TEXT.set(node, raw);
        if (!seenNodes.has(node)) {
            seenNodes.add(node);
            trackedNodes.push(node);
        }
        if (node.nodeValue !== lead + en + trail) node.nodeValue = lead + en + trail;
    }

    function translateAttr(el, attr) {
        if (attr === 'value') {
            // 只处理输入框的默认值（如画布名称），用户正在编辑的输入框跳过
            if (!/^input$/i.test(el.tagName)) return;
            if (el === document.activeElement) return;
        }
        var raw = el.getAttribute(attr);
        if (!raw || !CJK.test(raw)) return;
        var key = raw.trim();
        var en = lookup(key);
        if (!en) return;
        if (ORIG_ATTR) {
            var bag = ORIG_ATTR.get(el);
            if (!bag) { bag = {}; ORIG_ATTR.set(el, bag); }
            bag[attr] = raw;
        }
        if (trackedAttrs.indexOf(el) < 0) trackedAttrs.push(el);
        el.setAttribute(attr, en);
        if (attr === 'value') el.value = en;
    }

    function walk(root) {
        if (!root || root.nodeType !== 1 && root.nodeType !== 9) root = document.body;
        if (!root) return;
        if (root.nodeType === 1 && root.closest && root.closest(SKIP)) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType === 1) {
                    if (n.matches && n.matches(SKIP)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === 3) translateText(n);
        }
        // 属性单独遍历，避免被文本跳过规则影响
        var els = (root.querySelectorAll ? [root] : []).concat(
            Array.prototype.slice.call(root.querySelectorAll(ATTRS.map(function (a) { return '[' + a + ']'; }).join(',')))
        );
        els.forEach(function (el) {
            if (!el || el.nodeType !== 1) return;
            for (var i = 0; i < ATTRS.length; i++) {
                if (el.hasAttribute(ATTRS[i])) translateAttr(el, ATTRS[i]);
            }
        });
    }

    function translateTitle() {
        if (document.title && CJK.test(document.title)) {
            var en = lookup(document.title.trim());
            if (en) {
                if (origTitle == null) origTitle = document.title;
                document.title = en;
            }
        }
        var meta = document.querySelector('meta[name="description"]');
        if (meta) {
            var c = meta.getAttribute('content');
            var ec = c && CJK.test(c) ? lookup(c.trim()) : null;
            if (ec) {
                if (origDesc == null) origDesc = c;
                meta.setAttribute('content', ec);
            }
        }
    }

    function restore() {
        for (var i = 0; i < trackedNodes.length; i++) {
            var n = trackedNodes[i];
            var orig = ORIG_TEXT && ORIG_TEXT.get(n);
            if (orig != null) n.nodeValue = orig;
        }
        for (var j = 0; j < trackedAttrs.length; j++) {
            var el = trackedAttrs[j];
            var bag = ORIG_ATTR && ORIG_ATTR.get(el);
            if (!bag) continue;
            for (var attr in bag) {
                if (Object.prototype.hasOwnProperty.call(bag, attr)) {
                    el.setAttribute(attr, bag[attr]);
                    if (attr === 'value' && /^input$/i.test(el.tagName)) el.value = bag[attr];
                }
            }
        }
        if (origTitle != null) { document.title = origTitle; origTitle = null; }
        if (origDesc != null) {
            var meta = document.querySelector('meta[name="description"]');
            if (meta) meta.setAttribute('content', origDesc);
            origDesc = null;
        }
        trackedNodes = [];
        trackedAttrs = [];
        seenNodes = new WeakSet();
    }

    function apply(lang) {
        applying = true;
        if (lang === 'en') {
            document.documentElement.lang = 'en';
            walk(document.body);
            translateTitle();
        } else {
            document.documentElement.lang = 'zh-CN';
            restore();
            // data-i18n 元素恢复由 i18n.js 负责
        }
        applying = false;
    }

    function currentLang() {
        return (typeof window.getCurrentLang === 'function') ? window.getCurrentLang() : 'zh';
    }

    // 监听后续动态插入的界面文案
    function observe() {
        if (!window.MutationObserver || !document.body) return;
        var mo = new MutationObserver(function (muts) {
            if (applying || currentLang() !== 'en') return;
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type === 'characterData') translateText(m.target);
                else if (m.type === 'attributes') {
                    for (var a = 0; a < ATTRS.length; a++) {
                        if (m.attributeName === ATTRS[a]) translateAttr(m.target, m.attributeName);
                    }
                } else if (m.type === 'childList') {
                    for (var k = 0; k < m.addedNodes.length; k++) {
                        var node = m.addedNodes[k];
                        if (node.nodeType === 3) translateText(node);
                        else if (node.nodeType === 1) walk(node);
                    }
                }
            }
            fixTitleInput();
        });
        mo.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ATTRS
        });
    }

    // 画布标题等输入框的 value 由脚本以属性方式直接赋值（不会触发 attribute 变更），做定向轮询补齐
    function fixTitleInput() {
        if (currentLang() !== 'en') return;
        var el = document.getElementById('canvasTitle');
        if (!el || el === document.activeElement) return;
        // 直接读属性上的 value（脚本可能用 el.value = 中文 赋值，属性仍是英文）
        var v = el.value;
        // 只处理系统默认画布名，避免改动用户自己输入的标题
        if (v !== '未命名画布') return;
        var en = lookup(v);
        if (!en) return;
        if (ORIG_ATTR) {
            var bag = ORIG_ATTR.get(el);
            if (!bag) { bag = {}; ORIG_ATTR.set(el, bag); }
            if (!bag.value) bag.value = v;
        }
        if (trackedAttrs.indexOf(el) < 0) trackedAttrs.push(el);
        el.value = en;
        el.setAttribute('value', en);
    }

    function watchTitleInput() {
        if (typeof setInterval !== 'function') return;
        setInterval(fixTitleInput, 1000);
    }

    // 原生 alert / confirm / prompt 弹窗文案（DOM 之外，无法被 TreeWalker 处理）
    // alert 若已被页面替换为自定义 toast（pixora-ui.js），toast 进入 DOM 后自然会被翻译，这里只包原生函数
    function wrapDialogs() {
        ['alert', 'confirm', 'prompt'].forEach(function (fn) {
            var orig = window[fn];
            if (typeof orig !== 'function' || orig.__pxI18n) return;
            var isNative = /\[native code\]/.test(Function.prototype.toString.call(orig));
            if (!isNative) return;
            var wrapped = function (msg) {
                var args = Array.prototype.slice.call(arguments);
                if (currentLang() === 'en' && typeof msg === 'string' && CJK.test(msg)) {
                    var en = lookup(msg.trim());
                    if (en) args[0] = en;
                }
                return orig.apply(window, args);
            };
            wrapped.__pxI18n = true;
            window[fn] = wrapped;
        });
    }

    function boot() {
        apply(currentLang());
        observe();
        watchTitleInput();
        wrapDialogs();
        if (typeof window.onLangChange === 'function') {
            window.onLangChange(function () { setTimeout(function () { apply(currentLang()); }, 0); });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.PX_I18N = {
        refresh: function () { apply(currentLang()); },
        translate: lookup
    };
})();
