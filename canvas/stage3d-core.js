/**
 * stage3d-core.js —— 无限画布 · 3D 片场（一期）纯逻辑层（无 three 依赖，可在 node 单测）
 *   - 场景 JSON（block.stage3d）默认值 / 归一化 / 校验 / 迁移
 *   - 焦段 ↔ FOV、机位 lookAt 四元数、运镜插值（lerp + slerp + 焦段线性 / 环绕弧线）
 *   - 景别 / 角度预设求解、运镜预设、运镜描述文案
 *   - AI 助手受校验操作 applyOps：整批原子执行，任一失败整批不生效，不执行任何代码
 *
 * 运镜插值思路移植自 Toonflow director3dNode（motion.ts，MIT License）：
 *   Copyright (c) 2026 HBAI-Ltd
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"),
 *   to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Stage3DCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VERSION = 1;
    const LIMITS = { objects: 80, actors: 20, cameras: 8, name: 30, pos: 50, posYMin: -5, posYMax: 30, sizeMin: 0.02, sizeMax: 30, heightMin: 0.5, heightMax: 2.6, focalMin: 14, focalMax: 135, durMin: 2, durMax: 15, ops: 40 };
    const JOINTS = ['hips', 'spine', 'neck', 'head', 'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist', 'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'];
    const JOINT_LABEL = {
        hips: ['骨盆', 'Hips'], spine: ['脊柱', 'Spine'], neck: ['颈部', 'Neck'], head: ['头部', 'Head'],
        leftShoulder: ['左肩', 'L Shoulder'], leftElbow: ['左肘', 'L Elbow'], leftWrist: ['左腕', 'L Wrist'],
        rightShoulder: ['右肩', 'R Shoulder'], rightElbow: ['右肘', 'R Elbow'], rightWrist: ['右腕', 'R Wrist'],
        leftHip: ['左髋', 'L Hip'], leftKnee: ['左膝', 'L Knee'], leftAnkle: ['左踝', 'L Ankle'],
        rightHip: ['右髋', 'R Hip'], rightKnee: ['右膝', 'R Knee'], rightAnkle: ['右踝', 'R Ankle']
    };
    const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '21:9': 21 / 9, '2.39:1': 2.39 };
    const ENV_PRESETS = {
        studio: { zh: '影棚', en: 'Studio', top: '#3a3d44', bottom: '#15161a', ground: '#2b2d33', grid: false },
        sky: { zh: '晴空', en: 'Sky', top: '#4f8fd6', bottom: '#dfe9f2', ground: '#6f7a63', grid: false },
        dusk: { zh: '黄昏', en: 'Dusk', top: '#3b3560', bottom: '#f0a46a', ground: '#4a3d3a', grid: false },
        night: { zh: '夜景', en: 'Night', top: '#05070f', bottom: '#1b2440', ground: '#14161d', grid: false },
        grid: { zh: '网格', en: 'Grid', top: '#1d2128', bottom: '#0b0c0f', ground: '#14161a', grid: true }
    };
    // 预设姿势（关节局部欧拉角，单位度；零旋转 = 自然垂臂站姿；+X 为人偶自身左侧，面朝 +Z；肩/肘/髋绕 -X 向前抬起，膝绕 +X 向后弯）
    const P = (o) => o;
    const POSES = {
        stand: { zh: '站立', en: 'Stand', lift: 0, j: P({ lS: [0, 0, 7], rS: [0, 0, -7], lE: [-8, 0, 0], rE: [-8, 0, 0] }) },
        relaxed: { zh: '自然站', en: 'Relaxed', lift: -0.005, j: P({ hp: [0, 0, 2], sp: [0, 0, -2], hd: [0, 6, 0], lS: [3, 0, 6], rS: [-3, 0, -6], lE: [-12, 0, 0], rE: [-6, 0, 0], lH: [0, 0, 4], rH: [-4, 0, -1], rK: [6, 0, 0] }) },
        walk: { zh: '行走', en: 'Walk', lift: -0.03, j: P({ sp: [4, 4, 0], hd: [-2, -3, 0], lS: [22, 0, 6], lE: [-18, 0, 0], rS: [-24, 0, -6], rE: [-30, 0, 0], lH: [-24, 0, 2], lK: [10, 0, 0], lA: [6, 0, 0], rH: [18, 0, -2], rK: [28, 0, 0], rA: [-8, 0, 0] }) },
        run: { zh: '奔跑', en: 'Run', lift: -0.08, j: P({ sp: [14, 6, 0], hd: [-10, -4, 0], lS: [48, 0, 10], lE: [-85, 0, 0], rS: [-55, 0, -10], rE: [-95, 0, 0], lH: [-55, 0, 3], lK: [70, 0, 0], lA: [10, 0, 0], rH: [25, 0, -3], rK: [95, 0, 0], rA: [-15, 0, 0] }) },
        sit: { zh: '坐', en: 'Sit', lift: -0.47, j: P({ sp: [-4, 0, 0], hd: [2, 0, 0], lS: [-28, 0, 8], lE: [-45, 0, 0], rS: [-28, 0, -8], rE: [-45, 0, 0], lH: [-88, 0, 6], lK: [88, 0, 0], rH: [-88, 0, -6], rK: [88, 0, 0] }) },
        sit_floor: { zh: '席地坐', en: 'Floor Sit', lift: -0.82, j: P({ sp: [10, 0, 0], lS: [-20, 0, 10], lE: [-30, 0, 0], rS: [-20, 0, -10], rE: [-30, 0, 0], lH: [-80, -30, 30], lK: [120, 0, 0], rH: [-80, 30, -30], rK: [120, 0, 0] }) },
        squat: { zh: '蹲下', en: 'Squat', lift: -0.63, j: P({ sp: [30, 0, 0], hd: [-20, 0, 0], lS: [-45, 0, 8], lE: [-50, 0, 0], rS: [-45, 0, -8], rE: [-50, 0, 0], lH: [-115, 0, 8], lK: [135, 0, 0], lA: [-20, 0, 0], rH: [-115, 0, -8], rK: [135, 0, 0], rA: [-20, 0, 0] }) },
        kneel: { zh: '单膝跪', en: 'Kneel', lift: -0.42, j: P({ sp: [4, 0, 0], lS: [-20, 0, 6], lE: [-30, 0, 0], rS: [-5, 0, -6], rE: [-15, 0, 0], lH: [-90, 0, 4], lK: [90, 0, 0], rH: [0, 0, -4], rK: [90, 0, 0], rA: [30, 0, 0] }) },
        lie: { zh: '躺', en: 'Lie', lift: -0.83, j: P({ hp: [-90, 0, 0], lS: [0, 0, 8], rS: [0, 0, -8] }) },
        point: { zh: '指向', en: 'Point', lift: 0, j: P({ sp: [0, -10, 0], hd: [0, -12, 0], rS: [-88, 0, -6], rE: [-4, 0, 0], lS: [0, 0, 6], lE: [-10, 0, 0] }) },
        wave: { zh: '挥手', en: 'Wave', lift: 0, j: P({ hd: [0, 0, -6], rS: [0, 0, -80], rE: [0, 0, -100], lS: [0, 0, 6], lE: [-10, 0, 0] }) },
        hug: { zh: '拥抱', en: 'Hug', lift: 0, j: P({ sp: [6, 0, 0], lS: [-78, 0, -18], lE: [0, 0, -70], rS: [-78, 0, 18], rE: [0, 0, 70] }) },
        standoff: { zh: '对峙', en: 'Standoff', lift: -0.02, j: P({ sp: [6, 0, 0], hd: [-4, 0, 0], lS: [-15, 0, 14], lE: [-50, 0, 0], rS: [-15, 0, -14], rE: [-50, 0, 0], lH: [-10, 0, 8], lK: [14, 0, 0], rH: [6, 0, -8], rK: [12, 0, 0] }) },
        fight: { zh: '打斗起手', en: 'Fight Stance', lift: -0.05, j: P({ sp: [10, -20, 0], hd: [-6, 18, 0], lS: [-70, 0, 12], lE: [-110, 0, 0], rS: [-50, 0, -18], rE: [-125, 0, 0], lH: [-25, 0, 8], lK: [22, 0, 0], rH: [12, 0, -8], rK: [22, 0, 0] }) },
        phone: { zh: '看手机', en: 'Phone', lift: 0, j: P({ nk: [8, 0, 0], hd: [28, 0, 0], rS: [-18, 0, -6], rE: [-105, 0, 12], lS: [-10, 0, 10], lE: [-70, 0, -20] }) },
        toast: { zh: '举杯', en: 'Toast', lift: 0, j: P({ hd: [-6, 0, 0], rS: [-75, 0, -8], rE: [-75, 0, 0], lS: [0, 0, 6], lE: [-10, 0, 0] }) },
        think: { zh: '思考', en: 'Think', lift: 0, j: P({ hd: [10, 0, 8], rS: [-35, 0, -4], rE: [-135, 0, 0], lS: [-30, 0, 14], lE: [-95, 0, -50] }) },
        hands_hips: { zh: '叉腰', en: 'Hands on Hips', lift: 0, j: P({ hd: [-4, 0, 0], lS: [8, 0, 42], lE: [-25, 0, -95], rS: [8, 0, -42], rE: [-25, 0, 95] }) },
        arms_crossed: { zh: '抱臂', en: 'Arms Crossed', lift: 0, j: P({ lS: [-40, 0, -12], lE: [0, 0, -100], rS: [-40, 0, 12], rE: [0, 0, 100] }) },
        bow: { zh: '鞠躬', en: 'Bow', lift: 0, j: P({ sp: [45, 0, 0], hd: [10, 0, 0], lS: [-40, 0, 4], rS: [-40, 0, -4], lE: [-5, 0, 0], rE: [-5, 0, 0] }) },
        call: { zh: '打电话', en: 'Phone Call', lift: 0, j: P({ hd: [0, 0, -10], rS: [-25, 0, -30], rE: [-145, 0, 0], lS: [0, 0, 6], lE: [-10, 0, 0] }) },
        look_up: { zh: '仰望', en: 'Look Up', lift: 0, j: P({ sp: [-6, 0, 0], nk: [-12, 0, 0], hd: [-30, 0, 0], lS: [0, 0, 6], rS: [0, 0, -6] }) },
        lean: { zh: '倚靠', en: 'Lean', lift: -0.01, j: P({ hp: [0, 0, 6], sp: [0, 0, -8], hd: [0, 0, 4], lH: [0, 0, -4], rH: [-12, 0, 8], rK: [14, 0, 0], lS: [0, 0, 10], rS: [-30, 0, -10], rE: [-80, 0, 0] }) },
        cheer: { zh: '欢呼', en: 'Cheer', lift: 0, j: P({ hd: [-12, 0, 0], lS: [0, 0, 160], rS: [0, 0, -160], lE: [0, 0, -15], rE: [0, 0, 15] }) }
    };
    const SHORT = { hp: 'hips', sp: 'spine', nk: 'neck', hd: 'head', lS: 'leftShoulder', lE: 'leftElbow', lW: 'leftWrist', rS: 'rightShoulder', rE: 'rightElbow', rW: 'rightWrist', lH: 'leftHip', lK: 'leftKnee', lA: 'leftAnkle', rH: 'rightHip', rK: 'rightKnee', rA: 'rightAnkle' };
    function posePreset(name) {
        const p = POSES[name];
        if (!p) return null;
        const pose = {};
        Object.keys(p.j).forEach(k => { pose[SHORT[k]] = p.j[k].slice(); });
        return { pose, lift: p.lift };
    }
    // 道具（程序化低模）：默认尺寸 [宽, 高, 深]（米）与默认颜色
    const PROPS = {
        box: { zh: '立方体', en: 'Box', size: [1, 1, 1], color: '#9aa3ad' },
        cylinder: { zh: '圆柱', en: 'Cylinder', size: [0.8, 1, 0.8], color: '#9aa3ad' },
        sphere: { zh: '球体', en: 'Sphere', size: [0.8, 0.8, 0.8], color: '#9aa3ad' },
        cone: { zh: '圆锥', en: 'Cone', size: [0.8, 1, 0.8], color: '#9aa3ad' },
        plane: { zh: '平面', en: 'Plane', size: [4, 0.02, 4], color: '#7d838c' },
        wall: { zh: '墙', en: 'Wall', size: [4, 2.8, 0.15], color: '#c9c4ba' },
        window_wall: { zh: '带窗墙', en: 'Window Wall', size: [4, 2.8, 0.15], color: '#c9c4ba' },
        door: { zh: '门', en: 'Door', size: [1, 2.1, 0.12], color: '#8a6a4f' },
        table: { zh: '桌子', en: 'Table', size: [1.4, 0.75, 0.8], color: '#8a6f55' },
        chair: { zh: '椅子', en: 'Chair', size: [0.48, 0.9, 0.5], color: '#6f5a48' },
        sofa: { zh: '沙发', en: 'Sofa', size: [2, 0.85, 0.9], color: '#5d6b7a' },
        bed: { zh: '床', en: 'Bed', size: [1.6, 0.55, 2.1], color: '#a7a9b8' },
        stairs: { zh: '楼梯', en: 'Stairs', size: [1.2, 1.5, 2.4], color: '#9b9488' },
        pillar: { zh: '柱子', en: 'Pillar', size: [0.5, 3, 0.5], color: '#bdb6a8' },
        tree: { zh: '树', en: 'Tree', size: [1.6, 3.5, 1.6], color: '#4f7a46' },
        car: { zh: '汽车', en: 'Car', size: [1.8, 1.45, 4.4], color: '#b0413e' },
        lamp: { zh: '落地灯', en: 'Floor Lamp', size: [0.4, 1.7, 0.4], color: '#d9c27a' },
        shelf: { zh: '书架', en: 'Shelf', size: [1.2, 1.9, 0.35], color: '#7a5f47' },
        counter: { zh: '吧台', en: 'Counter', size: [2.2, 1.05, 0.6], color: '#6b5a4a' }
    };
    const ACTOR_COLORS = ['#e0645c', '#4f8fe8', '#e8b84f', '#5cc28a', '#a77be8', '#e87fb8', '#4fc8d6', '#c4f17b', '#f09a4f', '#9aa3ad'];
    // 景别：画面高度覆盖主体身高的倍数 / 视线点高度（主体身高比例）
    const SHOTS = {
        els: { zh: '大远景', en: 'Extreme Wide', frame: 7, aim: 0.5 },
        ls: { zh: '远景', en: 'Wide', frame: 3, aim: 0.5 },
        fs: { zh: '全景', en: 'Full', frame: 1.2, aim: 0.52 },
        ms: { zh: '中景', en: 'Medium', frame: 0.6, aim: 0.76 },
        mcu: { zh: '近景', en: 'Close', frame: 0.36, aim: 0.85 },
        cu: { zh: '特写', en: 'Close-up', frame: 0.18, aim: 0.925 }
    };
    const SHOT_ORDER = ['els', 'ls', 'fs', 'ms', 'mcu', 'cu'];
    const ANGLES = {
        eye: { zh: '平视', en: 'Eye Level' },
        high: { zh: '俯拍', en: 'High Angle' },
        low: { zh: '仰拍', en: 'Low Angle' },
        ots: { zh: '过肩', en: 'Over the Shoulder' },
        bird: { zh: '鸟瞰', en: "Bird's Eye" },
        ground: { zh: '低角度', en: 'Ground Level' }
    };
    const MOVES = {
        push: { zh: '推', en: 'Push In' }, pull: { zh: '拉', en: 'Pull Out' }, pan: { zh: '摇', en: 'Pan' }, truck: { zh: '移', en: 'Truck' },
        rise: { zh: '升', en: 'Crane Up' }, fall: { zh: '降', en: 'Crane Down' }, orbit: { zh: '环绕', en: 'Orbit' }, follow: { zh: '跟随', en: 'Follow' },
        custom: { zh: '自定义', en: 'Custom' }
    };
    const EASES = ['linear', 'smooth', 'cut'];

    // ---------------- 小工具 ----------------
    const isNum = (v) => typeof v === 'number' && isFinite(v);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const r1 = (v) => Math.round(v * 10) / 10;
    const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
    const isId = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(s);
    function uid(p) { return p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6); }
    function cleanName(s, def) {
        const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name) : '';
        return t || def || '';
    }
    function vec3(v, def, min, max) {
        if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) return def.slice();
        return v.map((x, i) => r3(clamp(x, Array.isArray(min) ? min[i] : min, Array.isArray(max) ? max[i] : max)));
    }
    const POS_MIN = [-LIMITS.pos, LIMITS.posYMin, -LIMITS.pos], POS_MAX = [LIMITS.pos, LIMITS.posYMax, LIMITS.pos];
    function deg(v) { return isNum(v) ? r1(((v % 360) + 540) % 360 - 180) : 0; }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    // ---------------- 焦段 / 画幅 ----------------
    // 全画幅等效：传感器长边 36mm 对应画幅长边（横幅 → 水平方向，竖幅 → 垂直方向）
    function aspectNum(a) { return ASPECTS[a] || 16 / 9; }
    function focalToVFov(focal, aspect) {
        const A = typeof aspect === 'number' ? aspect : aspectNum(aspect);
        const f = clamp(isNum(focal) ? focal : 35, 1, 2000);
        const halfV = A >= 1 ? 18 / A : 18;
        return 2 * Math.atan(halfV / f) * 180 / Math.PI;
    }
    function vfovToFocal(vfov, aspect) {
        const A = typeof aspect === 'number' ? aspect : aspectNum(aspect);
        const halfV = A >= 1 ? 18 / A : 18;
        return halfV / Math.tan(vfov * Math.PI / 360);
    }
    function hFov(focal, aspect) {
        const A = typeof aspect === 'number' ? aspect : aspectNum(aspect);
        const v = focalToVFov(focal, A) * Math.PI / 180;
        return 2 * Math.atan(Math.tan(v / 2) * A) * 180 / Math.PI;
    }
    function outSize(aspect, res) {
        const A = aspectNum(aspect);
        const L = res === '1K' ? 1024 : 2048;
        let w, h;
        if (A >= 1) { w = L; h = Math.round(L / A); } else { h = L; w = Math.round(L * A); }
        return { w: w - (w % 2), h: h - (h % 2) };
    }

    // ---------------- 向量 / 四元数 ----------------
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const len = (a) => Math.hypot(a[0], a[1], a[2]);
    const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // 与 three.js Object3D.lookAt（相机：-Z 指向目标，+Y 向上）一致
    function lookAtQuat(pos, target) {
        let z = sub(pos, target);
        if (len(z) < 1e-9) z = [0, 0, 1];
        z = norm(z);
        let x = cross([0, 1, 0], z);
        if (len(x) < 1e-9) { z = norm(add(z, [0, 0, 1e-4])); x = cross([0, 1, 0], z); }
        x = norm(x);
        const y = cross(z, x);
        const m11 = x[0], m12 = y[0], m13 = z[0], m21 = x[1], m22 = y[1], m23 = z[1], m31 = x[2], m32 = y[2], m33 = z[2];
        const tr = m11 + m22 + m33;
        let qx, qy, qz, qw;
        if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); qw = 0.25 / s; qx = (m32 - m23) * s; qy = (m13 - m31) * s; qz = (m21 - m12) * s; }
        else if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); qw = (m32 - m23) / s; qx = 0.25 * s; qy = (m12 + m21) / s; qz = (m13 + m31) / s; }
        else if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); qw = (m13 - m31) / s; qx = (m12 + m21) / s; qy = 0.25 * s; qz = (m23 + m32) / s; }
        else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); qw = (m21 - m12) / s; qx = (m13 + m31) / s; qy = (m23 + m32) / s; qz = 0.25 * s; }
        return [qx, qy, qz, qw];
    }
    function slerp(a, b, t) {
        let [x, y, z, w] = b;
        let c = a[0] * x + a[1] * y + a[2] * z + a[3] * w;
        if (c < 0) { x = -x; y = -y; z = -z; w = -w; c = -c; }
        if (c >= 1 - 1e-9) return [a[0] + (x - a[0]) * t, a[1] + (y - a[1]) * t, a[2] + (z - a[2]) * t, a[3] + (w - a[3]) * t];
        const s2 = 1 - c * c, s = Math.sqrt(s2), th = Math.atan2(s, c);
        const ra = Math.sin((1 - t) * th) / s, rb = Math.sin(t * th) / s;
        const q = [a[0] * ra + x * rb, a[1] * ra + y * rb, a[2] * ra + z * rb, a[3] * ra + w * rb];
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        return q.map(v => v / l);
    }
    function ease(t, kind) {
        t = clamp(isNum(t) ? t : 0, 0, 1);
        if (kind === 'cut') return t >= 1 ? 1 : 0;
        if (kind === 'linear') return t;
        return t * t * (3 - 2 * t);
    }
    // 运镜采样：t 为秒；返回位置 / 视线点 / 四元数 / 焦段 / 进度
    function sampleMove(cam, time) {
        const mv = cam && cam.move;
        if (!mv) return { pos: cam.pos.slice(), target: cam.target.slice(), quat: lookAtQuat(cam.pos, cam.target), focal: cam.focal, p: 1, done: true };
        const d = mv.duration || 4;
        const raw = clamp((isNum(time) ? time : 0) / d, 0, 1);
        const p = ease(raw, mv.ease);
        const s = mv.start, e = mv.end;
        const target = lerp3(s.target, e.target, p);
        let pos, quat;
        if (mv.path === 'arc') {
            const a0 = Math.atan2(s.pos[0] - s.target[0], s.pos[2] - s.target[2]);
            let a1 = Math.atan2(e.pos[0] - e.target[0], e.pos[2] - e.target[2]);
            if (isNum(mv.arc)) a1 = a0 + mv.arc * Math.PI / 180;
            const r0 = Math.hypot(s.pos[0] - s.target[0], s.pos[2] - s.target[2]), r1v = Math.hypot(e.pos[0] - e.target[0], e.pos[2] - e.target[2]);
            const a = a0 + (a1 - a0) * p, r = r0 + (r1v - r0) * p;
            const h = (s.pos[1] - s.target[1]) + ((e.pos[1] - e.target[1]) - (s.pos[1] - s.target[1])) * p;
            pos = [target[0] + Math.sin(a) * r, target[1] + h, target[2] + Math.cos(a) * r];
            quat = lookAtQuat(pos, target);
        } else {
            pos = lerp3(s.pos, e.pos, p);
            quat = slerp(lookAtQuat(s.pos, s.target), lookAtQuat(e.pos, e.target), p);
        }
        return { pos, target, quat, focal: s.focal + (e.focal - s.focal) * p, p, done: raw >= 1 };
    }

    // ---------------- 默认值 / 归一化 ----------------
    function defaultCamera(i, lang) {
        return { id: 'cam_' + (i + 1), name: (lang === 'en' ? 'Cam ' : '机位 ') + (i + 1), pos: [0, 1.6, 6], target: [0, 1.2, 0], focal: 35, aspect: '16:9', shot: '', angle: 'eye', subjectId: '', move: null };
    }
    function createStage(opts) {
        opts = opts || {};
        const st = {
            v: VERSION,
            env: { panoNodeId: '', panoUrl: '', yaw: 0, horizon: 0, exposure: 1, preset: 'studio', grid: true },
            objects: [], cameras: [defaultCamera(0, opts.lang)], activeCameraId: 'cam_1'
        };
        if (opts.panoNodeId) { st.env.panoNodeId = String(opts.panoNodeId); st.env.panoUrl = String(opts.panoUrl || ''); }
        if (opts.preset && ENV_PRESETS[opts.preset]) st.env.preset = opts.preset;
        return st;
    }
    function normEnv(e) {
        e = e && typeof e === 'object' ? e : {};
        return {
            panoNodeId: typeof e.panoNodeId === 'string' ? e.panoNodeId.slice(0, 80) : '',
            panoUrl: typeof e.panoUrl === 'string' && e.panoUrl.length < 2000 && !/^data:/i.test(e.panoUrl) ? e.panoUrl : '',
            yaw: isNum(e.yaw) ? deg(e.yaw) : 0,
            horizon: isNum(e.horizon) ? r1(clamp(e.horizon, -30, 30)) : 0,
            exposure: isNum(e.exposure) ? Math.round(clamp(e.exposure, 0.2, 3) * 100) / 100 : 1,
            preset: ENV_PRESETS[e.preset] ? e.preset : 'studio',
            grid: e.grid !== false
        };
    }
    function normPose(p) {
        const out = {};
        if (!p || typeof p !== 'object') return out;
        JOINTS.forEach(j => { const v = p[j]; if (Array.isArray(v) && v.length === 3 && v.every(isNum)) out[j] = v.map(x => r1(clamp(x, -180, 180))); });
        return out;
    }
    function normObject(o, issues, i) {
        if (!o || typeof o !== 'object' || (o.type !== 'prop' && o.type !== 'actor')) { issues.push(`objects[${i}] 类型无效，已丢弃`); return null; }
        const base = {
            id: isId(o.id) ? o.id : uid(o.type === 'actor' ? 'a_' : 'p_'),
            type: o.type,
            name: cleanName(o.name, o.type === 'actor' ? '人偶' : '道具'),
            pos: vec3(o.pos, [0, 0, 0], POS_MIN, POS_MAX),
            rot: Array.isArray(o.rot) && o.rot.length === 3 && o.rot.every(isNum) ? o.rot.map(deg) : [0, 0, 0],
            color: isColor(o.color) ? o.color.toLowerCase() : (o.type === 'actor' ? ACTOR_COLORS[0] : '#9aa3ad'),
            hidden: !!o.hidden, locked: !!o.locked
        };
        if (o.type === 'prop') {
            const pr = o.prop && typeof o.prop === 'object' ? o.prop : {};
            const kind = PROPS[pr.kind] ? pr.kind : 'box';
            base.prop = { kind, size: vec3(pr.size, PROPS[kind].size, LIMITS.sizeMin, LIMITS.sizeMax) };
        } else {
            const a = o.actor && typeof o.actor === 'object' ? o.actor : {};
            base.actor = {
                pose: normPose(a.pose), posePreset: POSES[a.posePreset] ? a.posePreset : (a.posePreset === 'custom' ? 'custom' : 'stand'),
                lift: isNum(a.lift) ? r3(clamp(a.lift, -0.95, 0.5)) : 0,
                height: isNum(a.height) ? r3(clamp(a.height, LIMITS.heightMin, LIMITS.heightMax)) : 1.75,
                characterId: typeof a.characterId === 'string' && /^[\w-]{1,60}$/.test(a.characterId) ? a.characterId : '',
                charName: cleanName(a.charName, ''),
                mode: a.mode === 'billboard' ? 'billboard' : 'mannequin'
            };
            if (!Object.keys(base.actor.pose).length && base.actor.posePreset !== 'custom') { const pp = posePreset(base.actor.posePreset); base.actor.pose = pp.pose; if (!isNum(a.lift)) base.actor.lift = pp.lift; }
        }
        return base;
    }
    function normKey(k, def) {
        k = k && typeof k === 'object' ? k : {};
        return { pos: vec3(k.pos, def.pos, POS_MIN, POS_MAX), target: vec3(k.target, def.target, POS_MIN, POS_MAX), focal: isNum(k.focal) ? r1(clamp(k.focal, LIMITS.focalMin, LIMITS.focalMax)) : def.focal };
    }
    function normMove(m, cam) {
        if (!m || typeof m !== 'object') return null;
        const start = normKey(m.start, cam), end = normKey(m.end, cam);
        const out = {
            preset: MOVES[m.preset] ? m.preset : 'custom',
            duration: isNum(m.duration) ? r1(clamp(m.duration, LIMITS.durMin, LIMITS.durMax)) : 4,
            ease: EASES.indexOf(m.ease) !== -1 ? m.ease : 'smooth',
            start, end
        };
        if (m.path === 'arc') { out.path = 'arc'; if (isNum(m.arc)) out.arc = r1(clamp(m.arc, -360, 360)); }
        if (m.follow && typeof m.follow === 'object' && isId(m.follow.actorId) && Array.isArray(m.follow.delta) && m.follow.delta.length === 3 && m.follow.delta.every(isNum)) {
            out.follow = { actorId: m.follow.actorId, delta: m.follow.delta.map(v => r3(clamp(v, -20, 20))) };
        }
        return out;
    }
    function normCamera(c, i, issues) {
        if (!c || typeof c !== 'object') { issues.push(`cameras[${i}] 无效，已丢弃`); return null; }
        const d = defaultCamera(i);
        const cam = {
            id: isId(c.id) ? c.id : uid('cam_'),
            name: cleanName(c.name, d.name),
            pos: vec3(c.pos, d.pos, POS_MIN, POS_MAX),
            target: vec3(c.target, d.target, POS_MIN, POS_MAX),
            focal: isNum(c.focal) ? r1(clamp(c.focal, LIMITS.focalMin, LIMITS.focalMax)) : 35,
            aspect: ASPECTS[c.aspect] ? c.aspect : '16:9',
            shot: SHOTS[c.shot] ? c.shot : '',
            angle: ANGLES[c.angle] ? c.angle : '',
            subjectId: isId(c.subjectId) ? c.subjectId : '',
            move: null
        };
        if (len(sub(cam.pos, cam.target)) < 0.01) cam.target = add(cam.pos, [0, 0, -1]);
        cam.move = normMove(c.move, cam);
        return cam;
    }
    // 迁移 + 默认值 + 截断；返回 { stage, issues }
    function normalize(raw) {
        const issues = [];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { stage: createStage(), issues: ['场景数据无效，已重置为默认场景'] };
        const s = clone(raw);
        if (s.v !== VERSION) {
            if (s.v == null) { issues.push('无版本号，按 v1 解析'); }
            else if (s.v > VERSION) issues.push('场景版本 ' + s.v + ' 高于当前支持的 v' + VERSION + '，按 v1 解析');
        }
        const out = { v: VERSION, env: normEnv(s.env), objects: [], cameras: [], activeCameraId: '' };
        const seen = new Set();
        let actors = 0;
        (Array.isArray(s.objects) ? s.objects : []).forEach((o, i) => {
            if (out.objects.length >= LIMITS.objects) { issues.push('对象超过 ' + LIMITS.objects + ' 个，已截断'); return; }
            const n = normObject(o, issues, i);
            if (!n) return;
            if (n.type === 'actor' && ++actors > LIMITS.actors) { issues.push('人偶超过 ' + LIMITS.actors + ' 个，已截断'); return; }
            if (seen.has(n.id)) n.id = uid(n.type === 'actor' ? 'a_' : 'p_');
            seen.add(n.id);
            out.objects.push(n);
        });
        (Array.isArray(s.cameras) ? s.cameras : []).forEach((c, i) => {
            if (out.cameras.length >= LIMITS.cameras) { issues.push('机位超过 ' + LIMITS.cameras + ' 个，已截断'); return; }
            const n = normCamera(c, i, issues);
            if (!n) return;
            if (seen.has(n.id)) n.id = uid('cam_');
            seen.add(n.id);
            out.cameras.push(n);
        });
        if (!out.cameras.length) out.cameras.push(defaultCamera(0));
        out.cameras.forEach(c => { if (c.subjectId && !out.objects.some(o => o.id === c.subjectId)) c.subjectId = ''; if (c.move && c.move.follow && !out.objects.some(o => o.id === c.move.follow.actorId)) delete c.move.follow; });
        out.activeCameraId = out.cameras.some(c => c.id === s.activeCameraId) ? s.activeCameraId : out.cameras[0].id;
        return { stage: out, issues };
    }
    // 严格校验（不修正）：返回问题列表，空数组 = 合法
    function validate(s) {
        const issues = [];
        if (!s || typeof s !== 'object') return ['不是对象'];
        if (s.v !== VERSION) issues.push('v 必须为 ' + VERSION);
        const n = normalize(s);
        if (stable(n.stage) !== stable(s)) issues.push('存在越界、缺省或非法字段（归一化后不一致）');
        return issues.concat(n.issues);
    }
    function stable(v) {
        if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
        if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
        return JSON.stringify(v);
    }
    function sizeOf(s) { try { return JSON.stringify(s).length; } catch (_) { return Infinity; } }

    // ---------------- 主体 / 景别 / 角度 ----------------
    function actorHeight(o) { return (o && o.actor && o.actor.height) || 1.75; }
    function subjectOf(stage, cam) {
        const actors = stage.objects.filter(o => o.type === 'actor' && !o.hidden);
        return (cam && cam.subjectId && actors.find(a => a.id === cam.subjectId)) || actors[0] || null;
    }
    function facingVec(rotYDeg) { const r = (rotYDeg || 0) * Math.PI / 180; return [Math.sin(r), 0, Math.cos(r)]; }
    // 景别 / 角度求解：返回 { pos, target }。d = (画面高度/2) / tan(vFOV/2)
    function framing(subject, shotKey, angleKey, focal, aspect, opts) {
        opts = opts || {};
        const sh = SHOTS[shotKey] || SHOTS.ms;
        const H = subject ? actorHeight(subject) : 1.75;
        const base = subject ? subject.pos : [0, 0, 0];
        const lift = subject && subject.actor ? (subject.actor.lift || 0) * H / 1.8 : 0;
        const frameH = sh.frame * H;
        const vfov = focalToVFov(focal, aspect) * Math.PI / 180;
        const dist = (frameH / 2) / Math.tan(vfov / 2);
        const target = [base[0], Math.max(0.1, base[1] + sh.aim * H + lift), base[2]];
        let az = isNum(opts.azimuth) ? opts.azimuth : (subject ? (subject.rot[1] || 0) * Math.PI / 180 : 0);
        let el = 0;
        const ang = angleKey || 'eye';
        if (ang === 'high') el = 30;
        else if (ang === 'low') el = -18;
        else if (ang === 'bird') el = 80;
        if (ang === 'ots' && opts.other) {
            const o = opts.other;
            const oh = actorHeight(o);
            const toSub = norm(sub([target[0], 0, target[2]], [o.pos[0], 0, o.pos[2]]));
            const right = cross(toSub, [0, 1, 0]);
            const shoulder = [o.pos[0] - toSub[0] * 0.55 + right[0] * 0.38, o.pos[1] + oh * 0.93, o.pos[2] - toSub[2] * 0.55 + right[2] * 0.38];
            return { pos: shoulder.map(r3), target: target.map(r3), dist: len(sub(shoulder, target)) };
        }
        const er = el * Math.PI / 180;
        let pos = [target[0] + Math.sin(az) * Math.cos(er) * dist, target[1] + Math.sin(er) * dist, target[2] + Math.cos(az) * Math.cos(er) * dist];
        if (ang === 'ground') {
            const hd = Math.hypot(pos[0] - target[0], pos[2] - target[2]);
            pos = [target[0] + Math.sin(az) * hd, 0.35, target[2] + Math.cos(az) * hd];
        }
        if (pos[1] < 0.15) pos[1] = 0.15;
        return { pos: pos.map(r3), target: target.map(r3), dist };
    }
    // 由相机到主体距离与焦段推算景别
    function classifyShot(cam, subject, posOverride, focalOverride) {
        if (!subject) return '';
        const H = actorHeight(subject);
        const pos = posOverride || cam.pos;
        const f = focalOverride || cam.focal;
        const c = [subject.pos[0], subject.pos[1] + H * 0.6, subject.pos[2]];
        const d = Math.max(0.05, len(sub(pos, c)));
        const frameH = 2 * d * Math.tan(focalToVFov(f, cam.aspect) * Math.PI / 360);
        const k = frameH / H;
        let best = 'fs', bd = Infinity;
        SHOT_ORDER.forEach(s => { const e = Math.abs(Math.log(k / SHOTS[s].frame)); if (e < bd) { bd = e; best = s; } });
        return best;
    }

    // ---------------- 运镜预设 ----------------
    function key(cam) { return { pos: cam.pos.slice(), target: cam.target.slice(), focal: cam.focal }; }
    function moveFromPreset(stage, cam, preset, opts) {
        opts = opts || {};
        const s = key(cam);
        const e = clone(s);
        const amt = isNum(opts.amount) ? clamp(opts.amount, 0.1, 3) : 1;
        const dir = sub(s.target, s.pos);
        const dist = len(dir);
        const f = norm(dir);
        const right = norm(cross(f, [0, 1, 0]));
        const out = { preset, duration: isNum(opts.duration) ? r1(clamp(opts.duration, LIMITS.durMin, LIMITS.durMax)) : 4, ease: EASES.indexOf(opts.ease) !== -1 ? opts.ease : 'smooth', start: s, end: e };
        const side = opts.direction === 'left' ? -1 : 1;
        if (preset === 'push') e.pos = add(s.pos, mul(f, dist * 0.45 * Math.min(amt, 1.9)));
        else if (preset === 'pull') e.pos = sub(s.pos, mul(f, dist * 0.7 * amt));
        else if (preset === 'pan') {
            const a = side * 30 * amt * Math.PI / 180;
            const c = Math.cos(-a), sn = Math.sin(-a);
            e.target = [s.pos[0] + dir[0] * c - dir[2] * sn, s.target[1], s.pos[2] + dir[0] * sn + dir[2] * c];
        } else if (preset === 'truck') { const dv = mul(right, side * Math.max(1, dist * 0.3) * amt); e.pos = add(s.pos, dv); e.target = add(s.target, dv); }
        else if (preset === 'rise') { e.pos = add(s.pos, [0, 1.5 * amt, 0]); e.target = add(s.target, [0, 0.25 * amt, 0]); }
        else if (preset === 'fall') { e.pos = [s.pos[0], Math.max(0.2, s.pos[1] - 1.2 * amt), s.pos[2]]; e.target = add(s.target, [0, -0.15 * amt, 0]); }
        else if (preset === 'orbit') {
            out.path = 'arc'; out.arc = r1(side * 90 * amt);
            const a = out.arc * Math.PI / 180;
            const rx = s.pos[0] - s.target[0], rz = s.pos[2] - s.target[2];
            e.pos = [s.target[0] + rx * Math.cos(a) + rz * Math.sin(a), s.pos[1], s.target[2] - rx * Math.sin(a) + rz * Math.cos(a)];
        } else if (preset === 'follow') {
            const subj = subjectOf(stage, cam);
            const fw = subj ? facingVec(subj.rot[1]) : [f[0], 0, f[2]];
            const dv = mul(norm(fw), 2.5 * amt);
            e.pos = add(s.pos, dv); e.target = add(s.target, dv);
            if (subj) out.follow = { actorId: subj.id, delta: dv.map(r3) };
        } else if (preset !== 'custom') return null;
        if (isNum(opts.endFocal)) e.focal = r1(clamp(opts.endFocal, LIMITS.focalMin, LIMITS.focalMax));
        e.pos = e.pos.map(r3); e.target = e.target.map(r3);
        if (e.pos[1] < 0.1) e.pos[1] = 0.1;
        return normMove(out, cam);
    }
    // 运镜描述（用作视频提示词）
    function describeMove(stage, cam, lang) {
        const en = lang === 'en';
        const mv = cam && cam.move;
        if (!mv) return '';
        const subj = subjectOf(stage, cam);
        const s0 = subj ? classifyShot(cam, subj, mv.start.pos, mv.start.focal) : '';
        const s1 = subj ? classifyShot(cam, subj, mv.end.pos, mv.end.focal) : '';
        const N = (k) => k ? (en ? SHOTS[k].en.toLowerCase() + ' shot' : SHOTS[k].zh) : '';
        const speed = mv.duration <= 3 ? (en ? 'quickly' : '快速') : (mv.duration >= 7 ? (en ? 'slowly' : '缓慢') : (en ? 'smoothly' : '平稳地'));
        const dx = sub(mv.end.pos, mv.start.pos);
        const f = norm(sub(mv.start.target, mv.start.pos));
        const right = cross(f, [0, 1, 0]);
        const lr = dot(dx, right) >= 0 ? (en ? 'right' : '右') : (en ? 'left' : '左');
        let t;
        switch (mv.preset) {
            case 'push': t = en ? `The camera ${speed} pushes in${s0 && s1 && s0 !== s1 ? ` from a ${N(s0)} to a ${N(s1)}` : ''}` : `镜头从${N(s0) || '当前景别'}${speed}推近${s1 && s1 !== s0 ? '到' + N(s1) : ''}`; break;
            case 'pull': t = en ? `The camera ${speed} pulls back${s0 && s1 && s0 !== s1 ? ` from a ${N(s0)} to a ${N(s1)}` : ''}` : `镜头从${N(s0) || '当前景别'}${speed}拉远${s1 && s1 !== s0 ? '到' + N(s1) : ''}`; break;
            case 'pan': { const ty = cross(sub(mv.start.target, mv.start.pos), sub(mv.end.target, mv.end.pos))[1]; const d = ty < 0 ? (en ? 'right' : '右') : (en ? 'left' : '左'); t = en ? `The camera ${speed} pans ${d}` : `镜头${speed}向${d}摇`; break; }
            case 'truck': t = en ? `The camera ${speed} trucks ${lr}, tracking sideways` : `镜头${speed}向${lr}横移`; break;
            case 'rise': t = en ? `The camera ${speed} cranes up into a high angle` : `镜头${speed}升起，转为俯视`; break;
            case 'fall': t = en ? `The camera ${speed} cranes down to a lower angle` : `镜头${speed}下降，转为低机位`; break;
            case 'orbit': t = en ? `The camera ${speed} orbits around the subject ${(mv.arc || 0) >= 0 ? 'counter-clockwise' : 'clockwise'}` : `镜头围绕主体${(mv.arc || 0) >= 0 ? '逆时针' : '顺时针'}${speed}环绕`; break;
            case 'follow': t = en ? `The camera ${speed} follows the character moving forward` : `镜头${speed}跟随人物向前移动`; break;
            default: {
                const dd = len(sub(mv.end.target, mv.end.pos)) - len(sub(mv.start.target, mv.start.pos));
                t = en ? `The camera moves from the start frame to the end frame${s0 && s1 && s0 !== s1 ? `, ${N(s0)} to ${N(s1)}` : ''}` : `镜头从起幅运动到落幅${s0 && s1 && s0 !== s1 ? `，${N(s0)}到${N(s1)}` : (Math.abs(dd) > 0.3 ? (dd < 0 ? '，逐渐推近' : '，逐渐拉远') : '')}`;
            }
        }
        const lens = Math.abs(mv.end.focal - mv.start.focal) >= 1 ? (en ? `, lens ${Math.round(mv.start.focal)}mm→${Math.round(mv.end.focal)}mm` : `，焦段 ${Math.round(mv.start.focal)}mm→${Math.round(mv.end.focal)}mm`) : (en ? `, ${Math.round(mv.start.focal)}mm lens` : `，${Math.round(mv.start.focal)}mm 镜头`);
        const ang = cam.angle && ANGLES[cam.angle] && cam.angle !== 'eye' ? (en ? `, ${ANGLES[cam.angle].en.toLowerCase()}` : `，${ANGLES[cam.angle].zh}`) : '';
        return t + ang + lens + (en ? `, ${mv.duration}s.` : `，${mv.duration} 秒。`);
    }

    // ---------------- 统计 / 摘要 ----------------
    function stats(stage) {
        const o = (stage && stage.objects) || [];
        return { actors: o.filter(x => x.type === 'actor').length, props: o.filter(x => x.type === 'prop').length, cameras: ((stage && stage.cameras) || []).length };
    }
    function summary(stage) {
        return {
            env: stage.env.panoNodeId ? { pano: stage.env.panoNodeId, yaw: stage.env.yaw } : { preset: stage.env.preset },
            actors: stage.objects.filter(o => o.type === 'actor').map(o => ({ id: o.id, name: o.name, x: r1(o.pos[0]), z: r1(o.pos[2]), rotY: Math.round(o.rot[1]), pose: o.actor.posePreset, height: o.actor.height, characterId: o.actor.characterId || undefined, color: o.color })),
            props: stage.objects.filter(o => o.type === 'prop').map(o => ({ id: o.id, name: o.name, kind: o.prop.kind, x: r1(o.pos[0]), z: r1(o.pos[2]), rotY: Math.round(o.rot[1]), size: o.prop.size })),
            cameras: stage.cameras.map(c => ({ id: c.id, name: c.name, focal: c.focal, aspect: c.aspect, shot: c.shot || undefined, angle: c.angle || undefined, subjectId: c.subjectId || undefined, pos: c.pos.map(r1), target: c.target.map(r1), move: c.move ? { preset: c.move.preset, duration: c.move.duration } : undefined })),
            activeCameraId: stage.activeCameraId
        };
    }

    // ---------------- AI 受校验操作 ----------------
    const OP_KEYS = {
        add_actor: ['op', 'id', 'name', 'characterId', 'pose', 'x', 'y', 'z', 'rotY', 'faceTo', 'near', 'side', 'distance', 'height', 'color', 'mode'],
        add_prop: ['op', 'id', 'name', 'kind', 'x', 'y', 'z', 'rotY', 'faceTo', 'near', 'side', 'distance', 'size', 'color'],
        move: ['op', 'id', 'x', 'y', 'z', 'rotY', 'faceTo', 'near', 'side', 'distance'],
        pose: ['op', 'id', 'pose', 'joints'],
        set_camera: ['op', 'id', 'name', 'subjectId', 'otherId', 'shot', 'angle', 'focal', 'aspect', 'pos', 'target', 'makeActive'],
        set_move: ['op', 'cameraId', 'preset', 'duration', 'ease', 'amount', 'direction', 'endFocal'],
        bind_character: ['op', 'id', 'characterId', 'mode'],
        delete: ['op', 'id'],
        set_env: ['op', 'panoNodeId', 'preset', 'yaw', 'horizon', 'exposure', 'grid'],
        rename: ['op', 'id', 'name'],
        set_color: ['op', 'id', 'color']
    };
    const OP_NAMES = Object.keys(OP_KEYS);
    function E(msg) { const e = new Error(msg); e.op = true; return e; }
    function num(v, name, min, max, opt) {
        if (v === undefined || v === null) { if (opt) return undefined; throw E(`${name} 不能为空`); }
        if (!isNum(v)) throw E(`${name} 必须是数字`);
        if (v < min || v > max) throw E(`${name} 超出范围（${min} ~ ${max}）`);
        return v;
    }
    function vecArg(v, name) {
        if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw E(`${name} 必须是 [x, y, z] 三个数字`);
        v.forEach((x, i) => { if (x < POS_MIN[i] || x > POS_MAX[i]) throw E(`${name} 超出场景范围（x/z ±${LIMITS.pos}，y ${LIMITS.posYMin}~${LIMITS.posYMax}）`); });
        return v.map(r3);
    }
    // 位置：x/z（必要时 y），或 near（参照对象）+ side + distance
    function placeOf(st, a, cur, isNew) {
        let pos = cur ? cur.slice() : [0, 0, 0];
        if (a.near !== undefined) {
            const ref = st.objects.find(o => o.id === a.near);
            if (!ref) throw E(`near「${String(a.near).slice(0, 40)}」不存在`);
            const side = a.side === undefined ? 'front' : a.side;
            if (['front', 'back', 'left', 'right'].indexOf(side) === -1) throw E('side 只能是 front / back / left / right');
            const dist = num(a.distance, 'distance', 0, 20, true);
            const half = ref.type === 'prop' ? ((side === 'front' || side === 'back') ? ref.prop.size[2] : ref.prop.size[0]) / 2 : 0.25;
            const d = (dist === undefined ? 0.6 : dist) + half;
            const fw = facingVec(ref.rot[1]);
            const rt = [fw[2], 0, -fw[0]];
            const v = side === 'front' ? fw : side === 'back' ? mul(fw, -1) : side === 'left' ? mul(rt, -1) : rt;
            pos = [ref.pos[0] + v[0] * d, 0, ref.pos[2] + v[2] * d];
        } else if (a.side !== undefined || a.distance !== undefined) throw E('side / distance 需要与 near 一起使用');
        if (a.x !== undefined) pos[0] = num(a.x, 'x', -LIMITS.pos, LIMITS.pos);
        if (a.z !== undefined) pos[2] = num(a.z, 'z', -LIMITS.pos, LIMITS.pos);
        if (a.y !== undefined) pos[1] = num(a.y, 'y', LIMITS.posYMin, LIMITS.posYMax);
        if (isNew && a.near === undefined && (a.x === undefined || a.z === undefined)) throw E('新对象需要 x 和 z（或 near）');
        return pos.map(r3);
    }
    // faceTo 优先于 rotY（模型常把 rotY 填默认 0）；faceTo 引用同批稍后创建的对象时延后到整批末尾解析
    function faceAngle(from, p, cur) {
        const dx = p[0] - from[0], dz = p[2] - from[2];
        if (Math.hypot(dx, dz) < 1e-3) return cur || 0;
        return deg(Math.atan2(dx, dz) * 180 / Math.PI);
    }
    function rotOf(st, a, pos, cur, defer) {
        if (a.faceTo !== undefined) {
            if (typeof a.faceTo !== 'string' || !a.faceTo) throw E('faceTo 必须是对象 / 机位 id 或 camera');
            let p;
            if (a.faceTo === 'camera') { const c = st.cameras.find(x => x.id === st.activeCameraId) || st.cameras[0]; p = c.pos; }
            else {
                const ref = st.objects.find(o => o.id === a.faceTo) || st.cameras.find(c => c.id === a.faceTo);
                if (!ref) { if (defer) { defer(a.faceTo); return cur || 0; } throw E(`faceTo「${String(a.faceTo).slice(0, 40)}」不存在`); }
                p = ref.pos;
            }
            return faceAngle(pos, p, cur);
        }
        if (a.rotY !== undefined) return deg(num(a.rotY, 'rotY', -360, 360));
        return cur || 0;
    }
    function newId(st, a, prefix) {
        if (a.id !== undefined) {
            if (!isId(a.id)) throw E(`id「${String(a.id).slice(0, 40)}」格式不合法（字母开头，2-40 位字母数字下划线）`);
            if (st.objects.some(o => o.id === a.id) || st.cameras.some(c => c.id === a.id)) throw E(`id「${a.id}」已存在`);
            return a.id;
        }
        let id;
        do { id = prefix + Math.random().toString(36).slice(2, 7); } while (st.objects.some(o => o.id === id) || st.cameras.some(c => c.id === id));
        return id;
    }
    function strArg(v, name, max) {
        if (v === undefined) return undefined;
        if (typeof v !== 'string') throw E(`${name} 必须是字符串`);
        if (v.length > max) throw E(`${name} 不能超过 ${max} 字`);
        return v;
    }
    function colorArg(v) { if (v === undefined) return undefined; if (!isColor(v)) throw E('color 必须是 #rrggbb'); return v.toLowerCase(); }
    function getObj(st, id, type) {
        if (typeof id !== 'string') throw E('id 不能为空');
        const o = st.objects.find(x => x.id === id);
        if (!o) throw E(`对象「${id.slice(0, 40)}」不存在`);
        if (type && o.type !== type) throw E(`「${o.name}」不是${type === 'actor' ? '人偶' : '道具'}`);
        return o;
    }
    function nextColor(st) {
        const used = st.objects.filter(o => o.type === 'actor').map(o => o.color);
        return ACTOR_COLORS.find(c => used.indexOf(c) === -1) || ACTOR_COLORS[used.length % ACTOR_COLORS.length];
    }
    function applyOne(st, a, ctx, created) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) throw E('操作必须是对象');
        const op = a.op;
        if (OP_NAMES.indexOf(op) === -1) throw E(`未知操作「${String(op).slice(0, 30)}」，可用：${OP_NAMES.join(' / ')}`);
        const extra = Object.keys(a).filter(k => OP_KEYS[op].indexOf(k) === -1);
        if (extra.length) throw E(`${op} 不支持参数：${extra.slice(0, 6).join(', ')}`);
        const lang = ctx.lang;
        if (op === 'add_actor' || op === 'add_prop') {
            const isA = op === 'add_actor';
            if (isA && st.objects.filter(o => o.type === 'actor').length >= LIMITS.actors) throw E(`人偶最多 ${LIMITS.actors} 个`);
            if (st.objects.length >= LIMITS.objects) throw E(`对象最多 ${LIMITS.objects} 个`);
            let kind;
            if (!isA) { kind = a.kind; if (!PROPS[kind]) throw E(`kind「${String(kind).slice(0, 30)}」无效，可用：${Object.keys(PROPS).join(' / ')}`); }
            if (isA && a.pose !== undefined && !POSES[a.pose]) throw E(`pose「${String(a.pose).slice(0, 30)}」无效，可用：${Object.keys(POSES).join(' / ')}`);
            let charName = '';
            if (a.characterId !== undefined) {
                if (!isA) throw E('道具不能绑定角色');
                if (typeof a.characterId !== 'string' || !ctx.character || !ctx.character(a.characterId)) throw E(`角色「${String(a.characterId).slice(0, 40)}」不存在，请先用 list_characters 获取角色 id`);
                charName = ctx.character(a.characterId).name || '';
            }
            if (a.mode !== undefined && a.mode !== 'mannequin' && a.mode !== 'billboard') throw E('mode 只能是 mannequin / billboard');
            const id = newId(st, a, isA ? 'a_' : 'p_');
            const pos = placeOf(st, a, null, true);
            if (!isA && a.y === undefined) pos[1] = 0;
            const ry = rotOf(st, a, pos, 0, (ref) => ctx._pending.push({ id, ref, index: ctx._idx }));
            const name = cleanName(strArg(a.name, 'name', 60), isA ? (charName || (lang === 'en' ? 'Actor ' : '人偶 ') + (st.objects.filter(o => o.type === 'actor').length + 1)) : (lang === 'en' ? PROPS[kind].en : PROPS[kind].zh));
            const o = { id, type: isA ? 'actor' : 'prop', name, pos, rot: [0, ry, 0], color: colorArg(a.color) || (isA ? nextColor(st) : PROPS[kind].color), hidden: false, locked: false };
            if (isA) {
                const pp = posePreset(a.pose || 'stand');
                o.actor = { pose: pp.pose, posePreset: a.pose || 'stand', lift: pp.lift, height: num(a.height, 'height', LIMITS.heightMin, LIMITS.heightMax, true) || 1.75, characterId: a.characterId || '', charName, mode: a.mode || 'mannequin' };
            } else {
                let size = PROPS[kind].size.slice();
                if (a.size !== undefined) {
                    if (!Array.isArray(a.size) || a.size.length !== 3 || !a.size.every(isNum)) throw E('size 必须是 [宽, 高, 深] 三个数字（米）');
                    a.size.forEach(v => { if (v < LIMITS.sizeMin || v > LIMITS.sizeMax) throw E(`size 每项须在 ${LIMITS.sizeMin}~${LIMITS.sizeMax} 米`); });
                    size = a.size.map(r3);
                }
                o.prop = { kind, size };
            }
            st.objects.push(o);
            created.push(id);
            return { op, id };
        }
        if (op === 'move') {
            const o = getObj(st, a.id);
            if (a.x === undefined && a.y === undefined && a.z === undefined && a.near === undefined && a.rotY === undefined && a.faceTo === undefined) throw E('move 至少需要 x / z / near / rotY / faceTo 之一');
            const pos = placeOf(st, a, o.pos, false);
            o.pos = pos;
            o.rot = [o.rot[0], rotOf(st, a, pos, o.rot[1], (ref) => ctx._pending.push({ id: o.id, ref, index: ctx._idx })), o.rot[2]];
            return { op, id: o.id };
        }
        if (op === 'pose') {
            const o = getObj(st, a.id, 'actor');
            if (a.pose === undefined && a.joints === undefined) throw E('pose 需要 pose 或 joints');
            if (a.pose !== undefined) {
                if (!POSES[a.pose]) throw E(`pose「${String(a.pose).slice(0, 30)}」无效，可用：${Object.keys(POSES).join(' / ')}`);
                const pp = posePreset(a.pose);
                o.actor.pose = pp.pose; o.actor.lift = pp.lift; o.actor.posePreset = a.pose;
            }
            if (a.joints !== undefined) {
                if (!Array.isArray(a.joints) || !a.joints.length || a.joints.length > 16) throw E('joints 必须是 1-16 项数组');
                a.joints.forEach((j, i) => {
                    if (!j || typeof j !== 'object') throw E(`joints[${i}] 必须是对象`);
                    const bad = Object.keys(j).filter(k => ['joint', 'x', 'y', 'z'].indexOf(k) === -1);
                    if (bad.length) throw E(`joints[${i}] 不支持参数：${bad.join(', ')}`);
                    if (JOINTS.indexOf(j.joint) === -1) throw E(`joints[${i}].joint「${String(j.joint).slice(0, 30)}」无效，可用：${JOINTS.join(' / ')}`);
                    const v = ['x', 'y', 'z'].map(k => num(j[k] === undefined ? 0 : j[k], `joints[${i}].${k}`, -180, 180));
                    o.actor.pose[j.joint] = v.map(r1);
                });
                o.actor.posePreset = 'custom';
            }
            return { op, id: o.id };
        }
        if (op === 'bind_character') {
            const o = getObj(st, a.id, 'actor');
            if (a.characterId === '' || a.characterId === null) { o.actor.characterId = ''; o.actor.charName = ''; o.actor.mode = 'mannequin'; return { op, id: o.id }; }
            if (typeof a.characterId !== 'string' || !ctx.character || !ctx.character(a.characterId)) throw E(`角色「${String(a.characterId).slice(0, 40)}」不存在，请先用 list_characters 获取角色 id`);
            if (a.mode !== undefined && a.mode !== 'mannequin' && a.mode !== 'billboard') throw E('mode 只能是 mannequin / billboard');
            const c = ctx.character(a.characterId);
            o.actor.characterId = a.characterId; o.actor.charName = cleanName(c.name, '');
            if (a.mode) o.actor.mode = a.mode;
            if (/^(人偶|Actor) \d+$/.test(o.name) && c.name) o.name = cleanName(c.name, o.name);
            return { op, id: o.id };
        }
        if (op === 'rename') { const o = getObj(st, a.id) ; const n = cleanName(strArg(a.name, 'name', 60), ''); if (!n) throw E('name 不能为空'); o.name = n; return { op, id: o.id }; }
        if (op === 'set_color') { const o = getObj(st, a.id); const c = colorArg(a.color); if (!c) throw E('color 不能为空'); o.color = c; return { op, id: o.id }; }
        if (op === 'delete') {
            if (typeof a.id !== 'string') throw E('id 不能为空');
            const oi = st.objects.findIndex(o => o.id === a.id);
            if (oi !== -1) {
                st.objects.splice(oi, 1);
                st.cameras.forEach(c => { if (c.subjectId === a.id) c.subjectId = ''; if (c.move && c.move.follow && c.move.follow.actorId === a.id) delete c.move.follow; });
                return { op, id: a.id };
            }
            const ci = st.cameras.findIndex(c => c.id === a.id);
            if (ci === -1) throw E(`对象或机位「${a.id.slice(0, 40)}」不存在`);
            if (st.cameras.length <= 1) throw E('至少保留一个机位');
            st.cameras.splice(ci, 1);
            if (st.activeCameraId === a.id) st.activeCameraId = st.cameras[0].id;
            return { op, id: a.id };
        }
        if (op === 'set_env') {
            const e = st.env;
            if (a.panoNodeId !== undefined) {
                if (a.panoNodeId === '' || a.panoNodeId === null) { e.panoNodeId = ''; e.panoUrl = ''; }
                else {
                    const pn = typeof a.panoNodeId === 'string' && ctx.pano ? ctx.pano(a.panoNodeId) : null;
                    if (!pn) throw E(`全景节点「${String(a.panoNodeId).slice(0, 40)}」不存在或还没有全景图`);
                    e.panoNodeId = a.panoNodeId; e.panoUrl = pn.url || '';
                }
            }
            if (a.preset !== undefined) { if (!ENV_PRESETS[a.preset]) throw E(`preset 只能是 ${Object.keys(ENV_PRESETS).join(' / ')}`); e.preset = a.preset; if (a.panoNodeId === undefined) { e.panoNodeId = ''; e.panoUrl = ''; } }
            if (a.yaw !== undefined) e.yaw = deg(num(a.yaw, 'yaw', -360, 360));
            if (a.horizon !== undefined) e.horizon = r1(num(a.horizon, 'horizon', -30, 30));
            if (a.exposure !== undefined) e.exposure = Math.round(num(a.exposure, 'exposure', 0.2, 3) * 100) / 100;
            if (a.grid !== undefined) { if (typeof a.grid !== 'boolean') throw E('grid 必须是 true / false'); e.grid = a.grid; }
            return { op };
        }
        if (op === 'set_camera') {
            let cam = a.id !== undefined ? st.cameras.find(c => c.id === a.id) : null;
            if (a.id !== undefined && !cam && st.objects.some(o => o.id === a.id)) throw E(`「${a.id}」是场景对象，不是机位`);
            let isNew = false;
            if (!cam) {
                if (st.cameras.length >= LIMITS.cameras) throw E(`机位最多 ${LIMITS.cameras} 个`);
                const id = newId(st, a, 'cam_');
                cam = defaultCamera(st.cameras.length, lang);
                cam.id = id;
                let n = st.cameras.length + 1;
                while (st.cameras.some(c => c.name === cam.name)) cam.name = (lang === 'en' ? 'Cam ' : '机位 ') + (++n);
                isNew = true;
            }
            const draft = clone(cam);
            if (a.name !== undefined) { const n = cleanName(strArg(a.name, 'name', 60), ''); if (!n) throw E('name 不能为空'); draft.name = n; }
            if (a.focal !== undefined) draft.focal = r1(num(a.focal, 'focal', LIMITS.focalMin, LIMITS.focalMax));
            if (a.aspect !== undefined) { if (!ASPECTS[a.aspect]) throw E(`aspect 只能是 ${Object.keys(ASPECTS).join(' / ')}`); draft.aspect = a.aspect; }
            if (a.shot !== undefined && !SHOTS[a.shot]) throw E(`shot 只能是 ${Object.keys(SHOTS).join(' / ')}`);
            if (a.angle !== undefined && !ANGLES[a.angle]) throw E(`angle 只能是 ${Object.keys(ANGLES).join(' / ')}`);
            if (a.subjectId !== undefined) { const s = getObj(st, a.subjectId, 'actor'); draft.subjectId = s.id; }
            let other = null;
            if (a.otherId !== undefined) { other = getObj(st, a.otherId, 'actor'); if (other.id === draft.subjectId) throw E('otherId 不能与 subjectId 相同'); }
            if (a.pos !== undefined || a.target !== undefined) {
                if (a.shot !== undefined || a.angle !== undefined) throw E('pos/target 与 shot/angle 不能同时使用');
                if (a.pos !== undefined) draft.pos = vecArg(a.pos, 'pos');
                if (a.target !== undefined) draft.target = vecArg(a.target, 'target');
                if (len(sub(draft.pos, draft.target)) < 0.05) throw E('pos 与 target 太近');
                draft.shot = ''; draft.angle = '';
            } else if (a.shot !== undefined || a.angle !== undefined || isNew || a.subjectId !== undefined) {
                const subj = subjectOf(st, draft);
                const shot = a.shot || draft.shot || (subj ? 'ms' : 'ls');
                const angle = a.angle || draft.angle || 'eye';
                if (angle === 'ots' && !other) other = st.objects.filter(o => o.type === 'actor' && subj && o.id !== subj.id).sort((p, q) => len(sub(p.pos, subj.pos)) - len(sub(q.pos, subj.pos)))[0] || null;
                if (angle === 'ots' && !other) throw E('过肩镜头（ots）需要场景里至少两个人偶');
                let az;
                if (!isNew && subj) { const dv = sub(draft.pos, draft.target); if (Math.hypot(dv[0], dv[2]) > 0.05) az = Math.atan2(dv[0], dv[2]); }
                const fr = framing(subj, shot, angle, draft.focal, draft.aspect, { azimuth: az, other });
                draft.pos = fr.pos; draft.target = fr.target; draft.shot = shot; draft.angle = angle;
            }
            if (draft.move) draft.move = null;
            if (isNew) { st.cameras.push(draft); created.push(draft.id); }
            else Object.assign(cam, draft);
            if (a.makeActive === true || isNew && a.makeActive !== false) st.activeCameraId = draft.id;
            return { op, id: draft.id };
        }
        if (op === 'set_move') {
            const cam = st.cameras.find(c => c.id === a.cameraId);
            if (!cam) throw E(`机位「${String(a.cameraId).slice(0, 40)}」不存在`);
            if (a.preset === 'none') { cam.move = null; return { op, id: cam.id }; }
            if (!MOVES[a.preset] || a.preset === 'custom') throw E(`preset 只能是 ${Object.keys(MOVES).filter(k => k !== 'custom').join(' / ')} / none`);
            if (a.ease !== undefined && EASES.indexOf(a.ease) === -1) throw E('ease 只能是 linear / smooth / cut');
            if (a.direction !== undefined && a.direction !== 'left' && a.direction !== 'right') throw E('direction 只能是 left / right');
            const mv = moveFromPreset(st, cam, a.preset, { duration: num(a.duration, 'duration', LIMITS.durMin, LIMITS.durMax, true), ease: a.ease, amount: num(a.amount, 'amount', 0.1, 3, true), direction: a.direction, endFocal: num(a.endFocal, 'endFocal', LIMITS.focalMin, LIMITS.focalMax, true) });
            cam.move = mv;
            return { op, id: cam.id };
        }
        throw E('未实现的操作');
    }
    // 整批原子执行：任一失败返回 { ok:false, errors }，原场景不变
    function applyOps(stage, ops, ctx) {
        ctx = ctx || {};
        if (!Array.isArray(ops) || !ops.length) return { ok: false, errors: [{ index: -1, error: 'ops 必须是非空数组' }] };
        if (ops.length > LIMITS.ops) return { ok: false, errors: [{ index: -1, error: `一次最多 ${LIMITS.ops} 个操作` }] };
        const draft = normalize(stage).stage;
        const created = [], done = [], errors = [];
        const cx = Object.assign({}, ctx, { _pending: [], _idx: 0 });
        for (let i = 0; i < ops.length; i++) {
            cx._idx = i;
            try { done.push(applyOne(draft, ops[i], cx, created)); }
            catch (e) { errors.push({ index: i, op: ops[i] && typeof ops[i].op === 'string' ? ops[i].op.slice(0, 30) : '', error: e.op ? e.message : ('执行失败：' + e.message) }); break; }
        }
        if (!errors.length) {
            for (const pd of cx._pending) {
                const o = draft.objects.find(x => x.id === pd.id);
                const ref = draft.objects.find(x => x.id === pd.ref) || draft.cameras.find(x => x.id === pd.ref);
                if (!o) continue;
                if (!ref) { errors.push({ index: pd.index, op: ops[pd.index] && ops[pd.index].op, error: `faceTo「${String(pd.ref).slice(0, 40)}」不存在` }); break; }
                o.rot = [o.rot[0], faceAngle(o.pos, ref.pos, o.rot[1]), o.rot[2]];
            }
        }
        if (errors.length) return { ok: false, errors, note: '整批未执行，请修正后重试' };
        const fin = normalize(draft);
        if (sizeOf(fin.stage) > 200 * 1024) return { ok: false, errors: [{ index: -1, error: '场景数据过大' }] };
        return { ok: true, stage: fin.stage, created, applied: done };
    }

    return {
        VERSION, LIMITS, JOINTS, JOINT_LABEL, ASPECTS, ENV_PRESETS, POSES, PROPS, ACTOR_COLORS, SHOTS, SHOT_ORDER, ANGLES, MOVES, EASES, OP_NAMES, OP_KEYS,
        posePreset, createStage, defaultCamera, normalize, validate, sizeOf, clone, uid,
        aspectNum, focalToVFov, vfovToFocal, hFov, outSize,
        lookAtQuat, slerp, ease, sampleMove, lerp3,
        subjectOf, framing, classifyShot, facingVec, moveFromPreset, describeMove, stats, summary, applyOps, nextColor
    };
});
