/*!
 * FluidGlow — iridescent metaball bubbles rendered with a WebGL shader.
 * Copyright (c) 2026 Stéphane Drozdz — MIT License
 * Original: https://github.com/stephanezdz/fluidglow
 * Preserved as a vendored dependency; see LICENSE.
 */
(function (root) {
  'use strict';
  var DEFAULTS = {
    speed: 0.24, glow: 2.06, aura: 0.055, waveA: 0.0, waveB: 0.0, surfaceMotion: 0.0, fringe: 5.85, edge: 0.002,
    sat: 1.20, hueSpeed: 0.04, hueOff: 0.00,
    size: 1.35, spread: 1.70, incline: 0.42, body: 0.00,
    film: 0.30, light: 1.00, gamma: 1.60, merge: 0.17,
    zoom: 1.05, posX: 0.00, posY: 0.00, posZ: -0.02
  };
  var FRAG = [
    'precision highp float;',
    'uniform vec2 u_res;uniform float u_time,u_motionTime;',
    'uniform float u_glow,u_aura,u_waveA,u_waveB,u_surfaceMotion,u_fringe,u_edge,u_sat,u_hueSpeed,u_hueOff,u_size,u_spread,u_incline,u_body,u_film,u_light,u_gamma,u_merge,u_zoom,u_posX,u_posY,u_posZ;',
    'vec3 hue(float h){vec3 c=abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0;return clamp(c,0.0,1.0);}',
    'vec2 C[4];float R[4];',
    'float smin(float a,float b,float k){float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);return mix(b,a,h)-k*h*(1.0-h);}',
    // Deform each droplet BEFORE SDF smooth-union. Phase offsets keep four bodies
    // organic rather than moving in lockstep. Displacement stays bounded as
    // a fraction of radius, without shifting the droplet centres.
    // Constant indices avoid WebGL 1 array indexing restrictions in shader helpers.
    'float dropSdf(vec2 p,vec2 center,float radius,float id){',
    '  vec2 q=p-center;float a=atan(q.y,q.x);',
    // Independent ambient deformation; this is never bound to music.
    '  float organic=0.048*sin(2.0*a+u_motionTime*0.69+id*1.37)',
    '    +0.022*sin(4.0*a-u_motionTime*0.96-id*2.31);',
    '  float ripple=u_waveA*sin(3.0*a+id*1.71)+u_waveB*sin(5.0*a-id*1.13)+u_surfaceMotion*organic;',
    '  return length(q)-radius*(1.0+clamp(ripple,-0.12,0.12));}',
    'float scene(vec2 p){float k=max(u_merge,1e-4);',
    '  float d=dropSdf(p,C[0],R[0],0.0);',
    '  d=smin(d,dropSdf(p,C[1],R[1],1.0),k);',
    '  d=smin(d,dropSdf(p,C[2],R[2],2.0),k);',
    '  d=smin(d,dropSdf(p,C[3],R[3],3.0),k);return d;}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-0.5*u_res)/min(u_res.x,u_res.y);',
    '  uv=(uv-vec2(u_posX,u_posY))/max(u_zoom,0.05);',
    '  float t=u_time;float e=u_incline;float dz=1.0+u_posZ;',
    '  float a1=t*0.20,a2=-t*0.16+2.1,a3=t*0.34+1.0,a4=t*0.28+3.7;',
    '  C[0]=u_spread*0.11*vec2(cos(a1),sin(a1)*e);',
    '  C[1]=u_spread*0.15*vec2(cos(a2),sin(a2)*e);',
    '  C[2]=u_spread*0.27*vec2(cos(a3),sin(a3)*e);',
    '  C[3]=u_spread*0.31*vec2(cos(a4),sin(a4)*e);',
    '  float z1=sin(a1),z2=sin(a2),z3=sin(a3),z4=sin(a4);',
    '  R[0]=u_size*0.185*(0.82+0.18*z1)*dz;R[1]=u_size*0.160*(0.82+0.18*z2)*dz;',
    '  R[2]=u_size*0.085*(0.82+0.18*z3)*dz;R[3]=u_size*0.070*(0.82+0.18*z4)*dz;',
    '  float D=scene(uv);float eps=0.0022;',
    '  vec2 n=normalize(vec2(scene(uv+vec2(eps,0.0))-scene(uv-vec2(eps,0.0)),',
    '                        scene(uv+vec2(0.0,eps))-scene(uv-vec2(0.0,eps)))+vec2(1e-6));',
    '  float inside=1.0-smoothstep(-u_edge,u_edge,D);',
    '  float filmDepth=max(u_film*u_size*0.16,1e-3);',
    '  float ep=clamp(1.0+D/filmDepth,0.0,1.0);',
    '  float fres=inside*pow(ep,u_fringe);',
    '  float ang=atan(n.y,n.x);',
    '  float hh=fract(ang/6.28318+u_hueSpeed*t+u_hueOff);',
    '  vec3 rc=hue(hh);rc=mix(vec3(dot(rc,vec3(0.333))),rc,u_sat);',
    '  vec2 L=normalize(vec2(-0.45,0.9));',
    '  float lit=mix(1.0,clamp(dot(n,L)*0.5+0.5,0.0,1.0),u_light);',
    '  vec3 col=rc*fres*lit*u_glow+inside*u_body*vec3(0.006,0.008,0.014);',
    '  col=pow(max(col,0.0),vec3(u_gamma));',
    '  float halo=exp(-max(D,0.0)*23.0)*(1.0-inside);',
    '  vec3 auraColor=mix(vec3(0.10,0.17,0.24),rc,0.78);',
    '  col+=u_aura*halo*auraColor*0.68;',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');
  // Last-known-safe fallback: only the ripple is disabled.
  var FRAG_SAFE = FRAG.replace(
    'float ripple=u_waveA*sin(3.0*a+id*1.71)+u_waveB*sin(5.0*a-id*1.13)+u_surfaceMotion*organic;',
    'float ripple=0.0;'
  );
  var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

  function FluidGlow(options) {
    options = options || {};
    var P = {}, k;
    for (k in DEFAULTS) P[k] = (options[k] !== undefined) ? options[k] : DEFAULTS[k];
    var parent = options.parent || document.body;
    var canvas = options.canvas, created = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'fluidglow-canvas';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:' +
        (options.zIndex !== undefined ? options.zIndex : 0) + ';pointer-events:none;display:block';
      parent.insertBefore(canvas, parent.firstChild);
      created = true;
    }
    var gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) {
      canvas.style.background = '#000';
      return { ready: false, error: 'WebGL unavailable', setParams: function () {}, destroy: function () {} };
    }
    function compile(type, src) {
      var s = gl.createShader(type);
      if (!s) throw new Error('Unable to create shader');
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(s) || 'Unknown GLSL compilation error';
        gl.deleteShader(s);
        throw new Error(log);
      }
      return s;
    }
    function createProgram(fragmentSource) {
      var vertex = compile(gl.VERTEX_SHADER, VERT);
      var fragment;
      try { fragment = compile(gl.FRAGMENT_SHADER, fragmentSource); }
      catch (error) { gl.deleteShader(vertex); throw error; }
      var program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(program) || 'Unknown GLSL link error';
        gl.deleteProgram(program);
        throw new Error(log);
      }
      return program;
    }
    var prog, usingSafeShader = false;
    try {
      prog = createProgram(FRAG);
    } catch (error) {
      console.error('FluidGlow: elastic shader failed, trying safe shader:', error);
      try {
        prog = createProgram(FRAG_SAFE);
        usingSafeShader = true;
        console.warn('FluidGlow: safe shader loaded; animation ripple disabled.');
      } catch (fallbackError) {
        console.error('FluidGlow: cannot render:', fallbackError);
        return {
          ready: false,
          error: String(fallbackError.message || fallbackError),
          setParams: function () {}, destroy: function () {}
        };
      }
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uRes = gl.getUniformLocation(prog, 'u_res'),
        uTime = gl.getUniformLocation(prog, 'u_time'),
        uMotionTime = gl.getUniformLocation(prog, 'u_motionTime'), U = {};
    for (k in DEFAULTS) if (k !== 'speed') U[k] = gl.getUniformLocation(prog, 'u_' + k);
    var maxDpr = options.maxDpr || 1.5;
    function resize() {
      var d = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = (canvas.clientWidth || window.innerWidth) * d;
      canvas.height = (canvas.clientHeight || window.innerHeight) * d;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize); resize();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    var acc = 0, naturalTime = 0, last = performance.now(), raf = null, alive = true;
    function frame(now) {
      if (!alive) return;
      var dt = Math.min((now - last) / 1000, 0.05); last = now; acc += dt * P.speed; naturalTime += dt;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduce ? 8.0 : acc);
      if (uMotionTime !== null) gl.uniform1f(uMotionTime, naturalTime);
      for (var kk in U) gl.uniform1f(U[kk], P[kk]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      ready: true, safeMode: usingSafeShader, params: P,
      setParams: function (next) { for (var n in next) if (n in P) P[n] = next[n]; },
      destroy: function () {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        if (created && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }
  FluidGlow.defaults = DEFAULTS;
  root.FluidGlow = FluidGlow;
  var self = document.currentScript;
  if (self && self.hasAttribute('data-auto')) {
    var opts = {};
    try { opts = JSON.parse(self.getAttribute('data-params') || '{}'); } catch (e) {}
    if (document.body) FluidGlow(opts);
    else document.addEventListener('DOMContentLoaded', function () { FluidGlow(opts); });
  }
})(typeof window !== 'undefined' ? window : this);