// Isolated GPU receivers: angular light coverage and the wavefront's actual travel uniform.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {serveProject}=require('./static-server.cjs');
const root=path.resolve(process.env.TEST_PROJECT_DIR||path.join(__dirname,'..'));
const output=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(root,'test-results'));
let browser,server;
(async()=>{
  fs.mkdirSync(output,{recursive:true});server=await serveProject(root);
  browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_BROWSER_EXECUTABLE}:{}),
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const url='http://127.0.0.1:'+server.address().port;
  await page.addScriptTag({url:url+'/lenses.js'});
  const stats=await page.evaluate(async()=>{
    // Drive only this renderer at known frame times, independent of a slow
    // software GPU. The real GL vertex shader still consumes every uniform.
    const nativeFrame=requestAnimationFrame;let nextFrame;
    window.requestAnimationFrame=fn=>{nextFrame=fn;return 0};
    function tick(now=performance.now()){const fn=nextFrame;nextFrame=null;fn(now)}
    const canvas=document.createElement('canvas');
    canvas.style.cssText='position:fixed;left:0;top:0;width:360px;height:360px;z-index:99';document.body.append(canvas);
    const probe=LensRenderer({canvas,maxDpr:1,edgeGlow:0,fresnelEdge:0,interReflection:0,reflection:1,posY:0});
    const gl=canvas.getContext('webgl'),draw=gl.drawArrays.bind(gl),clear=gl.clear.bind(gl);
    let mode='flat',seen=false,lastParticle=null;
    gl.clear=(...args)=>{seen=false;clear(...args)};
    gl.drawArrays=(...args)=>{
      const program=gl.getParameter(gl.CURRENT_PROGRAM);
      if(args[0]===gl.POINTS){
        if(mode==='particles'){
          lastParticle={age:gl.getUniform(program,gl.getUniformLocation(program,'u_age')),
            travel:gl.getUniform(program,gl.getUniformLocation(program,'u_travel'))};draw(...args);
        }return;
      }
      const surface=gl.getUniformLocation(program,'u_surface');
      if(mode==='flat'&&surface&&!seen&&gl.getUniform(program,surface)===1
        &&gl.getUniform(program,gl.getUniformLocation(program,'u_lensIndex'))===0){seen=true;draw(...args)}
    };
    const frame=async()=>tick();
    async function coverage(){
      await frame();const data=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
      let bright=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>150)bright++;
      const area=Math.PI*(canvas.width*.32*.88)**2*Math.abs(probe.metrics.axisY[2]);
      return bright/area;
    }
    const views=[];
    for(const incline of [-.15,-.55,-.95,-1.30])for(const yaw of [-10,-5,0,5,10]){
      probe.resetView();probe.setParams({incline});
      for(let i=0;i<Math.abs(yaw);i++)canvas.dispatchEvent(new KeyboardEvent('keydown',{key:yaw<0?'ArrowLeft':'ArrowRight'}));
      await frame();if(probe.metrics.axisY[2]<.15)continue; // Flat face must face the observer.
      const row={incline,yaw,normalZ:probe.metrics.axisY[2]};
      for(const [layout,key]of [[0,'classic'],[1,'multi'],[2,'rings']]){
        probe.setParams({lightLayout:layout});row[key]=await coverage();
      }views.push(row);
    }
    const angular={views};
    for(const key of ['classic','multi','rings'])angular[key]={
      visibleViews:views.filter(v=>v[key]>.025).length,
      meanCoverage:views.reduce((sum,v)=>sum+v[key],0)/views.length,
      minimumCoverage:Math.min(...views.map(v=>v[key]))};

    mode='particles';probe.resetView();probe.setParams({incline:-.15,zoom:.3,rippleLife:2,rippleSpeed:.78,
      rippleDrag:3,rippleHeight:0,rippleRise:0});probe.clearRipples();await frame();
    probe.emitRipple(new Float32Array(96).fill(.5),1);
    const born=performance.now();
    const samples=[probe.metrics.rippleProfiles[0]],gpuErrors=[];
    for(let i=0;i<4;i++){
      tick(born+(i+1)*400);
      const profile=probe.metrics.rippleProfiles[0];samples.push(profile);
      gpuErrors.push(Math.abs(lastParticle.travel-(profile.radius-1)));
    }
    const speeds=samples.slice(1).map((s,i)=>(s.radius-samples[i].radius)/(s.age-samples[i].age));
    tick(born+2100);const expired=probe.metrics.activeRipples===0;
    probe.clearRipples();probe.setParams({rippleDrag:0});probe.emitRipple(new Float32Array(96).fill(.5),1);
    tick(performance.now()+350);
    const linear=probe.metrics.rippleProfiles[0];
    const result={angular,wave:{samples,speeds,gpuErrors,expired,linearRate:(linear.radius-1)/linear.age}};
    probe.destroy();canvas.remove();window.requestAnimationFrame=nativeFrame;return result;
  });
  console.log(JSON.stringify(stats,null,2));
  assert(stats.angular.views.length>=15);
  assert(stats.angular.multi.visibleViews>=stats.angular.views.length*.85,'Wide bands must cover most tested flat-face viewing angles');
  assert(stats.angular.multi.meanCoverage>stats.angular.classic.meanCoverage*1.5,'Multi-panel studio must materially improve coverage');
  assert(stats.angular.rings.visibleViews>=stats.angular.views.length*.80,'Ring emitters must also cover most tested angles');
  const wave=stats.wave;
  assert(wave.speeds[0]>wave.speeds[1]&&wave.speeds[1]>wave.speeds[2]&&wave.speeds[2]>wave.speeds[3]);
  assert(wave.speeds[0]>wave.speeds[3]*2,'The deceleration should be visible, not a barely changed constant speed');
  assert(wave.gpuErrors.every(e=>e<1e-5),'The particle vertex shader must receive the eased displacement');
  assert(wave.samples[2].radius-1>.78*wave.samples[2].age,'Early expansion must beat the previous linear speed');
  assert.equal(wave.samples[0].finalRadius,2.56,'Final distance must remain average speed * lifetime');
  assert(wave.samples[4].radius<wave.samples[0].finalRadius);
  assert(wave.expired);assert(Math.abs(wave.linearRate-.78)<1e-5,'Drag zero restores linear expansion');

  await page.goto(url);
  await page.locator('#fluid-params').evaluate(el=>{el.open=true});
  for(const layout of [2,0,1]){
    await page.locator(`[data-light-layout="${layout}"]`).click();
    assert.equal(await page.locator(`[data-light-layout="${layout}"]`).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
    await page.screenshot({path:path.join(output,['lenses-classic.png','lenses-multi.png','lenses-rings.png'][layout])});
  }
  await page.locator('[data-param="rippleDrag"]').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input'))});
  await page.locator('[data-light-layout="2"]').click();await page.locator('#reset-btn').click();
  assert.equal(await page.locator('[data-light-layout="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-param="rippleDrag"]').inputValue(),'3');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'optics-validation.json'),JSON.stringify({passed:true,...stats,errors},null,2));
  console.log('Optical layouts, angular coverage, eased GPU wavefront, reset and mobile: passed');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close()});
