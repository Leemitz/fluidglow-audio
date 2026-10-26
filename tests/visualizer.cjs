/* Browser regression: real WebGL + real Web Audio with synthetic fixtures; no real mic.
 * npm install && npx playwright install chromium && npm test
 * Optional: PLAYWRIGHT_BROWSER_EXECUTABLE / TEST_OUTPUT_DIR / TEST_PROJECT_DIR.
 */
const { chromium } = require('playwright');
const { strict: assert } = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { serveProject } = require('./static-server.cjs');
const root = path.resolve(process.env.TEST_PROJECT_DIR || path.join(__dirname, '..'));
const output = path.resolve(process.env.TEST_OUTPUT_DIR || path.join(root, 'test-results'));
fs.mkdirSync(output, { recursive: true });
function wav(kind, hz) {
  const rate = 44100, length = rate * 5.8, data = Buffer.alloc(44 + length * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const phase = (t - .7) % .7;
    const envelope = t < .7 ? 0 : kind === 'sustain' ? Math.min(1, (t - .7) / .02)
      : phase < .28 ? Math.min(1, phase / .008) * Math.exp(-phase / .085) : 0;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * t) * .65 * envelope * 32767), 44 + i * 2);
  }
  return { name: `${kind}-${hz}.wav`, mimeType: 'audio/wav', buffer: data };
}
function denseWav(drums=true) {
  const data=wav('sustain',75), rate=44100;
  let seed=17, low=0, fast=0;
  for(let i=0;i<(data.buffer.length-44)/2;i++) {
    const t=i/rate, phase=(t-.7)%.7;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=seed/2147483648-1;
    low+=(noise-low)*.025; fast+=(noise-fast)*.16;
    const kick=drums&&t>=.7&&phase<.25?Math.min(1,phase/.008)*Math.exp(-phase/.09):0;
    const signal=2.2*low+.9*(fast-low)*(1+kick)+.25*(noise-fast)*(1+1.5*kick)
      +Math.sin(t*2*Math.PI*75)*(.14+.26*kick);
    const value=t<.7?0:Math.tanh(signal*1.35)*.95*(drums?1:Math.min(1,(t-.7)/.5));
    data.buffer.writeInt16LE(Math.round(value*32767),44+i*2);
  }
  data.name=drums?'dense-compressed-mix.wav':'bass-bed-without-drums.wav'; return data;
}
async function checkDrumFixtures(page,results) {
  for (const [id,value] of [['beatSensitivity',.9],['kickInterval',400]])
    await page.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input'))},value);
  await page.locator('#sensitivity').evaluate(el=>{el.value=3;el.dispatchEvent(new Event('input'))});
  await page.locator('#audio-file').setInputFiles(denseWav());
  await page.waitForFunction(()=>!document.getElementById('player').paused);
  await page.evaluate(()=>{__emissions.length=0;__audioFrames.length=0});
  await page.waitForFunction(()=>document.getElementById('player').ended,null,{timeout:12000});
  const compressed=await page.evaluate(()=>({events:__emissions.length,times:__emissions.map(e=>e.time),frames:__audioFrames.filter(f=>f.time>1)}));
  console.log('Dense mix drum times:',compressed.times);
  if(process.env.DIAGNOSTICS_OUT) fs.writeFileSync(path.resolve(process.env.DIAGNOSTICS_OUT),JSON.stringify(compressed));
  const headroom={};
  for(const [index,band] of ['bass','mid','high'].entries()) {
    const values=compressed.frames.map(f=>f[band]);
    const saturated=compressed.frames.filter(f=>f.old[band]>.995).length/compressed.frames.length;
    const span=Math.max(...values)-Math.min(...values);
    const motion=Math.max(...compressed.frames.map(f=>Math.abs(f.springs?.[index]||0)));
    headroom[band]={oldSaturatedFraction:saturated,newLevelRange:[Math.min(...values),Math.max(...values)],motion};
    console.log(`Compressed mix ${band}:`,JSON.stringify(headroom[band]));
    assert(saturated>.75,`${band} fixture must reproduce the old overload: ${saturated}`);
    assert(Math.max(...values)<.995&&span>.025,`${band} must retain dynamic headroom: ${span}`);
    assert(motion>.002,`${band} lens must still respond with a smaller impulse`);
  }
  assert(compressed.events>=5&&compressed.events<=8,`Dense mix has eight drum hits: ${compressed.events}`);
  // Analyser FFT blocks span ~46 ms and can precede the media clock slightly.
  const falseTimes=compressed.times.filter(t=>!Array.from({length:8},(_,i)=>.7+i*.7).some(beat=>t>=beat-.05&&t<=beat+.23));
  assert.equal(falseTimes.length,0,'Noise between drum hits must not emit: '+falseTimes.join(','));
  for(let i=1;i<compressed.times.length;i++) assert(compressed.times[i]-compressed.times[i-1]>=.37);
  results.push({compressedMix:{bassRings:compressed.events,falseTimes,bands:headroom}});

  await page.locator('#audio-file').setInputFiles(denseWav(false));
  await page.waitForFunction(()=>!document.getElementById('player').paused);
  await page.evaluate(()=>{__emissions.length=0;__audioFrames.length=0});
  await page.waitForFunction(()=>document.getElementById('player').ended,null,{timeout:12000});
  const ambientTimes=await page.evaluate(()=>__emissions.map(e=>e.time).filter(t=>t>1.3));
  console.log('No-drum bass bed:',ambientTimes);
  assert.equal(ambientTimes.length,0,'Bass bed without drums must not keep generating rings: '+ambientTimes.join(','));
  results.push('Sustained noisy bass bed without drums does not emit recurring rings');

}
const results = [], errors = [];
let browser, server;
(async () => {
  server = await serveProject(root);
  const url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    // Instrument only the test page, without shipping test hooks in the app.
    let constructor;
    window.__emissions = [];
    window.__audioFrames = [];
    let dynamicsConstructor;
    Object.defineProperty(window,'AudioDynamics',{
      get:()=>dynamicsConstructor,
      set:Original=>{ dynamicsConstructor=class extends Original {
        process(...args) {
          const raw=super.process(...args), player=document.getElementById('player');
          if(player&&!player.paused) {
            const old={};
            for(const [key,state] of Object.entries(this.bands)) {
              let sum=0;
              for(let i=state.first;i<state.end;i++) {
                const byte=Math.max(0,Math.min(1,(args[0][i]+95)/75)); sum+=byte*byte;
              }
              const rms=Math.sqrt(sum/Math.max(1,state.end-state.first));
              old[key]=Math.min(1,Math.max(0,Math.min(1,(rms-.055)/.52))**.82*args[3]);
            }
            __audioFrames.push({time:player.currentTime,bass:raw.bass,mid:raw.mid,high:raw.high,old,
              springs:window.__lens?.metrics?.springDisplacement,kick:{...this.diagnostics.bass}});
          }
          return raw;
        }
      }; }
    });
    Object.defineProperty(window, 'LensRenderer', {
      get: () => constructor,
      set: fn => {
        constructor = options => {
          const instance = fn(options), emit = instance.emitRipple;
          instance.emitRipple = (samples, strength) => {
            window.__emissions.push({ samples: Array.from(samples), strength, time: document.getElementById('player')?.currentTime });
            emit(samples, strength);
          };
          window.__lens = instance; return instance;
        };
        constructor.defaults = fn.defaults;
      }
    });
  });
  await page.goto(url);
  if(process.env.TEST_FOCUS==='drums'){
    await checkDrumFixtures(page,results);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({passed:true,results,errors},null,2));
    console.log(JSON.stringify({passed:true,results,errors},null,2));return;
  }
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => __lens.ready), true, JSON.stringify(errors));
  let metrics = await page.evaluate(() => __lens.metrics);
  assert.deepEqual(metrics.radii, [1, .76, .54]);
  assert.equal(metrics.particlesPerRipple,9216);
  assert.equal(metrics.sideSaturation,.18);
  assert.equal(await page.locator('[data-palette="bronze"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#motion').inputValue(),'70');
  assert.equal(await page.locator('#beatSensitivity').inputValue(),'1.45');
  assert.equal(await page.locator('#kickInterval').inputValue(),'300');
  assert(metrics.depths[0] < metrics.depths[1] && metrics.depths[1] < metrics.depths[2]);
  assert.equal(metrics.activeRipples,0,'An idle playlist must not invent audio beats');
  await page.locator('#test-wave-btn').click();
  await page.screenshot({ path: path.join(output, 'lenses-desktop.png') });
  results.push('WebGL compiles; playlist waits for playback; manual preview emits; ordered radii and depths');

  assert(metrics.lensExtentsY.every(lens => lens.convexY < lens.flatY), 'Convex face must extend along -Y');
  assert.equal(await page.evaluate(() => __lens.params.thickness), .50);
  assert.equal(await page.evaluate(() => __lens.params.bandWidth), 2.6);
  const canvas = page.locator('#fluid-canvas'), rect = await canvas.boundingBox();
  const dragFrom = { x: rect.x + rect.width * .28, y: rect.y + rect.height * .4 };
  await page.mouse.move(dragFrom.x, dragFrom.y); await page.mouse.down();
  await page.mouse.move(dragFrom.x + 190, dragFrom.y + 75, { steps: 12 }); await page.mouse.up();
  metrics = await page.evaluate(() => __lens.metrics);
  assert(Math.abs(metrics.viewRotation[0]) + Math.abs(metrics.viewRotation[1]) > .1);
  assert(Math.abs(Math.hypot(...metrics.viewRotation) - 1) < 1e-6);
  assert(!(await canvas.evaluate(el => el.classList.contains('is-orbiting'))));
  await page.screenshot({ path: path.join(output, 'lenses-orbit.png') });
  await page.locator('#reset-view-btn').click();
  assert.deepEqual(await page.evaluate(() => __lens.metrics.viewRotation), [0, 0, 0, 1]);
  await page.mouse.move(dragFrom.x, dragFrom.y); await page.mouse.down();
  await page.mouse.move(dragFrom.x + Math.PI / .006, dragFrom.y, { steps: 20 }); await page.mouse.up();
  await page.waitForTimeout(80);
  assert((await page.evaluate(() => __lens.metrics.axisY[2])) < 0, 'Orbit can view the opposite face');
  assert.equal(await page.evaluate(() => document.querySelector('canvas').getContext('webgl').getError()), 0);
  await page.screenshot({ path: path.join(output, 'lenses-reverse.png') });
  await canvas.dblclick({ position: { x: rect.width / 2, y: rect.height / 2 } });
  assert.deepEqual(await page.evaluate(() => __lens.metrics.viewRotation), [0, 0, 0, 1]);
  await canvas.press('ArrowRight');
  assert(Math.abs((await page.evaluate(() => __lens.metrics.viewRotation))[1]) > .01);
  await canvas.press('Home');
  assert.deepEqual(await page.evaluate(() => __lens.metrics.viewRotation), [0, 0, 0, 1]);
  results.push('Thick lenses face -Y; wider bands; pointer orbit, opposite view, button/double-click/keyboard reset');

  // Isolate real GPU draws: flat face only, then sidewall only. This tests
  // reflection on the plane rather than inferring it from the convex face.
  const probeStats=await page.evaluate(async()=>{
    const original=__lens, element=document.createElement('canvas');
    element.id='material-probe'; element.style.cssText='position:fixed;left:0;top:0;width:720px;height:720px;z-index:99';
    document.body.append(element);
    // Keep the isolated probe's physics clock deterministic. Sampling one
    // arbitrary frame after an 80ms timeout can miss the spring's peak on a
    // slow software GPU and falsely report a changed motion multiplier.
    const nativeFrame=window.requestAnimationFrame;let probeFrame;
    window.requestAnimationFrame=fn=>{probeFrame=fn;return 0};
    const probe=LensRenderer({canvas:element,maxDpr:1,reflection:1,edgeGlow:0,fresnelEdge:0,interReflection:0});
    window.requestAnimationFrame=fn=>fn===probeFrame?0:nativeFrame(fn);
    let probeNow=performance.now();
    function advance(ms){
      for(let left=ms;left>1e-6;){const step=Math.min(left,1000/120);probeNow+=step;probeFrame(probeNow);left-=step;}
    }
    const gl=element.getContext('webgl'), draw=gl.drawArrays.bind(gl), clear=gl.clear.bind(gl);
    let mode='flat', seen=false, lines=0, receiver=0, neighborShift=0;
    gl.clear=(...args)=>{seen=false;clear(...args)};
    gl.drawArrays=(...args)=>{
      if(args[0]===gl.LINES) lines++;
      const p=gl.getParameter(gl.CURRENT_PROGRAM), loc=gl.getUniformLocation(p,'u_surface');
      if(!loc)return;
      const surface=gl.getUniform(p,loc);
      if(mode==='flat'&&surface===1&&!seen&&gl.getUniform(p,gl.getUniformLocation(p,'u_lensIndex'))===receiver){
        seen=true;
        if(neighborShift){
          const data=gl.getUniformLocation(p,'u_lensData'+(receiver+1)),value=gl.getUniform(p,data);
          gl.uniform3f(data,value[0],value[1]+neighborShift,value[2]);
        }
        draw(...args);
      }
      else if(mode==='far'&&surface===0&&!seen){seen=true;draw(...args)}
      else if(mode==='side'&&surface>=2)draw(...args);
    };
    async function pixels(){
      advance(1000/60);
      const pixels=new Uint8Array(element.width*element.height*4);
      gl.readPixels(0,0,element.width,element.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      return pixels;
    }
    function bright(data){let n=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>150)n++;return n}
    function difference(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)n++;return n}
    async function brightness(){return bright(await pixels())}
    const flat=await brightness();
    // Clear-glass far face must not restore the old narrow ghost pair.
    // The default frosted cap is intentionally visible as a soft veil.
    mode='far';probe.setParams({convexFrost:0});const farGhost=await brightness();
    probe.setParams({convexFrost:.78});mode='flat';
    probe.setParams({reflection:0}); const flatWithoutReflection=await brightness();
    mode='side';probe.setParams({edgeGlow:1.25});const side=await brightness();
    probe.setParams({edgeSat:1});const saturatedSide=await pixels();
    probe.setParams({edgeSat:.18});const pearlSide=await pixels();
    function chroma(data){let c=0,n=0;for(let i=0;i<data.length;i+=4){if(data[i]+data[i+1]+data[i+2]>90){c+=Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]);n++}}return c/Math.max(1,n)}
    const sideChromaRatio=chroma(pearlSide)/chroma(saturatedSide);

    mode='flat';probe.setParams({reflection:1,interReflection:0,edgeGlow:1.25});
    const largeWithout=await pixels();probe.setParams({interReflection:1});const largeWith=await pixels();
    const mediumOnBass=difference(largeWithout,largeWith);
    neighborShift=.4;const largeShifted=await pixels();neighborShift=0;
    const mediumReflectionMoves=difference(largeWith,largeShifted);
    receiver=1;probe.setParams({interReflection:0});const mediumWithout=await pixels();
    probe.setParams({interReflection:1});const mediumWith=await pixels();
    const highOnMedium=difference(mediumWithout,mediumWith);
    neighborShift=.4;const mediumShifted=await pixels();neighborShift=0;receiver=0;
    const highReflectionMoves=difference(mediumWith,mediumShifted);

    probe.setParams({reflection:0,interReflection:0,edgeGlow:0,light:0,fresnelEdge:1.2});
    const rimPixels=await pixels(),fresnelPixels=bright(rimPixels);
    function rimProfile(data,tilt){
      const roll=probe.params.rotation,cr=Math.cos(roll),sr=Math.sin(roll),ct=Math.cos(tilt),st=Math.sin(tilt);
      const depth=probe.metrics.depths[0],scale=element.width*.32,profile=[];
      for(let i=0;i<180;i++){
        const a=i*Math.PI/90,x=.992*Math.cos(a),z=.992*Math.sin(a);
        const px=Math.round(element.width/2+(cr*x-sr*ct*z+sr*st*depth+probe.params.posX)*scale);
        const py=Math.round(element.height/2+(sr*x+cr*ct*z-cr*st*depth+probe.params.posY)*scale);
        let value=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const at=((py+dy)*element.width+px+dx)*4;value=Math.max(value,(data[at]+data[at+1]+data[at+2])/3);
        }profile.push(value);
      }return profile;
    }
    const profileA=rimProfile(rimPixels,probe.params.incline);
    probe.setParams({incline:-.55});const tilted=await pixels(),profileB=rimProfile(tilted,-.55);
    const movingFresnel=profileA.reduce((sum,v,i)=>sum+Math.abs(v-profileB[i]),0)/profileA.length;
    probe.setParams({incline:-.97,fresnelEdge:0});
    mode='physics'; // State checks do not need to shade a full 720px receiver.
    const delay=async ms=>advance(ms);
    const bassBefore=probe.metrics.depths[0];
    probe.setAudio({bass:1,mid:0,high:0});await delay(350);
    const volumeDrift=Math.abs(probe.metrics.depths[0]-bassBefore);
    probe.kick({bass:1});await delay(80);
    const drumDisplacement=Math.abs(probe.metrics.depths[0]-bassBefore);
    await delay(700);
    const residual=Math.abs(probe.metrics.depths[0]-bassBefore);
    probe.setParams({motionGain:0});probe.kick({bass:1});await delay(100);
    const disabledMotion=Math.abs(probe.metrics.depths[0]-bassBefore);
    probe.setParams({motionGain:.5});probe.clearMotion();probe.setAudio({bass:0,mid:0,high:0});
    await delay(250);
    async function impulseGain(band,multiplier){
      probe.clearMotion();probe.setParams({midMotion:band==='mid'?multiplier:1,highMotion:band==='high'?multiplier:1});
      advance(1000/60);
      const index=band==='mid'?1:2,before=probe.metrics.depths[index];
      probe.kick({[band]:1});await delay(80);
      return Math.abs(probe.metrics.depths[index]-before);
    }
    const midBase=await impulseGain('mid',1),midBoost=await impulseGain('mid',2);
    const highBase=await impulseGain('high',1),highBoost=await impulseGain('high',2.25);
    probe.destroy();element.remove();window.__lens=original;window.requestAnimationFrame=nativeFrame;
    return {flat,farGhost,flatWithoutReflection,side,lines,sideChromaRatio,mediumOnBass,mediumReflectionMoves,
      highOnMedium,highReflectionMoves,fresnelPixels,movingFresnel,volumeDrift,drumDisplacement,residual,disabledMotion,
      midGain:midBoost/midBase,highGain:highBoost/highBase};
  });
  assert(probeStats.flat>1000,JSON.stringify(probeStats));
  assert(probeStats.flatWithoutReflection<100,JSON.stringify(probeStats));
  assert(probeStats.farGhost<100,'Far-face ghost bands must be removed: '+JSON.stringify(probeStats));
  assert(probeStats.side>500,JSON.stringify(probeStats));
  assert.equal(probeStats.lines,0,'Separate face outline circles must not be drawn');
  assert(probeStats.volumeDrift<1e-6,'Sustained bass level must not move the large lens');
  assert(probeStats.drumDisplacement>.002&&probeStats.drumDisplacement<.025,'Drum response must be visible and gentle');
  assert(probeStats.residual<.002,'Damped response must settle');
  assert(probeStats.disabledMotion<1e-6,'Zero motion setting must stop movement');
  assert(probeStats.sideChromaRatio<.5,'Side guide must be substantially less saturated');
  assert(probeStats.mediumOnBass>200&&probeStats.highOnMedium>200,'Adjacent lenses must appear in the receiving lens');
  assert(probeStats.mediumReflectionMoves>100&&probeStats.highReflectionMoves>100,'Reflections must follow the adjacent lens positions');
  assert(probeStats.fresnelPixels>100&&probeStats.movingFresnel>5,'Flat rim must have a view-dependent Fresnel arc');
  assert(probeStats.midGain>1.6&&probeStats.highGain>1.8,'Mid and high motion gain must be visibly amplified');
  console.log('GPU material probe:',JSON.stringify(probeStats));
  results.push({analyticUnlitReflectionsAndSideGuide:probeStats});

  await page.locator('#wave-enabled').uncheck();
  assert.equal(await page.evaluate(() => __lens.metrics.activeRipples), 0);
  await page.locator('#wave-enabled').check();
  await page.locator('#test-wave-btn').click();
  assert((await page.evaluate(() => __lens.metrics.activeRipples)) > 0);
  await page.evaluate(() => {
    for (let i = 0; i < 15; i++) document.getElementById('test-wave-btn').click();
  });
  assert.equal(await page.evaluate(() => __lens.metrics.activeRipples), 6);
  results.push('Ripple switch clears; manual preview emits; pool is bounded to six');

  // Inspect a single wavefront independently of the audio/UI animation loop.
  await page.locator('#wave-enabled').uncheck();
  const emission=await page.evaluate(() => {
    __lens.setRipplesEnabled(true);
    const expected=__lens.metrics.lensExtentsY[0].convexY;
    __lens.emitRipple(new Float32Array(96).fill(.5), 1);
    return {expected,actual:__lens.metrics.rippleProfiles[0].emissionY};
  });
  assert(Math.abs(emission.expected-emission.actual)<1e-6,'Ripple must originate at the bass convex apex');
  assert.equal(await page.evaluate(() => __lens.metrics.activeRipples), 1);
  const earlyProfile = await page.evaluate(() => __lens.metrics.rippleProfiles[0]);
  await page.waitForTimeout(800);
  const laterProfile = await page.evaluate(() => __lens.metrics.rippleProfiles[0]);
  assert(laterProfile.radius > earlyProfile.radius);
  assert(laterProfile.peakHeight > earlyProfile.peakHeight);
  assert(laterProfile.baseY > earlyProfile.baseY);
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => __lens.metrics.activeRipples), 0);
  results.push('Expanding wavefront gains height along +Y, then fades and releases its pool slot');
  await page.locator('#wave-enabled').check();

  if(process.env.TEST_FOCUS!=='visual'){
    const audioCounts = {};
    for (const [kind, hz] of [['pulses', 75], ['pulses', 6000], ['sustain', 75]]) {
      await page.locator('#audio-file').setInputFiles(wav(kind, hz));
      await page.waitForFunction(() => !document.getElementById('player').paused);
      await page.evaluate(() => { __emissions.length = 0; });
      await page.waitForFunction(() => document.getElementById('player').ended, null, { timeout: 12000 });
      const emitted = await page.evaluate(() => __emissions);
      audioCounts[`${kind}-${hz}`] = emitted.length;
      console.log(`${kind}-${hz}: ${emitted.length} onsets at ${emitted.map(e => e.time.toFixed(2)).join(', ')}`);
      if (hz === 75 && kind === 'pulses') {
        assert(emitted.length >= 5 && emitted.length <= 8, `Expected bass attacks, got ${emitted.length}`);
        assert(emitted.every(e => e.samples.length === 96));
        assert(emitted.some(e => Math.max(...e.samples.slice(0, 24)) > Math.max(...e.samples.slice(64)) + .2));
      } else if (hz === 6000) assert.equal(emitted.length, 0, 'Treble must not emit bass rings');
      else assert(emitted.length <= 1, 'Sustained bass must not repeatedly emit');
    }
    results.push({ realAudioOnsets: audioCounts, spectrum: '96 log-spaced intervals captured at impact' });

    await checkDrumFixtures(page,results);
  } else results.push('Visual focus: browser audio fixtures are checked separately, not waived');

  await page.locator('#playlist-btn').click();
  await page.waitForFunction(() => !document.getElementById('player').paused);
  await page.locator('#play-btn').click();
  await page.locator('[data-palette="rose"]').click();
  assert.equal(await page.locator('[data-palette="rose"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#fluid-params').evaluate(el => { el.open = true; });
  const heightBefore = await page.locator('#fluid-canvas').evaluate(el => el.clientHeight);
  await page.locator('[data-param="thickness"]').evaluate(el => { el.value = '.90'; el.dispatchEvent(new Event('input')); });
  await page.locator('[data-param="spread"]').evaluate(el => { el.value = '.65'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(180);
  metrics = await page.evaluate(() => __lens.metrics);
  assert(metrics.lensExtentsY[1].convexY >= metrics.lensExtentsY[0].flatY + .099);
  assert(metrics.lensExtentsY[2].convexY >= metrics.lensExtentsY[1].flatY + .099);
  assert.equal(await page.locator('#fluid-canvas').evaluate(el => el.clientHeight), heightBefore);
  await page.locator('#reset-btn').click();
  assert.equal(await page.locator('[data-param="thickness"]').inputValue(), '0.5');
  assert.equal(await page.locator('[data-palette="bronze"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#motion').inputValue(),'70');
  assert.equal(await page.locator('#beatSensitivity').inputValue(),'1.45');
  assert.equal(await page.locator('#kickInterval').inputValue(),'300');
  results.push('Palettes, extreme thickness/spacing, fixed canvas height, and reset');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __lens.metrics.activeRipples), 0);
  const staticDepths = await page.evaluate(() => __lens.metrics.depths);
  await page.waitForTimeout(450);
  const nextDepths = await page.evaluate(() => __lens.metrics.depths);
  staticDepths.forEach((v, i) => assert(Math.abs(v - nextDepths[i]) < .003));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(600);
  const mobileRect = await canvas.boundingBox(), cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: mobileRect.y + 150 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: mobileRect.y + 180 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(Math.abs((await page.evaluate(() => __lens.metrics.viewRotation))[1]) > .05);
  await page.locator('#reset-view-btn').click();
  await page.locator('#toast').evaluate(el => el.classList.remove('visible'));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: path.join(output, 'lenses-mobile.png') });
  assert.equal(await page.evaluate(() => document.querySelector('canvas').getContext('webgl').getError()), 0);
  results.push('Live reduced-motion preference, mobile touch orbit/layout, zero GL errors');

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === 'webgl' ? null : getContext.call(this, kind, ...args); };
  });
  await fallback.goto(url);
  assert(await fallback.locator('body').evaluate(el => el.classList.contains('no-webgl')));
  assert.equal(await fallback.locator('.fallback-visual span').count(), 3);
  results.push('WebGL unavailable: labelled three-lens CSS fallback');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, process.env.TEST_FOCUS==='visual'?'visual-validation.json':'validation.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, errors }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); if (server) server.close(); });
