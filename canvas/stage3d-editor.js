/**
 * stage3d-editor.js —— 3D 片场编辑器（ES module，打开片场时才懒加载；依赖 canvas/vendor/three/three-stage.module.min.js）
 *   - StageView：three.js 渲染（全景环境球 / 程序化背景 / 地面阴影 / 人偶 / 道具 / 机位与视锥）+ 截图（离屏尺寸，同一渲染管线）
 *   - Editor：全屏沉浸式 UI（顶部工具条 / 左侧大纲 / 右侧属性 / 底部机位缩略条）、TransformControls、编辑器内撤销重做
 *   - renderStage：无界面渲染（AI 助手 stage_snapshot / 节点工具栏「截图到画布」）
 *
 * 程序化 16 关节人偶移植自 Toonflow director3dNode（mannequin.ts），MIT License：
 *   Copyright (c) 2026 HBAI-Ltd
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"),
 *   to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import * as T from './vendor/three/three-stage.module.min.js?v=1';

const C = window.Stage3DCore;
const DEG = Math.PI / 180;
const MAX_PR = 1.5;
const LIME = 0xc4f17b;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isEn = () => { try { return localStorage.getItem('nano_lang') === 'en'; } catch (_) { return false; } };
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const r3 = (v) => Math.round(v * 1000) / 1000;
const live = { renderers: 0 };
window.__s3Live = live;

// ======================================================================
// 人偶（Toonflow mannequin.ts 移植：椭圆截面环 → 刚性关节，无蒙皮、无外部模型）
// ======================================================================
const PART_RINGS = {
    hips: [[-0.12, 0.06, 0.065], [-0.07, 0.145, 0.095], [0.015, 0.175, 0.105], [0.1, 0.125, 0.085], [0.15, 0.115, 0.075]],
    spine: [[-0.045, 0.12, 0.08], [0.04, 0.12, 0.075], [0.16, 0.16, 0.095], [0.28, 0.205, 0.105], [0.34, 0.19, 0.09], [0.385, 0.09, 0.06], [0.4, 0.048, 0.04]],
    neck: [[-0.04, 0.048, 0.043], [0.045, 0.043, 0.04], [0.08, 0.052, 0.047]],
    head: [[-0.045, 0.038, 0.043, 0.015], [-0.01, 0.072, 0.075, 0.008], [0.055, 0.092, 0.095], [0.125, 0.09, 0.09], [0.17, 0.075, 0.075], [0.198, 0.035, 0.036], [0.205, 0.002, 0.002]],
    shoulder: [[-0.32, 0.04, 0.039], [-0.27, 0.045, 0.044], [-0.12, 0.064, 0.06], [-0.025, 0.073, 0.069], [0.035, 0.052, 0.049], [0.058, 0.008, 0.008]],
    elbow: [[-0.28, 0.029, 0.028], [-0.24, 0.033, 0.032], [-0.14, 0.044, 0.042], [-0.065, 0.052, 0.048], [0, 0.04, 0.039], [0.022, 0.025, 0.026]],
    wrist: [[-0.14, 0.021, 0.016], [-0.12, 0.039, 0.022], [-0.04, 0.043, 0.026], [0.015, 0.029, 0.025]],
    hip: [[-0.43, 0.047, 0.046], [-0.37, 0.057, 0.054], [-0.22, 0.087, 0.083], [-0.07, 0.097, 0.091], [0.015, 0.079, 0.078], [0.06, 0.045, 0.05]],
    knee: [[-0.42, 0.031, 0.032], [-0.35, 0.037, 0.04], [-0.2, 0.061, 0.062], [-0.1, 0.066, 0.06], [-0.015, 0.05, 0.047], [0.025, 0.041, 0.04]],
    ankle: [[-0.1, 0.051, 0.12, 0.045], [-0.07, 0.059, 0.132, 0.053], [-0.025, 0.048, 0.107, 0.032], [0.025, 0.032, 0.04]]
};
function ringGeometry(rings) {
    const segments = 16;
    const positions = [], indices = [];
    rings.forEach(([height, width, depth, forward = 0], row) => {
        for (let column = 0; column < segments; column++) {
            const angle = column / segments * Math.PI * 2;
            positions.push(Math.cos(angle) * width, height, Math.sin(angle) * depth + forward);
            if (!row) continue;
            const bottom = (row - 1) * segments + column;
            const next = (row - 1) * segments + (column + 1) % segments;
            indices.push(bottom, bottom + segments, next, next, bottom + segments, next + segments);
        }
    });
    for (const row of [0, rings.length - 1]) {
        const center = positions.length / 3;
        positions.push(0, rings[row][0], rings[row][3] || 0);
        for (let column = 0; column < segments; column++) {
            const current = row * segments + column;
            const next = row * segments + (column + 1) % segments;
            indices.push(center, row ? next : current, row ? current : next);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}

// ======================================================================
// 道具：单位几何体 + 部件表（位置/尺寸为 [宽,高,深] 的比例；m=0 主色，1 辅色，2 玻璃）
// ======================================================================
const B = (p, s, m, g) => ({ g: g || 'box', p, s, m: m || 0 });
const PROP_PIECES = {
    box: () => [B([0, .5, 0], [1, 1, 1])],
    cylinder: () => [B([0, .5, 0], [1, 1, 1], 0, 'cyl')],
    sphere: () => [B([0, .5, 0], [1, 1, 1], 0, 'sph')],
    cone: () => [B([0, .5, 0], [1, 1, 1], 0, 'cone')],
    plane: () => [B([0, .5, 0], [1, 1, 1])],
    wall: () => [B([0, .5, 0], [1, 1, 1])],
    window_wall: () => [B([-.375, .5, 0], [.25, 1, 1]), B([.375, .5, 0], [.25, 1, 1]), B([0, .175, 0], [.5, .35, 1]), B([0, .9, 0], [.5, .2, 1]),
        B([0, .575, 0], [.5, .45, .25], 2), B([0, .575, 0], [.018, .45, .6], 1), B([0, .575, 0], [.5, .015, .6], 1)],
    door: () => [B([0, .49, 0], [.9, .97, .55]), B([-.475, .5, 0], [.05, 1, 1], 1), B([.475, .5, 0], [.05, 1, 1], 1), B([0, .985, 0], [1, .03, 1], 1), B([.32, .48, .45], [.07, .03, .5], 1, 'sph')],
    table: () => [B([0, .96, 0], [1, .08, 1]), B([-.44, .46, -.4], [.05, .92, .07], 1), B([.44, .46, -.4], [.05, .92, .07], 1), B([-.44, .46, .4], [.05, .92, .07], 1), B([.44, .46, .4], [.05, .92, .07], 1)],
    chair: () => [B([0, .51, 0], [1, .06, 1]), B([0, .76, -.45], [1, .46, .1]), B([-.42, .25, -.42], [.08, .5, .08], 1), B([.42, .25, -.42], [.08, .5, .08], 1), B([-.42, .25, .42], [.08, .5, .08], 1), B([.42, .25, .42], [.08, .5, .08], 1)],
    sofa: () => [B([0, .26, .05], [1, .52, .9]), B([0, .62, -.4], [1, .76, .2]), B([-.46, .42, .05], [.08, .84, .9]), B([.46, .42, .05], [.08, .84, .9]), B([0, .58, .1], [.84, .12, .72], 1)],
    bed: () => [B([0, .2, 0], [1, .4, 1], 1), B([0, .58, .02], [.96, .32, .96]), B([0, .9, -.485], [1, 1.8, .03], 1), B([0, .8, -.36], [.62, .14, .12])],
    stairs: () => Array.from({ length: 6 }, (_, i) => B([0, (i + 1) / 12, .5 - (i + .5) / 6], [1, (i + 1) / 6, 1 / 6])),
    pillar: () => [B([0, .03, 0], [1.25, .06, 1.25], 1), B([0, .5, 0], [.8, .94, .8], 0, 'cyl'), B([0, .97, 0], [1.25, .06, 1.25], 1)],
    tree: () => [B([0, .2, 0], [.14, .4, .14], 1, 'cyl'), B([0, .6, 0], [1, .55, 1], 0, 'cone'), B([0, .82, 0], [.72, .36, .72], 0, 'cone')],
    car: () => [B([0, .33, 0], [1, .34, 1]), B([0, .66, -.05], [.86, .34, .5]), B([0, .66, -.05], [.88, .26, .46], 2),
        B([-.46, .2, -.31], [.14, .44, .145], 1, 'cylx'), B([.46, .2, -.31], [.14, .44, .145], 1, 'cylx'), B([-.46, .2, .31], [.14, .44, .145], 1, 'cylx'), B([.46, .2, .31], [.14, .44, .145], 1, 'cylx')],
    lamp: () => [B([0, .015, 0], [.8, .03, .8], 1, 'cyl'), B([0, .45, 0], [.08, .9, .08], 1, 'cyl'), B([0, .88, 0], [1, .2, 1], 0, 'cone')],
    shelf: () => [B([-.48, .5, 0], [.04, 1, 1]), B([.48, .5, 0], [.04, 1, 1]), B([0, .5, -.47], [1, 1, .06]), ...[0, .25, .5, .75, .985].map(y => B([0, y + .012, 0], [1, .025, 1])),
        B([-.25, .37, .05], [.3, .2, .7], 1), B([.2, .62, .05], [.4, .2, .7], 1), B([-.1, .87, .05], [.5, .2, .7], 1)],
    counter: () => [B([0, .47, .05], [1, .94, .9]), B([0, .97, 0], [1.04, .06, 1.1], 1)]
};
const TREE_TRUNK = '#6b4a33';

function texLoader() { const l = new T.TextureLoader(); l.setCrossOrigin('anonymous'); return l; }

function labelCanvas(text, color, opts) {
    opts = opts || {};
    const fs = 44, pad = 26, dot = opts.dot === false ? 0 : 30;
    const c = document.createElement('canvas');
    const g0 = c.getContext('2d');
    const font = `600 ${fs}px "Inter","PingFang SC","Microsoft YaHei",sans-serif`;
    g0.font = font;
    const tw = Math.ceil(g0.measureText(text).width);
    c.width = Math.min(1024, tw + pad * 2 + dot); c.height = 76;
    const g = c.getContext('2d');
    g.font = font;
    const r = 38;
    g.fillStyle = opts.bg || 'rgba(12,13,15,0.82)';
    g.beginPath(); g.moveTo(r, 0); g.lineTo(c.width - r, 0); g.arc(c.width - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, c.height); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); g.fill();
    if (dot) { g.fillStyle = color; g.beginPath(); g.arc(pad + 10, c.height / 2, 11, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = opts.fg || '#f5f6f8';
    g.textBaseline = 'middle';
    g.fillText(text, pad + dot, c.height / 2 + 2);
    return c;
}

// ======================================================================
// StageView：场景构建与渲染（编辑器与无界面渲染共用）
// ======================================================================
class StageView {
    constructor(canvas, host, opts) {
        opts = opts || {};
        this.host = host;
        this.canvas = canvas;
        this.interactive = !!opts.interactive;
        const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
        live.renderers++;
        r.outputColorSpace = T.SRGBColorSpace;
        r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.0;
        r.shadowMap.enabled = true;
        r.shadowMap.type = T.PCFShadowMap;
        r.shadowMap.autoUpdate = false;
        r.shadowMap.needsUpdate = true;
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PR));
        this.scene = new T.Scene();
        this.scene.background = new T.Color(0x0b0c0f);
        this.pmrem = new T.PMREMGenerator(r);
        this.geo = {
            box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(.5, .5, 1, 24), cylx: new T.CylinderGeometry(.5, .5, 1, 24).rotateZ(Math.PI / 2),
            sph: new T.SphereGeometry(.5, 24, 16), cone: new T.ConeGeometry(.5, 1, 24), plane: new T.PlaneGeometry(1, 1)
        };
        this.parts = {};
        Object.keys(PART_RINGS).forEach(k => { this.parts[k] = ringGeometry(PART_RINGS[k]); });
        this.faceMat = new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: .4, metalness: .1 });
        this.glassMat = new T.MeshStandardMaterial({ color: 0xa9c8e6, roughness: .08, metalness: .1, transparent: true, opacity: .38 });
        this.root = new T.Group(); this.scene.add(this.root);
        this.helpers = new T.Group(); this.scene.add(this.helpers);
        this._buildEnv();
        this.dirCam = new T.PerspectiveCamera(42, 16 / 9, 0.05, 1200);
        this.dirCam.position.set(7.5, 5.2, 10.5);
        this.shotCam = new T.PerspectiveCamera(35, 16 / 9, 0.05, 1200);
        this.viewCam = new T.PerspectiveCamera(35, 16 / 9, 0.05, 1200);
        this.objs = new Map();
        this.cams = new Map();
        this.texCache = new Map();
        this.pending = new Set();
        this.follow = null;
        this.version = 0;
    }
    _buildEnv() {
        const sky = this.skyGeo = new T.SphereGeometry(400, 64, 32);
        sky.scale(-1, 1, 1);
        this.gradMat = new T.ShaderMaterial({
            uniforms: { top: { value: new T.Color('#3a3d44') }, bottom: { value: new T.Color('#15161a') }, exposure: { value: 1 } },
            vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float exposure; varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = mix(bottom, top, smoothstep(-0.02, 0.55, h)); c = mix(bottom * 0.55, c, smoothstep(-0.35, 0.0, h)); gl_FragColor = vec4(c * exposure, 1.0); \n#include <colorspace_fragment>\n }',
            depthWrite: false, toneMapped: false
        });
        this.panoMat = new T.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, toneMapped: false });
        this.sky = new T.Mesh(sky, this.gradMat);
        this.sky.renderOrder = -10;
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);
        this.groundGeo = new T.CircleGeometry(60, 72).rotateX(-Math.PI / 2);
        this.groundMat = new T.MeshStandardMaterial({ color: 0x2b2d33, roughness: .95, metalness: 0 });
        this.shadowMat = new T.ShadowMaterial({ opacity: .38 });
        this.ground = new T.Mesh(this.groundGeo, this.groundMat);
        this.ground.receiveShadow = true;
        this.ground.userData.ground = true;
        this.scene.add(this.ground);
        this.grid = new T.GridHelper(40, 40, 0x4a505a, 0x2a2e35);
        this.grid.material.transparent = true; this.grid.material.opacity = .55; this.grid.material.depthWrite = false;
        this.grid.position.y = 0.002;
        this.grid.userData.helper = true;
        this.scene.add(this.grid);
        this.hemi = new T.HemisphereLight(0xdfe8ff, 0x3a332c, 0.85);
        this.scene.add(this.hemi);
        const d = this.sun = new T.DirectionalLight(0xffffff, 2.1);
        d.position.set(6, 11, 6);
        d.castShadow = true;
        d.shadow.mapSize.set(2048, 2048);
        const sc = d.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 0.5; sc.far = 40;
        d.shadow.bias = -0.0004; d.shadow.normalBias = 0.025;
        this.scene.add(d); this.scene.add(d.target);
        const room = new T.RoomEnvironment();
        this.roomEnv = this.pmrem.fromScene(room, 0.04);
        if (room.dispose) room.dispose();
        this.scene.environment = this.roomEnv.texture;
        this.scene.environmentIntensity = 0.45;
    }
    markShadows() { this.renderer.shadowMap.needsUpdate = true; this.version++; }

    // ---------- 纹理（引用计数缓存） ----------
    loadTex(url) {
        let e = this.texCache.get(url);
        if (e) return e.p;
        e = { tex: null, p: null };
        e.p = texLoader().loadAsync(url).then(t => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; e.tex = t; if (this._disposed) t.dispose(); return t; });
        this.texCache.set(url, e);
        const p = e.p.catch(() => null);
        this.pending.add(p);
        p.finally(() => this.pending.delete(p));
        return e.p;
    }
    async ready() { for (let i = 0; i < 4 && this.pending.size; i++) await Promise.all(Array.from(this.pending)); await new Promise(r => setTimeout(r, 0)); }

    // ---------- 环境 ----------
    setEnv(env) {
        const key = JSON.stringify([env.panoNodeId, env.panoUrl, env.preset, env.grid]);
        const url = this.host.panoUrlFor(env);
        this.grid.visible = !!env.grid && this.interactive;
        if (key !== this._envKey || url !== this._envUrl) {
            this._envKey = key; this._envUrl = url;
            const pre = C.ENV_PRESETS[env.preset] || C.ENV_PRESETS.studio;
            this._applyPreset(pre);
            if (url) {
                const myKey = key + url;
                this._panoKey = myKey;
                this.loadTex(url).then(t => {
                    if (this._disposed || this._panoKey !== myKey) return;
                    t.mapping = T.UVMapping; t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.needsUpdate = true;
                    this.panoMat.map = t; this.panoMat.needsUpdate = true;
                    this.sky.material = this.panoMat;
                    this.ground.material = this.shadowMat;
                    if (this.panoEnv) this.panoEnv.dispose();
                    try { this.panoEnv = this.pmrem.fromEquirectangular(t); this.scene.environment = this.panoEnv.texture; this.scene.environmentIntensity = 0.75; } catch (_) { /* 忽略 */ }
                    this.hemi.intensity = 0.55; this.sun.intensity = 1.7;
                    this.panoOk = true;
                    this._applyPanoParams();
                    this.markShadows();
                    if (this.onChange) this.onChange();
                }).catch(() => { if (this.onPanoError) this.onPanoError(); });
            } else {
                this._panoKey = '';
                this.panoOk = false;
            }
        }
        this._env = env;
        this._applyPanoParams();
    }
    _applyPreset(pre) {
        this.gradMat.uniforms.top.value.set(pre.top);
        this.gradMat.uniforms.bottom.value.set(pre.bottom);
        this.sky.material = this.gradMat;
        this.groundMat.color.set(pre.ground);
        if (pre.grid) {
            if (!this.gridTex) {
                const c = document.createElement('canvas'); c.width = c.height = 256;
                const g = c.getContext('2d'); g.fillStyle = '#16181c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#2f3540'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256); g.strokeStyle = '#22262d'; g.lineWidth = 1;
                for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
                this.gridTex = new T.CanvasTexture(c); this.gridTex.wrapS = this.gridTex.wrapT = T.RepeatWrapping; this.gridTex.repeat.set(30, 30); this.gridTex.colorSpace = T.SRGBColorSpace; this.gridTex.anisotropy = 8;
            }
            this.groundMat.map = this.gridTex; this.groundMat.color.set('#ffffff');
        } else this.groundMat.map = null;
        this.groundMat.needsUpdate = true;
        this.ground.material = this.groundMat;
        if (this.panoEnv) { this.panoEnv.dispose(); this.panoEnv = null; }
        this.scene.environment = this.roomEnv.texture;
        this.scene.environmentIntensity = 0.45;
        this.hemi.intensity = 0.85; this.sun.intensity = 2.1;
        this.markShadows();
    }
    _applyPanoParams() {
        const env = this._env;
        if (!env) return;
        this.sky.rotation.y = -Math.PI / 2 + (env.yaw || 0) * DEG;
        const ex = env.exposure || 1;
        if (this.panoMat.map) {
            this.panoMat.map.offset.y = -(env.horizon || 0) / 180;
            this.panoMat.color.setScalar(ex);
        }
        this.gradMat.uniforms.exposure.value = ex;
        this.renderer.toneMappingExposure = 0.85 + 0.15 * ex;
    }

    // ---------- 对象 ----------
    setStage(stage) {
        this.stage = stage;
        this.setEnv(stage.env);
        const ids = new Set();
        stage.objects.forEach(o => { ids.add(o.id); this.syncObject(o); });
        Array.from(this.objs.keys()).forEach(id => { if (!ids.has(id)) this.removeObject(id); });
        const cids = new Set();
        stage.cameras.forEach(c => { cids.add(c.id); this.syncCamera(c); });
        Array.from(this.cams.keys()).forEach(id => { if (!cids.has(id)) this.removeCamera(id); });
        this.version++;
    }
    removeObject(id) {
        const e = this.objs.get(id);
        if (!e) return;
        this.root.remove(e.group);
        this._disposeEntry(e);
        this.objs.delete(id);
        this.markShadows();
    }
    _disposeEntry(e) {
        e.group.traverse(o => {
            if (o.material && o.material !== this.faceMat && o.material !== this.glassMat && e.own.indexOf(o.material) === -1) e.own.push(o.material);
            if (o.geometry && e.ownGeo && e.ownGeo.indexOf(o.geometry) === -1 && !this._isShared(o.geometry)) e.ownGeo.push(o.geometry);
        });
        e.own.forEach(m => { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose(); });
        (e.ownGeo || []).forEach(g => g.dispose());
    }
    _isShared(g) { return Object.values(this.geo).indexOf(g) !== -1 || Object.values(this.parts).indexOf(g) !== -1; }
    syncObject(o) {
        let e = this.objs.get(o.id);
        const skey = o.type === 'prop' ? [o.prop.kind, o.prop.size.join(','), o.color].join('|') : [o.actor.mode, o.actor.characterId].join('|');
        if (e && e.skey !== skey) { this.removeObject(o.id); e = null; }
        if (!e) {
            e = o.type === 'prop' ? this._buildProp(o) : this._buildActor(o);
            e.skey = skey;
            e.group.userData.s3id = o.id;
            this.root.add(e.group);
            this.objs.set(o.id, e);
        }
        e.data = o;
        const g = e.group;
        g.visible = !o.hidden;
        g.position.set(o.pos[0], o.pos[1], o.pos[2]);
        g.rotation.set(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG, 'YXZ');
        if (o.type === 'actor') this._syncActor(e, o);
        if (this.follow && this.follow.id === o.id) g.position.add(this.follow.v);
        this.markShadows();
        return e;
    }
    _buildProp(o) {
        const kind = o.prop.kind, size = o.prop.size;
        const main = new T.MeshStandardMaterial({ color: o.color, roughness: .78, metalness: .04 });
        const second = new T.MeshStandardMaterial({ color: kind === 'tree' ? TREE_TRUNK : new T.Color(o.color).multiplyScalar(0.62), roughness: .7, metalness: .08 });
        const mats = [main, second, this.glassMat];
        const group = new T.Group();
        (PROP_PIECES[kind] || PROP_PIECES.box)().forEach(pc => {
            const m = new T.Mesh(this.geo[pc.g], mats[pc.m]);
            m.position.set(pc.p[0] * size[0], pc.p[1] * size[1], pc.p[2] * size[2]);
            m.scale.set(Math.max(1e-3, pc.s[0] * size[0]), Math.max(1e-3, pc.s[1] * size[1]), Math.max(1e-3, pc.s[2] * size[2]));
            m.castShadow = pc.m !== 2; m.receiveShadow = true;
            group.add(m);
        });
        return { type: 'prop', group, own: [main, second], ownGeo: [] };
    }
    _buildActor(o) {
        const root = new T.Group();
        const body = new T.Group();
        root.add(body);
        const mat = new T.MeshStandardMaterial({ color: o.color, roughness: .58, metalness: .06 });
        const joints = {};
        const meshes = [];
        const part = (parent, key) => { const m = new T.Mesh(this.parts[key], mat); m.castShadow = true; m.receiveShadow = true; m.userData.joint = parent.name; parent.add(m); meshes.push(m); return m; };
        const joint = (parent, name, p) => { const g = new T.Group(); g.name = name; g.position.set(p[0], p[1], p[2]); parent.add(g); joints[name] = g; return g; };
        const hips = joint(body, 'hips', [0, 0.95, 0]); part(hips, 'hips');
        const spine = joint(hips, 'spine', [0, 0.15, 0]); part(spine, 'spine');
        const neck = joint(spine, 'neck', [0, 0.425, 0]); part(neck, 'neck');
        const head = joint(neck, 'head', [0, 0.07, 0]); part(head, 'head');
        const visor = new T.Mesh(this.geo.box, this.faceMat);
        visor.position.set(0, 0.085, 0.082); visor.scale.set(0.105, 0.03, 0.03); visor.userData.joint = 'head';
        head.add(visor);
        for (const side of ['left', 'right']) {
            const dir = side === 'left' ? 1 : -1;
            const sh = joint(spine, side + 'Shoulder', [dir * 0.235, 0.3, 0]); part(sh, 'shoulder');
            const el = joint(sh, side + 'Elbow', [0, -0.3, 0]); part(el, 'elbow');
            const wr = joint(el, side + 'Wrist', [0, -0.26, 0]); part(wr, 'wrist');
            const hp = joint(hips, side + 'Hip', [dir * 0.105, -0.04, 0]); part(hp, 'hip');
            const kn = joint(hp, side + 'Knee', [0, -0.41, 0]); part(kn, 'knee');
            const an = joint(kn, side + 'Ankle', [0, -0.4, 0]); part(an, 'ankle');
        }
        const e = { type: 'actor', group: root, body, mat, joints, meshes, own: [mat], ownGeo: [] };
        if (o.actor.mode === 'billboard' && o.actor.characterId) this._buildBillboard(e, o);
        return e;
    }
    _buildBillboard(e, o) {
        const info = this.host.charViews(o.actor.characterId);
        if (!info || (!info.views && !info.single)) return;
        const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, alphaTest: 0.02, side: T.DoubleSide, toneMapped: false });
        const mesh = new T.Mesh(this.geo.plane, mat);
        mesh.userData.billboard = true;
        mesh.castShadow = false;
        const holder = new T.Group();
        holder.add(mesh);
        e.group.add(holder);
        e.own.push(mat);
        e.bb = { mesh, holder, mat, urls: info.views || [info.single], idx: -1, aspect: 0.66, tex: [] };
        e.bb.urls.forEach((u, i) => this.loadTex(u).then(t => { e.bb.tex[i] = t; if (i === 0 || e.bb.idx === i) { e.bb.idx = -1; } if (t.image && t.image.width) e.bb.aspect = t.image.width / t.image.height; if (this.onChange) this.onChange(); }).catch(() => {}));
        mesh.onBeforeRender = (r, s, cam) => this._orientBillboard(e, cam);
    }
    _orientBillboard(e, cam) {
        const bb = e.bb;
        const gp = new T.Vector3(); e.group.getWorldPosition(gp);
        const dx = cam.position.x - gp.x, dz = cam.position.z - gp.z;
        const wa = Math.atan2(dx, dz);
        const ry = e.group.rotation.y;
        bb.holder.rotation.y = wa - ry;
        bb.holder.updateMatrixWorld(true);
        bb.mesh.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, bb.mesh.matrixWorld);
        bb.mesh.normalMatrix.getNormalMatrix(bb.mesh.modelViewMatrix);
        let idx = 0;
        if (bb.urls.length === 8) { const rel = ((-(wa - ry) / DEG) % 360 + 360) % 360; idx = Math.round(rel / 45) % 8; }
        if (idx !== bb.idx && bb.tex[idx]) { bb.idx = idx; bb.mat.map = bb.tex[idx]; bb.mat.needsUpdate = true; }
    }
    _syncActor(e, o) {
        const a = o.actor;
        const s = a.height / 1.8;
        e.body.scale.setScalar(s);
        e.mat.color.set(o.color);
        C.JOINTS.forEach(j => { const v = a.pose[j] || [0, 0, 0]; e.joints[j].rotation.set(v[0] * DEG, v[1] * DEG, v[2] * DEG); });
        e.joints.hips.position.y = 0.95 + (a.lift || 0);
        const bbOn = !!(e.bb && e.bb.urls.length);
        e.body.visible = !bbOn;
        if (bbOn) { const h = a.height; e.bb.mesh.scale.set(h * (e.bb.aspect || 0.66), h, 1); e.bb.mesh.position.set(0, h / 2, 0); }
        const label = o.name + '';
        if (this.interactive && (e.label !== label || e.labelColor !== o.color)) {
            if (e.sprite) { e.group.remove(e.sprite); e.sprite.material.map.dispose(); e.sprite.material.dispose(); e.own = e.own.filter(m => m !== e.sprite.material); }
            const cv = labelCanvas(label, o.color);
            const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
            const sm = new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false });
            const sp = new T.Sprite(sm);
            sp.center.set(0.5, 0);
            sp.scale.set(0.15 * cv.width / cv.height, 0.15, 1);
            sp.renderOrder = 20;
            sp.userData.helper = true;
            e.group.add(sp);
            e.sprite = sp; e.label = label; e.labelColor = o.color;
        }
        if (e.sprite) e.sprite.position.set(0, a.height + 0.18 + Math.min(0, a.lift || 0) * s, 0);
    }
    // ---------- 机位辅助显示 ----------
    syncCamera(c) {
        let h = this.cams.get(c.id);
        if (!h) {
            const g = new T.Group();
            g.userData.s3cam = c.id; g.userData.helper = true;
            const mat = new T.MeshBasicMaterial({ color: 0x9aa3ad, toneMapped: false });
            const lmat = new T.LineBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: .8, toneMapped: false });
            const bodyM = new T.Mesh(this.geo.box, mat); bodyM.scale.set(0.2, 0.14, 0.26); bodyM.position.z = 0.13;
            const lens = new T.Mesh(this.geo.cylx, mat); lens.rotation.y = Math.PI / 2; lens.scale.set(0.09, 0.1, 0.1); lens.position.z = -0.03;
            const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(16 * 3), 3));
            const lines = new T.LineSegments(lg, lmat);
            g.add(bodyM, lens, lines);
            this.helpers.add(g);
            h = { group: g, mat, lmat, lines, lg };
            this.cams.set(c.id, h);
        }
        h.data = c;
        const key = [c.focal, c.aspect].join('|');
        if (h.key !== key) {
            h.key = key;
            const L = 0.75, vf = C.focalToVFov(c.focal, c.aspect) * DEG, A = C.aspectNum(c.aspect);
            const hh = Math.tan(vf / 2) * L, hw = hh * A;
            const p = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
            const arr = [];
            p.forEach(([x, y]) => arr.push(0, 0, 0, x, y, -L));
            for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; arr.push(a[0], a[1], -L, b[0], b[1], -L); }
            h.lg.attributes.position.array.set(arr);
            h.lg.attributes.position.needsUpdate = true;
            h.lg.computeBoundingSphere();
        }
        if (this.interactive && h.label !== c.name) {
            if (h.sprite) { h.group.remove(h.sprite); h.sprite.material.map.dispose(); h.sprite.material.dispose(); }
            const cv = labelCanvas(c.name, '#c4f17b', { dot: false, fg: '#e3e6eb' });
            const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
            const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
            sp.center.set(0.5, 0); sp.scale.set(0.12 * cv.width / cv.height, 0.12, 1); sp.position.set(0, 0.16, 0.1); sp.renderOrder = 21;
            h.group.add(sp); h.sprite = sp; h.label = c.name;
        }
        const q = C.lookAtQuat(c.pos, c.target);
        h.group.position.set(c.pos[0], c.pos[1], c.pos[2]);
        h.group.quaternion.set(q[0], q[1], q[2], q[3]);
        return h;
    }
    removeCamera(id) {
        const h = this.cams.get(id);
        if (!h) return;
        this.helpers.remove(h.group);
        h.mat.dispose(); h.lmat.dispose(); h.lg.dispose();
        if (h.sprite) { h.sprite.material.map.dispose(); h.sprite.material.dispose(); }
        this.cams.delete(id);
    }
    highlightCamera(id, viewingId) {
        this.cams.forEach((h, cid) => {
            const on = cid === id;
            h.mat.color.setHex(on ? LIME : 0x9aa3ad); h.lmat.color.setHex(on ? LIME : 0x9aa3ad);
            h.group.visible = cid !== viewingId;
        });
    }
    // ---------- 相机姿态 ----------
    poseCamera(cam, c, time) {
        let pos = c.pos, quat = C.lookAtQuat(c.pos, c.target), focal = c.focal, follow = null;
        if (time != null && c.move) {
            const s = C.sampleMove(c, time);
            pos = s.pos; quat = s.quat; focal = s.focal;
            if (c.move.follow) follow = { id: c.move.follow.actorId, v: new T.Vector3().fromArray(c.move.follow.delta).multiplyScalar(s.p) };
        }
        cam.position.set(pos[0], pos[1], pos[2]);
        cam.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        cam.updateMatrixWorld(true);
        return { focal, follow };
    }
    setFollow(f) {
        const prev = this.follow;
        this.follow = f;
        const ids = new Set([prev && prev.id, f && f.id].filter(Boolean));
        ids.forEach(id => { const e = this.objs.get(id); if (e) this.syncObject(e.data); });
    }
    // 机位视角：整块画布用同一投影，取景框（frame，CSS 像素）内与截图完全一致，框外为溢出取景
    setupViewCam(c, frame, W, H, time) {
        const r = this.poseCamera(this.viewCam, c, time);
        const vf = C.focalToVFov(r.focal, c.aspect) * DEG;
        const near = 0.05, far = 1200;
        const k = near * Math.tan(vf / 2) / (frame.h / 2);
        const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
        const cam = this.viewCam;
        cam.near = near; cam.far = far;
        cam.projectionMatrix.makePerspective((0 - cx) * k, (W - cx) * k, (cy - 0) * k, (cy - H) * k, near, far);
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
        cam.fov = vf / DEG * H / frame.h; cam.aspect = W / H;
        return r;
    }
    showHelpers(on) {
        this.helpers.visible = on;
        this.grid.visible = on && !!(this._env && this._env.grid) && this.interactive;
        this.objs.forEach(e => { if (e.sprite) e.sprite.visible = on; });
        if (this.selBox) this.selBox.visible = on;
        if (this.tcHelper) this.tcHelper.visible = on;
    }
    // ---------- 截图（同一渲染管线：临时把绘制缓冲调到输出尺寸） ----------
    capture(c, w, h, time) {
        const r = this.renderer;
        const prevSize = r.getSize(new T.Vector2()), prevPR = r.getPixelRatio();
        const pose = this.poseCamera(this.shotCam, c, time);
        const prevFollow = this.follow;
        if (pose.follow) this.setFollow(pose.follow); else if (prevFollow) this.setFollow(null);
        this.shotCam.fov = C.focalToVFov(pose.focal, c.aspect);
        this.shotCam.aspect = w / h;
        this.shotCam.updateProjectionMatrix();
        this.showHelpers(false);
        r.setPixelRatio(1);
        r.setSize(w, h, false);
        r.setScissorTest(false);
        r.setViewport(0, 0, w, h);
        r.shadowMap.needsUpdate = true;
        r.render(this.scene, this.shotCam);
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').drawImage(r.domElement, 0, 0, w, h);
        r.setPixelRatio(prevPR);
        r.setSize(prevSize.x, prevSize.y, false);
        this.setFollow(prevFollow);
        this.showHelpers(true);
        r.shadowMap.needsUpdate = true;
        return out;
    }
    dispose() {
        if (this._disposed) return null;
        this._disposed = true;
        const r = this.renderer;
        const mats = new Set(), geos = new Set();
        this.scene.traverse(o => { if (o.geometry) geos.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
        [this.gradMat, this.panoMat, this.groundMat, this.shadowMat, this.faceMat, this.glassMat].forEach(m => mats.add(m));
        Object.values(this.geo).forEach(g => geos.add(g)); Object.values(this.parts).forEach(g => geos.add(g));
        mats.forEach(m => { ['map', 'alphaMap'].forEach(k => { if (m[k] && m[k].dispose) m[k].dispose(); }); m.dispose(); });
        geos.forEach(g => g.dispose());
        this.texCache.forEach(e => { if (e.tex) e.tex.dispose(); });
        if (this.gridTex) this.gridTex.dispose();
        if (this.panoEnv) this.panoEnv.dispose();
        if (this.roomEnv) this.roomEnv.dispose();
        this.pmrem.dispose();
        if (this.sun.shadow) this.sun.shadow.dispose();
        const mem = { geometries: r.info.memory.geometries, textures: r.info.memory.textures };
        r.renderLists.dispose();
        r.dispose();
        try { r.forceContextLoss(); } catch (_) { /* 忽略 */ }
        live.renderers--;
        return mem;
    }
}

// ======================================================================
// 无界面渲染（AI 助手 / 节点工具栏截图）
// ======================================================================
export async function renderStage(host, stage, camId, opts) {
    opts = opts || {};
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const view = new StageView(canvas, host, { interactive: false });
    try {
        view.setStage(stage);
        await view.ready();
        const cam = stage.cameras.find(c => c.id === camId) || stage.cameras[0];
        const out = view.capture(cam, opts.w || 2048, opts.h || 1152, opts.time);
        return out;
    } finally { view.dispose(); }
}

// ======================================================================
// 编辑器 UI
// ======================================================================
const svg = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
    stage: svg('<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>'),
    actor: svg('<circle cx="12" cy="5" r="2.6"/><path d="M12 7.8v6.4M7.5 10.5l4.5-1.5 4.5 1.5M9 21l3-6.8 3 6.8"/>'),
    box: svg('<path d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2z"/><path d="m4 7.2 8 4.3 8-4.3M12 11.5V21"/>'),
    camera: svg('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>'),
    video: svg('<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3v9l-5.5-3"/>'),
    move: svg('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
    rotate: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>'),
    scale: svg('<path d="M4 20 20 4M14 4h6v6M10 20H4v-6"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    frames: svg('<rect x="2.5" y="5" width="8.5" height="14" rx="1.8"/><rect x="13" y="5" width="8.5" height="14" rx="1.8"/><path d="M6.75 10.5v3M17.25 10.5v3"/>'),
    clap: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
    unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.7-1.5"/>'),
    trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>'),
    dup: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    play: svg('<path d="M7 5.5v13l11-6.5z" fill="currentColor"/>'),
    stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>'),
    caret: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    joint: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M4.5 7.5 9.4 10.5M14.6 13.5l4.9 3"/>'),
    check: svg('<path d="m5.5 12.5 4.2 4 8.8-9"/>'),
    link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    spark: svg('<path d="M12 3c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6z"/>'),
    warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>')
};
const SWATCHES = ['#e0645c', '#f09a4f', '#e8b84f', '#5cc28a', '#4fc8d6', '#4f8fe8', '#a77be8', '#e87fb8', '#c9c4ba', '#9aa3ad', '#5d6470', '#2b2d33'];
const FOCALS = [14, 24, 35, 50, 85, 135];
const label = (o) => isEn() ? o.en : o.zh;

let current = null;
export function currentEditor() { return current; }

export function openEditor(host, nodeId, opts) {
    if (current) current.destroy();
    current = new Editor(host, nodeId, opts || {});
    return current.api;
}

class Editor {
    constructor(host, nodeId, opts) {
        this.host = host;
        this.nodeId = nodeId;
        this.opts = opts;
        const node = window.CanvasBlocks.getById(nodeId);
        this.stage = C.normalize(node.stage3d).stage;
        this.savedJson = JSON.stringify(this.stage);
        this.hist = [this.savedJson];
        this.hi = 0;
        this.session = {};
        this.sel = null;
        this.tool = 'translate';
        this.view = 'director';
        this.res = '2K';
        this.link = !!opts.targetId;
        this.thumbs = new Map();
        this.stats = { frames: 0, fps: 0, t0: performance.now(), renderMs: 0 };
        this._build(node);
        this.api = this._api();
    }
    _api() {
        const ed = this;
        return {
            nodeId: this.nodeId,
            isDirty: () => this.isDirty(),
            requestClose: () => this.requestClose(),
            close: (o) => this.close(o),
            getStage: () => C.clone(this.stage),
            applyExternal: (st) => { this.stage = C.normalize(st).stage; this.commit(); this.syncAll(); this.renderUI(); },
            snapshot: (o) => this.snapshot(o || {}),
            exportFrames: (o) => this.exportFrames(o || {}),
            save: () => this.save(),
            get ed() { return ed; }
        };
    }

    // ---------------- 构建 ----------------
    _build(node) {
        const el = this.el = document.createElement('div');
        el.className = 's3-overlay';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', '3D 片场');
        el.innerHTML = `
            <canvas class="s3-canvas" tabindex="0" aria-label="3D 视口"></canvas>
            <div class="s3-camframe hidden" aria-hidden="true"><div class="s3-thirds"><i></i><i></i><i></i><i></i></div><span class="s3-frame-lb num"></span><div class="s3-prog hidden"><i></i></div></div>
            <div class="s3-top">
                <div class="s3-top-l"><span class="s3-brand">${IC.stage}</span><input class="s3-title px-no-i18n" maxlength="40" spellcheck="false" aria-label="片场名称" value="${esc(node.name || '')}"><span class="s3-chip">3D 片场</span></div>
                <div class="s3-top-c">
                    <div class="s3-dd"><button type="button" class="s3-tbtn" data-a="menu-actor" title="添加人偶（点击地面放置）">${IC.actor}<span class="lb">人偶</span>${IC.caret}</button></div>
                    <div class="s3-dd"><button type="button" class="s3-tbtn" data-a="menu-prop" title="添加道具 / 布景">${IC.box}<span class="lb">道具</span>${IC.caret}</button></div>
                    <button type="button" class="s3-tbtn" data-a="add-cam" title="以当前视角添加机位（最多 8 个）">${IC.camera}<span class="lb">加机位</span></button>
                    <span class="s3-sep"></span>
                    <div class="s3-seg" data-g="tool" role="group" aria-label="变换工具">
                        <button type="button" data-v="translate" title="移动（W）">${IC.move}</button><button type="button" data-v="rotate" title="旋转（E）">${IC.rotate}</button><button type="button" data-v="scale" title="缩放（R）">${IC.scale}</button>
                    </div>
                    <span class="s3-sep"></span>
                    <div class="s3-seg wide" data-g="view" role="group" aria-label="视角切换">
                        <button type="button" data-v="director" title="导演视角：自由环绕场景（C 切换）">导演视角</button><button type="button" data-v="camera" title="机位视角：通过当前机位取景（C 切换）">机位视角</button>
                    </div>
                </div>
                <div class="s3-top-r">
                    <button type="button" class="s3-tbtn icon" data-a="undo" title="撤销（Ctrl+Z）">${IC.undo}</button>
                    <button type="button" class="s3-tbtn icon" data-a="redo" title="重做（Ctrl+Y）">${IC.redo}</button>
                    <span class="s3-sep"></span>
                    <button type="button" class="s3-tbtn" data-a="shot" title="按当前机位渲染截图并放到画布">${IC.camera}<span class="lb">截图到画布</span></button>
                    <button type="button" class="s3-tbtn" data-a="frames" title="导出当前机位运镜的起幅与落幅两张图">${IC.frames}<span class="lb">导出首尾帧</span></button>
                    <div class="s3-dd"><button type="button" class="s3-tbtn" data-a="menu-dir" title="把截图 / 首尾帧绑定到 2D 导演台的镜头">${IC.clap}<span class="lb">发送到导演台</span></button></div>
                    <button type="button" class="s3-btn primary sm" data-a="save" title="保存到画布节点（Ctrl+S）">${IC.save}<span>保存</span></button>
                    <button type="button" class="s3-tbtn icon close" data-a="close" title="关闭（Esc）">${IC.x}</button>
                </div>
            </div>
            <aside class="s3-left" aria-label="场景大纲"></aside>
            <aside class="s3-right" aria-label="属性"></aside>
            <div class="s3-bottom"><div class="s3-strip" role="list" aria-label="机位"></div></div>
            <div class="s3-hint hidden" role="status" aria-live="polite"></div>
            <div class="s3-loading"><span class="s3-spin lg"></span></div>`;
        document.body.appendChild(el);
        document.body.classList.add('s3-open');
        this.canvas = el.querySelector('.s3-canvas');
        this.v = new StageView(this.canvas, this.host, { interactive: true });
        this.v.onChange = () => {
            this.dirtyView = true; this._staleThumbs();
            if (this.v.panoOk !== this._panoShown) { this._panoShown = this.v.panoOk; if (!this.sel || this.sel.kind === 'env') this.renderRight(); }
        };
        this.v.onPanoError = () => { this.toast('全景图加载失败，已使用预设背景', 'warn'); };
        this._initControls();
        this._bind();
        this._resize();
        this.syncAll();
        const ac = this._activeCam();
        if (ac) this._aimDirectorAt(ac);
        this.renderUI();
        this.v.ready().then(() => { el.classList.add('loaded'); this.dirtyView = true; });
        requestAnimationFrame(() => el.classList.add('in'));
        this.raf = requestAnimationFrame(() => this._loop());
        if (this.opts.shotId) this.dirShotId = this.opts.shotId;
        setTimeout(() => { if (this.canvas) this.canvas.focus({ preventScroll: true }); }, 60);
    }
    _initControls() {
        const v = this.v;
        const oc = this.oc = new T.OrbitControls(v.dirCam, this.canvas);
        oc.enableDamping = !reduceMotion(); oc.dampingFactor = 0.14; oc.screenSpacePanning = true; oc.maxDistance = 120; oc.minDistance = 0.3; oc.maxPolarAngle = Math.PI * 0.495;
        oc.target.set(0, 1, 0);
        oc.addEventListener('change', () => { this.dirtyView = true; if (this.view === 'camera' && !this.playing) this._camFromView(); });
        oc.addEventListener('end', () => { if (this.view === 'camera') this._camFromViewEnd(); });
        const tc = this.tc = new T.TransformControls(v.dirCam, this.canvas);
        tc.setSize(0.85);
        v.tcHelper = tc.getHelper();
        v.tcHelper.userData.helper = true;
        v.scene.add(v.tcHelper);
        tc.addEventListener('dragging-changed', (e) => { oc.enabled = !e.value; this._tcDragging = e.value; if (!e.value) this._tcEnd(); });
        tc.addEventListener('objectChange', () => this._tcChange());
        tc.addEventListener('change', () => { this.dirtyView = true; });
        const box = v.selBox = new T.BoxHelper(undefined, LIME);
        box.material.transparent = true; box.material.opacity = .85; box.material.depthTest = false; box.renderOrder = 30;
        box.visible = false; box.userData.helper = true;
        v.helpers.add(box);
    }
    _bind() {
        const el = this.el;
        this._onKey = (e) => this._key(e);
        window.addEventListener('keydown', this._onKey, true);
        this._onResize = () => this._resize();
        window.addEventListener('resize', this._onResize);
        ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'paste', 'copy', 'touchstart', 'pointerdown', 'keyup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
        el.addEventListener('contextmenu', e => e.preventDefault());
        el.addEventListener('click', (e) => this._click(e));
        el.addEventListener('input', (e) => this._input(e, false));
        el.addEventListener('change', (e) => this._input(e, true));
        el.addEventListener('mousedown', (e) => { if (e.detail === 2 && e.button === 0) this._dbl(e); });
        const cv = this.canvas;
        cv.addEventListener('pointerdown', (e) => { this._pd = { x: e.clientX, y: e.clientY, axis: this.tc.axis, t: performance.now() }; });
        cv.addEventListener('pointermove', (e) => this._hover(e));
        cv.addEventListener('pointerup', (e) => {
            const d = this._pd; this._pd = null;
            if (!d || e.button !== 0) return;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || d.axis) return;
            this._pick(e);
        });
        this.el.querySelector('.s3-title').addEventListener('change', (e) => {
            const nm = String(e.target.value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
            const n = window.CanvasBlocks.getById(this.nodeId);
            if (n && nm && nm !== n.name) { window.CanvasBlocks.update(this.nodeId, { name: nm }); if (window.CanvasHistory) window.CanvasHistory.snapshot(); if (window.CanvasStore) window.CanvasStore.scheduleSave(); }
        });
    }
    // ---------------- 数据 / 历史 ----------------
    _obj(id) { return this.stage.objects.find(o => o.id === id); }
    _cam(id) { return this.stage.cameras.find(c => c.id === id); }
    _activeCam() { return this._cam(this.stage.activeCameraId) || this.stage.cameras[0]; }
    isDirty() { return JSON.stringify(this.stage) !== this.savedJson; }
    commit() {
        const j = JSON.stringify(this.stage);
        if (j === this.hist[this.hi]) return;
        this.hist = this.hist.slice(0, this.hi + 1);
        this.hist.push(j);
        if (this.hist.length > 120) this.hist.shift(); else this.hi++;
        this._staleThumbs();
        this._updateTopState();
    }
    undo() { if (this.hi <= 0) return; this.hi--; this._restore(); }
    redo() { if (this.hi >= this.hist.length - 1) return; this.hi++; this._restore(); }
    _restore() {
        this.stopPlay();
        this.stage = JSON.parse(this.hist[this.hi]);
        if (this.sel && this.sel.kind === 'object' && !this._obj(this.sel.id)) this.sel = null;
        if (this.sel && this.sel.kind === 'camera' && !this._cam(this.sel.id)) this.sel = null;
        this.syncAll();
        this.renderUI();
    }
    syncAll() {
        this.v.setStage(this.stage);
        this._attach();
        this._syncCamHelpers();
        this._staleThumbs();
        this.dirtyView = true;
    }
    _syncObj(o) {
        this.v.syncObject(o);
        // 道具重建（尺寸/颜色/类型变化）后 gizmo 需重新挂到新对象上
        let t = this.tc.object;
        while (t && t.parent) t = t.parent;
        if (this.tc.object && t !== this.v.scene) this._attach();
        this._updateSelBox(); this.dirtyView = true; this._staleThumbs();
    }
    _syncCam(c) { this.v.syncCamera(c); this._syncCamHelpers(); this.dirtyView = true; this._staleThumbs(c.id); }
    _syncCamHelpers() {
        const ac = this.stage.activeCameraId;
        this.v.highlightCamera(this.sel && this.sel.kind === 'camera' ? this.sel.id : ac, this.view === 'camera' ? ac : '');
    }
    _staleThumbs(id) { this.stage.cameras.forEach(c => { if (!id || c.id === id) { const t = this.thumbs.get(c.id); if (t) t.stale = true; } }); }

    // ---------------- 渲染循环 ----------------
    _resize() {
        const w = this.el.clientWidth, h = this.el.clientHeight;
        this.W = w; this.H = h;
        this.v.renderer.setSize(w, h, false);
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.v.dirCam.aspect = w / h; this.v.dirCam.updateProjectionMatrix();
        this._layoutFrame();
        this.dirtyView = true;
    }
    _freeArea() {
        const r = (sel) => { const e = this.el.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
        const top = r('.s3-top'), left = r('.s3-left'), right = r('.s3-right'), bot = r('.s3-bottom');
        const x0 = left ? left.right + 18 : 18, x1 = right ? right.left - 18 : this.W - 18;
        const y0 = top ? top.bottom + 40 : 70, y1 = bot ? bot.top - 22 : this.H - 20;
        return { x: x0, y: y0, w: Math.max(80, x1 - x0), h: Math.max(60, y1 - y0) };
    }
    _layoutFrame() {
        const c = this._activeCam();
        if (!c) return;
        const a = this._freeArea();
        const A = C.aspectNum(c.aspect);
        let w = a.w, h = w / A;
        if (h > a.h) { h = a.h; w = h * A; }
        this.frame = { x: a.x + (a.w - w) / 2, y: a.y + (a.h - h) / 2, w, h };
        const fr = this.el.querySelector('.s3-camframe');
        Object.assign(fr.style, { left: this.frame.x + 'px', top: this.frame.y + 'px', width: w + 'px', height: h + 'px' });
        fr.querySelector('.s3-frame-lb').textContent = `${c.name} · ${Math.round(this._viewFocal || c.focal)}mm · ${c.aspect}`;
    }
    _loop() {
        if (this.destroyed) return;
        this.raf = requestAnimationFrame(() => this._loop());
        const now = performance.now();
        if (this.oc.enabled && this.oc.update()) this.dirtyView = true;
        if (this.playing) this._playTick(now);
        let thumbDone = false;
        if (!this.playing && now - (this._lastThumb || 0) > 140) thumbDone = this._renderOneThumb();
        if (this.dirtyView || thumbDone || this.bench) {
            this.dirtyView = false;
            const t0 = performance.now();
            this._renderMain();
            this.stats.renderMs = performance.now() - t0;
            this.stats.frames++;
        }
        if (now - this.stats.t0 >= 1000) { this.stats.fps = Math.round(this.stats.frames * 1000 / (now - this.stats.t0)); this.stats.frames = 0; this.stats.t0 = now; }
    }
    _renderMain() {
        const v = this.v, r = v.renderer;
        r.setScissorTest(false);
        r.setViewport(0, 0, this.W, this.H);
        const showLabels = this.view !== 'camera';
        v.objs.forEach(e => { if (e.sprite) e.sprite.visible = showLabels; });
        if (this.view === 'camera') {
            const c = this._activeCam();
            const t = this.playing ? this.playT : (this.previewKey === 'end' && c.move ? c.move.duration : (this.previewKey === 'start' && c.move ? 0 : null));
            const res = v.setupViewCam(c, this.frame, this.W, this.H, t);
            this._viewFocal = res.focal;
            if (res.follow || v.follow) v.setFollow(res.follow);
            this.tc.camera = v.viewCam;
            this._updateSelBox();
            r.render(v.scene, v.viewCam);
        } else {
            if (v.follow) v.setFollow(null);
            this.tc.camera = v.dirCam;
            this._updateSelBox();
            r.render(v.scene, v.dirCam);
        }
    }
    _renderOneThumb() {
        const cams = this.stage.cameras;
        if (!cams.length) return false;
        let pick = null;
        for (let i = 0; i < cams.length; i++) {
            const c = cams[(i + (this._thumbRR || 0)) % cams.length];
            const t = this.thumbs.get(c.id);
            if (t && t.stale && t.canvas) { pick = { c, t }; this._thumbRR = (this._thumbRR || 0) + i + 1; break; }
        }
        if (!pick) return false;
        this._lastThumb = performance.now();
        const { c, t } = pick;
        const v = this.v, r = v.renderer;
        const tw = t.canvas.width, th = t.canvas.height;
        const pr = r.getPixelRatio();
        const vw = Math.max(1, Math.round(tw / pr)), vh = Math.max(1, Math.round(th / pr));
        const pose = v.poseCamera(v.shotCam, c, null);
        v.shotCam.fov = C.focalToVFov(pose.focal, c.aspect); v.shotCam.aspect = vw / vh; v.shotCam.updateProjectionMatrix();
        v.showHelpers(false);
        if (v.follow) v.setFollow(null);
        r.setScissorTest(true);
        r.setScissor(0, 0, vw, vh); r.setViewport(0, 0, vw, vh);
        r.render(v.scene, v.shotCam);
        r.setScissorTest(false);
        const ctx = t.canvas.getContext('2d');
        ctx.drawImage(this.canvas, 0, this.canvas.height - vh * pr, vw * pr, vh * pr, 0, 0, tw, th);
        v.showHelpers(true);
        t.stale = false;
        return true;
    }
    // ---------------- 选择 / 变换 ----------------
    select(sel) {
        this.sel = sel;
        if (sel && sel.kind === 'camera') this.setActiveCam(sel.id, true);
        this._attach();
        this._syncCamHelpers();
        this.renderUI();
        this.dirtyView = true;
    }
    _selObj() { return this.sel && this.sel.kind === 'object' ? this._obj(this.sel.id) : null; }
    _attach() {
        const tc = this.tc;
        tc.detach();
        const s = this.sel;
        if (!s || this.playing) { this._updateSelBox(); return; }
        if (s.kind === 'object') {
            const o = this._obj(s.id); const e = this.v.objs.get(s.id);
            if (o && e && !o.hidden && !o.locked) {
                if (s.joint && o.type === 'actor' && e.joints[s.joint]) { tc.setMode('rotate'); tc.setSpace('local'); tc.attach(e.joints[s.joint]); }
                else { tc.setMode(this.tool); tc.setSpace(this.tool === 'translate' ? 'world' : 'local'); tc.showY = true; tc.attach(e.group); }
            }
        } else if (s.kind === 'camera' && this.view === 'director') {
            const h = this.v.cams.get(s.id);
            if (h) { tc.setMode(this.tool === 'scale' ? 'translate' : this.tool); tc.setSpace('local'); tc.attach(h.group); }
        }
        this._updateSelBox();
    }
    _updateSelBox() {
        const b = this.v.selBox;
        const o = this._selObj();
        const e = o && this.v.objs.get(o.id);
        if (e && !o.hidden) {
            b.setFromObject(o.type === 'actor' ? (e.body.visible ? e.body : (e.bb ? e.bb.holder : e.group)) : e.group);
            b.visible = true;
        } else b.visible = false;
    }
    _tcChange() {
        const s = this.sel;
        if (!s) return;
        if (s.kind === 'object') {
            const o = this._obj(s.id), e = this.v.objs.get(s.id);
            if (!o || !e) return;
            if (s.joint) {
                const j = e.joints[s.joint];
                o.actor.pose[s.joint] = [j.rotation.x / DEG, j.rotation.y / DEG, j.rotation.z / DEG].map(x => Math.round(x * 10) / 10);
                o.actor.posePreset = 'custom';
            } else {
                const g = e.group;
                o.pos = [g.position.x, Math.max(-5, g.position.y), g.position.z].map(r3);
                const eu = new T.Euler().setFromQuaternion(g.quaternion, 'YXZ');
                o.rot = [eu.x / DEG, eu.y / DEG, eu.z / DEG].map(x => Math.round(x * 10) / 10);
                if (this.tool === 'scale') {
                    if (o.type === 'actor') { const k = (g.scale.x + g.scale.y + g.scale.z) / 3; this._scaleTmp = clamp(o.actor.height * k, 0.5, 2.6); }
                    else this._scaleTmp = [g.scale.x, g.scale.y, g.scale.z];
                }
            }
            this._updateSelBox();
            this._refreshFields();
            this.v.markShadows();
            this._staleThumbs();
        } else if (s.kind === 'camera') {
            const c = this._cam(s.id), h = this.v.cams.get(s.id);
            if (!c || !h) return;
            const g = h.group;
            const dist = Math.max(0.5, Math.hypot(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]));
            const fwd = new T.Vector3(0, 0, -1).applyQuaternion(g.quaternion);
            c.pos = [g.position.x, g.position.y, g.position.z].map(r3);
            c.target = [g.position.x + fwd.x * dist, g.position.y + fwd.y * dist, g.position.z + fwd.z * dist].map(r3);
            c.shot = ''; c.angle = '';
            this._staleThumbs(c.id);
            this._refreshFields();
        }
    }
    _tcEnd() {
        const s = this.sel;
        if (!s) return;
        if (s.kind === 'object') {
            const o = this._obj(s.id), e = this.v.objs.get(s.id);
            if (o && e && this._scaleTmp != null) {
                if (o.type === 'actor') o.actor.height = r3(this._scaleTmp);
                else o.prop.size = o.prop.size.map((v, i) => r3(clamp(v * this._scaleTmp[i], 0.02, 30)));
                e.group.scale.set(1, 1, 1);
                this._scaleTmp = null;
                this._syncObj(o);
                this._attach();
            }
        } else if (s.kind === 'camera') {
            const c = this._cam(s.id);
            if (c) { this._rebaseMove(c); this._syncCam(c); }
        }
        this.commit();
        this.renderUI();
    }
    // 机位基准姿态变化后，预设运镜按新基准重算（自定义运镜保留）
    _rebaseMove(c) {
        if (c.move && c.move.preset !== 'custom') {
            const mv = C.moveFromPreset(this.stage, Object.assign({}, c, { move: null }), c.move.preset, { duration: c.move.duration, ease: c.move.ease, direction: c.move.arc < 0 ? 'left' : undefined });
            if (mv) c.move = mv;
        }
    }
    _camFromView() {
        const c = this._activeCam();
        if (!c || this._syncingView) return;
        const vc = this.v.viewCam;
        c.pos = vc.position.toArray().map(r3);
        c.target = this.oc.target.toArray().map(r3);
        if (c.pos[1] < 0.05) c.pos[1] = 0.05;
        c.shot = ''; c.angle = '';
        this.v.syncCamera(c);
        this._staleThumbs(c.id);
        this._refreshFields();
    }
    _camFromViewEnd() { const c = this._activeCam(); if (c) { this._rebaseMove(c); this.commit(); this.renderUI(); } }
    setView(mode) {
        if (mode === this.view) return;
        this.stopPlay();
        this.view = mode;
        this.previewKey = '';
        const oc = this.oc, v = this.v;
        oc.enabled = true;
        if (mode === 'camera') {
            const c = this._activeCam();
            this._dirSave = { pos: v.dirCam.position.clone(), target: oc.target.clone() };
            this._syncingView = true;
            v.poseCamera(v.viewCam, c, null);
            oc.object = v.viewCam;
            oc.target.fromArray(c.target);
            oc.enableDamping = false;
            oc.minDistance = 0.02; oc.maxPolarAngle = Math.PI; oc.minPolarAngle = 0;
            oc.update();
            this._syncingView = false;
        } else {
            oc.object = v.dirCam;
            oc.minDistance = 0.3; oc.maxPolarAngle = Math.PI * 0.495;
            if (this._dirSave) { v.dirCam.position.copy(this._dirSave.pos); oc.target.copy(this._dirSave.target); }
            oc.enableDamping = !reduceMotion();
            oc.update();
        }
        this.el.classList.toggle('camview', mode === 'camera');
        this.el.querySelector('.s3-camframe').classList.toggle('hidden', mode !== 'camera');
        this._layoutFrame();
        this._attach();
        this._syncCamHelpers();
        this.renderTop();
        this.dirtyView = true;
    }
    // 起幅 / 落幅查看（机位视角下锁定交互，避免误改基准姿态）
    _setPeek(k) {
        if (k && this.view !== 'camera') this.setView('camera');
        this.previewKey = k || '';
        this.oc.enabled = !this.previewKey;
        this.dirtyView = true;
        this.renderRight();
    }
    setActiveCam(id, keepSel) {
        const c = this._cam(id);
        if (!c) return;
        const changed = this.stage.activeCameraId !== id;
        if (changed && this.previewKey) { this.previewKey = ''; this.oc.enabled = !this.playing; }
        this.stage.activeCameraId = id;
        if (!keepSel && this.sel && this.sel.kind === 'camera') this.sel = { kind: 'camera', id };
        if (this.view === 'camera') {
            this._syncingView = true;
            this.v.poseCamera(this.v.viewCam, c, null);
            this.oc.target.fromArray(c.target);
            this.oc.update();
            this._syncingView = false;
        }
        this._layoutFrame();
        this._syncCamHelpers();
        if (changed) this.commit();
        this.dirtyView = true;
    }
    _aimDirectorAt(c) {
        const sub = C.subjectOf(this.stage, c);
        const tgt = sub ? [sub.pos[0], 1, sub.pos[2]] : [c.target[0], Math.max(0.6, c.target[1]), c.target[2]];
        this.oc.target.fromArray(tgt);
        const dir = new T.Vector3(c.pos[0] - tgt[0], 0, c.pos[2] - tgt[2]);
        if (dir.lengthSq() < 1e-4) dir.set(0.6, 0, 1);
        dir.normalize();
        const side = new T.Vector3(dir.z, 0, -dir.x);
        this.v.dirCam.position.set(tgt[0] + dir.x * 8 + side.x * 4.5, 4.8, tgt[2] + dir.z * 8 + side.z * 4.5);
        this.oc.update();
    }
    focusSel() {
        const s = this.sel;
        let center, radius = 1.5;
        if (s && s.kind === 'object') {
            const e = this.v.objs.get(s.id);
            if (!e) return;
            const bx = new T.Box3().setFromObject(e.body && e.body.visible ? e.body : e.group);
            const sp = bx.getBoundingSphere(new T.Sphere());
            center = sp.center; radius = Math.max(0.4, sp.radius);
        } else if (s && s.kind === 'camera') { const c = this._cam(s.id); center = new T.Vector3().fromArray(c.pos); radius = 0.8; }
        else { center = new T.Vector3(0, 1, 0); radius = 6; }
        if (this.view === 'camera') this.setView('director');
        const cam = this.v.dirCam;
        const dir = cam.position.clone().sub(this.oc.target).normalize();
        const d = radius / Math.sin(cam.fov * DEG / 2) * 1.15;
        this.oc.target.copy(center);
        cam.position.copy(center).addScaledVector(dir, d);
        this.oc.update();
        this.dirtyView = true;
    }
    // ---------------- 拾取 / 放置 ----------------
    _ndc(e) {
        const r = this.canvas.getBoundingClientRect();
        return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }
    _ray(e) {
        const rc = new T.Raycaster();
        rc.setFromCamera(this._ndc(e), this.view === 'camera' ? this.v.viewCam : this.v.dirCam);
        return rc;
    }
    _groundPoint(e) {
        const p = new T.Vector3();
        const hit = this._ray(e).ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p);
        if (!hit) return null;
        return [clamp(p.x, -50, 50), 0, clamp(p.z, -50, 50)];
    }
    _pick(e) {
        if (this.placing) return this._place(e);
        if (this.playing) return;
        const rc = this._ray(e);
        const targets = [];
        this.v.objs.forEach(o => { if (o.group.visible) targets.push(o.group); });
        if (this.view === 'director') this.v.cams.forEach(h => { if (h.group.visible) targets.push(h.group); });
        const hits = rc.intersectObjects(targets, true).filter(h => !(h.object.isSprite) && !(h.object.type === 'LineSegments'));
        if (!hits.length) { this.select(null); return; }
        let o = hits[0].object;
        const jointName = o.userData.joint;
        while (o && !o.userData.s3id && !o.userData.s3cam) o = o.parent;
        if (!o) return;
        if (o.userData.s3cam) return this.select({ kind: 'camera', id: o.userData.s3cam });
        const id = o.userData.s3id;
        const obj = this._obj(id);
        if (this.jointMode && obj && obj.type === 'actor' && jointName && this.sel && this.sel.id === id) return this.select({ kind: 'object', id, joint: jointName });
        this.select({ kind: 'object', id });
    }
    _hover(e) {
        if (!this.placing) return;
        const p = this._groundPoint(e);
        if (!p || !this.ghost) return;
        this.ghost.position.set(p[0], 0, p[2]);
        this.ghost.visible = true;
        this.dirtyView = true;
    }
    startPlace(spec) {
        this.cancelPlace();
        this.placing = spec;
        const g = this.ghost = new T.Group();
        const mat = new T.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.35, depthWrite: false });
        this._ghostMat = mat;
        if (spec.type === 'actor') { const m = new T.Mesh(this.v.geo.cyl, mat); m.scale.set(0.5, 1.75, 0.35); m.position.y = 0.875; g.add(m); }
        else { const sz = C.PROPS[spec.kind].size; const m = new T.Mesh(this.v.geo.box, mat); m.scale.set(sz[0], sz[1], sz[2]); m.position.y = sz[1] / 2; g.add(m); }
        const ring = new T.Mesh(new T.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), mat);
        ring.position.y = 0.01; g.add(ring);
        this._ghostRing = ring.geometry;
        g.visible = false;
        g.userData.helper = true;
        this.v.helpers.add(g);
        this.el.classList.add('placing');
        this.hint(spec.type === 'actor' ? '点击地面放置人偶 · Esc 取消' : '点击地面放置道具 · Esc 取消');
        if (this.view === 'camera') this.setView('director');
    }
    cancelPlace() {
        if (!this.placing) return;
        this.placing = null;
        if (this.ghost) { this.v.helpers.remove(this.ghost); this._ghostMat.dispose(); this._ghostRing.dispose(); this.ghost = null; }
        this.el.classList.remove('placing');
        this.hint('');
        this.dirtyView = true;
    }
    _place(e) {
        const p = this._groundPoint(e);
        const spec = this.placing;
        if (!p || !spec) return;
        this.cancelPlace();
        if (spec.type === 'actor') this.addActor(Object.assign({}, spec, { pos: p }));
        else this.addProp(Object.assign({}, spec, { pos: p }));
    }
    // ---------------- 增删改 ----------------
    _faceToCamera(pos) {
        const c = this._activeCam();
        return c ? Math.round(Math.atan2(c.pos[0] - pos[0], c.pos[2] - pos[2]) / DEG) : 0;
    }
    addActor(o) {
        o = o || {};
        const st = this.stage;
        if (st.objects.filter(x => x.type === 'actor').length >= C.LIMITS.actors) { this.toast('人偶最多 ' + C.LIMITS.actors + ' 个', 'warn'); return null; }
        if (st.objects.length >= C.LIMITS.objects) { this.toast('对象最多 ' + C.LIMITS.objects + ' 个', 'warn'); return null; }
        const pose = o.pose || 'stand';
        const pp = C.posePreset(pose);
        const ch = o.characterId ? this.host.character(o.characterId) : null;
        const n = st.objects.filter(x => x.type === 'actor').length + 1;
        const pos = o.pos || [((n - 1) % 4) * 0.9 - 1.35, 0, -Math.floor((n - 1) / 4) * 0.9];
        const a = {
            id: C.uid('a_'), type: 'actor', name: ch ? ch.name : (isEn() ? 'Actor ' : '人偶 ') + n, pos: pos.map(r3), rot: [0, o.rotY != null ? o.rotY : this._faceToCamera(pos), 0],
            color: o.color || C.nextColor(st), hidden: false, locked: false,
            actor: { pose: pp.pose, posePreset: pose, lift: pp.lift, height: o.height || 1.75, characterId: ch ? o.characterId : '', charName: ch ? ch.name : '', mode: o.mode === 'billboard' && ch ? 'billboard' : 'mannequin' }
        };
        a.name = String(a.name).slice(0, 30);
        st.objects.push(a);
        this._syncObj(a);
        this.commit();
        this.select({ kind: 'object', id: a.id });
        return a;
    }
    addProp(o) {
        o = o || {};
        const st = this.stage;
        if (st.objects.length >= C.LIMITS.objects) { this.toast('对象最多 ' + C.LIMITS.objects + ' 个', 'warn'); return null; }
        const kind = C.PROPS[o.kind] ? o.kind : 'box';
        const pos = o.pos || [0, 0, -2];
        const p = { id: C.uid('p_'), type: 'prop', name: label(C.PROPS[kind]), pos: pos.map(r3), rot: [0, o.rotY || 0, 0], color: o.color || C.PROPS[kind].color, hidden: false, locked: false, prop: { kind, size: (o.size || C.PROPS[kind].size).slice() } };
        st.objects.push(p);
        this._syncObj(p);
        this.commit();
        this.select({ kind: 'object', id: p.id });
        return p;
    }
    addCamera() {
        const st = this.stage;
        if (st.cameras.length >= C.LIMITS.cameras) { this.toast('机位最多 ' + C.LIMITS.cameras + ' 个', 'warn'); return null; }
        const src = this.view === 'camera' ? this.v.viewCam : this.v.dirCam;
        let n = st.cameras.length + 1;
        const base = isEn() ? 'Cam ' : '机位 ';
        while (st.cameras.some(c => c.name === base + n)) n++;
        let id; do { id = 'cam_' + Math.random().toString(36).slice(2, 7); } while (this._cam(id));
        const fwd = new T.Vector3(0, 0, -1).applyQuaternion(src.quaternion);
        const pos = src.position.toArray().map(r3);
        const dist = this.view === 'camera' ? src.position.distanceTo(this.oc.target) : Math.max(2, this.v.dirCam.position.distanceTo(this.oc.target));
        const c = { id, name: base + n, pos, target: [pos[0] + fwd.x * dist, pos[1] + fwd.y * dist, pos[2] + fwd.z * dist].map(r3), focal: 35, aspect: this._activeCam() ? this._activeCam().aspect : '16:9', shot: '', angle: '', subjectId: '', move: null };
        if (c.pos[1] < 0.1) c.pos[1] = 0.1;
        st.cameras.push(c);
        st.activeCameraId = c.id;
        this._syncCam(c);
        this.commit();
        this.select({ kind: 'camera', id: c.id });
        return c;
    }
    deleteSel() {
        const s = this.sel;
        if (!s) return;
        const st = this.stage;
        if (s.kind === 'object') {
            st.objects = st.objects.filter(o => o.id !== s.id);
            st.cameras.forEach(c => { if (c.subjectId === s.id) c.subjectId = ''; if (c.move && c.move.follow && c.move.follow.actorId === s.id) delete c.move.follow; });
        } else if (s.kind === 'camera') {
            if (st.cameras.length <= 1) { this.toast('至少保留一个机位', 'warn'); return; }
            st.cameras = st.cameras.filter(c => c.id !== s.id);
            if (st.activeCameraId === s.id) st.activeCameraId = st.cameras[0].id;
            this.thumbs.delete(s.id);
        } else return;
        this.sel = null;
        this.syncAll();
        this.commit();
        this.renderUI();
    }
    duplicateSel() {
        const s = this.sel;
        if (!s) return;
        const st = this.stage;
        if (s.kind === 'object') {
            const o = this._obj(s.id);
            if (!o) return;
            if (st.objects.length >= C.LIMITS.objects || (o.type === 'actor' && st.objects.filter(x => x.type === 'actor').length >= C.LIMITS.actors)) { this.toast('数量已达上限', 'warn'); return; }
            const n = C.clone(o);
            n.id = C.uid(o.type === 'actor' ? 'a_' : 'p_');
            n.pos = [r3(o.pos[0] + 0.7), o.pos[1], r3(o.pos[2] + 0.3)];
            n.name = String(o.name).slice(0, 26) + (isEn() ? ' 2' : ' 副本');
            if (o.type === 'actor' && !o.actor.characterId) n.color = C.nextColor(st);
            st.objects.push(n);
            this._syncObj(n);
            this.commit();
            this.select({ kind: 'object', id: n.id });
        } else if (s.kind === 'camera') {
            if (st.cameras.length >= C.LIMITS.cameras) { this.toast('机位最多 ' + C.LIMITS.cameras + ' 个', 'warn'); return; }
            const c = C.clone(this._cam(s.id));
            let id; do { id = 'cam_' + Math.random().toString(36).slice(2, 7); } while (this._cam(id));
            c.id = id; c.name = String(c.name).slice(0, 26) + (isEn() ? ' 2' : ' 副本');
            st.cameras.push(c);
            this._syncCam(c);
            this.commit();
            this.select({ kind: 'camera', id: c.id });
        }
    }
    setPose(o, key) {
        const pp = C.posePreset(key);
        if (!pp) return;
        o.actor.pose = pp.pose; o.actor.lift = pp.lift; o.actor.posePreset = key;
        this._syncObj(o);
        this.commit();
        this.renderRight();
    }
    // 景别 / 角度预设（基于主体人偶自动计算距离）
    applyFraming(c, shot, angle) {
        const subj = C.subjectOf(this.stage, c);
        shot = shot || c.shot || (subj ? 'ms' : 'ls');
        angle = angle || c.angle || 'eye';
        let other = null;
        if (angle === 'ots') {
            other = subj && this.stage.objects.filter(o => o.type === 'actor' && o.id !== subj.id && !o.hidden).sort((p, q) => Math.hypot(p.pos[0] - subj.pos[0], p.pos[2] - subj.pos[2]) - Math.hypot(q.pos[0] - subj.pos[0], q.pos[2] - subj.pos[2]))[0];
            if (!other) { this.toast('过肩镜头需要场景里至少两个人偶', 'warn'); return; }
        }
        const dv = [c.pos[0] - c.target[0], c.pos[2] - c.target[2]];
        const az = Math.hypot(dv[0], dv[1]) > 0.05 ? Math.atan2(dv[0], dv[1]) : undefined;
        const fresh = !c.shot;
        const fr = C.framing(subj, shot, angle, c.focal, c.aspect, { azimuth: fresh && subj ? undefined : az, other });
        c.pos = fr.pos; c.target = fr.target; c.shot = shot; c.angle = angle;
        this._rebaseMove(c);
        this._syncCam(c);
        if (this.view === 'camera') this.setActiveCam(c.id, true);
        this.commit();
        this.renderUI();
    }
    setMovePreset(c, preset) {
        if (preset === 'none') c.move = null;
        else if (preset === 'custom') {
            const k = { pos: c.pos.slice(), target: c.target.slice(), focal: c.focal };
            c.move = { preset: 'custom', duration: c.move ? c.move.duration : 4, ease: c.move ? c.move.ease : 'smooth', start: C.clone(k), end: C.clone(k) };
        } else c.move = C.moveFromPreset(this.stage, Object.assign({}, c, { move: null }), preset, { duration: c.move ? c.move.duration : 4, ease: c.move ? c.move.ease : 'smooth' });
        this.previewKey = '';
        this.commit();
        this.renderRight();
        this._staleThumbs(c.id);
        this.dirtyView = true;
    }
    setKey(c, which) {
        const k = { pos: c.pos.slice(), target: c.target.slice(), focal: c.focal };
        if (!c.move) c.move = { preset: 'custom', duration: 4, ease: 'smooth', start: C.clone(k), end: C.clone(k) };
        else if (c.move.preset !== 'custom') { c.move = C.clone(c.move); c.move.preset = 'custom'; delete c.move.path; delete c.move.arc; delete c.move.follow; }
        c.move[which] = k;
        this.commit();
        this.renderRight();
        this.toast(which === 'start' ? '已把当前机位设为起幅' : '已把当前机位设为落幅', 'ok');
    }
    // ---------------- 运镜预览 ----------------
    play() {
        const c = this._activeCam();
        if (!c || !c.move) { this.toast('当前机位还没有设置运镜', 'warn'); return; }
        if (this.view !== 'camera') this.setView('camera');
        this.tc.detach();
        this.previewKey = '';
        this.playing = true; this.playT = 0; this._play0 = performance.now();
        this.oc.enabled = false;
        this.el.classList.add('playing');
        this.el.querySelector('.s3-prog').classList.remove('hidden');
        this.hint('预览运镜中 · Esc 停止');
        this.renderRight();
    }
    _playTick(now) {
        const c = this._activeCam();
        if (!c || !c.move) return this.stopPlay();
        this.playT = (now - this._play0) / 1000;
        const p = clamp(this.playT / c.move.duration, 0, 1);
        const bar = this.el.querySelector('.s3-prog i');
        if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
        this.dirtyView = true;
        this._layoutFrame();
        if (this.playT >= c.move.duration + 0.35) this.stopPlay();
    }
    stopPlay() {
        if (!this.playing) return;
        this.playing = false;
        this.oc.enabled = true;
        this.v.setFollow(null);
        this.el.classList.remove('playing');
        this.el.querySelector('.s3-prog').classList.add('hidden');
        this.hint('');
        this._viewFocal = null;
        const c = this._activeCam();
        if (c && this.view === 'camera') { this._syncingView = true; this.v.poseCamera(this.v.viewCam, c, null); this.oc.target.fromArray(c.target); this.oc.update(); this._syncingView = false; }
        this._layoutFrame();
        this._attach();
        this.renderRight();
        this.dirtyView = true;
    }
    // ---------------- 输出 ----------------
    _capture(c, res, time) {
        const sz = C.outSize(c.aspect, res);
        const cv = this.v.capture(c, sz.w, sz.h, time);
        this._renderMain();
        return { cv, w: sz.w, h: sz.h };
    }
    async snapshot(o) {
        o = o || {};
        if (this._busy) return null;
        const c = this._cam(o.cameraId) || this._activeCam();
        const frame = (o.frame === 'start' || o.frame === 'end') && c.move ? o.frame : '';
        this._busy = true;
        this._setBusy('shot', true);
        try {
            await this.v.ready();
            const cap = this._capture(c, o.res || this.res, frame === 'end' ? c.move.duration : (frame === 'start' ? 0 : undefined));
            this.lastCapture = { w: cap.w, h: cap.h, cameraId: c.id };
            const blob = await new Promise(r => cap.cv.toBlob(r, 'image/jpeg', 0.92));
            const media = await this.host.upload(blob);
            const n = window.CanvasBlocks.getById(this.nodeId);
            const link = o.linkTo !== undefined ? o.linkTo : (this.link && this.opts.targetId ? this.opts.targetId : '');
            const r = this.host.placeShot({ stageNodeId: this.nodeId, name: ((n && n.name) || '3D 片场') + ' · ' + c.name + (frame ? (frame === 'start' ? ' · 起幅' : ' · 落幅') : ''), aspect: c.aspect, media, linkTo: link, meta: this.host.shotMeta(this.stage, c, frame, cap) });
            this.lastShotNodeId = r.node.id;
            if (!o.silent) this.toast(r.linked ? '截图已放到画布并连到生成节点' : '截图已放到画布', 'ok');
            return r;
        } catch (e) {
            this.toast('截图失败：' + (e.message || ''), 'warn');
            return null;
        } finally { this._busy = false; this._setBusy('shot', false); }
    }
    async exportFrames(o) {
        o = o || {};
        const c = this._cam(o.cameraId) || this._activeCam();
        if (!c.move) { this.toast('请先为当前机位设置运镜（起幅 / 落幅）', 'warn'); return null; }
        if (this._busy) return null;
        this._busy = true;
        this._setBusy('frames', true);
        try {
            await this.v.ready();
            const n = window.CanvasBlocks.getById(this.nodeId);
            const nm = ((n && n.name) || '3D 片场') + ' · ' + c.name;
            const a = this._capture(c, o.res || this.res, 0);
            const b = this._capture(c, o.res || this.res, c.move.duration);
            const [ba, bb] = await Promise.all([new Promise(r => a.cv.toBlob(r, 'image/jpeg', 0.92)), new Promise(r => b.cv.toBlob(r, 'image/jpeg', 0.92))]);
            const [ma, mb] = await Promise.all([this.host.upload(ba), this.host.upload(bb)]);
            const ra = this.host.placeShot({ stageNodeId: this.nodeId, name: nm + ' · 起幅', aspect: c.aspect, media: ma, noHistory: true, meta: this.host.shotMeta(this.stage, c, 'start', a) });
            const rb = this.host.placeShot({ stageNodeId: this.nodeId, name: nm + ' · 落幅', aspect: c.aspect, media: mb, meta: this.host.shotMeta(this.stage, c, 'end', b) });
            const CB = window.CanvasBlocks;
            if (rb.node.y < ra.node.y + 10 && Math.abs(rb.node.x - ra.node.x) < 10) { const sp = CB._findFreeSpot(ra.node.x + ra.node.w + 24, ra.node.y, rb.node.w, rb.node.h, rb.node.id); CB.update(rb.node.id, { x: sp.x, y: sp.y }); }
            this.lastFrames = { firstId: ra.node.id, lastId: rb.node.id, cameraId: c.id, w: a.w, h: a.h };
            if (!o.silent) this._flPanel(c);
            return this.lastFrames;
        } catch (e) {
            this.toast('导出失败：' + (e.message || ''), 'warn');
            return null;
        } finally { this._busy = false; this._setBusy('frames', false); }
    }
    _flPanel(c) {
        this._closePanel();
        const fr = this.lastFrames;
        const desc = C.describeMove(this.stage, c, isEn() ? 'en' : 'zh');
        const model = this.host.pickFLModel();
        const PB = window.PromptBar;
        const mname = (PB && PB.modelConfigMap[model] && PB.modelConfigMap[model].name) || model || '';
        const p = document.createElement('div');
        p.className = 's3-panel';
        p.setAttribute('role', 'dialog');
        p.innerHTML = `<div class="s3-panel-h"><span class="s3-panel-ic">${IC.check}</span><b>首尾帧已放到画布</b><button type="button" class="s3-ibtn" data-a="panel-x" title="关闭">${IC.x}</button></div>
            <div class="s3-panel-b"><div class="s3-fl-pair"><span class="s3-fl-tag">起幅</span><span class="s3-fl-arrow">→</span><span class="s3-fl-tag">落幅</span><span class="s3-dim num">${fr.w}×${fr.h} · ${c.move.duration}s</span></div>
            <label class="s3-label">视频提示词（运镜描述，可编辑）</label>
            <textarea class="s3-input s3-ta px-no-i18n" data-f="fl-prompt" rows="3" maxlength="2000">${esc(desc)}</textarea>
            <div class="s3-note">${IC.video}<span>将创建「首尾帧」视频生成节点并按顺序连好两帧；不会自动生成，确认后在画布上点生成</span></div>${mname ? `<div class="s3-fl-model"><span>视频模型</span><b class="px-no-i18n">${esc(mname)}</b></div>` : ''}</div>
            <div class="s3-panel-f"><button type="button" class="s3-btn ghost" data-a="panel-x">稍后</button><button type="button" class="s3-btn primary" data-a="fl-video"${model ? '' : ' disabled'}>${IC.video}<span>创建首尾帧视频节点</span></button></div>`;
        this.el.appendChild(p);
        this.panel = p;
        requestAnimationFrame(() => p.classList.add('in'));
        const ta = p.querySelector('textarea'); if (ta) ta.focus({ preventScroll: true });
    }
    _closePanel() { if (this.panel) { this.panel.remove(); this.panel = null; } }
    createFLVideo(prompt) {
        const fr = this.lastFrames;
        if (!fr) return null;
        const c = this._cam(fr.cameraId) || this._activeCam();
        try {
            const node = this.host.createFLVideo({ firstId: fr.firstId, lastId: fr.lastId, prompt: prompt != null ? prompt : C.describeMove(this.stage, c, isEn() ? 'en' : 'zh'), duration: c.move ? c.move.duration : 5, aspect: c.aspect, stageNodeId: this.nodeId, cameraId: c.id });
            this.lastVideoNodeId = node.id;
            this._closePanel();
            this.toast('已创建首尾帧视频节点（未生成），关闭片场后可在画布上确认并生成', 'ok');
            return node;
        } catch (e) { this.toast(e.message || '创建失败', 'warn'); return null; }
    }
    async sendToDirector(shotId, kind) {
        const c = this._activeCam();
        try {
            if (kind === 'fl') {
                if (!c.move) { this.toast('请先为当前机位设置运镜（起幅 / 落幅）', 'warn'); return false; }
                const fr = await this.exportFrames({ silent: true });
                if (!fr) return false;
                this.host.sendToDirector(shotId, { first: fr.firstId, last: fr.lastId });
            } else if (kind === 'layout') { // _FRAMES_20261029
                const r = await this.snapshot({ silent: true, linkTo: '' });
                if (!r) return false;
                this.host.sendToDirector(shotId, { layout: r.node.id, stageNodeId: this.nodeId, cameraId: c.id, stage: C.clone(this.stage) });
            } else {
                const frame = kind === 'first' && c.move ? 'start' : (kind === 'last' && c.move ? 'end' : '');
                const r = await this.snapshot({ silent: true, linkTo: '', frame });
                if (!r) return false;
                const o = kind === 'scene' ? { sceneRef: r.node.id, sceneName: (window.CanvasBlocks.getById(this.nodeId) || {}).name } : (kind === 'first' ? { first: r.node.id } : { last: r.node.id });
                this.host.sendToDirector(shotId, o);
            }
            this.dirShotId = shotId;
            const sh = this.host.directorShots().find(s => s.id === shotId);
            this.toast('已发送到导演台镜头 ' + (sh ? sh.no : ''), 'ok');
            return true;
        } catch (e) { this.toast(e.message || '发送失败', 'warn'); return false; }
    }
    _setBusy(a, on) { const b = this.el.querySelector(`.s3-top [data-a="${a}"]`); if (b) { b.classList.toggle('loading', on); b.disabled = on; } if (!on) this._updateTopState(); }
    // ---------------- 保存 / 关闭 ----------------
    async save(opts) {
        opts = opts || {};
        const st = C.normalize(this.stage).stage;
        this.host.writeBack(this.nodeId, st, this.session);
        this.savedJson = JSON.stringify(this.stage);
        this._updateTopState();
        let blob = null;
        try {
            const c = this._activeCam();
            const A = C.aspectNum(c.aspect);
            const w = A >= 1 ? 640 : Math.round(640 * A), h = A >= 1 ? Math.round(640 / A) : 640;
            const cv = this.v.capture(c, w - (w % 2), h - (h % 2));
            this._renderMain();
            blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86));
        } catch (_) { /* 忽略 */ }
        const p = this.host.updateThumb(this.nodeId, blob, this.session);
        if (!opts.quiet) this.toast('已保存到画布', 'ok');
        return p;
    }
    requestClose() {
        if (!this.isDirty()) { this.close(); return Promise.resolve(true); }
        return new Promise((resolve) => {
            const m = document.createElement('div');
            m.className = 's3-modal-mask';
            m.innerHTML = `<div class="s3-modal" role="alertdialog" aria-modal="true"><div class="s3-modal-h"><span class="s3-modal-ic">${IC.save}</span><b>保存对 3D 片场的修改？</b></div>
                <div class="s3-modal-b">有未保存的修改。保存后会写回画布节点（可在画布上 Ctrl+Z 撤销整次编辑）。</div>
                <div class="s3-modal-f"><button type="button" class="s3-btn ghost danger" data-m="discard">放弃修改</button><span class="s3-flex"></span><button type="button" class="s3-btn ghost" data-m="cancel">取消</button><button type="button" class="s3-btn primary" data-m="save">${IC.save}<span>保存并退出</span></button></div></div>`;
            this.el.appendChild(m);
            this.modal = m;
            const done = async (v) => {
                m.remove(); this.modal = null;
                if (v === 'save') { await this.save({ quiet: true }); this.close(); resolve(true); }
                else if (v === 'discard') { this.close(); resolve(true); }
                else resolve(false);
            };
            m.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) done(b.dataset.m); else if (e.target === m) done('cancel'); });
            m.querySelector('[data-m="save"]').focus();
            this._modalDone = done;
        });
    }
    close() {
        if (this.destroyed) return;
        this.destroy();
        this.host._onEditorClosed(this.nodeId);
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        cancelAnimationFrame(this.raf);
        window.removeEventListener('keydown', this._onKey, true);
        window.removeEventListener('resize', this._onResize);
        try { this.tc.detach(); this.tc.dispose(); } catch (_) { /* 忽略 */ }
        try { this.oc.dispose(); } catch (_) { /* 忽略 */ }
        this.cancelPlace();
        const mem = this.v.dispose();
        this.disposeReport = { memory: mem, renderers: live.renderers };
        window.__s3LastDispose = this.disposeReport;
        this.el.remove();
        document.body.classList.remove('s3-open');
        this.thumbs.clear();
        if (current === this) current = null;
    }
    // ---------------- 键盘 ----------------
    _key(e) {
        const t = e.target;
        const typing = t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable);
        if (window.CanvasPano && window.CanvasPano._modalCtl) return;
        e.stopPropagation();
        const k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (this.modal) { if (k === 'Escape') { e.preventDefault(); this._modalDone('cancel'); } return; }
        if (k === 'Escape') {
            e.preventDefault();
            if (this.menu) return this._closeMenu();
            if (typing) { t.blur(); return; }
            if (this.panel) return this._closePanel();
            if (this.placing) return this.cancelPlace();
            if (this.playing) return this.stopPlay();
            if (this.sel && this.sel.joint) return this.select({ kind: 'object', id: this.sel.id });
            this.requestClose();
            return;
        }
        if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); this.save(); return; }
        if (typing) return;
        if (ctrl && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); this.undo(); return; }
        if (ctrl && (k === 'y' || k === 'Y' || (e.shiftKey && (k === 'z' || k === 'Z')))) { e.preventDefault(); this.redo(); return; }
        if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); this.duplicateSel(); return; }
        if (ctrl) return;
        if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSel(); return; }
        const lk = k.toLowerCase();
        if (lk === 'w' || lk === 'e' || lk === 'r') { e.preventDefault(); this.setTool(lk === 'w' ? 'translate' : (lk === 'e' ? 'rotate' : 'scale')); return; }
        if (lk === 'f') { e.preventDefault(); this.focusSel(); return; }
        if (lk === 'c') { e.preventDefault(); this.setView(this.view === 'camera' ? 'director' : 'camera'); return; }
        if (lk === 'j') { e.preventDefault(); this.toggleJoint(); return; }
        if (k === ' ') { e.preventDefault(); if (this.playing) this.stopPlay(); else this.play(); return; }
        if (/^[1-8]$/.test(k)) { const c = this.stage.cameras[+k - 1]; if (c) { e.preventDefault(); this.select({ kind: 'camera', id: c.id }); } return; }
    }
    setTool(t) { this.tool = t; if (this.sel && this.sel.joint) this.sel = { kind: 'object', id: this.sel.id }; this._attach(); this.renderTop(); }
    toggleJoint() {
        const o = this._selObj();
        if (!o || o.type !== 'actor') { this.toast('先选中一个人偶', 'warn'); return; }
        this.jointMode = !this.jointMode;
        if (!this.jointMode && this.sel.joint) this.sel = { kind: 'object', id: o.id };
        else if (this.jointMode && !this.sel.joint) this.sel = { kind: 'object', id: o.id, joint: 'rightShoulder' };
        this._attach();
        this.renderRight();
        this.hint(this.jointMode ? '关节模式：点击人偶身体部位选择关节，拖动旋转环微调 · J 退出' : '');
        if (this.jointMode) setTimeout(() => { if (this.jointMode) this.hint(''); }, 3200);
    }
    hint(msg) {
        const h = this.el.querySelector('.s3-hint');
        h.textContent = msg || '';
        h.classList.toggle('hidden', !msg);
    }
    toast(msg, type) { this.host.toast(msg, type); }

    // ---------------- 事件分发 ----------------
    _click(e) {
        const b = e.target.closest('[data-a]');
        if (this.menu && !e.target.closest('.s3-menu') && !(b && /^menu-/.test(b.dataset.a))) this._closeMenu();
        const seg = e.target.closest('.s3-seg button');
        if (seg && !seg.disabled) {
            const g = seg.parentNode.dataset.g, val = seg.dataset.v;
            return this._seg(g, val);
        }
        if (!b || b.disabled) return;
        const a = b.dataset.a;
        if ((a === 'sel' || a === 'cam-pick') && this._renameT && performance.now() - this._renameT < 700) return;
        const c = this._activeCam();
        switch (a) {
            case 'close': return this.requestClose();
            case 'save': return this.save();
            case 'undo': return this.undo();
            case 'redo': return this.redo();
            case 'shot': return this.snapshot();
            case 'frames': return this.exportFrames();
            case 'add-cam': return this.addCamera();
            case 'menu-actor': return this._menuActor(b);
            case 'menu-prop': return this._menuProp(b);
            case 'menu-dir': return this._menuDir(b);
            case 'place-actor': this._closeMenu(); return this.startPlace({ type: 'actor', characterId: b.dataset.cid || '' });
            case 'place-prop': this._closeMenu(); return this.startPlace({ type: 'prop', kind: b.dataset.kind });
            case 'dir-send': this._closeMenu(); return this.sendToDirector(b.dataset.sid, b.dataset.kind);
            case 'sel': { const kind = b.dataset.kind; if (kind === 'env') return this.select({ kind: 'env' }); return this.select({ kind, id: b.dataset.id }); }
            case 'vis': { const o = this._obj(b.dataset.id); if (o) { o.hidden = !o.hidden; this._syncObj(o); this.commit(); if (o.hidden && this.sel && this.sel.id === o.id) this._attach(); this.renderLeft(); } return; }
            case 'lock': { const o = this._obj(b.dataset.id); if (o) { o.locked = !o.locked; this.commit(); this._attach(); this.renderLeft(); this.renderRight(); } return; }
            case 'cam-pick': return this.select({ kind: 'camera', id: b.dataset.id });
            case 'cam-view': this.select({ kind: 'camera', id: b.dataset.id }); return this.setView('camera');
            case 'del': return this.deleteSel();
            case 'dup': return this.duplicateSel();
            case 'focus': return this.focusSel();
            case 'pose': { const o = this._selObj(); if (o) this.setPose(o, b.dataset.pose); return; }
            case 'color': return this._setColor(b.dataset.c, true);
            case 'joint-mode': return this.toggleJoint();
            case 'joint-reset': { const o = this._selObj(); if (o && this.sel.joint) { o.actor.pose[this.sel.joint] = [0, 0, 0]; o.actor.posePreset = 'custom'; this._syncObj(o); this.commit(); this.renderRight(); } return; }
            case 'char-menu': return this._menuChar(b);
            case 'bind-char': { this._closeMenu(); const o = this._selObj(); if (o) this._bindChar(o, b.dataset.cid); return; }
            case 'focal': if (c) { c.focal = +b.dataset.v; this._afterCamEdit(c, true); } return;
            case 'shot-size': if (c) this.applyFraming(c, b.dataset.v, null); return;
            case 'angle': if (c) this.applyFraming(c, null, b.dataset.v); return;
            case 'move': if (c) this.setMovePreset(c, b.dataset.v); return;
            case 'key-start': if (c) this.setKey(c, 'start'); return;
            case 'key-end': if (c) this.setKey(c, 'end'); return;
            case 'peek': return this._setPeek(this.previewKey === b.dataset.v ? '' : b.dataset.v);
            case 'play': return this.playing ? this.stopPlay() : this.play();
            case 'cam-from-view': if (c) { const src = this.v.dirCam; const fwd = new T.Vector3(0, 0, -1).applyQuaternion(src.quaternion); const d = Math.max(1, src.position.distanceTo(this.oc.target)); c.pos = src.position.toArray().map(r3); c.target = src.position.clone().addScaledVector(fwd, d).toArray().map(r3); c.shot = ''; c.angle = ''; this._rebaseMove(c); this._syncCam(c); this.commit(); this.renderUI(); } return;
            case 'env-pano': { const st = this.stage.env; const p = this.host.panoList().find(x => x.id === b.dataset.id); if (p) { st.panoNodeId = p.id; st.panoUrl = p.url; this.v.setEnv(st); this.commit(); this.renderUI(); this._staleThumbs(); } return; }
            case 'env-preset': { const st = this.stage.env; st.panoNodeId = ''; st.panoUrl = ''; st.preset = b.dataset.v; this.v.setEnv(st); this.commit(); this.renderUI(); this._staleThumbs(); this.dirtyView = true; return; }
            case 'panel-x': return this._closePanel();
            case 'fl-video': { const ta = this.panel && this.panel.querySelector('textarea'); return this.createFLVideo(ta ? ta.value : null); }
            case 'link-toggle': this.link = !this.link; return this.renderRight();
            case 'help': return this._menuHelp(b);
        }
    }
    _seg(g, val) {
        const c = this._activeCam();
        if (g === 'tool') return this.setTool(val);
        if (g === 'view') return this.setView(val);
        if (g === 'aspect' && c) { c.aspect = val; this._afterCamEdit(c, true); this._layoutFrame(); return; }
        if (g === 'res') { this.res = val; return this.renderRight(); }
        if (g === 'ease' && c && c.move) { c.move.ease = val; this.commit(); return this.renderRight(); }
        if (g === 'amode') { const o = this._selObj(); if (o && o.type === 'actor') { if (val === 'billboard' && !o.actor.characterId) { this.toast('纸片人模式需要先绑定角色', 'warn'); return; } o.actor.mode = val; this._syncObj(o); this.commit(); this.renderRight(); } return; }
        if (g === 'bg') { this._bgTab = val; return this.renderRight(); }
    }
    _input(e, final) {
        const t = e.target, f = t.dataset && t.dataset.f;
        if (!f) return;
        if (f === 'fl-prompt' || f === 'rename') return;
        const num = parseFloat(t.value);
        const c = this._activeCam();
        const o = this._selObj();
        const st = this.stage;
        if (t.type === 'range') t.style.setProperty('--pct', (((num - t.min) / (t.max - t.min)) * 100).toFixed(1) + '%');
        const out = t.parentNode && t.parentNode.querySelector('.s3-val');
        if (/^env\./.test(f)) {
            const k = f.slice(4);
            if (k === 'grid') st.env.grid = t.checked;
            else if (isFinite(num)) st.env[k] = k === 'exposure' ? Math.round(num * 100) / 100 : Math.round(num * 10) / 10;
            if (out) out.textContent = k === 'exposure' ? st.env[k].toFixed(2) : Math.round(st.env[k]) + '°';
            this.v.setEnv(st.env);
            this.dirtyView = true; this._staleThumbs();
            if (final) this.commit();
            return;
        }
        if (/^cam\./.test(f) && c) {
            const k = f.slice(4);
            if (k === 'focal' && isFinite(num)) { c.focal = clamp(Math.round(num), 14, 135); if (out) out.textContent = c.focal + 'mm'; this._afterCamEdit(c, final); }
            else if (k === 'duration' && c.move && isFinite(num)) { c.move.duration = clamp(Math.round(num * 2) / 2, 2, 15); if (out) out.textContent = c.move.duration + 's'; if (final) { this.commit(); this.renderRight(); } }
            else if (k === 'name') { const v = String(t.value).replace(/[\r\n\t<>]+/g, ' ').trim().slice(0, 30); if (final && v) { c.name = v; this._syncCam(c); this.commit(); this.renderUI(); this._layoutFrame(); } }
            else if (k === 'subject') { c.subjectId = t.value; if (final) { this.commit(); this.renderRight(); } }
            else if (/^(pos|target)\.\d$/.test(k) && isFinite(num)) { const [p, i] = k.split('.'); c[p][+i] = r3(clamp(num, i === '1' ? -5 : -50, i === '1' ? 30 : 50)); c.shot = ''; c.angle = ''; this._afterCamEdit(c, final); }
            return;
        }
        if (!o) return;
        if (f === 'name') { const v = String(t.value).replace(/[\r\n\t<>]+/g, ' ').trim().slice(0, 30); if (final && v) { o.name = v; this._syncObj(o); this.commit(); this.renderLeft(); } return; }
        if (f === 'color') { this._setColor(t.value, final); return; }
        if (/^pos\.\d$/.test(f) && isFinite(num)) { const i = +f.slice(4); o.pos[i] = r3(clamp(num, i === 1 ? -5 : -50, i === 1 ? 30 : 50)); }
        else if (/^rot\.\d$/.test(f) && isFinite(num)) { const i = +f.slice(4); o.rot[i] = clamp(num, -180, 180); }
        else if (/^size\.\d$/.test(f) && isFinite(num) && o.type === 'prop') { const i = +f.slice(5); o.prop.size[i] = r3(clamp(num, 0.02, 30)); }
        else if (f === 'height' && isFinite(num) && o.type === 'actor') { o.actor.height = r3(clamp(num, 0.5, 2.6)); if (out) out.textContent = o.actor.height.toFixed(2) + 'm'; }
        else if (/^joint\.\d$/.test(f) && isFinite(num) && o.type === 'actor' && this.sel.joint) {
            const i = +f.slice(6);
            const cur = (o.actor.pose[this.sel.joint] || [0, 0, 0]).slice(); cur[i] = clamp(Math.round(num), -180, 180);
            o.actor.pose[this.sel.joint] = cur; o.actor.posePreset = 'custom';
            if (out) out.textContent = cur[i] + '°';
        } else if (f === 'joint-sel') { this.sel = { kind: 'object', id: o.id, joint: t.value }; this.jointMode = true; this._attach(); this.renderRight(); return; }
        else return;
        if (/^size\./.test(f) && !final) return;
        this._syncObj(o);
        if (this.sel && !this.sel.joint) this._attach();
        if (final) { this.commit(); if (/^size\./.test(f)) this.renderRight(); }
    }
    _afterCamEdit(c, final) {
        this._rebaseMove(c);
        this._syncCam(c);
        if (this.view === 'camera') { this._syncingView = true; this.v.poseCamera(this.v.viewCam, c, null); this.oc.target.fromArray(c.target); this.oc.update(); this._syncingView = false; this._layoutFrame(); }
        this.dirtyView = true;
        if (final) { this.commit(); this.renderRight(); this.renderStrip(); }
    }
    _setColor(col, final) {
        const o = this._selObj();
        if (!o || !/^#[0-9a-f]{6}$/i.test(col)) return;
        o.color = col.toLowerCase();
        this._syncObj(o);
        if (final) { this.commit(); this.renderRight(); this.renderLeft(); }
    }
    _bindChar(o, cid) {
        if (!cid) { o.actor.characterId = ''; o.actor.charName = ''; o.actor.mode = 'mannequin'; }
        else {
            const ch = this.host.character(cid);
            if (!ch) return;
            const was = o.actor.charName || '';
            o.actor.characterId = cid; o.actor.charName = String(ch.name || '').slice(0, 30);
            if (!o.name || /^(人偶|Actor) \d+$/.test(o.name) || o.name === was) o.name = o.actor.charName || o.name;
        }
        this._syncObj(o);
        this.commit();
        this.renderUI();
    }
    _dbl(e) {
        const btn = e.target.closest('.s3-row-main[data-id], .s3-card-main[data-id]');
        if (!btn) return;
        const id = btn.dataset.id;
        const isCam = !!this._cam(id);
        const it = isCam ? this._cam(id) : this._obj(id);
        if (!it) return;
        e.preventDefault();
        const inp = document.createElement('input');
        inp.className = 's3-rename px-no-i18n' + (btn.classList.contains('s3-card-main') ? ' card' : ''); inp.value = it.name; inp.maxLength = 30; inp.dataset.f = 'rename';
        inp.setAttribute('aria-label', '重命名');
        btn.replaceWith(inp);
        this._renameT = performance.now();
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        const done = (ok) => {
            if (inp._done) return; inp._done = true;
            const v = String(inp.value).replace(/[\r\n\t<>]+/g, ' ').trim().slice(0, 30);
            if (ok && v && v !== it.name) { it.name = v; if (isCam) this._syncCam(it); else this._syncObj(it); this.commit(); }
            this.renderUI();
        };
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
    }
    // ---------------- 弹出菜单 ----------------
    _menu(anchor, html, cls) {
        this._closeMenu();
        const m = document.createElement('div');
        m.className = 's3-menu ' + (cls || '');
        m.innerHTML = html;
        this.el.appendChild(m);
        const r = anchor.getBoundingClientRect();
        const mw = m.offsetWidth, mh = m.offsetHeight;
        let x = r.left, y = r.bottom + 8;
        if (x + mw > this.W - 10) x = Math.max(10, r.right - mw);
        if (y + mh > this.H - 10) y = Math.max(10, r.top - mh - 8);
        m.style.left = x + 'px'; m.style.top = y + 'px';
        this.menu = m;
        anchor.setAttribute('aria-expanded', 'true');
        this._menuAnchor = anchor;
        requestAnimationFrame(() => m.classList.add('in'));
        const first = m.querySelector('button'); if (first) first.focus({ preventScroll: true });
        return m;
    }
    _closeMenu() { if (this.menu) { this.menu.remove(); this.menu = null; if (this._menuAnchor) this._menuAnchor.setAttribute('aria-expanded', 'false'); } }
    _avatar(c) { const r = (c.refs || [])[0]; return r ? this.host.sameOrigin(r.previewUrl || r.url) : ''; }
    _menuActor(anchor) {
        const chars = this.host.characters().slice(0, 30);
        this._menu(anchor, `<div class="s3-menu-h">添加人偶 · 点击地面放置</div>
            <button type="button" class="s3-mi" data-a="place-actor"><span class="s3-mi-av">${IC.actor}</span><span>空白人偶</span></button>
            ${chars.length ? `<div class="s3-menu-sep"></div><div class="s3-menu-h sub">角色库</div><div class="s3-menu-scroll">${chars.map(c => `<button type="button" class="s3-mi" data-a="place-actor" data-cid="${esc(c.id)}"><span class="s3-mi-av">${this._avatar(c) ? `<img src="${esc(this._avatar(c))}" alt="" draggable="false">` : IC.actor}</span><span class="px-no-i18n">${esc(c.name)}</span></button>`).join('')}</div>` : '<div class="s3-menu-tip">角色库还没有角色，可在左侧「角色库」创建后绑定</div>'}`, 'actor');
    }
    _menuProp(anchor) {
        this._menu(anchor, `<div class="s3-menu-h">添加道具 / 布景 · 点击地面放置</div><div class="s3-prop-grid">${Object.keys(C.PROPS).map(k => `<button type="button" class="s3-pi" data-a="place-prop" data-kind="${k}"><i style="--c:${C.PROPS[k].color}"></i><span>${esc(label(C.PROPS[k]))}</span></button>`).join('')}</div>`, 'props');
    }
    _menuChar(anchor) {
        const chars = this.host.characters().slice(0, 40);
        this._menu(anchor, `<div class="s3-menu-h">绑定角色</div><button type="button" class="s3-mi" data-a="bind-char" data-cid=""><span class="s3-mi-av">${IC.x}</span><span>不绑定</span></button>
            ${chars.length ? `<div class="s3-menu-scroll">${chars.map(c => `<button type="button" class="s3-mi" data-a="bind-char" data-cid="${esc(c.id)}"><span class="s3-mi-av">${this._avatar(c) ? `<img src="${esc(this._avatar(c))}" alt="" draggable="false">` : IC.actor}</span><span class="px-no-i18n">${esc(c.name)}</span>${(c.turnaround || []).length >= 8 ? '<em>8 视角</em>' : ''}</button>`).join('')}</div>` : '<div class="s3-menu-tip">角色库还没有角色</div>'}`, 'actor');
    }
    _menuDir(anchor) {
        const shots = this.host.directorShots();
        const c = this._activeCam();
        const hasMove = !!(c && c.move);
        this._menu(anchor, shots.length ? `<div class="s3-menu-h">发送到 2D 导演台镜头</div><div class="s3-menu-sub"><span>当前机位：</span><b class="px-no-i18n">${esc(c.name)}</b></div><div class="s3-menu-scroll tall">${shots.map(s => `<div class="s3-dir-row${s.id === this.dirShotId ? ' on' : ''}"><div class="s3-dir-t"><b class="num">${s.no}</b><span class="px-no-i18n">${esc(s.title || s.scene || '')}</span>${s.mode === 'first_last' ? '<em>首尾帧</em>' : ''}</div>
                <div class="s3-dir-acts"><button type="button" class="s3-chipbtn" data-a="dir-send" data-sid="${esc(s.id)}" data-kind="layout" title="截图作为该镜头的分镜构图图，并把机位与人物站位同步到镜头构图">分镜构图</button><button type="button" class="s3-chipbtn" data-a="dir-send" data-sid="${esc(s.id)}" data-kind="scene" title="截图作为该镜头所在场景的参考图">场景参考图</button><button type="button" class="s3-chipbtn" data-a="dir-send" data-sid="${esc(s.id)}" data-kind="first" title="作为首帧（有运镜时用起幅）">首帧</button><button type="button" class="s3-chipbtn" data-a="dir-send" data-sid="${esc(s.id)}" data-kind="last" title="作为尾帧（有运镜时用落幅）">尾帧</button><button type="button" class="s3-chipbtn${hasMove ? '' : ' off'}" data-a="dir-send" data-sid="${esc(s.id)}" data-kind="fl" title="导出起幅与落幅，绑定为首尾帧"${hasMove ? '' : ' disabled'}>首尾帧</button></div></div>`).join('')}</div>`
            : `<div class="s3-menu-h">发送到 2D 导演台</div><div class="s3-menu-tip">导演台还没有镜头。先在导演台写剧本、拆分镜，再把机位截图发送到镜头。</div>`, 'dir');
    }
    _menuHelp(anchor) {
        const rows = [['W / E / R', '移动 / 旋转 / 缩放'], ['C', '导演视角 ⇄ 机位视角'], ['1 – 8', '切换机位'], ['Space', '预览 / 停止运镜'], ['J', '关节微调模式'], ['F', '聚焦选中'], ['Delete', '删除'], ['Ctrl + D', '复制'], ['Ctrl + Z / Y', '撤销 / 重做'], ['Ctrl + S', '保存'], ['Esc', '取消 / 退出']];
        this._menu(anchor, `<div class="s3-menu-h">快捷键</div><div class="s3-keys">${rows.map(r => `<span class="s3-kbd num">${r[0]}</span><span>${r[1]}</span>`).join('')}</div>`, 'help');
    }

    // ---------------- 面板渲染 ----------------
    renderUI() { this.renderTop(); this.renderLeft(); this.renderRight(); this.renderStrip(); this._layoutFrame(); }
    _updateTopState() {
        const u = this.el.querySelector('[data-a="undo"]'), r = this.el.querySelector('[data-a="redo"]'), s = this.el.querySelector('[data-a="save"]');
        if (u) u.disabled = this.hi <= 0;
        if (r) r.disabled = this.hi >= this.hist.length - 1;
        if (s) s.classList.toggle('dirty', this.isDirty());
        const c = this._activeCam();
        const fb = this.el.querySelector('.s3-top [data-a="frames"]');
        if (fb && !fb.classList.contains('loading')) fb.disabled = !(c && c.move);
        const sb = this.el.querySelector('.s3-top [data-a="shot"]');
        if (sb && !sb.classList.contains('loading')) sb.disabled = false;
    }
    renderTop() {
        this.el.querySelectorAll('.s3-seg[data-g="tool"] button').forEach(b => { const on = b.dataset.v === this.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        this.el.querySelectorAll('.s3-seg[data-g="view"] button').forEach(b => { const on = b.dataset.v === this.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        this._updateTopState();
    }
    renderLeft() {
        const st = this.stage, s = this.sel || {};
        const actors = st.objects.filter(o => o.type === 'actor'), props = st.objects.filter(o => o.type === 'prop');
        const env = st.env;
        const pano = env.panoNodeId && this.host.panoList().find(p => p.id === env.panoNodeId);
        const envName = pano ? pano.name : (env.panoNodeId ? '全景（已失效）' : label(C.ENV_PRESETS[env.preset]));
        const row = (o) => `<div class="s3-row${s.id === o.id ? ' on' : ''}${o.hidden ? ' off' : ''}" data-id="${esc(o.id)}" role="listitem">
            <button type="button" class="s3-row-main" data-a="sel" data-kind="object" data-id="${esc(o.id)}"><i class="s3-dot${o.type === 'prop' ? ' sq' : ''}" style="--c:${esc(o.color)}"></i><span class="s3-row-name px-no-i18n">${esc(o.name)}</span>${o.type === 'actor' && o.actor.characterId ? `<span class="s3-row-tag">角色</span>` : ''}</button>
            <button type="button" class="s3-row-ic" data-a="vis" data-id="${esc(o.id)}" title="${o.hidden ? '显示' : '隐藏'}" aria-pressed="${!o.hidden}">${o.hidden ? IC.eyeOff : IC.eye}</button>
            <button type="button" class="s3-row-ic${o.locked ? ' lit' : ''}" data-a="lock" data-id="${esc(o.id)}" title="${o.locked ? '解锁' : '锁定'}" aria-pressed="${o.locked}">${o.locked ? IC.lock : IC.unlock}</button></div>`;
        const sec = (title, icon, n, body, empty) => `<div class="s3-sec"><div class="s3-sec-h"><span class="s3-sec-ic">${icon}</span><span>${title}</span><b class="num">${n}</b></div>${n ? body : `<div class="s3-sec-empty">${empty}</div>`}</div>`;
        this.el.querySelector('.s3-left').innerHTML = `<div class="s3-pane-h"><span>场景</span><button type="button" class="s3-ibtn" data-a="help" title="快捷键">${IC.help}</button></div>
            <div class="s3-pane-b">
            <div class="s3-sec"><div class="s3-sec-h"><span class="s3-sec-ic">${IC.globe}</span><span>背景</span></div>
                <div class="s3-row${s.kind === 'env' ? ' on' : ''}"><button type="button" class="s3-row-main" data-a="sel" data-kind="env"><i class="s3-dot env${pano ? ' pano' : ''}"></i><span class="s3-row-name${pano ? ' px-no-i18n' : ''}">${esc(envName)}</span>${pano ? '<span class="s3-row-tag">360°</span>' : ''}</button></div></div>
            ${sec('人偶', IC.actor, actors.length, actors.map(row).join(''), '点顶部「人偶」添加，点击地面放置')}
            ${sec('道具', IC.box, props.length, props.map(row).join(''), '点顶部「道具」添加桌椅、墙、门等布景')}
            ${sec('机位', IC.camera, st.cameras.length, st.cameras.map(c => `<div class="s3-row${s.id === c.id ? ' on' : ''}${c.id === st.activeCameraId ? ' active' : ''}" data-id="${esc(c.id)}" role="listitem"><button type="button" class="s3-row-main" data-a="sel" data-kind="camera" data-id="${esc(c.id)}"><i class="s3-dot cam"></i><span class="s3-row-name px-no-i18n">${esc(c.name)}</span><span class="s3-row-meta num">${Math.round(c.focal)}mm</span>${c.move ? `<span class="s3-row-tag">${esc(label(C.MOVES[c.move.preset]))}</span>` : ''}</button><button type="button" class="s3-row-ic" data-a="cam-view" data-id="${esc(c.id)}" title="机位视角">${IC.eye}</button></div>`).join(''), '')}
            </div>
            <div class="s3-pane-f">W/E/R 变换 · C 切换视角 · Space 预览运镜</div>`;
    }
    renderRight() {
        const box = this.el.querySelector('.s3-right');
        const s = this.sel;
        let html;
        if (!s || s.kind === 'env') html = this._envPane();
        else if (s.kind === 'camera') html = this._camPane(this._cam(s.id));
        else { const o = this._obj(s.id); html = o ? (o.type === 'actor' ? this._actorPane(o) : this._propPane(o)) : this._envPane(); }
        const keep = box.querySelector('.s3-pane-b');
        const st = keep ? keep.scrollTop : 0;
        box.innerHTML = html;
        const nb = box.querySelector('.s3-pane-b');
        if (nb && this._lastPaneKey === (s ? s.kind + (s.id || '') : 'env')) nb.scrollTop = st;
        this._lastPaneKey = s ? s.kind + (s.id || '') : 'env';
        box.querySelectorAll('input[type=range]').forEach(r => r.style.setProperty('--pct', (((parseFloat(r.value) - r.min) / (r.max - r.min)) * 100).toFixed(1) + '%'));
    }
    _slider(f, val, min, max, step, txt, lb) {
        return `<div class="s3-field"><label class="s3-label">${lb}</label><div class="s3-slider"><input type="range" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${esc(lb)}"><span class="s3-val num">${txt}</span></div></div>`;
    }
    _nums(prefix, arr, labels, step) {
        return `<div class="s3-nums">${arr.map((v, i) => `<label class="s3-num"><i>${labels[i]}</i><input type="number" data-f="${prefix}.${i}" value="${Math.round(v * 100) / 100}" step="${step || 0.1}" aria-label="${labels[i]}"></label>`).join('')}</div>`;
    }
    _head(icon, name, chip, extra) {
        return `<div class="s3-pane-h big"><span class="s3-head-ic">${icon}</span><input class="s3-head-name px-no-i18n" data-f="name" value="${esc(name)}" maxlength="30" aria-label="名称"><span class="s3-chip sm">${chip}</span>${extra || ''}</div>`;
    }
    _ops() {
        return `<span class="s3-head-ops"><button type="button" class="s3-ibtn" data-a="focus" title="聚焦（F）">${IC.target}</button><button type="button" class="s3-ibtn" data-a="dup" title="复制（Ctrl+D）">${IC.dup}</button><button type="button" class="s3-ibtn danger" data-a="del" title="删除（Delete）">${IC.trash}</button></span>`;
    }
    _colors(cur) {
        return `<div class="s3-field"><label class="s3-label">颜色</label><div class="s3-swatches">${SWATCHES.map(c => `<button type="button" class="s3-sw${c === cur ? ' on' : ''}" data-a="color" data-c="${c}" style="--c:${c}" title="${c}" aria-label="${c}"></button>`).join('')}<label class="s3-sw custom" title="自定义颜色"><input type="color" data-f="color" value="${esc(cur)}" aria-label="自定义颜色"></label></div></div>`;
    }
    _envPane() {
        const env = this.stage.env;
        const panos = this.host.panoList();
        const tab = this._bgTab || (env.panoNodeId ? 'pano' : 'preset');
        const hasPano = !!(env.panoNodeId && this.v.panoOk);
        return `<div class="s3-pane-h big"><span class="s3-head-ic">${IC.globe}</span><span class="s3-head-t">背景与环境</span></div><div class="s3-pane-b">
            <div class="s3-seg full" data-g="bg"><button type="button" data-v="pano" class="${tab === 'pano' ? 'on' : ''}">360° 全景</button><button type="button" data-v="preset" class="${tab === 'preset' ? 'on' : ''}">预设背景</button></div>
            ${tab === 'pano' ? (panos.length ? `<div class="s3-panos">${panos.map(p => `<button type="button" class="s3-pano${p.id === env.panoNodeId ? ' on' : ''}" data-a="env-pano" data-id="${esc(p.id)}" title="${esc(p.name)}"><span class="s3-pano-img" style="background-image:url('${esc(p.thumb)}')"></span><span class="s3-pano-n px-no-i18n">${esc(p.name)}</span>${p.id === env.panoNodeId ? `<span class="s3-pano-on">${IC.check}</span>` : ''}</button>`).join('')}</div>`
                : `<div class="s3-empty-card">${IC.globe}<span>画布上还没有已生成的 360° 全景节点。可先用「360 全景」生成场景全景，再回来作为片场背景。</span></div>`)
                : `<div class="s3-presets">${Object.keys(C.ENV_PRESETS).map(k => { const p = C.ENV_PRESETS[k]; return `<button type="button" class="s3-preset${!env.panoNodeId && env.preset === k ? ' on' : ''}" data-a="env-preset" data-v="${k}"><span class="s3-preset-sw" style="--t:${p.top};--b:${p.bottom};--g:${p.ground}"></span><span>${esc(label(p))}</span></button>`; }).join('')}</div>`}
            ${env.panoNodeId ? `<div class="s3-group-t">全景校准</div>
                ${this._slider('env.yaw', env.yaw, -180, 180, 1, Math.round(env.yaw) + '°', '偏航')}
                ${this._slider('env.horizon', env.horizon, -30, 30, 0.5, Math.round(env.horizon) + '°', '地平线')}
                ${this._slider('env.exposure', env.exposure, 0.2, 3, 0.05, env.exposure.toFixed(2), '亮度')}
                ${hasPano ? '' : '<div class="s3-note dim">全景加载中…</div>'}
                <div class="s3-note">${IC.warn}<span>全景是无限远背景：机位尽量靠近场景中心，人偶站在地面网格上，用「地平线」对齐人偶脚底与全景地面</span></div>` : this._slider('env.exposure', env.exposure, 0.2, 3, 0.05, env.exposure.toFixed(2), '亮度')}
            <label class="s3-toggle"><input type="checkbox" data-f="env.grid"${env.grid ? ' checked' : ''}><span class="s3-switch"></span><span>地面网格（辅助线，不进截图）</span></label>
        </div>`;
    }
    _propPane(o) {
        return `${this._head(IC.box, o.name, esc(label(C.PROPS[o.prop.kind])), this._ops())}<div class="s3-pane-b">
            ${o.locked ? `<div class="s3-note">${IC.lock}<span>已锁定，解锁后可移动</span></div>` : ''}
            ${this._colors(o.color)}
            <div class="s3-field"><label class="s3-label">尺寸（米）</label>${this._nums('size', o.prop.size, isEn() ? ['W', 'H', 'D'] : ['宽', '高', '深'], 0.05)}</div>
            <div class="s3-field"><label class="s3-label">位置（米）</label>${this._nums('pos', o.pos, ['X', 'Y', 'Z'], 0.1)}</div>
            <div class="s3-field"><label class="s3-label">旋转（度）</label>${this._nums('rot', o.rot, ['X', 'Y', 'Z'], 5)}</div>
        </div>`;
    }
    _actorPane(o) {
        const a = o.actor;
        const ch = a.characterId ? this.host.character(a.characterId) : null;
        const cv = a.characterId ? this.host.charViews(a.characterId) : null;
        const canBB = !!(cv && (cv.views || cv.single));
        const j = this.sel && this.sel.joint;
        const jv = j ? (a.pose[j] || [0, 0, 0]) : null;
        return `${this._head(IC.actor, o.name, '演员', this._ops())}<div class="s3-pane-b">
            ${o.locked ? `<div class="s3-note">${IC.lock}<span>已锁定，解锁后可移动</span></div>` : ''}
            <div class="s3-field"><label class="s3-label">绑定角色</label><button type="button" class="s3-charbtn" data-a="char-menu">${ch ? `<span class="s3-mi-av">${this._avatar(ch) ? `<img src="${esc(this._avatar(ch))}" alt="" draggable="false">` : IC.actor}</span><span class="px-no-i18n">${esc(ch.name)}</span>` : `<span class="s3-mi-av">${IC.actor}</span><span>未绑定 · 从角色库选择</span>`}${IC.caret}</button>
                <div class="s3-seg full" data-g="amode"><button type="button" data-v="mannequin" class="${a.mode !== 'billboard' ? 'on' : ''}">白模人偶</button><button type="button" data-v="billboard" class="${a.mode === 'billboard' ? 'on' : ''}"${canBB ? '' : ' disabled'} title="${canBB ? '用角色图片做纸片人（有 8 视角序列时按机位角度自动换图）' : '绑定有参考图的角色后可用'}">纸片人${cv && cv.views ? ' · 8 视角' : ''}</button></div></div>
            ${this._colors(o.color)}
            ${this._slider('height', a.height, 0.5, 2.6, 0.01, a.height.toFixed(2) + 'm', '身高')}
            <div class="s3-group-t">姿势</div>
            <div class="s3-poses">${Object.keys(C.POSES).map(k => `<button type="button" class="s3-pose${a.posePreset === k ? ' on' : ''}" data-a="pose" data-pose="${k}">${esc(label(C.POSES[k]))}</button>`).join('')}</div>
            <div class="s3-joint-row"><button type="button" class="s3-btn sm${this.jointMode ? ' on' : ''}" data-a="joint-mode" aria-pressed="${!!this.jointMode}" title="点击人偶身体部位选择关节（J）">${IC.joint}<span>关节微调</span></button>${a.posePreset === 'custom' ? '<span class="s3-dim">自定义姿势</span>' : ''}</div>
            ${this.jointMode ? `<div class="s3-joint">
                <select class="s3-input" data-f="joint-sel" aria-label="关节">${C.JOINTS.map(k => `<option value="${k}"${k === j ? ' selected' : ''}>${esc(C.JOINT_LABEL[k][isEn() ? 1 : 0])}</option>`).join('')}</select>
                ${j ? ['X', 'Y', 'Z'].map((ax, i) => this._slider('joint.' + i, jv[i], -180, 180, 1, Math.round(jv[i]) + '°', ax)).join('') + `<button type="button" class="s3-link" data-a="joint-reset">重置该关节</button>` : ''}</div>` : ''}
            <div class="s3-field"><label class="s3-label">位置（米）</label>${this._nums('pos', o.pos, ['X', 'Y', 'Z'], 0.1)}</div>
            <div class="s3-field"><label class="s3-label">朝向（度）</label>${this._nums('rot', o.rot, ['X', 'Y', 'Z'], 5)}</div>
        </div>`;
    }
    _camPane(c) {
        if (!c) return this._envPane();
        const actors = this.stage.objects.filter(o => o.type === 'actor');
        const subj = C.subjectOf(this.stage, c);
        const mv = c.move;
        const tgt = this.opts.targetId && window.CanvasBlocks.getById(this.opts.targetId);
        const desc = mv ? C.describeMove(this.stage, c, isEn() ? 'en' : 'zh') : '';
        const sizeNow = subj ? C.classifyShot(c, subj) : '';
        return `${this._head(IC.camera, c.name, c.id === this.stage.activeCameraId ? '当前机位' : '机位', this._ops())}<div class="s3-pane-b">
            ${this._slider('cam.focal', c.focal, 14, 135, 1, Math.round(c.focal) + 'mm', '焦段')}
            <div class="s3-chips">${FOCALS.map(f => `<button type="button" class="s3-chipbtn${Math.round(c.focal) === f ? ' on' : ''}" data-a="focal" data-v="${f}">${f}</button>`).join('')}</div>
            <div class="s3-field"><label class="s3-label">画幅</label><div class="s3-seg full wrap" data-g="aspect">${Object.keys(C.ASPECTS).map(k => `<button type="button" data-v="${k}" class="${c.aspect === k ? 'on' : ''}">${k}</button>`).join('')}</div></div>
            <div class="s3-group-t">景别 / 角度<span class="s3-dim">${subj ? `主体：<span class="px-no-i18n">${esc(subj.name)}</span>` : '（无人偶时按场景中心）'}</span></div>
            ${actors.length > 1 ? `<div class="s3-field"><select class="s3-input" data-f="cam.subject" aria-label="主体"><option value="">${isEn() ? 'Auto (first actor)' : '自动（第一个人偶）'}</option>${actors.map(a => `<option value="${esc(a.id)}"${a.id === c.subjectId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
            <div class="s3-chips">${C.SHOT_ORDER.map(k => `<button type="button" class="s3-chipbtn${(c.shot || sizeNow) === k ? (c.shot ? ' on' : ' soft') : ''}" data-a="shot-size" data-v="${k}">${esc(label(C.SHOTS[k]))}</button>`).join('')}</div>
            <div class="s3-chips">${Object.keys(C.ANGLES).map(k => `<button type="button" class="s3-chipbtn${c.angle === k ? ' on' : ''}" data-a="angle" data-v="${k}">${esc(label(C.ANGLES[k]))}</button>`).join('')}</div>
            <div class="s3-group-t">运镜${mv ? `<span class="s3-dim num">${mv.duration}s</span>` : ''}</div>
            <div class="s3-chips">${['none', 'push', 'pull', 'pan', 'truck', 'rise', 'fall', 'orbit', 'follow', 'custom'].map(k => `<button type="button" class="s3-chipbtn${(mv ? mv.preset : 'none') === k ? ' on' : ''}" data-a="move" data-v="${k}">${k === 'none' ? (isEn() ? 'None' : '无') : esc(label(C.MOVES[k]))}</button>`).join('')}</div>
            ${mv ? `${this._slider('cam.duration', mv.duration, 2, 15, 0.5, mv.duration + 's', '时长')}
                <div class="s3-field"><label class="s3-label">节奏</label><div class="s3-seg full" data-g="ease"><button type="button" data-v="linear" class="${mv.ease === 'linear' ? 'on' : ''}">匀速</button><button type="button" data-v="smooth" class="${mv.ease === 'smooth' ? 'on' : ''}">缓入缓出</button></div></div>
                <div class="s3-keys2"><button type="button" class="s3-key${this.previewKey === 'start' ? ' on' : ''}" data-a="peek" data-v="start" title="在机位视角中查看起幅"><span>起幅</span><b class="num">${Math.round(mv.start.focal)}mm</b></button><span class="s3-key-arrow">→</span><button type="button" class="s3-key${this.previewKey === 'end' ? ' on' : ''}" data-a="peek" data-v="end" title="在机位视角中查看落幅"><span>落幅</span><b class="num">${Math.round(mv.end.focal)}mm</b></button></div>
                <div class="s3-row2"><button type="button" class="s3-btn sm" data-a="key-start" title="把当前机位姿态设为起幅">设为起幅</button><button type="button" class="s3-btn sm" data-a="key-end" title="把当前机位姿态设为落幅">设为落幅</button></div>
                <button type="button" class="s3-btn primary full${this.playing ? ' on' : ''}" data-a="play">${this.playing ? IC.stop : IC.play}<span>${this.playing ? '停止预览' : '预览运镜'}</span></button>
                <div class="s3-desc px-no-i18n" title="运镜描述（导出首尾帧时作为视频提示词）">${esc(desc)}</div>` : '<div class="s3-note dim">选择运镜预设后，机位当前姿态为起幅，自动计算落幅；也可选「自定义」分别设定起幅 / 落幅</div>'}
            <div class="s3-group-t">输出</div>
            <div class="s3-field"><div class="s3-seg full" data-g="res"><button type="button" data-v="1K" class="${this.res === '1K' ? 'on' : ''}">1K</button><button type="button" data-v="2K" class="${this.res === '2K' ? 'on' : ''}">2K</button></div></div>
            ${tgt ? `<button type="button" class="s3-toggle btn" data-a="link-toggle" aria-pressed="${this.link}"><span class="s3-switch${this.link ? ' on' : ''}"></span><span>截图同时连到</span><b class="px-no-i18n">${esc(tgt.name || '')}</b></button>` : ''}
            <div class="s3-row2"><button type="button" class="s3-btn" data-a="shot">${IC.camera}<span>截图到画布</span></button><button type="button" class="s3-btn" data-a="frames"${mv ? '' : ' disabled'}>${IC.frames}<span>导出首尾帧</span></button></div>
            <button type="button" class="s3-link" data-a="cam-from-view" title="把机位移动到当前导演视角的位置与朝向">${IC.target}<span>机位对齐到导演视角</span></button>
            <div class="s3-field"><label class="s3-label">位置（米）</label>${this._nums('cam.pos', c.pos, ['X', 'Y', 'Z'], 0.1)}</div>
            <div class="s3-field"><label class="s3-label">视线点（米）</label>${this._nums('cam.target', c.target, ['X', 'Y', 'Z'], 0.1)}</div>
        </div>`;
    }
    _refreshFields() {
        const box = this.el.querySelector('.s3-right');
        const s = this.sel;
        if (!s) return;
        const set = (f, v) => { const i = box.querySelector(`[data-f="${f}"]`); if (i && document.activeElement !== i) i.value = Math.round(v * 100) / 100; };
        if (s.kind === 'object') {
            const o = this._obj(s.id); if (!o) return;
            o.pos.forEach((v, i) => set('pos.' + i, v)); o.rot.forEach((v, i) => set('rot.' + i, v));
            if (s.joint && o.actor) { const jv = o.actor.pose[s.joint] || [0, 0, 0]; jv.forEach((v, i) => { set('joint.' + i, v); const r = box.querySelector(`[data-f="joint.${i}"]`); if (r) { r.style.setProperty('--pct', ((v + 180) / 360 * 100).toFixed(1) + '%'); const out = r.parentNode.querySelector('.s3-val'); if (out) out.textContent = Math.round(v) + '°'; } }); }
        } else if (s.kind === 'camera') {
            const c = this._cam(s.id); if (!c) return;
            c.pos.forEach((v, i) => set('cam.pos.' + i, v)); c.target.forEach((v, i) => set('cam.target.' + i, v));
        }
    }
    renderStrip() {
        const box = this.el.querySelector('.s3-strip');
        const st = this.stage;
        const keep = new Map();
        box.querySelectorAll('.s3-card[data-id]').forEach(el => keep.set(el.dataset.id, el.querySelector('canvas')));
        const html = st.cameras.map((c, i) => {
            const A = C.aspectNum(c.aspect);
            const H = 74, W = Math.min(150, Math.round(H * A));
            return `<div class="s3-card${c.id === st.activeCameraId ? ' on' : ''}" data-id="${esc(c.id)}" role="listitem">
                <button type="button" class="s3-card-main" data-a="cam-pick" data-id="${esc(c.id)}" title="${esc(c.name)} · ${Math.round(c.focal)}mm · ${c.aspect}（双击名称重命名）"><span class="s3-card-view" style="--w:${W}px"><span class="s3-cv-slot" data-slot="${esc(c.id)}"></span><span class="s3-card-no num">${i + 1}</span>${c.move ? `<span class="s3-card-mv">${esc(label(C.MOVES[c.move.preset]))}</span>` : ''}</span>
                <span class="s3-card-meta"><span class="s3-card-name px-no-i18n">${esc(c.name)}</span><span class="s3-dim num">${Math.round(c.focal)}mm · ${c.aspect}</span></span></button>
                <button type="button" class="s3-card-eye" data-a="cam-view" data-id="${esc(c.id)}" title="机位视角">${IC.eye}</button></div>`;
        }).join('') + (st.cameras.length < C.LIMITS.cameras ? `<button type="button" class="s3-card add" data-a="add-cam" title="以当前视角添加机位"><span>${IC.plus}</span><span>添加机位</span></button>` : '');
        box.innerHTML = html;
        st.cameras.forEach(c => {
            const slot = box.querySelector(`.s3-cv-slot[data-slot="${CSS.escape(c.id)}"]`);
            const A = C.aspectNum(c.aspect);
            const H = 74, W = Math.min(150, Math.round(H * A));
            const ch = Math.round(W / A);
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            let cv = keep.get(c.id);
            const tw = Math.round(W * dpr), th = Math.round(ch * dpr);
            if (!cv || cv.width !== tw || cv.height !== th) { cv = document.createElement('canvas'); cv.width = tw; cv.height = th; this.thumbs.set(c.id, { canvas: cv, stale: true }); }
            else if (!this.thumbs.get(c.id)) this.thumbs.set(c.id, { canvas: cv, stale: true });
            cv.style.width = W + 'px'; cv.style.height = ch + 'px';
            slot.replaceWith(cv);
            this.thumbs.get(c.id).canvas = cv;
        });
        Array.from(this.thumbs.keys()).forEach(id => { if (!this._cam(id)) this.thumbs.delete(id); });
    }
}
