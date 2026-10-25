/* FluidGlow Audio: coaxial plano-convex lenses + spectral wavefronts. MIT.
 * Dependency-free WebGL 1 / GLSL ES 1.00. Legacy FluidGlow remains vendored.
 */
(function (root) {
  'use strict';
  const DEFAULTS = Object.freeze({
    size: 1, spread: 1, incline: -.97, rotation: .48, thickness: .50, bandWidth: 2.6,
    reflection: .5, opacity: .48, glow: 1.35, aura: .20, roughness: .13, edgeGlow: 1.25,
    interReflection: .70, fresnelEdge: .85, edgeSat: .18, midMotion: 2.0, highMotion: 2.25,
    sat: 1.05, light: 1, gamma: 1.15, speed: .24, surfaceMotion: 0,
    rippleSpeed: .78, rippleLife: 3.4, rippleHeight: .78, rippleGrowth: .80, rippleRise: .20,
    zoom: 1, posX: 0, posY: .08, motionGain: .70
  });
  const INITIAL_PALETTE = {
    a: [.953, .824, .655], b: [.749, .525, .427],
    c: [.604, .380, .341], bg: [.031, .020, .027], mode: 1
  };
  const MAX_RIPPLES = 6, ANGLES = 576, LANES = 16;
  const VERT = `
    attribute vec3 a_position, a_normal;
    uniform vec2 u_res, u_pan;
    uniform mediump vec3 u_diskX, u_diskZ, u_axisY;
    uniform float u_zoom, u_radius, u_depth, u_thickness;
    varying vec3 v_normal, v_local, v_position;
    void main() {
      vec3 local = vec3(a_position.xy * u_radius, a_position.z * u_thickness);
      // Scene +Y runs from the large lens to the small lens. The flat face
      // is at depth, and the convex face extends toward scene -Y.
      vec3 world = u_diskX * local.x + u_diskZ * local.y + u_axisY * (u_depth - local.z);
      v_position = world;
      v_local = a_position;
      v_normal = normalize(u_diskX * a_normal.x * u_thickness / u_radius
        + u_diskZ * a_normal.y * u_thickness / u_radius - u_axisY * a_normal.z);
      vec2 p = (world.xy + u_pan) * u_zoom;
      gl_Position = vec4(p * min(u_res.x, u_res.y) / u_res, -world.z * .12, 1.0);
    }`;
  const FRAG = `
    precision highp float;
    uniform vec3 u_paletteA, u_paletteB, u_paletteC;
    uniform mediump vec3 u_diskX, u_diskZ, u_axisY;
    uniform vec3 u_lensData0,u_lensData1,u_lensData2;
    uniform float u_paletteMode, u_time, u_reflection, u_opacity, u_glow,
      u_roughness, u_sat, u_light, u_gamma, u_energy, u_surfaceMotion, u_surface, u_bandWidth,
      u_edgeGlow, u_frontSurface, u_lensIndex, u_interReflection, u_fresnelEdge, u_edgeSat;
    varying vec3 v_normal, v_local, v_position;
    // Analytic unlit studio: reflected view rays intersect finite virtual
    // softbox panels. No image texture, UV-painted stripe, or scene light API.
    vec3 sceneVector(vec3 v) {
      return vec3(dot(v,u_diskX),dot(v,u_axisY),dot(v,u_diskZ));
    }
    vec3 guideTint() {
      vec3 tint=mix(u_paletteB,u_paletteA,.40);
      return mix(vec3(dot(tint,vec3(.299,.587,.114))),tint,u_edgeSat);
    }
    vec2 studioBarsLocal(vec3 p,vec3 r,float curved) {
      if (abs(r.y) < .025) return vec2(0.0);
      float t = (sign(r.y) * 2.8 - p.y) / r.y;
      if (t <= 0.0) return vec2(0.0);
      vec3 hit = p + r * t;
      float endFade = 1.0 - smoothstep(3.2,4.4,abs(hit.x));
      float drift = .10 * sin(u_time*.12) * u_surfaceMotion;
      float curveWidth = mix(1.0,2.4,curved);
      float roseWidth = (.12*u_bandWidth + .20*u_roughness)*curveWidth;
      float whiteWidth = (.07*u_bandWidth + .12*u_roughness)*curveWidth;
      return endFade * vec2(exp(-.5*pow((abs(hit.z)-4.55-drift)/roseWidth,2.0)),
        exp(-.5*pow((abs(hit.z)-3.55)/whiteWidth,2.0)));
    }
    // Exact one-bounce intersections with the same scaled spherical cap,
    // flat disk and cylindrical sidewall used by the rasterized lens mesh.
    void keepHit(float t,vec3 normal,float kind,inout vec4 hit,inout float part) {
      if(t>.003&&t<hit.x){hit=vec4(t,normalize(normal));part=kind;}
    }
    void traceLens(vec3 p,vec3 d,vec3 lens,inout vec4 hit,inout float part,inout vec3 picked) {
      float radius=lens.x,flatY=lens.y,thick=lens.z;
      vec3 oc=p-vec3(0.0,flatY-thick*.5,0.0);
      float bound=radius*radius+thick*thick*.25;
      float projection=dot(oc,d);
      if(projection*projection-dot(oc,oc)+bound<0.0)return;
      if(projection>0.0&&dot(oc,oc)>bound)return;
      float before=hit.x;
      if(abs(d.y)>.0001){
        float t=(flatY-p.y)/d.y;vec3 q=p+d*t;
        if(dot(q.xz,q.xz)<=radius*radius)keepHit(t,vec3(0.0,1.0,0.0),1.0,hit,part);
      }
      const float sag=.38,edge=.20;
      const float sphere=(1.0+sag*sag)/(2.0*sag),stretch=sag/(1.0-edge);
      vec3 q=vec3(p.x/radius,((flatY-p.y)/thick-edge)*stretch+sphere-sag,p.z/radius);
      vec3 v=vec3(d.x/radius,-d.y/thick*stretch,d.z/radius);
      float a=dot(v,v),b=dot(q,v),c=dot(q,q)-sphere*sphere;
      float disc=b*b-a*c;
      if(disc>=0.0){
        float root=sqrt(disc);
        for(int k=0;k<2;k++){
          float t=(-b+(k==0?-root:root))/a;vec3 h=q+v*t;
          if(h.y>=sphere-sag-.0001&&dot(h.xz,h.xz)<=1.0001)
            keepHit(t,vec3(h.x/radius,-h.y/thick*stretch,h.z/radius),0.0,hit,part);
        }
      }
      a=dot(d.xz,d.xz);b=dot(p.xz,d.xz);c=dot(p.xz,p.xz)-radius*radius;
      disc=b*b-a*c;
      if(a>.0001&&disc>=0.0){
        float root=sqrt(disc);
        for(int k=0;k<2;k++){
          float t=(-b+(k==0?-root:root))/a;vec3 h=p+d*t;
          if(h.y<=flatY&&h.y>=flatY-edge*thick)keepHit(t,vec3(h.x,0.0,h.z),2.0,hit,part);
        }
      }
      if(hit.x<before)picked=lens;
    }
    vec4 neighborReflection(vec3 p,vec3 d) {
      vec4 hit=vec4(1000.0,0.0,1.0,0.0);float part=0.0;vec3 picked=vec3(1.0,0.0,.5);
      if(abs(u_lensIndex-0.0)>.1)traceLens(p,d,u_lensData0,hit,part,picked);
      if(abs(u_lensIndex-1.0)>.1)traceLens(p,d,u_lensData1,hit,part,picked);
      if(abs(u_lensIndex-2.0)>.1)traceLens(p,d,u_lensData2,hit,part,picked);
      if(hit.x>999.0)return vec4(0.0);
      vec3 point=p+d*hit.x,n=hit.yzw;
      vec2 bars=studioBarsLocal(point,reflect(d,n),1.0-step(.5,part));
      float fr=.04+.96*pow(1.0-abs(dot(n,-d)),5.0);
      float rim=smoothstep(.89,.995,length(point.xz)/picked.x);
      vec3 color=u_paletteC*.07+(u_paletteB*bars.x*.85
        +mix(u_paletteA,vec3(1.0),.7)*bars.y*.95)*u_light+guideTint()*rim*.60*u_edgeGlow;
      if(part>1.5)color=guideTint()*(.65+.35*fr)*u_edgeGlow;
      float coverage=(.14+.35*fr+.28*rim+.25*max(bars.x,bars.y))/(1.0+.10*hit.x*hit.x);
      return vec4(color,coverage);
    }
    void main() {
      vec3 n = normalize(v_normal);
      vec3 view = vec3(0.0,0.0,1.0); // Correct for our orthographic camera.
      if (dot(n,view) < 0.0) n = -n;
      float fresnel = pow(1.0 - abs(n.z), 3.0);
      vec3 p=sceneVector(v_position),ray=sceneVector(reflect(-view,n));
      // One primary pair per lens. The far transparent face must not add
      // the narrow ghost pair visible through the near face in v2.2.
      vec2 bars = abs(u_surface-u_frontSurface) < .5
        ? studioBarsLocal(p,ray,1.0-step(.5,u_surface)) : vec2(0.0);
      float warm = bars.x, cool = bars.y;
      vec3 tint = u_paletteB;
      if (u_paletteMode < .5) tint = .55 + .45 * cos(vec3(0.0, 2.1, 4.2) + n.y * 3.0 + n.x * 2.0);
      vec3 col = u_paletteC*(.025+.08*fresnel)
        + (tint*warm*.95 + mix(u_paletteA,vec3(1.0),.70)*cool*1.05)*u_light;
      col = mix(vec3(dot(col, vec3(.299, .587, .114))), col, u_sat);
      col *= u_glow * (1.0 + u_energy * .30);
      float alpha = u_opacity * (.07 + fresnel * .25)
        + u_reflection * (warm * 1.15 + cool * 1.5)*u_light;
      if(u_surface<1.5&&abs(u_surface-u_frontSurface)<.5&&u_interReflection>.001){
        vec4 other=neighborReflection(p+ray*.004,ray);
        float amount=u_interReflection*other.a*(.5+.5*u_reflection);
        col=mix(col,other.rgb*u_glow,amount);alpha+=amount*.35;
      }
      // A micro-bevel gives the flat face an angularly varying normal only
      // at its edge. Its Fresnel highlight travels around the rim on orbit.
      if(u_surface>.5&&u_surface<1.5&&u_fresnelEdge>.001){
        float rho=length(v_local.xy);
        float bevel=smoothstep(.955,1.0,rho);
        vec3 radial=normalize(u_diskX*v_local.x+u_diskZ*v_local.y+u_axisY*.00001);
        vec3 bn=normalize(u_axisY*(1.0-.80*bevel)+radial*.85*bevel);
        float fr=.04+.96*pow(1.0-abs(dot(bn,view)),5.0);
        float edge=smoothstep(.980,.994,rho);
        float strength=u_fresnelEdge*edge*(.06+.94*fr);
        col+=mix(u_paletteA,vec3(1.0),.75)*strength*1.10;
        alpha+=strength*.80;
      }
      // Guide light fills the cylindrical sidewall, brightest through its
      // thickness. Face boundaries no longer have separate glowing circles.
      if (u_surface > 1.5) {
        float across = clamp(v_local.z/.20,0.0,1.0);
        float guide = u_edgeGlow*(.55+.45*sin(across*3.14159265))*(.70+.30*fresnel);
        col = guideTint()*guide*(1.0+.16*u_energy);
        alpha = u_opacity*(.35+.40*guide);
      }
      if (u_surface > 2.5) {
        alpha = (u_surface < 3.5 ? .09 : .04)*u_edgeGlow;
      }
      gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(u_gamma)), clamp(alpha, 0.0, .90));
    }`;
  const PARTICLE_VERT = `
    attribute vec2 a_circle;
    attribute float a_lane, a_seed, a_height;
    uniform vec2 u_res, u_pan;
    uniform vec3 u_diskX, u_diskZ, u_axisY;
    uniform float u_zoom, u_age, u_life, u_speed, u_radius, u_depth,
      u_height, u_growth, u_rise, u_strength, u_dpr;
    varying float v_alpha, v_seed;
    void main() {
      float life = clamp(u_age / u_life, 0.0, 1.0);
      float travel = u_age * u_speed;
      float radius = u_radius + travel + a_lane * (.035 + life * .22);
      float crest = sin(a_lane * 3.14159265);
      // Both the ring's baseline and its captured FFT profile grow along +Y
      // as it expands. Only opacity decays; axial height never collapses.
      float height = travel * u_rise
        + a_height * u_height * u_strength * crest * (1.0 + travel * u_growth);
      vec3 world = (u_diskX * a_circle.x + u_diskZ * a_circle.y) * radius
        + u_axisY * (u_depth + height);
      vec2 p = (world.xy + u_pan) * u_zoom;
      gl_Position = vec4(p * min(u_res.x, u_res.y) / u_res, -world.z * .12, 1.0);
      gl_PointSize = (1.0 + a_seed * 1.4) * u_dpr;
      v_alpha = pow(1.0 - life, 1.65) * smoothstep(0.0, .07, u_age)
        * (.25 + .75 * crest) * (.4 + a_seed * .6) * u_strength;
      v_seed = a_seed;
    }`;
  const PARTICLE_FRAG = `
    precision mediump float;
    uniform vec3 u_paletteA, u_paletteB;
    uniform float u_aura;
    varying float v_alpha, v_seed;
    void main() {
      float d = length(gl_PointCoord - vec2(.5)) * 2.0;
      float alpha = (1.0 - smoothstep(.12, 1.0, d)) * v_alpha;
      gl_FragColor = vec4(mix(u_paletteB, u_paletteA, v_seed * .35) * (1.03 + u_aura * .25), alpha*.78);
    }`;
  function copyPalette(value) {
    const result = {};
    for (const k of ['a', 'b', 'c', 'bg']) result[k] = (value[k] || INITIAL_PALETTE[k]).slice();
    result.mode = value.mode === undefined ? 1 : value.mode;
    return result;
  }
  function LensRenderer(options = {}) {
    const P = { ...DEFAULTS };
    for (const k in P) if (Number.isFinite(options[k])) P[k] = options[k];
    const canvas = options.canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    const noop = () => {};
    const unavailable = { ready: false, setParams: noop, setPalette: noop,
      setAudio: noop, kick: noop, clearMotion: noop, emitRipple: noop, clearRipples: noop, setRipplesEnabled: noop, resetView: noop, destroy: noop };
    if (!gl) return unavailable;
    const programs = [], buffers = [];
    function program(vertexSource, fragmentSource) {
      const shaders = [], p = gl.createProgram();
      try {
        for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
          const s = gl.createShader(type); shaders.push(s);
          gl.shaderSource(s, source); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      } catch (error) { gl.deleteProgram(p); throw error; }
      finally { shaders.forEach(s => gl.deleteShader(s)); }
      programs.push(p); return { handle: p, uniforms: {}, attributes: {} };
    }
    let lensProgram, particleProgram;
    try {
      const highp=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      lensProgram=program(VERT,highp&&highp.precision?FRAG:FRAG.replace('precision highp float','precision mediump float'));
      particleProgram=program(PARTICLE_VERT,PARTICLE_FRAG);
    }
    catch (error) {
      programs.forEach(p => gl.deleteProgram(p));
      console.error('FluidGlow lens shader:', error);
      unavailable.error = String(error.message || error); return unavailable;
    }
    function buffer(data) {
      const b = gl.createBuffer(); buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b;
    }
    // Plane at scene Y=0, convex cap at negative Y, and an actual cylindrical
    // sidewall. The edge keeps 20% of the center thickness at all settings.
    const segments = 128, rings = 32, cap = [], back = [], side = [];
    const sag = .38, sphere = (1 + sag * sag) / (2 * sag), edge = .20;
    function capVertex(r, a) {
      const x = r * Math.cos(a), y = r * Math.sin(a);
      const z = Math.sqrt(sphere * sphere - r * r);
      return [x, y, (1 - edge) * (z - (sphere - sag)) / sag + edge,
        x * (1 - edge) / sag, y * (1 - edge) / sag, z];
    }
    for (let ring = 0; ring < rings; ring++) for (let j = 0; j < segments; j++) {
      const a = j / segments * Math.PI * 2, b = (j + 1) / segments * Math.PI * 2;
      const r0 = ring / rings, r1 = (ring + 1) / rings;
      cap.push(...capVertex(r0, a), ...capVertex(r1, a), ...capVertex(r1, b),
        ...capVertex(r0, a), ...capVertex(r1, b), ...capVertex(r0, b));
      if (ring === 0) {
        back.push(0, 0, 0, 0, 0, -1, Math.cos(a), Math.sin(a), 0, 0, 0, -1, Math.cos(b), Math.sin(b), 0, 0, 0, -1);
        const sa = [Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 0];
        const sb = [Math.cos(b), Math.sin(b), 0, Math.cos(b), Math.sin(b), 0];
        const sc = sa.slice(), sd = sb.slice(); sc[2] = edge; sd[2] = edge;
        side.push(...sa, ...sc, ...sd, ...sa, ...sd, ...sb);
      }
    }
    const capBuffer = buffer(new Float32Array(cap)), backBuffer = buffer(new Float32Array(back)),
      sideBuffer = buffer(new Float32Array(side));
    const ripples = Array.from({ length: MAX_RIPPLES }, () => ({
      buffer: buffer(new Float32Array(ANGLES * LANES * 5)),
      data: new Float32Array(ANGLES * LANES * 5), age: Infinity, life: 0
    }));
    const audio = { bass: 0, mid: 0, high: 0 }, levels = { ...audio };
    const springs = Array.from({ length: 3 }, () => ({ x: 0, v: 0, energy: 0 }));
    function clearMotion() { springs.forEach(s => { s.x = s.v = s.energy = 0; }); }
    function kick(impulses = {}) {
      if (reduce || P.motionGain <= 0) return;
      ['bass','mid','high'].forEach((band,i) => {
        const strength=Math.max(0,Number(impulses[band])||0);
        springs[i].v = Math.min(.9, springs[i].v + strength*1.15);
        springs[i].energy=Math.max(springs[i].energy,strength);
      });
    }
    const depths = [0, 0, 0], radii = [1, .76, .54];
    let ripplesEnabled = true;
    const currentPalette = copyPalette(options.palette || INITIAL_PALETTE);
    let targetPalette = copyPalette(currentPalette);
    const media = window.matchMedia('(prefers-reduced-motion:reduce)');
    let reduce = media.matches, dpr = 1, alive = true, raf, last = performance.now(), time = 0;
    const basisU = [1, 0, 0], basisV = [0, 1, 0], axisY = [0, 0, 1];
    // A separate camera quaternion rotates the whole scene. Audio changes
    // only axial positions, never the camera or the shared scene Y axis.
    const view = [0, 0, 0, 1];
    let drag = null;
    function multiplyQuaternion(a, b) {
      return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
        a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
        a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
        a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    }
    function orbit(dx, dy) {
      const yaw = dx * .003, pitch = dy * .003;
      const delta = multiplyQuaternion([0, Math.sin(yaw), 0, Math.cos(yaw)],
        [Math.sin(pitch), 0, 0, Math.cos(pitch)]);
      const next = multiplyQuaternion(delta, view), length = Math.hypot(...next);
      view.splice(0, 4, ...next.map(v => v / length));
    }
    function rotateVector(out, x, y, z) {
      const [qx, qy, qz, qw] = view;
      const tx = 2 * (qy*z-qz*y), ty = 2 * (qz*x-qx*z), tz = 2 * (qx*y-qy*x);
      out.splice(0, 3, x + qw*tx + qy*tz-qz*ty,
        y + qw*ty + qz*tx-qx*tz, z + qw*tz + qx*ty-qy*tx);
    }
    function finishDrag(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const id = drag.id; drag = null; canvas.classList.remove('is-orbiting');
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function pointerDown(event) {
      if (drag || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-orbiting');
      canvas.focus({ preventScroll: true });
    }
    function pointerMove(event) {
      if (!drag || event.pointerId !== drag.id) return;
      orbit(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX; drag.y = event.clientY;
    }
    function resetView() { finishDrag(); view.splice(0, 4, 0, 0, 0, 1); }
    function keyDown(event) {
      const steps = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
      if (event.key === 'Home') { event.preventDefault(); resetView(); }
      else if (event.key in steps) { event.preventDefault(); orbit(...steps[event.key]); }
    }
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, finishDrag);
    canvas.addEventListener('dblclick', resetView); canvas.addEventListener('keydown', keyDown);
    function clearRipples() { ripples.forEach(r => { r.age = Infinity; }); }
    function motionChanged() { reduce = media.matches; clearRipples(); clearMotion(); }
    media.addEventListener('change', motionChanged);
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, options.maxDpr || 1.5);
      canvas.width = Math.max(1, Math.round((canvas.clientWidth || 1) * dpr));
      canvas.height = Math.max(1, Math.round((canvas.clientHeight || 1) * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(canvas);
    window.addEventListener('resize', resize); resize();
    function location(p, name) {
      if (!(name in p.uniforms)) p.uniforms[name] = gl.getUniformLocation(p.handle, 'u_' + name);
      return p.uniforms[name];
    }
    function f(p, name, value) { gl.uniform1f(location(p, name), value); }
    function v3(p, name, value) { gl.uniform3fv(location(p, name), value); }
    function common(p) {
      gl.useProgram(p.handle);
      // Reset vertex arrays when moving between the particle and mesh layouts.
      for (let i = 0; i < 5; i++) gl.disableVertexAttribArray(i);
      gl.uniform2f(location(p, 'res'), canvas.width, canvas.height);
      const compact = canvas.clientWidth < 600 && canvas.clientHeight < 600;
      gl.uniform2f(location(p, 'pan'), P.posX, P.posY + (compact ? .15 : 0));
      f(p, 'zoom', .64 * P.zoom * (compact ? .88 : 1) * Math.min(1, canvas.width / canvas.height * 1.15));
      v3(p, 'diskX', basisU); v3(p, 'diskZ', basisV); v3(p, 'axisY', axisY);
      for (const key of ['a', 'b', 'c']) v3(p, 'palette' + key.toUpperCase(), currentPalette[key]);
    }
    function attribute(p, name, size, stride, offset) {
      if (!(name in p.attributes)) p.attributes[name] = gl.getAttribLocation(p.handle, name);
      const a = p.attributes[name];
      if (a >= 0) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, stride, offset); }
    }
    function mesh(b, count, mode) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      attribute(lensProgram, 'a_position', 3, 24, 0); attribute(lensProgram, 'a_normal', 3, 24, 12);
      gl.drawArrays(mode, 0, count);
    }
    function emitRipple(samples, strength) {
      if (reduce || !ripplesEnabled || !samples?.length || !(strength > 0)) return;
      const r = ripples.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest);
      r.age = 0; r.bornAt=performance.now();r.strength = Math.max(.1, Math.min(1.4, strength));
      r.depth = depths[0]-P.thickness*radii[0]*P.size;
      r.radius = radii[0] * P.size;
      r.life = P.rippleLife; r.speed = P.rippleSpeed; r.height = P.rippleHeight;
      r.growth = P.rippleGrowth; r.rise = P.rippleRise; r.maxSample = 0;
      // Capture the FFT at impact; later audio cannot rewrite a travelling ring.
      let at = 0;
      for (let lane = 0; lane < LANES; lane++) for (let j = 0; j < ANGLES; j++) {
        const angle = j / ANGLES * Math.PI * 2;
        // Mirror the logarithmic spectrum for a continuous low/high seam.
        const index = (1 - Math.abs(j / ANGLES * 2 - 1)) * (samples.length - 1);
        const lo = Math.floor(index), hi = Math.min(lo + 1, samples.length - 1);
        const height = samples[lo] + (samples[hi] - samples[lo]) * (index - lo);
        r.data[at++] = Math.cos(angle); r.data[at++] = Math.sin(angle);
        r.data[at++] = lane / (LANES - 1);
        r.data[at++] = ((j * 73 + lane * 37) % 211) / 211;
        const captured = Math.max(0, Math.min(1, height));
        r.data[at++] = captured; r.maxSample = Math.max(r.maxSample, captured);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, r.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, r.data);
    }
    function frame(now) {
      if (!alive) return;
      const wallDt=Math.max(0,(now-last)/1000),dt=Math.min(wallDt,.10);last=now;
      if (!reduce) time += dt * P.speed;
      const ease = 1 - Math.exp(-dt / .4);
      for (const key of ['a', 'b', 'c', 'bg']) for (let ch = 0; ch < 3; ch++)
        currentPalette[key][ch] += (targetPalette[key][ch] - currentPalette[key][ch]) * ease;
      currentPalette.mode += (targetPalette.mode - currentPalette.mode) * ease;
      for (const band in levels) {
        if (reduce) levels[band] = 0;
        else levels[band] += (audio[band] - levels[band]) * (1 - Math.exp(-dt / .22));
      }
      if (reduce) clearMotion();
      springs.forEach(s=>{s.energy*=Math.exp(-dt/.30)});
      const steps = Math.max(1,Math.ceil(dt*180)), h = dt/steps;
      for (let step = 0; step < steps; step++) springs.forEach((s,i) => {
        const w = 11+i*2;
        s.v += (-w*w*s.x-2.1*w*s.v)*h;
        s.x = Math.max(-.06,Math.min(.06,s.x+s.v*h));
      });
      // Bass motion is drum-only: sustained low-frequency level never moves
      // the large lens. Critical damping settles each impulse without jitter.
      depths[0] = (-.34 - springs[0].x*P.motionGain) * P.spread;
      // Each NEXT convex face now reaches back toward -Y. Its own thickness
      // sets the clearance from the previous lens's +Y-facing flat plane.
      depths[1] = Math.max((.18 + (levels.mid*.07+springs[1].x)*P.motionGain*P.midMotion) * P.spread, depths[0] + P.thickness * .76 * P.size + .10);
      depths[2] = Math.max((.60 + (levels.high*.10+springs[2].x)*P.motionGain*P.highMotion) * P.spread, depths[1] + P.thickness * .54 * P.size + .10);
      const cr = Math.cos(P.rotation), sr = Math.sin(P.rotation), ct = Math.cos(P.incline), st = Math.sin(P.incline);
      rotateVector(basisU, cr, sr, 0); rotateVector(basisV, -sr * ct, cr * ct, st);
      rotateVector(axisY, sr * st, -cr * st, ct);
      gl.clearColor(...currentPalette.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      common(particleProgram); f(particleProgram, 'dpr', dpr); f(particleProgram, 'aura', P.aura);
      for (const r of ripples) {
        // Wall-clock lifetime must not stretch when dense particles or a
        // software GPU lower the frame rate. Springs use bounded substeps.
        if(!Number.isFinite(r.age))continue;
        r.age=Math.max(0,(now-r.bornAt)/1000);
        if(r.age>=r.life)continue;
        for (const name of ['age', 'life', 'speed', 'radius', 'depth', 'height', 'growth', 'rise', 'strength']) f(particleProgram, name, r[name]);
        gl.bindBuffer(gl.ARRAY_BUFFER, r.buffer);
        attribute(particleProgram, 'a_circle', 2, 20, 0); attribute(particleProgram, 'a_lane', 1, 20, 8);
        attribute(particleProgram, 'a_seed', 1, 20, 12); attribute(particleProgram, 'a_height', 1, 20, 16);
        gl.drawArrays(gl.POINTS, 0, ANGLES * LANES);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      common(lensProgram); f(lensProgram, 'time', time); f(lensProgram, 'paletteMode', currentPalette.mode);
      for (const name of ['reflection', 'opacity', 'roughness', 'sat', 'light', 'gamma', 'surfaceMotion', 'bandWidth', 'edgeGlow', 'interReflection', 'fresnelEdge', 'edgeSat']) f(lensProgram, name, P[name]);
      for(let i=0;i<3;i++)gl.uniform3f(location(lensProgram,'lensData'+i),radii[i]*P.size,depths[i],P.thickness*radii[i]*P.size);
      // Orbit can pass behind the lenses. Re-sort transparent objects and
      // their flat/convex surfaces whenever the camera crosses the disk plane.
      const order = axisY[2] >= 0 ? [0, 1, 2] : [2, 1, 0];
      f(lensProgram,'frontSurface',axisY[2]>=0?1:0);
      for (const i of order) {
        f(lensProgram,'lensIndex',i);
        f(lensProgram, 'radius', radii[i] * P.size); f(lensProgram, 'depth', depths[i]);
        f(lensProgram, 'thickness', P.thickness * radii[i] * P.size);
        f(lensProgram, 'energy', i===0?springs[0].energy:levels[['bass', 'mid', 'high'][i]]);
        f(lensProgram, 'glow', P.glow);
        f(lensProgram, 'surface', axisY[2] >= 0 ? 0 : 1);
        mesh(axisY[2] >= 0 ? capBuffer : backBuffer, axisY[2] >= 0 ? cap.length / 6 : back.length / 6, gl.TRIANGLES);
        f(lensProgram, 'surface', 2); mesh(sideBuffer, side.length / 6, gl.TRIANGLES);
        f(lensProgram, 'surface', axisY[2] >= 0 ? 1 : 0);
        mesh(axisY[2] >= 0 ? backBuffer : capBuffer, axisY[2] >= 0 ? back.length / 6 : cap.length / 6, gl.TRIANGLES);
        gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
        f(lensProgram, 'surface', 3); f(lensProgram, 'radius',radii[i]*P.size*1.012);
        mesh(sideBuffer,side.length/6,gl.TRIANGLES);
        f(lensProgram, 'surface', 4); f(lensProgram, 'radius',radii[i]*P.size*1.028);
        mesh(sideBuffer,side.length/6,gl.TRIANGLES);
        gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      ready: true, params: P,
      setParams(next) { for (const n in next) if (n in P && Number.isFinite(next[n])) P[n] = next[n]; },
      setPalette(next) { targetPalette = copyPalette(next); },
      setAudio(next) { for (const band in audio) audio[band] = Math.max(0, Math.min(1, Number(next[band]) || 0)); },
      emitRipple, clearRipples, resetView, kick, clearMotion,
      setRipplesEnabled(enabled) { ripplesEnabled = !!enabled; if (!enabled) clearRipples(); },
      get metrics() {
        const active = ripples.filter(r => r.age < r.life);
        return { depths: depths.slice(), radii: radii.map(r => r * P.size),
          particlesPerRipple:ANGLES*LANES,sideSaturation:P.edgeSat,
          axisY: axisY.slice(), viewRotation: view.slice(), springDisplacement: springs.map(s => s.x),
          // All extents use the agreed scene Y coordinate, not screen Y.
          lensExtentsY: depths.map((flatY, i) => ({ flatY, convexY: flatY - P.thickness * radii[i] * P.size })),
          rippleProfiles: active.map(r => {
            const travel = r.age * r.speed, lift = travel * r.rise;
            return { age: r.age, emissionY:r.depth,radius: r.radius + travel, baseY: r.depth + lift,
              peakHeight: lift + r.maxSample*r.height*r.strength*Math.sin(Math.floor((LANES-1)/2)*Math.PI/(LANES-1))*(1+travel*r.growth) };
          }), activeRipples: active.length };
      },
      destroy() {
        alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
        observer?.disconnect(); media.removeEventListener('change', motionChanged);
        finishDrag(); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.removeEventListener(name, finishDrag);
        canvas.removeEventListener('dblclick', resetView); canvas.removeEventListener('keydown', keyDown);
        buffers.forEach(b => gl.deleteBuffer(b)); programs.forEach(p => gl.deleteProgram(p));
      }
    };
  }
  LensRenderer.defaults = DEFAULTS;
  root.LensRenderer = LensRenderer;
})(typeof window !== 'undefined' ? window : this);
