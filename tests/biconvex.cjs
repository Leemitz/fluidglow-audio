/* Node regression for real biconvex vertex buffers + inward point-flow state.
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
  uniform2f(){},uniform3f(){},uniform3fv(){},
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
  const faceLength=128*40*6*6;
  const faces=gl.buffers.filter(b=>b.data.length===faceLength);
  assert.equal(faces.length,2,'Two equal-resolution curved faces');
  const [front,back]=faces.map(b=>b.data);
  const pos=(a,i)=>[a[i*6],a[i*6+1],a[i*6+2]];
  const close=(a,b,tol=1e-5)=>assert(Math.abs(a-b)<tol, a+' is not near '+b);
  close(pos(front,0)[2],.5);
  close(pos(back,0)[2],-.5);
  for(const ring of [0,1,10,20,35,39]){
    const first=ring*128*6;
    const top=pos(front,first),bottom=pos(back,first);
    close(top[0],bottom[0]);close(top[1],bottom[1]);close(top[2],-bottom[2]);
    const radius=ring/40;
    const half=.5*(.12+.88*.5*(1+Math.cos(Math.PI*radius)));
    close(top[2],half);
    close(front[first*6+3],back[first*6+3]);
    close(front[first*6+5],-back[first*6+5]);
  }
  const outer=pos(front,39*128*6+1);
  close(outer[2],.06,2e-5);
  const h=r=>.5*(.12+.88*.5*(1+Math.cos(Math.PI*r)));
  const derivative=r=>(h(r+.0001)-h(r-.0001))/.0002;
  close(derivative(0),0,1e-4);
  close(derivative(1),0,1e-4);
  assert(Math.abs(derivative(.5))>Math.abs(derivative(.2)));
  const flow=gl.buffers.find(b=>b.data.length===160*24*4).data;
  assert.equal(flow.length,15360);
  for(let i=0;i<flow.length;i+=4){
    assert(flow[i+1]>=0&&flow[i+1]<1);
    assert(flow[i+2]>=0&&flow[i+2]<1);
    assert(flow[i+3]>=0&&flow[i+3]<1);
  }
  const seed=flow[2],phase=flow[1],speed=.24*(.78+.44*seed);
  const initial=1-(phase%1),later=1-((phase+.2*speed)%1);
  assert(later<initial,'Rim particles move toward center');
  const sampleInside=(r,layer)=>Math.abs(h(r)*(layer*2-1)*.78)<h(r);
  assert(sampleInside(.3,flow[3])&&sampleInside(.9,flow[3]),'Drops remain in the volume');
  scheduled(performance.now()+16);
  const fallDraws=gl.draws.filter(d=>d.mode===gl.POINTS&&d.count===3840);
  assert.equal(fallDraws.length,3,'Three independent lens waterfalls');
  assert.deepEqual(fallDraws.map(x=>x.uniforms.u_fade),[1,.58,.28]);
  assert.equal(probe.metrics.waterfallCount,11520);
  assert.equal(probe.metrics.lensExtentsY.length,3);
  assert(probe.metrics.lensExtentsY.every(l=>l.convexY<l.centerY&&l.centerY<l.backY));
  probe.emitRipple(new Float32Array(96).fill(.5),1);
  const {emissionY}=probe.metrics.rippleProfiles[0];
  close(emissionY,probe.metrics.lensExtentsY[0].convexY);
  const before=gl.draws.length;
  probe.setParams({waterfallDensity:0});
  scheduled(performance.now()+32);
  assert.equal(gl.draws.slice(before).filter(d=>d.count===3840).length,0,
    'Density=0 turns off the independent waterfall pass');
  probe.destroy();
  console.log(JSON.stringify({biconvex:'passed',profile:'cosine symmetric both faces',
    meshTriangles:2*128*40*2,waterfallPoints:11520,draws:3,
    rippleFromFrontApex:true,waterfallDisable:true}));
}finally{
  global.window=prevWindow;
  global.requestAnimationFrame=prevRAF;
  global.cancelAnimationFrame=prevCancel;
}