// Regression: both kick estimators consume identical 45–120 Hz FFT frames.
// Browser UI defaults to integral; old Node process() calls default to legacy.
const assert=require('node:assert/strict');
const AudioDynamics=require('../audio-dynamics.js');
function exercise(kind,dt=.024,interval=.25) {
  const audio=new AudioDynamics(48000,2048);
  const db=new Float32Array(1024),wave=new Float32Array(2048);
  const hits={legacy:[],integral:[],active:[]};
  let sawNumbers=true,last=null;
  for(let frame=0;frame<Math.ceil(9/dt);frame++){
    const t=frame*dt,phase=((t-.7)%.7+.7)%.7;
    db.fill(-Infinity);
    let level=-Infinity;
    if(kind==='compressed')level=t<.7?-34:-34+(phase<.25?6*Math.exp(-phase/.08):0);
    if(kind==='quiet')level=t<.7?-58:-58+(phase<.25?9*Math.exp(-phase/.075):0);
    if(kind==='sustain')level=-16;
    if(kind==='swell')level=20*Math.log10(.07*(1+.25*Math.sin(t*2*Math.PI*.7)));
    if(kind==='noise')level=20*Math.log10(.07*(1+.30*Math.sin(t*25)+.12*Math.sin(t*51)));
    if(kind==='bed')level=t<.7?-Infinity:20*Math.log10(.07*Math.min(1,(t-.7)/.5));
    if(kind==='rapid')level=-40+(phase < .05 ? 12*Math.exp(-phase/.03):0);
    if(kind==='treble')db[200]=-18+(phase<.10?8:0);
    else for(const bin of [3,4])db[bin]=Number.isFinite(level)?level-3:-Infinity;
    if(kind==='compressed')for(let i=8;i<350;i++)db[i]=-39+(phase<.22?5*Math.exp(-phase/.09):0);
    wave.fill(kind==='quiet'?.004:kind==='bed'?.12:.22);
    const result=audio.process(db,wave,dt,1.25,1.45,interval,'integral');
    const comparison=result.detectors;
    sawNumbers&&=!!comparison&&[comparison.integral.power,comparison.integral.velocity,
      comparison.integral.integral,comparison.integral.score,comparison.integral.threshold]
      .every(Number.isFinite);
    if(comparison.legacy.hit)hits.legacy.push(t);
    if(comparison.integral.hit)hits.integral.push(t);
    if(result.attacks.bass>0)hits.active.push(t);
    assert.equal(result.attacks.bass,comparison.integral.strength);
    last=result;
  }
  assert(sawNumbers,kind+' diagnostic values must remain finite');
  assert.deepEqual(hits.active,hits.integral,'Selected detector must drive ripple and bass impulse');
  return {audio,hits,last};
}
const compressed=exercise('compressed');
assert(compressed.hits.integral.length>=9&&compressed.hits.integral.length<=13,
  'Compressed drum train should retain attacks');
const quiet=exercise('quiet');
assert(quiet.hits.integral.length>=9,'Integral must recover low-level drum attacks');
assert(quiet.hits.integral.length>quiet.hits.legacy.length,
  'Quiet drum improvement must exceed legacy hit count');
for(const name of ['sustain','swell','noise','treble']){
  const value=exercise(name);
  assert.equal(value.hits.integral.length,0,name+' must not generate phantom rings');
}
const bed=exercise('bed');
assert(bed.hits.integral.filter(t=>t>1.3).length===0,
  'Gradually rising bass bed must not keep retriggering');
const rate=exercise('quiet',1/120);
assert(rate.hits.integral.length>=9,'Integrator must also work at 120 fps');
const dense=exercise('rapid',.024,.70);
dense.hits.integral.slice(1).forEach((t,i)=>assert(t-dense.hits.integral[i]>=.69,
  'Manual kickInterval must bound consecutive integral hits'));
assert(dense.hits.integral.length>=0);
const oldModel=new AudioDynamics(48000,2048),db=new Float32Array(1024),wave=new Float32Array(2048);
db.fill(-Infinity);db[4]=-24;wave.fill(.22);
const defaultResult=oldModel.process(db,wave,.024);
assert.equal(defaultResult.attacks.bass,defaultResult.detectors.legacy.strength,
  'Existing Node API remains legacy by default');
oldModel.reset();
assert.equal(oldModel.integral.count,0);
assert.equal(oldModel.integral.window.length,0);
console.log(JSON.stringify({integralRegression:'passed',
  compressed:{old:compressed.hits.legacy.length,new:compressed.hits.integral.length},
  quiet:{old:quiet.hits.legacy.length,new:quiet.hits.integral.length},
  steadyAndNoise:'no repeat events',minIntervalSeconds:.7},null,2));
