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
  const PARAMS = Object.freeze({
    size: 1.35, film: 0.30, glow: 2.06, fringe: 5.85,
    hueOff: 0, speed: 0.24, merge: 0.17, spread: 1.70
  });
  const hasWebGL = !!$('fluid-canvas').getContext('webgl');
  if (!hasWebGL) document.body.classList.add('no-webgl');
  const glow = FluidGlow({
    canvas: $('fluid-canvas'), ...PARAMS,
    zoom: window.innerWidth < 760 ? 1.14 : 1.24,
    sat: 1.20, hueSpeed: 0.038, maxDpr: 1.5
  });

  let mode = 'demo';
  let ctx = null;
  let analyser = null;
  let fileSource = null;
  let micSource = null;
  let micStream = null;
  let activeUrl = null;
  let frequencyBins = null;
  let toastTimer;
  const player = $('player');
  const smoothed = { bass: 0, mid: 0, high: 0 };
  const setting = { sensitivity: 1.25, intensity: .70, speed: .24 };
  const meters = {
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
      analyser.smoothingTimeConstant = 0.62;
      analyser.minDecibels = -95;
      analyser.maxDecibels = -20;
      frequencyBins = new Uint8Array(analyser.frequencyBinCount);
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
      activate('demo');
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

  function spectrum() {
    if (!analyser || !frequencyBins || ctx?.state !== 'running') return { bass: 0, mid: 0, high: 0 };
    analyser.getByteFrequencyData(frequencyBins);
    return {
      bass: energyBetween(35, 180),
      mid: energyBetween(180, 1900),
      high: energyBetween(1900, 10000)
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
      bass: clamp(.10 + .75 * kick + .08 * (Math.sin(t * 2.1) + 1)),
      mid: clamp(.15 + .34 * snare + .17 * (Math.sin(t * 2.8 - .6) + 1)),
      high: clamp(.15 + .53 * hat + .08 * Math.sin(t * 9) ** 2)
    };
  }

  // Attack/release in *seconds*, independent of screen refresh rate.
  function envelope(current, target, dt, attack, release) {
    const tau = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }

  const start = performance.now();
  let last = start;
  let lastUi = 0;
  function animate(now) {
    const dt = clamp((now - last) / 1000, 0, .05);
    last = now;
    const raw = mode === 'demo' ? simulatedSpectrum((now - start) / 1000) : spectrum();
    smoothed.bass = envelope(smoothed.bass, raw.bass, dt, .08, .32);
    smoothed.mid = envelope(smoothed.mid, raw.mid, dt, .18, .55);
    smoothed.high = envelope(smoothed.high, raw.high, dt, .025, .13);

    const B = smoothed.bass * setting.intensity;
    const M = smoothed.mid * setting.intensity;
    const H = smoothed.high * setting.intensity;
    // Keep the variation of radius small and do not animate merge or spread.
    glow.setParams({
      size: PARAMS.size + .05 * B,
      film: PARAMS.film + .085 * M,
      hueOff: PARAMS.hueOff + .034 * M,
      glow: PARAMS.glow + 1.12 * H,
      fringe: PARAMS.fringe - .34 * H,
      speed: setting.speed,
      merge: PARAMS.merge,
      spread: PARAMS.spread
    });

    if (!hasWebGL) {
      document.documentElement.style.setProperty('--fallback-brightness', String(0.70 + (smoothed.bass + smoothed.high) * .5));
    }
    if (now - lastUi > 65) {
      lastUi = now;
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
    stopAudio(); activate('demo');
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

  for (const id of ['sensitivity', 'intensity', 'speed']) {
    $(id).addEventListener('input', event => {
      const value = Number(event.target.value);
      setting[id] = id === 'intensity' ? value / 100 : value;
      $(id + '-out').textContent = id === 'intensity' ? `${value}%` : id === 'sensitivity' ? `${value.toFixed(2)}×` : value.toFixed(2);
    });
  }
  $('reset-btn').addEventListener('click', () => {
    const defaults = { sensitivity: 1.25, intensity: 70, speed: .24 };
    for (const [name, value] of Object.entries(defaults)) {
      $(name).value = String(value);
      $(name).dispatchEvent(new Event('input'));
    }
    toast('已恢复默认响应参数');
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
    status('系统已开启减少动态效果；可以在系统设置中调整');
  }
  if (!hasWebGL) {
    status('当前浏览器无法启用 WebGL，显示简化预览效果');
    toast('当前环境未启用 WebGL；推荐使用 Chrome / Safari 并开启硬件加速');
  }
  requestAnimationFrame(animate);
})();