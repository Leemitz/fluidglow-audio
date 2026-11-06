/* Node regression for concave-upper convex-lower meniscus mesh + inward flow.
 * Uses a recording GL implementation: verifies geometry and draw commands,
 * not browser GPU shader compilation or photographic appearance.
 */
const assert=require('node:assert/strict');
const LensRenderer=require('../lenses.js').LensRenderer;
assert.equal(typeof LensRenderer,'function');
const prevWindow=global.window,prevRAF=global.requestAnimationFrame,
  prevCancel=global.cancelAnimationFrame;
let scheduled=null,number=0;
const gl={
  POINTS:0,TRIANGLES:4,FLOAT:5126,ARRAY_BUFFER:34962,STATIC_DRAW:35044,
  VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,
  LINK_STATUS:35714,FRAGMENT_SHADER_PRECISION:1,HIGH_FLOAT:36338,
  COLOR_BUFFER_BIT:16384,DEPTH_TEST:2929,BLEND:3042,SRC_ALPHA:770,ONE:1,
  ONE_MINUS_SRC_ALPHA:771,
  buffers:[],draws:[],bound:null,program:null,
  createProgram(){return {uniforms:{}}},createShader(){return {}},
  shaderSource(){},compileShader(){},getShaderParameter(){return true},
  attachShader(){},linkProgram(){},getProgramParameter(){return true},
  getShaderInfoLog(){return ''},getProgramInfoLog(){return ''},
  deleteShader(){},deleteProgram(){},getShaderPrecisionFormat(){return {precision:23}},
  createBuffer(){const b={data:null};this.buffers.push(b);return b},
  bindBuffer(target,b){this.bound=b},
  bufferData(target,data){this.bound.data=Float32Array.from(data)},
  bufferSubData(target,offset,data){this.bound.data.set(data,offset/4)},
  deleteBuffer(){},getAttribLocation(){return 0},
  getUniformLocation(program,name){return {program,name}},
  useProgram(p){this.program=p},
  uniform1f(loc,v){loc.program.uniforms[loc.name]=v},
  uniform2f(loc,a,b){loc.program.uniforms[loc.name]=[a,b]},uniform3f(){},uniform3fv(){},
  disableVertexAttribArray(){},enableVertexAttribArray(){},vertexAttribPointer(){},
  viewport(){},clearColor(){},clear(){},disable(){},enable(){},blendFunc(){},
  drawArrays(mode,start,count){
    this.draws.push({mode,count,uniforms:{...this.program.uniforms}});
  }
};
const canvas={clientWidth:700,clientHeight:560,classList:{add(){},remove(){}},
  getContext(type){assert.equal(type,'webgl');return gl},
  addEventListener(){},removeEventListener(){},hasPointerCapture(){return false}};
global.window={devicePixelRatio:1,matchMedia(){return {matches:false,addEventListener(){},removeEventListener(){}}},
  addEventListener(){},removeEventListener(){}};
global.requestAnimationFrame=fn=>{scheduled=fn;return ++number};
global.cancelAnimationFrame=()=>{};
try{
  const probe=LensRenderer({canvas,maxDpr:1});
  assert.equal(probe.ready,true);
  assert.equal(probe.params.convexFrost,.12);
  assert.equal(probe.params.opacity,.26);
  assert.equal(probe.params.waterfallDensity,1.70);
  assert.equal(probe.params.sideGoldWidth,.10);

  const faceLength=128*40*6*6;
  const faces=gl.buffers.filter(b=>b.data.length===faceLength);
  assert.equal(faces.length,2,'Meniscus has two curved surfaces');
  const [lower,upper]=faces.map(b=>b.data);
  const pos=(data,i)=>[data[i*6],data[i*6+1],data[i*6+2]];
  const close=(a,b,eps=1e-5)=>assert(Math.abs(a-b)<=eps,a+' not near '+b);
  const ease=r=>.5-.5*Math.cos(Math.PI*r);
  const low=r=>-.50+1.03*ease(r);
  const high=r=>.50+.27*ease(r);
  close(pos(lower,0)[2],.5);
  close(pos(upper,0)[2],-.5);
  for(const ring of [0,1,10,20,30,39]){
    const offset=ring*128*6,radius=ring/40;
    const l=pos(lower,offset),u=pos(upper,offset);
    close(l[0],u[0]);close(l[1],u[1]);
    close(-l[2],low(radius));
    close(-u[2],high(radius));
    assert(-l[2]<-u[2],'Glass faces must not cross');
    if(ring>0&&ring<39){
      assert(lower[offset*6+3]>0,'Lower face is radially convex');
      assert(upper[offset*6+3]<0,'Upper face is radially concave');
    }
    close(lower[offset*6+5],1);
    close(upper[offset*6+5],-1);
  }
  close(-pos(lower,39*128*6+1)[2],.53,3e-5);
  close(-pos(upper,39*128*6+1)[2],.77,3e-5);
  const slope=(fn,r)=>(fn(r+.0001)-fn(r-.0001))/.0002;
  for(const fn of [low,high]){
    close(slope(fn,0),0,1e-4);
    close(slope(fn,1),0,1e-4);
    assert(slope(fn,.5)>slope(fn,.2));
    assert(slope(fn,.5)>slope(fn,.8));
  }
  const flow=gl.buffers.find(b=>b.data.length===360*64*4);
  assert(flow,'Need 23040 stationary waterfall particles per lens');
  const data=flow.data;
  for(let i=0;i<data.length;i+=4){
    assert(data[i+1]>=0&&data[i+1]<1);
    assert(data[i+2]>=0&&data[i+2]<1);
    assert(data[i+3]>=0&&data[i+3]<1);
  }
  // Check nonuniform density AFTER time advances. A nonlinear starting
  // layout followed by linear position updates would not pass.
  const distribution=time=>{
    let edge=0,center=0;
    for(let i=0;i<data.length;i+=4){
      const seed=data[i+2],speed=.24*(.88+.24*seed);
      const cycle=(data[i+1]+time*speed)%1;
      const r=1-Math.pow(cycle,3.2);
      if(r>=.7)edge++;
      if(r<.3)center++;
      const layer=Math.min(.88,Math.max(.12,.5+(data[i+3]*2-1)*.36));
      const y=low(r)+(high(r)-low(r))*layer;
      assert(y>low(r)&&y<high(r),'Waterfall point inside glass');
    }
    return {edge,center,ratio:edge/Math.max(1,center)};
  };
  const bias=[0,.4,1.7,4.2].map(distribution);
  assert(bias.every(x=>x.ratio>4),'Flow must stay rim-dense, centre-sparse');
  // Fixed emitter means the same particles keep identical angles as time
  // advances; the fragment and vertex source contain no angular animation.
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../lenses.js'),'utf8');
  assert(source.includes('float angle=a_flow.x;'));
  assert(!source.includes('float angle=a_flow.x+'));
  const phase=data[13],seed=data[14];
  const p0=1-Math.pow(phase,3.2);
  const p1=1-Math.pow((phase+.08*.24*(.88+.24*seed))%1,3.2);
  assert(p1<p0,'A particle advances inward');
  scheduled(performance.now()+16);
  // Draw calls must receive the six independently controlled values, not
  // just expose them in the HTML. The default single-cosine profile is 1/1.
  const faceCalls=()=>gl.draws.filter(d=>d.mode===gl.TRIANGLES&&d.count===128*40*6);
  assert.equal(faceCalls().length,6,'Two curved surfaces drawn for each of 3 lenses');
  assert(faceCalls().every(d=>JSON.stringify(d.uniforms.u_profile)==='[1,1]'));
  probe.setParams({bassProfileAmp:0,bassProfileWave:4,
    midProfileAmp:.38,midProfileWave:2,highProfileAmp:.83,highProfileWave:1.5,
    sideGoldWidth:1});
  const start=gl.draws.length;
  scheduled(performance.now()+28);
  const changed=gl.draws.slice(start).filter(d=>d.mode===gl.TRIANGLES&&d.count===128*40*6);
  assert.deepEqual(changed.map(d=>d.uniforms.u_profile),
    [[0,4],[0,4],[.38,2],[.38,2],[.83,1.5],[.83,1.5]],
    'Each lens has two faces sharing its own amplitude and wavelength');
  assert(changed.every(d=>d.uniforms.u_sideGoldWidth===1),
    '100% gold sidewall parameter reaches glass shader');
  const waterfallProfile=gl.draws.slice(start).filter(d=>d.count===23040);
  assert.deepEqual(waterfallProfile.map(d=>d.uniforms.u_profile),
    [[0,4],[.38,2],[.83,1.5]],
    'Internal flow must track the corresponding curved surface');
  probe.setParams({bassProfileAmp:1,bassProfileWave:1,
    midProfileAmp:1,midProfileWave:1,highProfileAmp:1,highProfileWave:1,
    sideGoldWidth:.10});
  gl.draws.length=0;
  scheduled(performance.now()+44);
  const draws=gl.draws.filter(d=>d.mode===gl.POINTS&&d.count===23040);
  assert.equal(draws.length,3,'All three lenses emit a waterfall');
  assert.deepEqual(draws.map(x=>x.uniforms.u_fade),[1,.58,.28]);
  assert.equal(probe.metrics.waterfallCount,69120);
  const bounds=probe.metrics.lensExtentsY;
  assert.equal(bounds.length,3);
  assert(bounds.every(x=>x.convexY<x.upperCenterY&&x.upperCenterY<x.upperRimY));
  assert(bounds.every(x=>x.lowerRimY<x.upperRimY));
  assert(bounds[1].convexY>=bounds[0].upperRimY+.099);
  assert(bounds[2].convexY>=bounds[1].upperRimY+.099);
  probe.emitRipple(new Float32Array(96).fill(.5),1);
  close(probe.metrics.rippleProfiles[0].emissionY,bounds[0].convexY);
  const before=gl.draws.length;
  probe.setParams({waterfallDensity:0});
  scheduled(performance.now()+32);
  assert.equal(gl.draws.slice(before).filter(x=>x.count===23040).length,0,
    'Zero density disables waterfall draws');
  probe.destroy();
  console.log(JSON.stringify({meniscus:'passed',profile:'upper concave, lower convex',
    waterfallPoints:69120,spatialDensity:bias,glass:{opacity:.26,frost:.12}}));
}finally{
  global.window=prevWindow;
  global.requestAnimationFrame=prevRAF;
  global.cancelAnimationFrame=prevCancel;
}