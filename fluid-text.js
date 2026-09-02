/* ============================================================
 * Fluid Text — WebGL 流体文字（vanilla JS，零依赖）
 * 标题字形内部是一张实时流体画布：鼠标划过留下彩色颜料，
 * 移动越快搅动越猛，点击溅射一大团，随后缓缓扩散消散。
 * 结构：速度场 + 颜料场各一对 ping-pong FBO（经典 stable fluids 简化版），
 * 显示时用文字蒙版把颜料裁剪进字形。
 * 思路参考 Pavel Dobryakov 的 WebGL fluid simulation（MIT）。
 * 无 WebGL / prefers-reduced-motion 时自动回退为普通标题。
 * ============================================================ */
(function () {
  'use strict';

  var CONTAINER_ID = 'fluidHeroTitle';

  /* 颜料色板：随移动在色板间连续漂移混色 */
  var PALETTE = [
    [1.00, 0.42, 0.36], // 珊瑚红
    [1.00, 0.65, 0.35], // 暖橙
    [1.00, 0.85, 0.45], // 鹅黄
    [0.45, 0.82, 0.78], // 青碧
    [0.55, 0.62, 0.98]  // 雾蓝
  ];

  function root() { return document.getElementById(CONTAINER_ID); }
  if (!root()) return;

  var canvas = null, gl = null;
  var running = false, rafId = 0;
  var texW = 0, texH = 0;
  var velA = null, velB = null, dyeA = null, dyeB = null, maskFBO = null;
  var progAdvectVel = null, progAdvectDye = null, progSplatVel = null, progSplatDye = null, progDisplay = null;
  var quadBuf = null;
  var uniCache = {}, attrCache = {};
  var lastTime = 0;
  var hue = Math.random() * PALETTE.length;
  var fallbackDone = false;

  /* ---------- 基础 ---------- */
  function initGL() {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    root().insertBefore(canvas, root().firstChild);
    gl = canvas.getContext('webgl', { alpha: true, depth: false, stencil: false, antialias: false })
      || canvas.getContext('experimental-webgl', { alpha: true });
    return !!gl;
  }

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function program(fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  var VS = [
    'precision highp float;',
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  /* 速度场自平流 + 衰减。速度编码：RG = v*0.5+0.5 */
  var FS_ADVECT_VEL = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uField;',
    'uniform vec2 uTexel;',
    'uniform float uDt;',
    'void main(){',
    '  vec2 v = texture2D(uField, vUv).xy * 2.0 - 1.0;',
    '  vec2 coord = vUv - v * uDt * uTexel * 24.0;',
    '  vec2 carried = texture2D(uField, coord).xy * 2.0 - 1.0;',
    '  gl_FragColor = vec4((carried * 0.985) * 0.5 + 0.5, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* 颜料沿速度场平流 + 缓慢消散 */
  var FS_ADVECT_DYE = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uDye;',
    'uniform sampler2D uVel;',
    'uniform vec2 uTexel;',
    'uniform float uDt;',
    'void main(){',
    '  vec2 v = texture2D(uVel, vUv).xy * 2.0 - 1.0;',
    '  vec2 coord = vUv - v * uDt * uTexel * 42.0;',
    '  vec4 c = texture2D(uDye, coord);',
    '  gl_FragColor = vec4(c.rgb / 1.004, 1.0);',
    '}'
  ].join('\n');

  /* splat：注入速度（移动方向） */
  var FS_SPLAT_VEL = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform vec2 uPoint;',
    'uniform vec2 uForce;',
    'uniform float uRadius;',
    'uniform float uAspect;',
    'void main(){',
    '  vec2 d = vUv - uPoint;',
    '  d.x *= uAspect;',
    '  float g = exp(-dot(d, d) / uRadius);',
    '  vec2 v = texture2D(uTarget, vUv).xy * 2.0 - 1.0;',
    '  v += g * uForce;',
    '  v = clamp(v, vec2(-1.0), vec2(1.0));',
    '  gl_FragColor = vec4(v * 0.5 + 0.5, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* splat：注入颜料 */
  var FS_SPLAT_DYE = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform vec2 uPoint;',
    'uniform vec3 uColor;',
    'uniform float uRadius;',
    'uniform float uAspect;',
    'void main(){',
    '  vec2 d = vUv - uPoint;',
    '  d.x *= uAspect;',
    '  float g = exp(-dot(d, d) / uRadius);',
    '  vec3 base = texture2D(uTarget, vUv).rgb;',
    '  gl_FragColor = vec4(min(base + g * uColor, vec3(2.0)), 1.0);',
    '}'
  ].join('\n');

  /* 显示：颜料裁进字形；未上色处显示底色（白） */
  var FS_DISPLAY = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uDye;',
    'uniform sampler2D uMask;',
    'void main(){',
    '  float m = texture2D(uMask, vUv).r;',
    '  vec3 dye = texture2D(uDye, vUv).rgb;',
    '  float lum = max(dye.r, max(dye.g, dye.b));',
    '  vec3 col = mix(vec3(1.0), dye / max(lum, 0.0001), clamp(lum * 1.5, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, m);',
    '}'
  ].join('\n');

  function u(prog, name) {
    uniCache[prog] = uniCache[prog] || {};
    if (!(name in uniCache[prog])) uniCache[prog][name] = gl.getUniformLocation(prog, name);
    return uniCache[prog][name];
  }

  function bindQuad(prog) {
    attrCache[prog] = attrCache[prog] || {};
    if (attrCache[prog].aPos === undefined) {
      attrCache[prog].aPos = gl.getAttribLocation(prog, 'aPos');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(attrCache[prog].aPos);
    gl.vertexAttribPointer(attrCache[prog].aPos, 2, gl.FLOAT, false, 0, 0);
  }

  function setupQuad() {
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
  }

  /* ---------- FBO ---------- */
  function createFBO(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: fbo, texelX: 1 / w, texelY: 1 / h };
  }

  function destroyFBO(f) {
    if (!f) return;
    gl.deleteFramebuffer(f.fbo);
    gl.deleteTexture(f.tex);
  }

  function ensureBuffers() {
    var rect = root().getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scale = 0.5; // 模拟分辨率减半，省 GPU
    texW = Math.max(2, Math.floor(rect.width * dpr * scale));
    texH = Math.max(2, Math.floor(rect.height * dpr * scale));
    canvas.width = texW;
    canvas.height = texH;

    destroyFBO(velA); destroyFBO(velB); destroyFBO(dyeA); destroyFBO(dyeB); destroyFBO(maskFBO);
    velA = createFBO(texW, texH);
    velB = createFBO(texW, texH);
    dyeA = createFBO(texW, texH);
    dyeB = createFBO(texW, texH);
    maskFBO = createFBO(texW, texH);
    drawMask();
  }

  /* ---------- 文字蒙版：离屏 2D canvas 画字形再上传 ---------- */
  function drawMask() {
    if (!maskFBO || !texW) return;
    var off = document.createElement('canvas');
    off.width = texW;
    off.height = texH;
    var ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, texW, texH);

    var text = '';
    try {
      var walker = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim()) {
          text = walker.currentNode.textContent.trim();
          break;
        }
      }
    } catch (e) { /* ignore */ }
    if (!text) text = 'STUDIO';

    var cs = window.getComputedStyle(root());
    var fontSize = parseFloat(cs.fontSize) || 64;
    ctx.font = (cs.fontWeight || '400') + ' ' + fontSize + 'px ' + (cs.fontFamily || 'Georgia, serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, texW / 2, texH / 2);

    gl.bindTexture(gl.TEXTURE_2D, maskFBO.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /* ---------- 渲染循环 ---------- */
  function advect(prog, srcFBO, dstFBO, secondTex) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO.fbo);
    gl.viewport(0, 0, texW, texH);
    gl.useProgram(prog);
    bindQuad(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcFBO.tex);
    gl.uniform1i(u(prog, prog === progAdvectDye ? 'uDye' : 'uField'), 0);
    if (prog === progAdvectDye) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, secondTex.tex);
      gl.uniform1i(u(prog, 'uVel'), 1);
    }
    gl.uniform2f(u(prog, 'uTexel'), srcFBO.texelX, srcFBO.texelY);
    gl.uniform1f(u(prog, 'uDt'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  function frame(time) {
    if (!running) return;
    lastTime = time;

    advect(progAdvectVel, velA, velB, null);
    var t = velA; velA = velB; velB = t;

    advect(progAdvectDye, dyeA, dyeB, velA);
    t = dyeA; dyeA = dyeB; dyeB = t;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, texW, texH);
    gl.useProgram(progDisplay);
    bindQuad(progDisplay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dyeA.tex);
    gl.uniform1i(u(progDisplay, 'uDye'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskFBO.tex);
    gl.uniform1i(u(progDisplay, 'uMask'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);

    rafId = requestAnimationFrame(frame);
  }

  /* ---------- 交互 ---------- */
  var lastPointer = null;

  function paletteColor() {
    hue = (hue + 0.15) % PALETTE.length;
    var i = Math.floor(hue);
    var f = hue - i;
    var a = PALETTE[i % PALETTE.length];
    var b = PALETTE[(i + 1) % PALETTE.length];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX || 0) - rect.left) / rect.width,
      y: 1 - ((e.clientY || 0) - rect.top) / rect.height
    };
  }

  function splat(x, y, dx, dy, big) {
    if (!gl || !velA || !dyeA) return;

    // 速度注入
    gl.bindFramebuffer(gl.FRAMEBUFFER, velB.fbo);
    gl.viewport(0, 0, texW, texH);
    gl.useProgram(progSplatVel);
    bindQuad(progSplatVel);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velA.tex);
    gl.uniform1i(u(progSplatVel, 'uTarget'), 0);
    gl.uniform2f(u(progSplatVel, 'uPoint'), x, y);
    gl.uniform2f(u(progSplatVel, 'uForce'), dx * (big ? 60 : 30), -dy * (big ? 60 : 30));
    gl.uniform1f(u(progSplatVel, 'uRadius'), big ? 0.004 : 0.002);
    gl.uniform1f(u(progSplatVel, 'uAspect'), texW / texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
    var t = velA; velA = velB; velB = t;

    // 颜料注入
    var c = paletteColor();
    var boost = big ? 0.9 : 0.35;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dyeB.fbo);
    gl.viewport(0, 0, texW, texH);
    gl.useProgram(progSplatDye);
    bindQuad(progSplatDye);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dyeA.tex);
    gl.uniform1i(u(progSplatDye, 'uTarget'), 0);
    gl.uniform2f(u(progSplatDye, 'uPoint'), x, y);
    gl.uniform3f(u(progSplatDye, 'uColor'), c[0] * boost, c[1] * boost, c[2] * boost);
    gl.uniform1f(u(progSplatDye, 'uRadius'), big ? 0.003 : 0.0012);
    gl.uniform1f(u(progSplatDye, 'uAspect'), texW / texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
    t = dyeA; dyeA = dyeB; dyeB = t;
  }

  function onPointerMove(e) {
    var p = pointerPos(e);
    if (lastPointer) {
      splat(p.x, p.y, p.x - lastPointer.x, p.y - lastPointer.y, false);
    } else {
      splat(p.x, p.y, 0, 0, false);
    }
    lastPointer = p;
  }

  function onPointerDown(e) {
    var p = pointerPos(e);
    splat(p.x, p.y, 0, 0, true);
  }

  function onPointerLeave() { lastPointer = null; }

  /* ---------- 生命周期 ---------- */
  function start() {
    if (running || !gl || document.hidden) return;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function fallback() {
    if (fallbackDone) return;
    fallbackDone = true;
    stop();
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    root().classList.add('fluid-fallback');
  }

  var resizeTimer = 0;
  function onResize() {
    if (!gl) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      try { ensureBuffers(); } catch (e) { fallback(); }
    }, 200);
  }

  function rebuildGL() {
    uniCache = {}; attrCache = {};
    setupQuad();
    progAdvectVel = program(FS_ADVECT_VEL);
    progAdvectDye = program(FS_ADVECT_DYE);
    progSplatVel = program(FS_SPLAT_VEL);
    progSplatDye = program(FS_SPLAT_DYE);
    progDisplay = program(FS_DISPLAY);
    ensureBuffers();
  }

  function bindEvents() {
    root().addEventListener('pointermove', onPointerMove, { passive: true });
    root().addEventListener('pointerdown', onPointerDown, { passive: true });
    root().addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('resize', onResize);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !document.hidden) start(); else stop();
        });
      }, { threshold: 0.05 }).observe(root());
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stop();
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      try { rebuildGL(); start(); } catch (e) { fallback(); }
    }, false);
  }

  function init() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return fallback();
    }
    try {
      if (!initGL()) return fallback();
      rebuildGL();
      bindEvents();
      start();
      root().classList.add('fluid-on');
    } catch (e) {
      fallback();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
