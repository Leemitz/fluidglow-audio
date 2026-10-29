/* Real bundled MP3 decoding, Web Audio, transport and project-subdirectory regression. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {serveProject} = require('./static-server.cjs');
const root = path.resolve(process.env.TEST_PROJECT_DIR || path.join(__dirname, '..'));
const output = path.resolve(process.env.TEST_OUTPUT_DIR || path.join(root, 'test-results'));
const tracks = [
  ['Rivers In the Desert','rivers-in-the-desert.mp3'],
  ['星と僕らと','hoshi-to-bokura-to.mp3'],
  ['远航星的告别','yuan-hang-xing-de-gao-bie.mp3'],
  ['新长征路上的摇滚','xin-chang-zheng-lu-shang-de-yao-gun.mp3'],
  ['Hello','hello.mp3']
];
const results = [], errors = [];
let browser, server;
function localWav() {
  const size = 44100, buffer = Buffer.alloc(44 + size * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length-8,4); buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(1,20); buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(44100,24); buffer.writeUInt32LE(88200,28);
  buffer.writeUInt16LE(2,32); buffer.writeUInt16LE(16,34); buffer.write('data',36); buffer.writeUInt32LE(size*2,40);
  return {name:'local-test.wav',mimeType:'audio/wav',buffer};
}
(async () => {
  fs.mkdirSync(output,{recursive:true});
  server = await serveProject(root,'/preview/fluidglow-audio');
  browser = await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_BROWSER_EXECUTABLE} : {}),
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page = await browser.newPage({viewport:{width:1440,height:1000},permissions:['microphone']});
  // Observe the browser's actual Web Audio node without modifying the app.
  await page.addInitScript(() => {
    const Context=window.AudioContext||window.webkitAudioContext;
    const createDelay=Context.prototype.createDelay;
    Context.prototype.createDelay=function(maximum) {
      const node=createDelay.call(this,maximum);
      window.__testMusicDelay=node;
      window.__testMusicDelayMax=maximum;
      return node;
    };
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/fluidglow-audio/`);
  assert.equal(await page.locator('.playlist-track').count(),5);
  assert.equal(await page.locator('[data-palette="bronze"]').getAttribute('aria-pressed'),'true');
  for (const [id,value] of [['motion','70'],['beatSensitivity','1.45'],['kickInterval','300'],['audioDelay','0']])
    assert.equal(await page.locator('#'+id).inputValue(),value);
  await page.waitForTimeout(450);
  assert(await page.evaluate(()=>document.getElementById('player').paused));
  assert.equal(await page.locator('#beat-count').textContent(),'000','Idle playlist must not generate synthetic beats');
  results.push('Five relative bundled tracks; no autoplay; requested defaults on first load');

  for (const [index,[title,file]] of tracks.entries()) {
    const size = fs.statSync(path.join(root,'audio',file)).size;
    assert(size>1000000,'Each song must be a real MP3, not a path or LFS pointer');
    const response = await page.request.get(`http://127.0.0.1:${server.address().port}/preview/fluidglow-audio/audio/${file}`,
      {headers:{Range:'bytes=0-1023'}});
    assert.equal(response.status(),206); assert.equal((await response.body()).length,1024);
    await page.locator('.playlist-track').nth(index).click();
    await page.waitForFunction(()=>{
      const p=document.getElementById('player');return !p.paused&&p.readyState>=3&&p.duration>30;
    });
    assert.equal(await page.locator('#track-name').textContent(),title);
    assert.equal(await page.locator('.playlist-track[aria-current="true"]').getAttribute('data-index'),String(index));
    await page.evaluate(()=>{document.getElementById('player').currentTime=30});
    await page.waitForFunction(()=>document.getElementById('player').currentTime>30.3);
    await page.waitForFunction(()=>Number(document.getElementById('loudness-value').textContent)>5);
    assert((await page.evaluate(()=>document.getElementById('player').currentSrc)).endsWith('/audio/'+file));
    const duration=await page.evaluate(()=>document.getElementById('player').duration);
    if(index===0){
      await page.waitForFunction(()=>!!window.__testMusicDelay);
      assert((await page.evaluate(()=>window.__testMusicDelayMax))>=.3);
      assert(Math.abs(await page.evaluate(()=>window.__testMusicDelay.delayTime.value))<.002);
      for(const ms of [150,300,0]){
        await page.locator('#audioDelay').evaluate((el,ms)=>{
          el.value=String(ms);el.dispatchEvent(new Event('input',{bubbles:true}));
        },ms);
        await page.waitForFunction(ms=>Math.abs(window.__testMusicDelay.delayTime.value-ms/1000)<.007,ms);
        assert.equal(await page.locator('#audioDelay-out').textContent(),ms+' ms');
      }
      results.push('Actual music DelayNode: adjustable 0 / 150 / 300 ms during playback');
    }
    results.push({title,bytes:size,duration,decoded:true,fftResponds:true});
    console.log(`Decoded ${index+1}/5: ${title} (${duration.toFixed(2)}s)`);
  }

  await page.locator('#play-btn').click();
  assert(await page.evaluate(()=>document.getElementById('player').paused));
  await page.locator('#play-btn').click();
  await page.waitForFunction(()=>!document.getElementById('player').paused);
  await page.locator('#seek').evaluate(el=>{el.value='500';el.dispatchEvent(new Event('input'))});
  assert(await page.evaluate(()=>{const p=document.getElementById('player');return Math.abs(p.currentTime/p.duration-.5)<.02}));
  // Last -> first wrap, then first -> last wrap.
  await page.locator('#next-btn').click();
  await page.waitForFunction(()=>document.getElementById('track-name').textContent==='Rivers In the Desert');
  await page.locator('#previous-btn').click();
  await page.waitForFunction(()=>{
    const p=document.getElementById('player');
    return document.getElementById('track-name').textContent==='Hello'&&!p.paused&&p.readyState>=3&&Number.isFinite(p.duration);
  });
  // Reach the real end of the MP3 instead of dispatching a synthetic ended event.
  await page.evaluate(()=>{const p=document.getElementById('player');p.currentTime=p.duration-.15});
  await page.waitForFunction(()=>document.getElementById('track-name').textContent==='Rivers In the Desert'&&!document.getElementById('player').paused);
  await page.waitForFunction(()=>document.getElementById('player').currentTime>.15);
  await page.evaluate(()=>{document.querySelectorAll('.playlist-track')[1].click();document.querySelectorAll('.playlist-track')[3].click()});
  await page.waitForFunction(()=>document.getElementById('track-name').textContent==='新长征路上的摇滚'&&!document.getElementById('player').paused);
  results.push('Pause/resume, seek, previous/next wrap, real ended continuation, rapid selection');

  await page.locator('#audio-file').setInputFiles(localWav());
  await page.waitForFunction(()=>document.getElementById('track-name').textContent==='local-test.wav');
  assert(await page.locator('#playlist-panel').isHidden());
  assert(await page.locator('#next-btn').isHidden());
  await page.waitForFunction(()=>document.getElementById('player').ended);
  assert.equal(await page.locator('#track-name').textContent(),'local-test.wav','Uploaded files must not advance the bundled playlist');
  await page.locator('#playlist-btn').click();
  await page.waitForFunction(()=>document.getElementById('track-name').textContent==='新长征路上的摇滚'&&!document.getElementById('player').paused);
  await page.locator('#mic-btn').click();
  await page.waitForFunction(()=>document.getElementById('mic-btn').getAttribute('aria-pressed')==='true');
  assert(await page.evaluate(()=>document.getElementById('player').paused));
  await page.locator('#mic-btn').click();
  assert(await page.locator('#playlist-panel').isVisible());
  assert(await page.evaluate(()=>document.getElementById('player').paused));
  results.push('Local file and fake microphone modes stop playlist; selected track preserved on return');

  await page.locator('[data-palette="rose"]').click();
  await page.locator('#audioDelay').evaluate(el=>{
    el.value='300';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForFunction(()=>Math.abs(window.__testMusicDelay.delayTime.value-.300)<.007);
  for(const id of ['motion','beatSensitivity','kickInterval'])
    await page.locator('#'+id).evaluate(el=>{el.value=el.min;el.dispatchEvent(new Event('input'))});
  await page.locator('#reset-btn').click();
  assert.equal(await page.locator('[data-palette="bronze"]').getAttribute('aria-pressed'),'true');
  for(const [id,value] of [['motion','70'],['beatSensitivity','1.45'],['kickInterval','300'],['audioDelay','0']])
    assert.equal(await page.locator('#'+id).inputValue(),value);
  await page.waitForFunction(()=>Math.abs(window.__testMusicDelay.delayTime.value)<.007);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(output,'playlist-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.screenshot({path:path.join(output,'playlist-mobile.png'),fullPage:true});
  results.push('Reset restores default 0 ms audio delay, Twilight Rosé, 1.45 sensitivity, 300ms interval, 70% motion; mobile fits');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'playlist-validation.json'),JSON.stringify({passed:true,results,errors},null,2));
  console.log(JSON.stringify({passed:true,results,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1})
  .finally(async()=>{if(browser)await browser.close();if(server)server.close()});
