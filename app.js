/** FluidGlow Audio v2 — three coaxial glass lenses and bass-triggered spectral rings.
 * Local audio stays in the browser. Existing FFT bands / RMS / envelopes are reused.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const toClock = seconds => Number.isFinite(seconds) ?
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
  // Bundled tracks use relative URLs so a clone or static deployment is portable.
  const PLAYLIST = [
    { title: 'Rivers In the Desert', src: 'audio/rivers-in-the-desert.mp3' },
    { title: '星と僕らと', detail: 'Lyn / アトラスサウンドチーム', src: 'audio/hoshi-to-bokura-to.mp3' },
    { title: '远航星的告别', src: 'audio/yuan-hang-xing-de-gao-bie.mp3' },
    { title: '新长征路上的摇滚', src: 'audio/xin-chang-zheng-lu-shang-de-yao-gun.mp3' },
    { title: 'Hello', src: 'audio/hello.mp3' }
  ];
  // Artist-picked sRGB metal presets; independent of audio analysis.
  const PALETTES = [
    {id:'champagne',name:'香槟黑金',en:'CHAMPAGNE NOIR',note:'温润香槟金 / 柔和玫瑰影',colors:['#F4E3C4','#D1AC78','#A87D64'],bg:'#060506'},
    {id:'rose',name:'玫瑰金',en:'ROSE GOLD',note:'玫瑰金反射 / 珍珠白导光',colors:['#F8E6E1','#CE9C95','#A76D68'],bg:'#0A0709'},
    {id:'royal',name:'曜石深金',en:'GILDED ONYX',note:'古典深金 / 黑曜石',colors:['#F0D49A','#B89453','#795434'],bg:'#070607'},
    {id:'pearl',name:'月光香槟',en:'PEARL CHAMPAGNE',note:'淡香槟珍珠 / 浅玫瑰',colors:['#F6E8D1','#DBC1A0','#C49A8E'],bg:'#0A090A'},
    {id:'bronze',name:'暮光玫瑰',en:'BRONZE ROSÉ',note:'香槟铜 / 暮色玫瑰金',colors:['#F3D2A7','#BF866D','#9A6157'],bg:'#080507'},
    {id:'original',name:'原版虹彩',en:'ORIGINAL PRISM',note:'原始虹彩 / 对比模式',colors:['#79E4DC','#C38DEA','#E6AEB0'],bg:'#000000',mode:0}
  ];
  const toRgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
  const DEFAULT_PALETTE = PALETTES.find(preset => preset.id === 'bronze');
  let selectedPalette = DEFAULT_PALETTE;
  function paletteUniforms(preset) {
    return {
      a:toRgb(preset.colors[0]),b:toRgb(preset.colors[1]),
      c:toRgb(preset.colors[2]),bg:toRgb(preset.bg),
      mode:preset.mode===0 ? 0 : 1
    };
  }
  // User-editable baseline; musical signals add bounded offsets.
  const PARAMS = {
    ...LensRenderer.defaults,
    zoom: 1, sat: 1.05, gamma: 1.15
  };
  const PARAM_DEFAULTS = { ...PARAMS };
  const PARAM_GROUPS = [
    { title: '透镜与构图 / LENSES', fields: [
      ['size', '透镜尺寸', .6, 1.4, .01],
      ['spread', '轴向间距', .65, 1.6, .01],
      ['incline', '基础视角倾角', -1.25, -.45, .01],
      ['rotation', '基础画面旋转', -.3, 1.2, .01],
      ['thickness', '透镜中心厚度', .20, .90, .01],
      ['zoom', '画面缩放', .6, 1.5, .01],
      ['posX', '水平偏移', -.6, .6, .01],
      ['posY', '垂直偏移', -.6, .6, .01]
    ]},
    { title: '半透材质 / OPTICS', fields: [
      ['reflection', '反射率', .1, .9, .01],
      ['edgeGlow', '亚克力侧壁导光', 0, 2.5, .05],
      ['edgeSat', '侧壁导光饱和度', 0, 1, .02],
      ['fresnelEdge', '平面菲涅尔亮边', 0, 1.8, .05],
      ['interReflection', '透镜之间的反射', 0, 1, .05],
      ['opacity', '不透明度', .15, .8, .01],
      ['glow', '反射亮度', .5, 2.5, .02],
      ['aura', '粒子光泽', 0, 1, .01],
      ['roughness', '反射柔度', .03, .7, .01],
      ['convexFrost', '凸面磨砂程度', 0, 1, .02],
      ['faceTransition', '正反面过渡半角（度）', 4, 35, 1],
      ['bandWidth', '反射灯箱宽度', .8, 4, .1],
      ['bandSpacing', '平行光带间距', 1.6, 5, .1],
      ['bandOffset', '平行光带位置', -3.2, 3.2, .05],
      ['sat', '饱和度', 0, 1.6, .01],
      ['light', '虚拟灯箱亮度', 0, 1, .01],
      ['gamma', '伽马', .6, 2, .01]
    ]},
    { title: '波前与光照 / WAVEFRONTS', fields: [
      ['midMotion', '中频运动倍率', .5, 3.5, .1],
      ['highMotion', '高频运动倍率', .5, 3.5, .1],
      ['rippleSpeed', '涟漪平均扩散速度', .3, 1.6, .02],
      ['rippleDrag', '扩散减速程度', 0, 6, .1],
      ['rippleLife', '涟漪寿命（秒）', 1.2, 5, .1],
      ['rippleHeight', 'Y 轴频谱高度', .2, 1.8, .02],
      ['rippleGrowth', '扩散增高倍率', .1, 2, .05],
      ['rippleRise', '沿 +Y 整体抬升', 0, .6, .02],
      ['speed', '自主光照速度', 0, 1.5, .01]
    ]}
  ];
  const AUDIO_PARAMETERS = new Set(['spread']);
  // A context can exist even when the shader program failed to compile.
  const glow = LensRenderer({
    canvas: $('fluid-canvas'), ...PARAMS, palette: paletteUniforms(selectedPalette), maxDpr: 1.5
  });
  const hasWebGL = glow.ready === true;
  if (!hasWebGL) document.body.classList.add('no-webgl');
  $('reset-view-btn').disabled = !hasWebGL;
  $('reset-view-btn').addEventListener('click', () => glow.resetView());

  let mode = 'playlist';
  let playlistIndex = 0;
  let sourceRevision = 0;
  let ctx = null;
  let analyser = null;
  let fileSource = null;
  let micSource = null;
  let micStream = null;
  let activeUrl = null;
  let frequencyDb = null;
  let dynamics = null;
  const emptySpectrum = () => ({loudness:0,bass:0,mid:0,high:0,flux:0,bassFlux:0,
    bassThreshold:0,attacks:{bass:0,mid:0,high:0}});
  let latestSpectrum=emptySpectrum();
  let waveform = null;
  const ringSpectrum = new Float32Array(96);
  let toastTimer;
  const player = $('player');
  const smoothed = { loudness: 0, bass: 0, mid: 0, high: 0 };
  const INPUT_DEFAULTS = Object.freeze({ sensitivity: 1.25, intensity: 85, motion: 70,
    beatSensitivity: 1.45, kickInterval: 300, wave: 100 });
  const setting = { sensitivity: INPUT_DEFAULTS.sensitivity, intensity: INPUT_DEFAULTS.intensity/100,
    motion: INPUT_DEFAULTS.motion/100, beatSensitivity: INPUT_DEFAULTS.beatSensitivity,
    kickInterval: INPUT_DEFAULTS.kickInterval/1000, wave: INPUT_DEFAULTS.wave/100,
    waveEnabled: true, surfaceEnabled: false };
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
    for (const name of ['playlist', 'upload', 'mic']) {
      const active = (name === 'upload' ? which === 'file' : name === which);
      $(name + '-btn').classList.toggle('active', active);
      if (name !== 'upload') $(name + '-btn').setAttribute('aria-pressed', String(active));
    }
    $('track-panel').hidden = which !== 'file' && which !== 'playlist';
    $('playlist-panel').hidden = which !== 'playlist';
    $('previous-btn').hidden = $('next-btn').hidden = which !== 'playlist';
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
      analyser.smoothingTimeConstant = .08; // Float FFT keeps high-level attacks intact.
      analyser.minDecibels = -110;
      analyser.maxDecibels = 0; // Display range only; float FFT is not clipped by these values.
      frequencyDb = new Float32Array(analyser.frequencyBinCount);
      dynamics = new AudioDynamics(ctx.sampleRate, analyser.fftSize);
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

  function prepareTrack(src, title, detail, which) {
    sourceRevision++;
    stopAudio();
    if (activeUrl) { URL.revokeObjectURL(activeUrl); activeUrl = null; }
    player.src = src;
    player.load();
    $('track-name').textContent = title;
    $('track-detail').textContent = detail;
    $('seek').value = '0';
    $('current-time').textContent = $('duration').textContent = '0:00';
    $('play-btn').textContent = '▶';
    activate(which);
    resetOnsetDetector();
  }

  async function playCurrentTrack() {
    const revision = ++sourceRevision;
    try {
      await ensureAudioGraph();
      if (revision !== sourceRevision) return;
      connectFile();
      await player.play();
      if (revision === sourceRevision)
        status('三频正在驱动透镜间距 · 低频鼓点激发频谱涟漪');
    } catch (error) {
      if (revision !== sourceRevision || error.name === 'AbortError') return;
      status('音乐已就绪 · 点击播放开始体验');
      toast(error.name === 'NotAllowedError' ? '点击播放按钮开始音乐' : '音频无法播放，请检查文件或选择其他曲目');
    }
  }

  function selectPlaylistTrack(index, autoplay = true) {
    playlistIndex = (index + PLAYLIST.length) % PLAYLIST.length;
    const track = PLAYLIST[playlistIndex];
    prepareTrack(track.src, track.title,
      `体验歌单 · ${playlistIndex + 1} / ${PLAYLIST.length}${track.detail ? ' · ' + track.detail : ''}`, 'playlist');
    for (const row of $('playlist-list').children)
      row.setAttribute('aria-current', String(Number(row.dataset.index) === playlistIndex));
    status('体验歌单已就绪 · 点击播放，让音乐驱动画面');
    if (autoplay) return playCurrentTrack();
  }

  function buildPlaylist() {
    PLAYLIST.forEach((track, index) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'playlist-track'; row.dataset.index = index;
      const number = document.createElement('span');
      number.className = 'playlist-number'; number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'playlist-title'; title.textContent = track.title;
      row.append(number, title);
      row.addEventListener('click', () => selectPlaylistTrack(index));
      $('playlist-list').append(row);
    });
  }

  async function loadFile(file) {
    if (!file || !(file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(file.name))) {
      toast('请选择音频文件（MP3 / WAV / OGG / M4A 等）');
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      prepareTrack(url, file.name, '本地音频 · 浏览器实时 FFT 分析', 'file');
      activeUrl = url;
      await playCurrentTrack();
    } catch (error) {
      console.error(error);
      toast('音频无法播放，请尝试 MP3 或 WAV 文件');
    }
  }

  async function useMicrophone() {
    if (mode === 'mic') {
      stopMicrophone();
      selectPlaylistTrack(playlistIndex, false);
      return;
    }
    const revision = ++sourceRevision;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('需要 HTTPS 或 localhost');
      await ensureAudioGraph();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false }, video: false });
      if (revision !== sourceRevision) { stream.getTracks().forEach(track => track.stop()); return; }
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

  // The display compressor and the onset detector have separate signal paths.
  // Float FFT preserves attacks even above the old byte FFT's -20 dB ceiling.
  function spectrum(dt) {
    if (!analyser || !frequencyDb || !waveform || ctx?.state !== 'running')
      return { loudness: 0, bass: 0, mid: 0, high: 0, flux: 0, bassFlux: 0,
        bassThreshold: 0, attacks: { bass: 0, mid: 0, high: 0 } };
    analyser.getFloatFrequencyData(frequencyDb);
    analyser.getFloatTimeDomainData(waveform);
    const raw = dynamics.process(frequencyDb, waveform, dt, setting.sensitivity,
      setting.beatSensitivity, setting.kickInterval);
    dynamics.spectrumSnapshot(ringSpectrum, setting.sensitivity);
    return raw;
  }

  // Attack/release in *seconds*, independent of screen refresh rate.
  function envelope(current, target, dt, attack, release) {
    const tau = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }

  // Onsets come from unclipped physical spectral energy, never from a meter
  // percentage or its rounded delta. Each band can also excite its lens.
  const beat = { count: 0, flash: 0, novelty: 0, threshold: 0 };
  const motionPreference = window.matchMedia('(prefers-reduced-motion:reduce)');
  let reduceMotion = motionPreference.matches;
  motionPreference.addEventListener('change', () => {
    reduceMotion = motionPreference.matches;
    resetOnsetDetector();
  });

  function resetOnsetDetector() {
    dynamics?.reset(); ringSpectrum.fill(0); glow.clearRipples(); glow.clearMotion();
    latestSpectrum=emptySpectrum();
    beat.novelty = 0; beat.threshold = 0;
  }

  function strike(strength = 1) {
    const hit = clamp(strength, .25, 1.35);
    glow.emitRipple(ringSpectrum, hit * setting.wave * setting.intensity);
    beat.flash = 1;
    beat.count += 1;
  }

  function detectBeat(raw) {
    if (mode !== 'mic' && player.paused) return;
    beat.novelty = raw.bassFlux; beat.threshold = raw.bassThreshold;
    glow.kick({ bass: raw.attacks.bass*setting.intensity, mid: raw.attacks.mid*setting.intensity,
      high: raw.attacks.high*setting.intensity });
    if (setting.waveEnabled && raw.attacks.bass > 0) strike(raw.attacks.bass);
  }

  const start = performance.now();
  let last = start;
  let lastUi = 0;
  let lastAudioSample=start;
  // Audio analysis must not inherit the display/GPU frame rate. A 24ms hop
  // overlaps the ~46ms FFT window by roughly half. Handle every onset here
  // so no transient is overwritten before the next display frame.
  const audioTimer=setInterval(()=>{
    const now=performance.now(),dt=clamp((now-lastAudioSample)/1000,.001,.10);
    lastAudioSample=now;
    if(mode!=='mic'&&player.paused){latestSpectrum=emptySpectrum();return;}
    latestSpectrum=spectrum(dt);
    if(!reduceMotion)detectBeat(latestSpectrum);
  },24);
  function animate(now) {
    const dt = clamp((now - last) / 1000, 0, .10);
    last = now;
    const raw = latestSpectrum;
    surfaceLevel = envelope(surfaceLevel, setting.surfaceEnabled && !reduceMotion ? 1 : 0, dt, .28, .34);
    beat.flash *= Math.exp(-dt / .16);
    smoothed.loudness = envelope(smoothed.loudness, raw.loudness, dt, .045, .26);
    smoothed.bass = envelope(smoothed.bass, raw.bass, dt, .08, .32);
    smoothed.mid = envelope(smoothed.mid, raw.mid, dt, .22, .65);
    smoothed.high = envelope(smoothed.high, raw.high, dt, .12, .38);

    glow.setParams({ ...PARAMS, motionGain: setting.motion, surfaceMotion: surfaceLevel });
    glow.setAudio({
      bass: smoothed.bass * setting.intensity,
      mid: smoothed.mid * setting.intensity,
      high: smoothed.high * setting.intensity
    });

    if (!hasWebGL) {
      document.documentElement.style.setProperty('--fallback-brightness', String(0.70 + (smoothed.bass + smoothed.loudness) * .5));
    }
    if (now - lastUi > 65) {
      lastUi = now;
      $('beat-lamp').style.setProperty('--beat-flash', beat.flash.toFixed(3));
      $('beat-count').textContent = String(beat.count).padStart(3, '0');
      $('onset-debug').textContent = mode !== 'mic' && player.paused ? '等待播放 · 真实音频分析' : `BASS ONSET ${beat.novelty.toFixed(3)} / ${beat.threshold.toFixed(3)}`;
      const metrics = glow.metrics;
      if (metrics) {
        $('lens-gap').textContent = (metrics.depths[2] - metrics.depths[0]).toFixed(2);
        $('ripple-count').textContent = String(metrics.activeRipples).padStart(2, '0');
      }
      for (const [key, elements] of Object.entries(meters)) {
        const percent = Math.round(smoothed[key] * 100);
        elements[0].style.width = `${percent}%`;
        elements[1].textContent = String(percent).padStart(2, '0');
      }
      if (mode !== 'mic' && player.duration && !$('seek').matches(':active')) {
        $('seek').value = String(Math.round(player.currentTime / player.duration * 1000));
        $('current-time').textContent = toClock(player.currentTime);
        $('duration').textContent = toClock(player.duration);
      }
    }
    requestAnimationFrame(animate);
  }

  // Player and source controls.
  $('playlist-btn').addEventListener('click', () => {
    if (mode !== 'playlist') selectPlaylistTrack(playlistIndex);
    else playCurrentTrack();
  });
  $('previous-btn').addEventListener('click', () => selectPlaylistTrack(playlistIndex - 1));
  $('next-btn').addEventListener('click', () => selectPlaylistTrack(playlistIndex + 1));
  $('upload-btn').addEventListener('click', () => $('audio-file').click());
  $('audio-file').addEventListener('change', event => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
  $('mic-btn').addEventListener('click', useMicrophone);
  $('play-btn').addEventListener('click', async () => {
    if (mode === 'mic') return;
    if (player.paused) await playCurrentTrack();
    else player.pause();
  });
  player.addEventListener('play', () => $('play-btn').textContent = '❚❚');
  player.addEventListener('pause', () => {
    $('play-btn').textContent = '▶'; resetOnsetDetector();
    if (mode !== 'mic' && !player.ended) status('音乐已暂停 · 点击播放继续');
  });
  player.addEventListener('seeking', resetOnsetDetector);
  player.addEventListener('ended', () => {
    if (mode === 'playlist') selectPlaylistTrack(playlistIndex + 1);
    else { $('play-btn').textContent = '▶'; status('音乐播放完成，等待再次播放'); }
  });
  player.addEventListener('error', () => {
    if (mode === 'mic') return;
    status('音频加载失败 · 请重新选曲');
    toast(mode === 'playlist' ? '歌单音频无法加载，请确认 audio 文件夹完整并通过本地服务器打开' : '浏览器不支持该文件的音频编码');
  });
  player.addEventListener('loadedmetadata', () => { $('duration').textContent = toClock(player.duration); });
  $('seek').addEventListener('input', event => {
    if (Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = player.duration * Number(event.target.value) / 1000;
    }
  });

  $('test-wave-btn').addEventListener('click', () => {
    if (reduceMotion) { toast('系统已启用减少动态效果，粒子涟漪暂停'); return; }
    if (!setting.waveEnabled) { toast('请先开启低频粒子涟漪开关'); return; }
    strike(1);
    toast('已发出一圈频谱涟漪 · 观察扩散与淡出');
  });
  $('wave-enabled').addEventListener('change', event => {
    setting.waveEnabled = event.target.checked;
    glow.setRipplesEnabled(setting.waveEnabled);
    resetOnsetDetector();
  });
  $('surface-enabled').addEventListener('change', event => {
    setting.surfaceEnabled = event.target.checked;
    toast(setting.surfaceEnabled ? '已开启自主反射光移动' : '已关闭自主反射光移动');
  });
  for (const id of ['sensitivity', 'intensity', 'wave', 'motion', 'beatSensitivity', 'kickInterval']) {
    $(id).addEventListener('input', event => {
      const value = Number(event.target.value);
      const percent = ['intensity','wave','motion'].includes(id);
      setting[id] = percent ? value/100 : id==='kickInterval' ? value/1000 : value;
      $(id+'-out').textContent = percent ? `${value}%` : id==='kickInterval' ? `${value} ms` : `${value.toFixed(2)}×`;
    });
  }

  // Every base FluidGlow control is generated from one parameter schema.
  // Audio modulators add bounded offsets to the user-selected base values.
  // Preset cards are built with textContent (no untrusted HTML).
  function buildPalettePicker() {
    const host = $('palette-grid');
    if (!host) return;
    for (const preset of PALETTES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'palette-card';
      card.dataset.palette = preset.id;
      card.setAttribute('aria-pressed', String(preset === selectedPalette));
      const swatch = document.createElement('span');
      swatch.className = 'palette-swatch';
      swatch.style.background = `radial-gradient(circle at 36% 33%,${preset.colors[0]} 2%,${preset.colors[1]} 27%,${preset.colors[2]} 48%,${preset.bg} 75%)`;
      const meta = document.createElement('span');
      meta.className = 'palette-meta';
      const title = document.createElement('strong'); title.textContent = preset.name;
      const subtitle = document.createElement('small'); subtitle.textContent = preset.en;
      meta.append(title,subtitle);
      card.append(swatch,meta);
      card.title = preset.note;
      card.addEventListener('click', () => {
        selectedPalette = preset;
        glow.setPalette(paletteUniforms(preset));
        for (const el of host.querySelectorAll('.palette-card')) {
          el.setAttribute('aria-pressed',String(el === card));
        }
        $('palette-note').textContent = preset.note;
        toast('已切换配色：'+preset.name);
      });
      host.append(card);
    }
    $('palette-note').textContent = selectedPalette.note;
  }
  buildPalettePicker();

  function updateLightLayout() {
    for(const button of document.querySelectorAll('[data-light-layout]'))
      button.setAttribute('aria-pressed',String(Number(button.dataset.lightLayout)===PARAMS.lightLayout));
  }
  for(const button of document.querySelectorAll('[data-light-layout]')) {
    button.addEventListener('click',()=>{
      PARAMS.lightLayout=Number(button.dataset.lightLayout);
      updateLightLayout();
    });
  }
  updateLightLayout();

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
    for (const [key, label] of [['lens-gap', '高低频透镜轴向距离'], ['ripple-count', '当前可见涟漪']]) {
      const wrap = document.createElement('div');
      wrap.className = 'module-readonly';
      wrap.innerHTML = `<span>${label}</span><output id="${key}">0</output>`;
      holder.append(wrap);
    }
  }
  buildParameterPanel();

  $('reset-btn').addEventListener('click', () => {
    for (const [name, value] of Object.entries(INPUT_DEFAULTS)) {
      $(name).value = String(value);
      $(name).dispatchEvent(new Event('input'));
    }
    $('wave-enabled').checked = true; $('wave-enabled').dispatchEvent(new Event('change'));
    $('surface-enabled').checked = false; $('surface-enabled').dispatchEvent(new Event('change'));
    Object.assign(PARAMS, PARAM_DEFAULTS);
    updateLightLayout();
    glow.resetView();
    selectedPalette=DEFAULT_PALETTE;
    glow.setPalette(paletteUniforms(selectedPalette));
    for (const card of document.querySelectorAll('.palette-card'))
      card.setAttribute('aria-pressed',String(card.dataset.palette===selectedPalette.id));
    $('palette-note').textContent=selectedPalette.note;
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
    clearInterval(audioTimer);
    glow.destroy(); stopMicrophone(); if (activeUrl) URL.revokeObjectURL(activeUrl);
    if (ctx && ctx.state !== 'closed') ctx.close();
  });

  buildPlaylist();
  selectPlaylistTrack(0, false);
  if (reduceMotion) {
    status('系统已开启减少动态效果；轴向运动与粒子涟漪已暂停');
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
