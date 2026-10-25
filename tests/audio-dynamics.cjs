const assert = require('node:assert/strict');
const AudioDynamics = require('../audio-dynamics.js');
const model = new AudioDynamics(48000,2048), db = new Float32Array(1024), wave = new Float32Array(2048);
const levels = { bass: [], mid: [], high: [] }, hits = { bass: 0, mid: 0, high: 0 };
// Every displayed old band is stuck at 100 even at the quiet phase of this
// loud, compressed mix. Float FFT still retains its periodic +6 dB attacks.
const oldByteLevel = (-34+95)/75;
assert.equal(Math.min(1,Math.min(1,(oldByteLevel-.055)/.52)**.82*3),1);
for(let frame=0;frame<720;frame++) {
  const t=frame/120, phase=(t-.7)%.7, active=t>=.7;
  db.fill(-Infinity); wave.fill(active?.20:0);
  const decibel = -34 + (phase>=0 && phase<.25 ? 6*Math.exp(-phase/.09):0);
  for(const state of Object.values(model.bands)) for(let i=state.first;i<state.end;i++) db[i]=active?decibel:-Infinity;
  const raw=model.process(db,wave,1/120,3,1.2);
  for(const band of Object.keys(levels)) {
    if(raw.attacks[band]>0) hits[band]++;
    if(t>1.5) levels[band].push(raw[band]);
    assert(Number.isFinite(raw[band]) && raw[band]>=0 && raw[band]<1);
  }
}
for(const band of Object.keys(levels)) {
  assert(hits[band]>=6 && hits[band]<=8,`${band}: ${hits[band]} attacks`);
  assert(Math.max(...levels[band])-Math.min(...levels[band])>.04,`${band} must retain dynamics above the old 100 ceiling`);
}
// The old byte FFT clips these bins at 255, while the new path keeps +6 dB.
model.reset(); let aboveCeilingHits=0;
for(let frame=0;frame<600;frame++) {
  const t=frame/120, phase=t%.7;
  db.fill(-Infinity); wave.fill(.35);
  db[4]=-15+(phase<.2?6*Math.exp(-phase/.07):0);
  const raw=model.process(db,wave,1/120,1.25,1.2);
  if(raw.attacks.bass) aboveCeilingHits++;
}
assert(aboveCeilingHits>=5,`Attacks above -20 dB must survive: ${aboveCeilingHits}`);
// A truly unchanging sustained spectrum must not invent recurring drum hits.
model.reset(); let sustained=0;
for(let frame=0;frame<480;frame++) {
  db.fill(-Infinity); db[4]=-12; wave.fill(.35);
  if(model.process(db,wave,1/120).attacks.bass) sustained++;
}
assert.equal(sustained,0);
const snapshot=new Float32Array(96); model.spectrumSnapshot(snapshot,3);
assert(snapshot.every(n=>Number.isFinite(n)&&n>=0&&n<1));
assert(model.levelFor(.8,'bass',3)>model.levelFor(.4,'bass',3));
// Slow bass swells and pitch redistribution are not drum attacks.
model.reset();let swells=0;
for(let frame=0;frame<1200;frame++) {
  const t=frame/120;db.fill(-Infinity);wave.fill(.15);
  const amplitude=.07*(1+.25*Math.sin(t*2*Math.PI*.7));
  const mix=.5+.25*Math.sin(t*2*Math.PI*2);
  db[3]=20*Math.log10(amplitude*Math.sqrt(mix));
  db[4]=20*Math.log10(amplitude*Math.sqrt(1-mix));
  if(model.process(db,wave,1/120).attacks.bass)swells++;
}
assert.equal(swells,0,'Slow changes and bass vibrato must not keep emitting');
model.reset();let noisyBass=0;
for(let frame=0;frame<1200;frame++) {
  const t=frame/120;db.fill(-50);wave.fill(.25);
  const a=.07*(1+.30*Math.sin(t*25)+.12*Math.sin(t*51));
  db[3]=20*Math.log10(a*.7);db[4]=20*Math.log10(a*.7);
  if(model.process(db,wave,1/120).attacks.bass)noisyBass++;
}
assert.equal(noisyBass,0,'An active mix with bass-only fluctuations is not a repeated drum train');
// A user-defined minimum interval remains a hard bound even in a dense train.
model.reset();const rapid=[];
for(let frame=0;frame<1200;frame++) {
  const t=frame/120,phase=t%.22;db.fill(-Infinity);wave.fill(.3);
  db[4]=-38+(phase<.15?22*Math.exp(-phase/.05):0);
  if(model.process(db,wave,1/120,1.25,.9,.7).attacks.bass)rapid.push(t);
}
assert(rapid.length>3);
rapid.slice(1).forEach((t,i)=>assert(t-rapid[i]>=.69));
console.log(JSON.stringify({audioDynamics:'passed',oldMeterSaturated:true,compressedMixHits:hits,
  aboveCeilingHits,sustained,swells,noisyBass,minimumInterval:.7},null,2));
