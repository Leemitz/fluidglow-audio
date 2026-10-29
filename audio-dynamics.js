/* Float-FFT dynamics. Browser + Node, no dependencies. MIT. */
(function (root) {
  'use strict';
  const BANDS = { bass: [35, 180], mid: [180, 1900], high: [1900, 10000] };
  const follow = (a, b, dt, tau) => a + (b - a) * (1 - Math.exp(-dt / tau));

  // Shadow detector: the integral is the signed positive CHANGE of bass power,
  // not the time integral of loudness (whose derivative is just loudness).
  // Work in 45-120 Hz linear FFT POWER; normalize against a slow power floor.
  class BassIntegralDetector {
    constructor() { this.reset(); }
    reset() {
      this.time=0; this.previousPower=null; this.slowPower=0;
      this.window=[]; this.noiseMean=.12; this.noiseVariance=.12;
      this.armed=true; this.candidate=null; this.lastAt=-Infinity; this.count=0;
    }
    sample(power, dt, rms, sensitivity=1.45, minInterval=.30) {
      this.time+=dt;
      const now=this.time;
      const thresholdNow=()=>Math.max(.70,
        (1.15+this.noiseMean+1.3*Math.sqrt(this.noiseVariance))/Math.max(.4,sensitivity));
      if(this.previousPower===null) {
        // Prime from the first frame: an already-sustained bass tone should
        // not be mistaken for a new transient at playback startup.
        this.previousPower=power; this.slowPower=power;
        return {hit:false,strength:0,power,velocity:0,integral:0,score:0,
          threshold:thresholdNow(),compactness:0};
      }
      const reference=Math.max(this.slowPower,power*.17,1e-7);
      const delta=Math.min(4,Math.max(0,power-this.previousPower)/reference);
      this.previousPower=power;
      this.slowPower+= (power-this.slowPower)*(1-Math.exp(-dt/.36));
      this.window.push({at:now,rise:delta});
      while(this.window.length&&this.window[0].at<now-.08)this.window.shift();
      let integral=0,strongest=0;
      for(const item of this.window) {
        integral+=item.rise;
        strongest=Math.max(strongest,item.rise);
      }
      // A fast, concentrated attack is more percussive than slowly rising or
      // oscillating bass. This is a SOFT weight, not an additional hard gate.
      const compactness=integral>1e-8?strongest/integral:0;
      const score=integral*(.20+.80*Math.min(1,compactness/.65));
      const threshold=thresholdNow();
      const innovation=score-this.noiseMean;
      const learn=1-Math.exp(-dt/1.6);
      this.noiseMean+=learn*(Math.min(score,threshold*1.2)-this.noiseMean);
      this.noiseVariance+=learn*(Math.min(innovation*innovation,4)-this.noiseVariance);
      if(score<threshold*.48&&!this.candidate)this.armed=true;
      const ready=now-this.lastAt>=Math.max(.22,minInterval);
      const audible=rms>.0015&&power>1e-7;
      if(ready&&audible&&this.armed&&!this.candidate&&score>threshold) {
        this.candidate={at:now,peak:score,threshold};
        this.armed=false;
      }
      let hit=false,strength=0;
      if(this.candidate) {
        const candidate=this.candidate;
        candidate.peak=Math.max(candidate.peak,score);
        const age=now-candidate.at;
        if(age>=.045&&(score<candidate.peak*.78||age>=.090)) {
          hit=ready&&audible&&candidate.peak>candidate.threshold;
          if(hit) {
            this.lastAt=now;this.count++;
            strength=Math.min(1.1,.35+.25*Math.log1p(candidate.peak/Math.max(candidate.threshold,.01)));
          }
          this.candidate=null;
        }
      }
      return {hit,strength,power,velocity:delta/Math.max(dt,.001),
        integral,score,threshold,compactness};
    }
  }
  class AudioDynamics {
    constructor(sampleRate, fftSize) {
      this.hzPerBin = sampleRate / fftSize;
      this.amplitudes = new Float32Array(fftSize / 2);
      this.previous = new Float32Array(fftSize / 2);
      this.integral = new BassIntegralDetector();
      this.bands = Object.fromEntries(Object.entries(BANDS).map(([key, range]) => [key, {
        first: Math.max(1, Math.ceil(range[0] / this.hzPerBin)),
        end: Math.min(fftSize / 2, Math.ceil(range[1] / this.hzPerBin)),
        reference: .04, slow: 0, baseline: .02, armed: true, lastAt: -Infinity
      }]));
      this.reset();
    }
    reset() {
      this.previous.fill(0); this.amplitudes.fill(0); this.time = 0; this.primed = false;
      this.integral.reset();
      for (const state of Object.values(this.bands)) {
        Object.assign(state, { reference: .04, slow: 0, baseline: .02, armed: true,
          lastAt: -Infinity, previousAmplitude: 0, kickSlow: 0, recentSlope: 0, candidate: null });
      }
      this.diagnostics = {};
    }
    levelFor(amplitude, band, sensitivity = 1) {
      const x = Math.max(0, amplitude - .00015) * sensitivity / this.bands[band].reference;
      // Smooth headroom, not min(value,1). Derivative stays positive at every
      // finite level; onset detection never sees this display compressor.
      return x / (x + 1);
    }
    spectrumSnapshot(target, sensitivity = 1) {
      const maxHz = Math.min(10000, this.amplitudes.length * this.hzPerBin);
      for (let i = 0; i < target.length; i++) {
        const low = 35 * (maxHz / 35) ** (i / target.length);
        const high = 35 * (maxHz / 35) ** ((i + 1) / target.length);
        const first = Math.max(1, Math.floor(low / this.hzPerBin));
        const end = Math.min(this.amplitudes.length, Math.max(first + 1, Math.ceil(high / this.hzPerBin)));
        let power = 0;
        for (let j = first; j < end; j++) power += this.amplitudes[j] ** 2;
        target[i] = this.levelFor(Math.sqrt(power), low < 180 ? 'bass' : low < 1900 ? 'mid' : 'high', sensitivity);
      }
    }
    process(decibels, waveform, dt, sensitivity = 1, beatSensitivity = .9, kickInterval = .40, detector = 'legacy') {
      dt = Math.max(.001, Math.min(.1, dt)); this.time += dt;
      let sum = 0;
      for (let i = 0; i < waveform.length; i++) sum += waveform[i] ** 2;
      const rms = Math.sqrt(sum / Math.max(1, waveform.length));
      for (let i = 0; i < this.amplitudes.length; i++) {
        this.amplitudes[i] = Number.isFinite(decibels[i]) ? 10 ** (decibels[i] / 20) : 0;
      }
      const bandAmplitudes={};
      for(const [key,state] of Object.entries(this.bands)) {
        let energy=0;
        for(let i=state.first;i<state.end;i++)energy+=this.amplitudes[i]**2;
        bandAmplitudes[key]=Math.sqrt(energy);
      }
      const result = { loudness: rms / (rms + .16), attacks: {}, bassFlux: 0, flux: 0, detectors: null };
      for (const [key, state] of Object.entries(this.bands)) {
        let positive = 0, previousSum = 0, currentSum = 0;
        let kickPower=0,kickPositive=0,kickNegative=0,kickSum=0,kickPrev=0;
        for (let i = state.first; i < state.end; i++) {
          const a = this.amplitudes[i], prev = this.previous[i];
          positive += Math.max(0, a - prev);
          previousSum += prev; currentSum += a;
          if(key==='bass'&&i*this.hzPerBin>=45&&i*this.hzPerBin<=120) {
            kickPower+=a*a;kickPositive+=Math.max(0,a-prev);kickNegative+=Math.max(0,prev-a);
            kickSum+=a;kickPrev+=prev;
          }
        }
        const amplitude = bandAmplitudes[key];
        if (!this.primed) state.slow = amplitude;
        const flux = positive / Math.max(previousSum, currentSum * .2, .003);
        let contrast = Math.max(0, (amplitude - state.slow) / Math.max(state.slow, .006));
        let novelty = .65 * Math.log1p(contrast) + .35 * Math.min(flux, 3);
        const threshold = key === 'bass'
          ? Math.max(.19,state.baseline*1.8+.04)/beatSensitivity
          : Math.max(.16,state.baseline*2.8+.05);
        if (key!=='bass'&&novelty < threshold * .55) state.armed = true;
        const audible = amplitude > .0025 && rms > .0015;
        let hit=false, hitNovelty=novelty, kickMetrics={};
        if(key==='bass') {
          // Bass notes/vibrato redistribute bins; drum attacks mostly raise
          // them together. Reject slow swells and mixed-sign spectral jitter.
          const kickAmplitude=Math.sqrt(kickPower);
          if(!this.primed)state.kickSlow=kickAmplitude;
          contrast=Math.max(0,(kickAmplitude-state.kickSlow)/Math.max(state.kickSlow,.006));
          const kickFlux=kickPositive/Math.max(kickPrev,kickSum*.2,.003);
          novelty=.90*Math.log1p(contrast)+.10*Math.min(kickFlux,2);
          if(novelty<threshold*.55)state.armed=true;
          const coherence=kickPositive/Math.max(kickPositive+kickNegative,1e-8);
          const slope=8.686*(kickAmplitude-state.previousAmplitude)/(Math.max(state.previousAmplitude,.006)*dt);
          state.recentSlope=Math.max(0,slope,state.recentSlope*Math.exp(-dt/.06));
          const ready=this.time-state.lastAt>=Math.max(.22,kickInterval);
          const midRise=(bandAmplitudes.mid-this.bands.mid.slow)/Math.max(this.bands.mid.slow,.006);
          const highRise=(bandAmplitudes.high-this.bands.high.slow)/Math.max(this.bands.high.slow,.006);
          const midSlope=8.686*(bandAmplitudes.mid-this.bands.mid.previousAmplitude)
            /(Math.max(this.bands.mid.previousAmplitude,.006)*dt);
          const highSlope=8.686*(bandAmplitudes.high-this.bands.high.previousAmplitude)
            /(Math.max(this.bands.high.previousAmplitude,.006)*dt);
          const busyMix=Math.max(this.bands.mid.slow,this.bands.high.slow)>.008;
          const percussion=midRise>.10/beatSensitivity&&highRise>.12/beatSensitivity
            &&(midSlope>25/beatSensitivity||this.time-this.bands.mid.lastAt<.12)
            &&(highSlope>25/beatSensitivity||this.time-this.bands.high.lastAt<.12);
          kickMetrics={kickAmplitude,contrast,coherence,slope,ready,midRise,highRise,candidate:!!state.candidate};
          if(this.primed&&audible&&ready&&state.armed&&!state.candidate&&novelty>threshold*.85
            &&contrast>.18/beatSensitivity&&slope>5&&state.recentSlope>40/beatSensitivity&&coherence>.60) {
            state.candidate={at:this.time,peak:kickAmplitude,score:novelty,background:state.kickSlow,
              area:0,busyMix,hasPercussion:false};
          }
          if(state.candidate) {
            const candidate=state.candidate;
            candidate.peak=Math.max(candidate.peak,kickAmplitude);
            candidate.score=Math.max(candidate.score,novelty);
            candidate.area+=Math.max(0,(kickAmplitude-candidate.background)/Math.max(candidate.background,.006)-.10)*dt;
            candidate.hasPercussion ||= percussion;
            const age=this.time-candidate.at;
            // Confirm one local peak, rather than firing at every rising FFT
            // bin. Requiring attack-body energy rejects isolated noisy spikes
            // and deliberately confirms a candidate over roughly 75–120ms.
            if(age>=.075&&(kickAmplitude<candidate.peak*.90||age>=.12)) {
              const prominence=(candidate.peak-candidate.background)/Math.max(candidate.background,.006);
              hit=audible&&ready&&prominence>.30/beatSensitivity&&candidate.score>threshold
                &&candidate.area>.020/beatSensitivity
                &&(!candidate.busyMix||candidate.hasPercussion||prominence>1.25/beatSensitivity);
              hitNovelty=candidate.score;state.candidate=null;
            }
          }
          // Run the integral detector on EVERY FFT hop, even when the legacy
          // candidate gates reject this event. Both see identical source data.
          const integrated=this.integral.sample(kickPower,dt,rms,beatSensitivity,kickInterval);
          result.detectors={
            legacy:{hit,score:novelty,threshold,
              strength:hit?Math.min(1.1,.35+.25*Math.log1p(hitNovelty/threshold)):0},
            integral:integrated
          };
          state.kickSlow=follow(state.kickSlow,kickAmplitude,dt,.24);
          state.previousAmplitude=kickAmplitude;
        } else {
          hit=this.primed&&audible&&state.armed&&novelty>threshold&&this.time-state.lastAt>.24;
        }
        result.attacks[key] = hit ? Math.min(1.1,.35+.25*Math.log1p(hitNovelty/threshold)) : 0;
        if(key==='bass'&&detector==='integral') {
          // The integrator drives both the bass lens impulse and ripple.
          // Old candidate state continues advancing for A/B comparison.
          result.attacks.bass=result.detectors.integral.strength;
        }
        if (hit) { state.armed = false; state.lastAt = this.time; }
        if(key!=='bass')state.previousAmplitude=amplitude;
        // Slow independent references adapt to each band's actual amplitude.
        state.reference = Math.max(.04, follow(state.reference, amplitude, dt,
          amplitude > state.reference ? 1.4 : 8));
        state.slow = follow(state.slow, amplitude, dt, .22);
        state.baseline = follow(state.baseline, key==='bass'?Math.min(novelty,.35):novelty, dt, .8);
        result[key] = this.levelFor(amplitude, key, sensitivity);
        this.diagnostics[key] = { amplitude, db: 20 * Math.log10(Math.max(amplitude, 1e-8)),
          reference: state.reference, novelty, threshold, level: result[key], ...kickMetrics };
        result.flux += novelty / 3;
        if (key === 'bass') {
          result.bassFlux=detector==='integral' ? result.detectors.integral.score : novelty;
          result.bassThreshold=detector==='integral' ? result.detectors.integral.threshold : threshold;
        }
      }
      this.previous.set(this.amplitudes); this.primed = true;
      return result;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = AudioDynamics;
  else root.AudioDynamics = AudioDynamics;
})(typeof window !== 'undefined' ? window : globalThis);
