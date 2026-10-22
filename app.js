/**
 * FluidGlow Audio — phase 1.
 * Audio changes material/size only. Geometry topology controls (merge/spread)
 * are deliberately constant so no audio spike can teleport bubble centres.
 * All uploaded audio is decoded/analyzed in the browser, never uploaded.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const toClock = seconds => Number.isFinite(seconds) ?
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
  // User-editable baseline; musical signals add bounded offsets.
  const PARAMS = {
    ...FluidGlow.defaults,
    zoom: window.innerWidth < 760 ? 1.14 : 1.24,
    sat: 1.20, hueSpeed: 0.038, gamma: 1.36
  };
  const PARAM_DEFAULTS = { ...PARAMS };
  const PARAM_GROUPS = [
    { title: '形状与融合 / SHAPE', fields: [
      ['size', '液滴基础尺寸', .40, 2.40, .01],
      ['spread', '液滴间距', .5, 3.2, .01],
      ['merge', '融合强度', .01, .40, .005],
      ['incline', '轨道倾角', -.8, .8, .01],
      ['edge', '边缘柔化', .0004, .018, .0002],
      ['zoom', '缩放', .5, 2.5, .01],
      ['posX', '水平偏移', -1, 1, .01],
      ['posY', '垂直偏移', -1, 1, .01],
      ['posZ', '景深缩放', -.6, .6, .01]
    ]},
    { title: '材质与颜色 / OPTICS', fields: [
      ['glow', '边缘光泽', 0, 6, .02],
      ['aura', '外侧光晕', 0, 2, .01],
      ['film', '油膜宽度', .03, 1, .01],
      ['fringe', '边缘锐度', .6, 12, .05],
      ['sat', '饱和度', 0, 2, .01],
      ['hueSpeed', '色相流动速度', -.5, .5, .005],
      ['hueOff', '色相偏移', -1, 1, .01],
      ['body', '液滴内部亮度', 0, 2, .02],
      ['light', '定向照明', 0, 1, .01],
      ['gamma', '伽马', .6, 2.8, .01]
    ]},
    { title: '独立运动 / MOTION', fields: [
      ['speed', '轨道速度', 0, 1.5, .01]
    ]}
  ];
  const AUDIO_PARAMETERS = new Set(['size','glow','aura','film','hueOff','fringe']);
  // A context can exist even when the shader program failed to compile.
  const glow = FluidGlow({
    canvas: $('fluid-canvas'), ...PARAMS, maxDpr: 1.5
  });
  const hasWebGL = glow.ready === true;
  if (!hasWebGL) document.body.classList.add('no-webgl');
  if (glow.safeMode) document.body.classList.add('shader-safe-mode');

  let mode = 'demo';
  let ctx = null;
  let analyser = null;
  let fileSource = null;
  let micSource = null;
  let micStream = null;
  let activeUrl = null;
  let frequencyBins = null;
  let previousBins = null;
  let waveform = null;
  let toastTimer;
  const player = $('player');
  const smoothed = { loudness: 0, bass: 0, mid: 0, high: 0 };
  const setting = { sensitivity: 1.25, intensity: .85, beatSensitivity: 1.20, wave: 1, waveEnabled: true, surfaceEnabled: false };
  let surfaceLevel = 0;
  const meters = {
    loudness: [$('loudness-fill'), $('loudness-value')],
    bass: [$('bass-fill'), $('bass-value')],
    mid: [$('mid-fill'), $('mid-value')],
    high: [$('high-fill'), $('high-value')]
  };

  function toast(message) {
    const box = $('toast');
    box.textContent = message;
    box.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('visible'), 3400);
  }

  function status(message) { $('visual-status').textContent = message; }
  function activate(which) {
    mode = which;
    for (const name of ['demo', 'upload', 'mic']) {
      const active = (name === 'upload' ? which === 'file' : name === which);
      $(name + '-btn').classList.toggle('active', active);
      if (name !== 'upload') $(name + '-btn').setAttribute('aria-pressed', String(active));
    }
    $('track-panel').hidden = which !== 'file';
  }

  function stopMicrophone() {
    if (micSource) { micSource.disconnect(); micSource = null; }
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
  }
  function stopAudio() { player.pause(); stopMicrophone(); }

  async function ensureAudioGraph() {
    if (!ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('浏览器不支持 Web Audio API');
      ctx = new Context();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.30; // Keep drum transients visible to FFT flux.
      analyser.minDecibels = -95;
      analyser.maxDecibels = -20;
      frequencyBins = new Uint8Array(analyser.frequencyBinCount);
      previousBins = new Uint8Array(analyser.frequencyBinCount);
      waveform = new Float32Array(analyser.fftSize);
    }
    if (ctx.state !== 'running') await ctx.resume();
    return ctx;
  }
  function connectFile() {
    if (fileSource) return;
    fileSource = ctx.createMediaElementSource(player);
    fileSource.connect(analyser);
    fileSource.connect(ctx.destination); // Never connect microphone to speakers.
  }

  async function loadFile(file) {
    if (!file || !(file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(file.name))) {
      toast('请选择音频文件（MP3 / WAV / OGG / M4A 等）');
      return;
    }
    try {
      await ensureAudioGraph();
      stopAudio();
      connectFile();
      if (activeUrl) URL.revokeObjectURL(activeUrl);
      activeUrl = URL.createObjectURL(file);
      player.src = activeUrl;
      player.load();
      $('track-name').textContent = file.name;
      $('track-detail').textContent = '本地音频 · 浏览器实时 FFT 分析';
      activate('file');
      resetOnsetDetector();
      await player.play();
      $('play-btn').textContent = '❚❚';
      status('你的音乐正在驱动液滴的呼吸与光泽');
      toast('音乐载入成功，开始实时响应');
    } catch (error) {
      console.error(error);
      if (mode !== 'file') activate('demo');
      toast('音频无法播放，请尝试 MP3 或 WAV 文件');
    }
  }

  async function useMicrophone() {
    if (mode === 'mic') {
      stopMicrophone();
      activate('demo'); resetOnsetDetector();
      status('体验模式运行中 · 选择音乐来驱动画面');
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('需要 HTTPS 或 localhost');
      await ensureAudioGraph();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false }, video: false });
      stopAudio();
      micStream = stream;
      micSource = ctx.createMediaStreamSource(stream);
      micSource.connect(analyser);
      activate('mic');
      resetOnsetDetector();
      status('正在通过麦克风捕捉周围声音');
      toast('麦克风已连接，音频不会上传');
    } catch (error) {
      console.warn('Microphone unavailable:', error);
      toast('无法打开麦克风；请检查 HTTPS 和权限设置');
    }
  }

  // Log-compressed spectral averages, without rapidly adapting normalization.
  // This avoids the visual "pumping" and sudden jumps caused by a moving peak.
  function energyBetween(lowHz, highHz) {
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    const start = clamp(Math.ceil(lowHz / hzPerBin), 1, frequencyBins.length - 1);
    const end = clamp(Math.floor(highHz / hzPerBin), start + 1, frequencyBins.length);
    let energy = 0;
    for (let i = start; i < end; i++) {
      const n = frequencyBins[i] / 255;
      energy += n * n;
    }
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    const gated = clamp((rms - .055) / .52);
    return clamp(Math.pow(gated, .82) * setting.sensitivity);
  }

  // Time-domain RMS represents overall loudness, not a sum of spectral bins.
  // Gentle gating, compression, and an envelope make quiet music perceptible
  // without allowing sudden peaks to change the metaball topology.
  function overallLoudness() {
    analyser.getFloatTimeDomainData(waveform);
    let sum = 0;
    for (let i = 0; i < waveform.length; i++) sum += waveform[i] * waveform[i];
    const rms = Math.sqrt(sum / waveform.length);
    return clamp(Math.pow(clamp((rms - .012) / .22), .65) * setting.sensitivity);
  }

  // Weighted positive spectral flux, from ungated FFT bins (35–2600 Hz).
  // This measures attacks, not sustained bass level or a moving peak.
  function spectralFlux() {
    if (!previousBins) return 0;
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    const end = Math.min(frequencyBins.length, Math.ceil(2600 / hzPerBin));
    let flux = 0, weights = 0;
    for (let i = 1; i < end; i++) {
      const hz = i * hzPerBin;
      if (hz < 35) continue;
      const weight = hz < 180 ? 2.3 : hz < 900 ? 1.25 : 0.75;
      const delta = (frequencyBins[i] - previousBins[i]) / 255;
      flux += Math.max(0, delta) * weight;
      weights += weight;
    }
    previousBins.set(frequencyBins);
    return flux / Math.max(weights, 1);
  }

  function spectrum() {
    if (!analyser || !frequencyBins || !waveform || ctx?.state !== 'running')
      return { loudness: 0, bass: 0, mid: 0, high: 0, flux: 0 };
    analyser.getByteFrequencyData(frequencyBins);
    const flux = spectralFlux();
    return {
      loudness: overallLoudness(),
      bass: energyBetween(35, 180),
      mid: energyBetween(180, 1900),
      high: energyBetween(1900, 10000),
      flux
    };
  }

  // A *silent* illustrative rhythm, deliberately labeled as a visual demo.
  // Unlike uploaded files or microphone mode, it is not analyzing real sound.
  function simulatedSpectrum(t) {
    const beat = t % .66;
    const upbeat = (t + .32) % .66;
    const kick = Math.exp(-beat / .16);
    const snare = Math.exp(-upbeat / .20);
    const hat = Math.exp(-((t + .03) % .165) / .055);
    return {
      loudness: clamp(.14 + .67 * kick + .32 * snare),
      bass: clamp(.10 + .75 * kick + .08 * (Math.sin(t * 2.1) + 1)),
      mid: clamp(.15 + .34 * snare + .17 * (Math.sin(t * 2.8 - .6) + 1)),
      high: clamp(.15 + .53 * hat + .08 * Math.sin(t * 9) ** 2),
      flux: 0
    };
  }

  // Attack/release in *seconds*, independent of screen refresh rate.
  function envelope(current, target, dt, attack, release) {
    const tau = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }

  // Beat detection: fast vs slow bass-weighted envelope with a rising-edge
  // threshold + refractory period. Sustained bass cannot continuously re-hit.
  const beat = { fluxBaseline: .004, previous: 0, armed: true, lastAt: -Infinity,
    demoStep: -1, count: 0, flash: 0, novelty: 0, threshold: 0 };
  const waves = { x1: 0, v1: 0, x2: 0, v2: 0 };
  let elapsed = 0;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion:reduce)').matches;

  function resetOnsetDetector() {
    beat.fluxBaseline = .004; beat.previous = 0; beat.armed = true;
    beat.lastAt = -Infinity; beat.demoStep = -1; beat.novelty = 0; beat.threshold = 0;
    if (previousBins) previousBins.fill(0);
  }

  function strike(strength = 1) {
    const hit = clamp(strength, .25, 1.35);
    // Impulse changes VELOCITY, never shape/position instantly.
    waves.v1 = clamp(waves.v1 + 12.5 * hit, -16, 16);
    waves.v2 = clamp(waves.v2 - 8.2 * hit, -12, 12);
    beat.flash = 1;
    beat.count += 1;
  }

  function detectBeat(raw, dt, nowSeconds) {
    if (mode === 'demo') {
      const step = Math.floor(elapsed / .66);
      if (beat.demoStep !== step) {
        beat.demoStep = step;
        if (setting.waveEnabled) strike(.88);
      }
      return;
    }
    if (mode === 'file' && player.paused) return;
    if (mode !== 'file' && mode !== 'mic') return;
    const flux = raw.flux;
    const baselineBefore = beat.fluxBaseline;
    const adapt = 1 - Math.exp(-dt / .60);
    beat.fluxBaseline += (flux - beat.fluxBaseline) * adapt;
    const threshold = Math.max(.005, baselineBefore * 1.40 + .0025) / setting.beatSensitivity;
    beat.novelty = flux;
    beat.threshold = threshold;
    // Hysteresis and a 200ms refractory period avoid repeated triggers.
    if (flux < threshold * .62) beat.armed = true;
    const fresh = flux > threshold && flux > beat.previous * 1.08;
    if (setting.waveEnabled && beat.armed && fresh &&
        raw.loudness > .035 && nowSeconds - beat.lastAt > .20) {
      beat.lastAt = nowSeconds;
      beat.armed = false;
      strike(clamp(.55 + (flux / Math.max(threshold, .001) - 1) * .20, .55, 1.18));
    }
    beat.previous = flux;
  }

  function simulateElasticWaves(dt) {
    // Fixed micro-steps keep both damped spring modes stable at varied FPS.
    const steps = Math.max(1, Math.ceil(dt / (1 / 180)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      waves.v1 += (-19 * 19 * waves.x1 - 7.8 * waves.v1) * h;
      waves.x1 += waves.v1 * h;
      waves.v2 += (-29 * 29 * waves.x2 - 11.5 * waves.v2) * h;
      waves.x2 += waves.v2 * h;
    }
  }

  const start = performance.now();
  let last = start;
  let lastUi = 0;
  function animate(now) {
    const dt = clamp((now - last) / 1000, 0, .05);
    last = now;
    elapsed += dt;
    const raw = mode === 'demo' ? simulatedSpectrum(elapsed) : spectrum();
    if (!reduceMotion) detectBeat(raw, dt, now / 1000);
    simulateElasticWaves(dt);
    surfaceLevel = envelope(surfaceLevel, setting.surfaceEnabled && !reduceMotion ? 1 : 0, dt, .28, .34);
    beat.flash *= Math.exp(-dt / .16);
    smoothed.loudness = envelope(smoothed.loudness, raw.loudness, dt, .045, .26);
    smoothed.bass = envelope(smoothed.bass, raw.bass, dt, .08, .32);
    smoothed.mid = envelope(smoothed.mid, raw.mid, dt, .18, .55);
    smoothed.high = envelope(smoothed.high, raw.high, dt, .025, .13);

    const L = smoothed.loudness * setting.intensity;
    const B = smoothed.bass * setting.intensity;
    const M = smoothed.mid * setting.intensity;
    const H = smoothed.high * setting.intensity;
    // Keep the variation of radius small and do not animate merge or spread.
    glow.setParams({
      ...PARAMS,
      size: PARAMS.size + .070 * B,
      film: PARAMS.film + .130 * M,
      hueOff: PARAMS.hueOff + .055 * M,
      glow: PARAMS.glow + 2.10 * L,
      aura: PARAMS.aura + .62 * L,
      waveA: (setting.waveEnabled && !reduceMotion) ? clamp(waves.x1 * .17 * setting.wave * setting.intensity, -.10, .10) : 0,
      waveB: (setting.waveEnabled && !reduceMotion) ? clamp(waves.x2 * .16 * setting.wave * setting.intensity, -.042, .042) : 0,
      surfaceMotion: surfaceLevel,
      fringe: PARAMS.fringe - .18 * H
    });

    if (!hasWebGL) {
      document.documentElement.style.setProperty('--fallback-brightness', String(0.70 + (smoothed.bass + smoothed.loudness) * .5));
    }
    if (now - lastUi > 65) {
      lastUi = now;
      $('beat-lamp').style.setProperty('--beat-flash', beat.flash.toFixed(3));
      $('beat-count').textContent = String(beat.count).padStart(3, '0');
      $('onset-debug').textContent = mode === 'demo' ? 'DEMO · 模拟节奏' : `FLUX ${beat.novelty.toFixed(3)} / ${beat.threshold.toFixed(3)}`;
      for (const key of ['waveA', 'waveB']) {
        const output = $('fluid-output-' + key);
        if (output && glow.params) output.textContent = Number(glow.params[key]).toFixed(3);
      }
      for (const [key, elements] of Object.entries(meters)) {
        const percent = Math.round(smoothed[key] * 100);
        elements[0].style.width = `${percent}%`;
        elements[1].textContent = String(percent).padStart(2, '0');
      }
      if (mode === 'file' && player.duration && !$('seek').matches(':active')) {
        $('seek').value = String(Math.round(player.currentTime / player.duration * 1000));
        $('current-time').textContent = toClock(player.currentTime);
        $('duration').textContent = toClock(player.duration);
      }
    }
    requestAnimationFrame(animate);
  }

  // Player and source controls.
  $('demo-btn').addEventListener('click', () => {
    stopAudio(); activate('demo'); resetOnsetDetector();
    status('体验模式运行中（模拟节奏，无音频）');
    toast('已切换到无声节奏演示');
  });
  $('upload-btn').addEventListener('click', () => $('audio-file').click());
  $('audio-file').addEventListener('change', event => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
  $('mic-btn').addEventListener('click', useMicrophone);
  $('play-btn').addEventListener('click', async () => {
    if (mode !== 'file') return;
    try {
      if (player.paused) { await ensureAudioGraph(); await player.play(); }
      else player.pause();
    } catch (error) { toast('播放失败，请选择其他音频文件'); }
  });
  player.addEventListener('play', () => $('play-btn').textContent = '❚❚');
  player.addEventListener('pause', () => $('play-btn').textContent = '▶');
  player.addEventListener('ended', () => { $('play-btn').textContent = '▶'; status('音乐播放完成，等待再次播放'); });
  player.addEventListener('error', () => { if (mode === 'file') toast('浏览器不支持该文件的音频编码'); });
  $('seek').addEventListener('input', event => {
    if (Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = player.duration * Number(event.target.value) / 1000;
    }
  });

  $('test-wave-btn').addEventListener('click', () => {
    if (reduceMotion) { toast('系统已启用减少动态效果，弹性波暂停'); return; }
    if (!setting.waveEnabled) { toast('请先开启鼓点弹性波开关'); return; }
    strike(1);
    toast('已施加一次测试冲击 · 观察弹性回弹');
  });
  $('wave-enabled').addEventListener('change', event => {
    setting.waveEnabled = event.target.checked;
    if (!setting.waveEnabled) { waves.x1 = waves.v1 = waves.x2 = waves.v2 = 0; }
  });
  $('surface-enabled').addEventListener('change', event => {
    setting.surfaceEnabled = event.target.checked;
    toast(setting.surfaceEnabled ? '已开启自主表面形变（不读取音乐）' : '已关闭自主表面形变');
  });
  for (const id of ['sensitivity', 'intensity', 'wave', 'beatSensitivity']) {
    $(id).addEventListener('input', event => {
      const value = Number(event.target.value);
      setting[id] = (id === 'intensity' || id === 'wave') ? value / 100 : value;
      $(id + '-out').textContent = (id === 'intensity' || id === 'wave') ? `${value}%` : `${value.toFixed(2)}×`;
    });
  }

  // Every base FluidGlow control is generated from one parameter schema.
  // Audio modulators add bounded offsets to the user-selected base values.
  function buildParameterPanel() {
    const holder = $('fluid-parameter-list');
    for (const group of PARAM_GROUPS) {
      const section = document.createElement('section');
      section.className = 'module-group';
      const heading = document.createElement('h3');
      heading.className = 'module-group-title';
      heading.textContent = group.title;
      section.append(heading);
      for (const [key, label, min, max, step] of group.fields) {
        const wrap = document.createElement('label');
        wrap.className = 'module-control';
        const head = document.createElement('span');
        head.className = 'module-control-head';
        const text = document.createElement('span');
        text.textContent = label + ' ';
        const code = document.createElement('code');
        code.textContent = key;
        text.append(code);
        if (AUDIO_PARAMETERS.has(key)) {
          const dot = document.createElement('em');
          dot.textContent = '●';
          text.prepend(dot);
        }
        const output = document.createElement('output');
        output.id = 'fluid-output-' + key;
        output.textContent = Number(PARAMS[key]).toFixed(step < .01 ? 4 : 2);
        head.append(text, output);
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
        slider.value = PARAMS[key]; slider.dataset.param = key;
        slider.addEventListener('input', () => {
          PARAMS[key] = Number(slider.value);
          output.textContent = PARAMS[key].toFixed(step < .01 ? 4 : 2);
        });
        wrap.append(head, slider); section.append(wrap);
      }
      holder.append(section);
    }
    for (const key of ['waveA', 'waveB']) {
      const wrap = document.createElement('div');
      wrap.className = 'module-readonly';
      wrap.innerHTML = `<span>${key} · 实时弹性波输出</span><output id="fluid-output-${key}">0.000</output>`;
      holder.append(wrap);
    }
  }
  buildParameterPanel();

  $('reset-btn').addEventListener('click', () => {
    const defaults = { sensitivity: 1.25, intensity: 85, beatSensitivity: 1.20, wave: 100 };
    for (const [name, value] of Object.entries(defaults)) {
      $(name).value = String(value);
      $(name).dispatchEvent(new Event('input'));
    }
    $('wave-enabled').checked = true; $('wave-enabled').dispatchEvent(new Event('change'));
    $('surface-enabled').checked = false; $('surface-enabled').dispatchEvent(new Event('change'));
    Object.assign(PARAMS, PARAM_DEFAULTS);
    for (const control of document.querySelectorAll('[data-param]')) {
      control.value = PARAMS[control.dataset.param];
      control.dispatchEvent(new Event('input'));
    }
    resetOnsetDetector();
    toast('已恢复默认响应与模块参数');
  });
  $('fullscreen-btn').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { toast('当前浏览器不支持全屏模式'); }
  });

  // Drop music files anywhere; do not navigate to the dropped file.
  let dragDepth = 0;
  window.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault(); dragDepth++; document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', event => { event.preventDefault(); });
  window.addEventListener('dragleave', event => {
    event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0;
    document.body.classList.remove('dragging');
    if (event.dataTransfer?.files?.[0]) loadFile(event.dataTransfer.files[0]);
  });
  window.addEventListener('beforeunload', () => {
    stopMicrophone(); if (activeUrl) URL.revokeObjectURL(activeUrl);
    if (ctx && ctx.state !== 'closed') ctx.close();
  });

  if (window.matchMedia?.('(prefers-reduced-motion:reduce)').matches) {
    status('系统已开启减少动态效果；弹性波被禁用');
  }
  if (glow.safeMode) {
    status('已自动切换兼容模式：油滴正常显示，弹性波在此设备上暂停');
    toast('设备 Shader 兼容性限制：已自动恢复稳定液滴');
  }
  if (!hasWebGL) {
    status('Shader 初始化失败，已显示简化预览。请查看浏览器控制台错误');
    toast('无法初始化 WebGL Shader，已启用简化预览');
  }
  $('fluid-canvas').addEventListener('webglcontextlost', event => {
    event.preventDefault();
    document.body.classList.add('no-webgl');
    status('显卡上下文暂时丢失，已启用简化预览');
  });
  $('fluid-canvas').addEventListener('webglcontextrestored', () => window.location.reload());
  requestAnimationFrame(animate);
})();