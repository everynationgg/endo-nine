import type { CommunicationRole } from '../narrative/types';
import type { VoicePlaybackPort } from '../narrative/DialogueDirector';

interface ActiveVoicePlayback {
  source: AudioBufferSourceNode;
  turnGain: GainNode;
  nodes: AudioNode[];
  startedAtCtxTime: number;
  offsetSec: number;
  gen: number;
}

export class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterVolume: number = 0.8;
  private voiceVolume: number = 0.95;
  private masterGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;

  private voiceBuffers: Map<string, AudioBuffer | null> = new Map();
  private voiceLoadGen: number = 0;
  private activeVoice: ActiveVoicePlayback | null = null;

  public readonly voice: VoicePlaybackPort = {
    preload: (urls: string[], loadGen: number) => this.preloadVoiceBuffers(urls, loadGen),
    play: (
      url: string,
      offsetSec: number,
      role: CommunicationRole,
      playbackGen: number,
      onEnded: (gen: number) => void
    ) => this.playVoiceBuffer(url, offsetSec, role, playbackGen, onEnded),
    pause: (playbackGen: number) => this.pauseVoicePlayback(playbackGen),
    stop: (playbackGen: number) => this.stopVoicePlayback(playbackGen),
    hasBuffer: (url: string) => Boolean(this.voiceBuffers.get(url)),
    isAvailable: () => typeof window !== 'undefined' && Boolean(window.AudioContext || (window as any).webkitAudioContext),
    clearBuffers: () => {
      this.voiceLoadGen++;
      this.stopVoicePlayback(0);
      this.voiceBuffers.clear();
    }
  };

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setVoiceVolume(vol: number): void {
    this.voiceVolume = Math.max(0, Math.min(1, vol));
    if (this.voiceGain && this.ctx) {
      this.voiceGain.gain.setValueAtTime(this.voiceVolume, this.ctx.currentTime);
    }
  }

  public getVoiceVolume(): number {
    return this.voiceVolume;
  }

  constructor() {
    // Lazy initialize on first interaction to comply with browser autoplay policies
    const initAudio = () => {
      this.ensureContext();
    };

    window.addEventListener('click', initAudio, { once: false });
    window.addEventListener('keydown', initAudio, { once: false });
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        this.voiceGain = this.ctx.createGain();
        this.voiceGain.gain.setValueAtTime(this.voiceVolume, this.ctx.currentTime);
        this.voiceGain.connect(this.masterGain);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private ensureVoiceGain(ctx: AudioContext): GainNode {
    if (!this.voiceGain) {
      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.setValueAtTime(this.voiceVolume, ctx.currentTime);
      this.voiceGain.connect(this.getAudioDestination());
    }
    return this.voiceGain;
  }

  private async preloadVoiceBuffers(urls: string[], loadGen: number): Promise<void> {
    const myGen = Math.max(this.voiceLoadGen, loadGen);
    this.voiceLoadGen = myGen;
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    if (uniqueUrls.length === 0) return;

    const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const decodeCtx = this.ctx || (OfflineCtx ? new OfflineCtx(1, 1, 24000) : this.ensureContext());
    if (!decodeCtx) return;

    await Promise.all(
      uniqueUrls.map(async (url) => {
        if (this.voiceBuffers.has(url)) return;
        try {
          const res = await fetch(url);
          if (myGen !== this.voiceLoadGen) return;
          if (!res.ok) {
            this.voiceBuffers.set(url, null);
            return;
          }
          const ctype = (res.headers.get('content-type') || '').toLowerCase();
          if (ctype.includes('text/html') || ctype.includes('application/json')) {
            this.voiceBuffers.set(url, null);
            return;
          }
          const arr = await res.arrayBuffer();
          if (myGen !== this.voiceLoadGen || arr.byteLength < 44) {
            if (myGen === this.voiceLoadGen) this.voiceBuffers.set(url, null);
            return;
          }
          const decoded = await decodeCtx.decodeAudioData(arr.slice(0));
          if (myGen !== this.voiceLoadGen) return;
          this.voiceBuffers.set(url, decoded);
        } catch {
          if (myGen === this.voiceLoadGen) {
            this.voiceBuffers.set(url, null);
          }
        }
      })
    );
  }

  private playVoiceBuffer(
    url: string,
    offsetSec: number,
    role: CommunicationRole,
    playbackGen: number,
    onEnded: (gen: number) => void
  ): boolean {
    this.stopVoicePlayback(playbackGen);

    const buffer = this.voiceBuffers.get(url);
    if (!buffer) return false;

    const ctx = this.ensureContext();
    if (!ctx) return false;

    const voiceBus = this.ensureVoiceGain(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const turnGain = ctx.createGain();
    turnGain.gain.setValueAtTime(1.0, ctx.currentTime);
    const nodes: AudioNode[] = [source, turnGain];

    if (role === 'remote_support') {
      // Subtle radio comms shaping while preserving vocal intelligibility
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(220, ctx.currentTime);

      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.setValueAtTime(1850, ctx.currentTime);
      presence.Q.setValueAtTime(0.9, ctx.currentTime);
      presence.gain.setValueAtTime(2.5, ctx.currentTime);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(4600, ctx.currentTime);

      source.connect(highpass);
      highpass.connect(presence);
      presence.connect(lowpass);
      lowpass.connect(turnGain);
      nodes.push(highpass, presence, lowpass);
    } else {
      source.connect(turnGain);
    }

    turnGain.connect(voiceBus);

    const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.05)));
    source.onended = () => {
      if (this.activeVoice && this.activeVoice.source === source && this.activeVoice.gen === playbackGen) {
        this.cleanupVoiceNodes(this.activeVoice);
        this.activeVoice = null;
        onEnded(playbackGen);
      }
    };

    try {
      source.start(0, safeOffset);
    } catch {
      return false;
    }

    this.activeVoice = {
      source,
      turnGain,
      nodes,
      startedAtCtxTime: ctx.currentTime,
      offsetSec: safeOffset,
      gen: playbackGen
    };
    return true;
  }

  private pauseVoicePlayback(_playbackGen: number): number {
    if (!this.activeVoice) return 0;
    const elapsed = this.ctx
      ? this.activeVoice.offsetSec + Math.max(0, this.ctx.currentTime - this.activeVoice.startedAtCtxTime)
      : this.activeVoice.offsetSec;
    this.stopVoicePlayback(0);
    return elapsed;
  }

  private stopVoicePlayback(_playbackGen: number): void {
    if (!this.activeVoice) return;
    const cur = this.activeVoice;
    this.activeVoice = null;
    cur.source.onended = null;
    try {
      cur.source.stop();
    } catch {
      // Ignore already stopped AudioBufferSourceNode
    }
    this.cleanupVoiceNodes(cur);
  }

  private cleanupVoiceNodes(playback: ActiveVoicePlayback): void {
    for (const n of playback.nodes) {
      try {
        n.disconnect();
      } catch {
        // Ignore already disconnected node
      }
    }
  }

  private getAudioDestination(): AudioNode {
    return this.masterGain || this.ctx!.destination;
  }

  // Energy Pulse: Quick energetic laser zap
  public playPulse(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(580, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  // Piercing Wave: Low sweeping plasma surge
  public playWave(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }

  // Dash: High-tech whoosh / air displacement
  public playDash(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // White noise burst with lowpass filter sweep
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.getAudioDestination());

    noise.start();
    noise.stop(ctx.currentTime + 0.2);
  }

  // Ultimate Orbital Judgment: Deep thunderous plasma boom
  public playOrbitalStrike(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.8);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  }

  // Chain Spark: Electric crackle
  public playChainSpark(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.04);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  // Pod Opened / Item Acquired: Harmonious sci-fi chime
  public playItemAcquired(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + idx * 0.07;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.005, start + 0.3);

      osc.connect(gain);
      gain.connect(this.getAudioDestination());

      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  // Currency (Genes) pickup chime
  public playCurrencyPickup(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now);
    osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.07);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Enemy Hit / Death pop
  public playEnemyHit(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  // Jump: Kinetic thruster impulse
  public playJump(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + 0.14);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  }

  // Glide: High-frequency plasma thruster hiss
  public playGlide(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(460, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  // Land: Heavy frost surface landing impact
  public playLand(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  // Threat Level Advance: Risk of Rain 2 style deep warning siren
  public playThreatAlert(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(130, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.35);
    osc1.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.7);

    osc2.frequency.setValueAtTime(195, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(390, ctx.currentTime + 0.35);
    osc2.frequency.exponentialRampToValueAtTime(165, ctx.currentTime + 0.7);

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.getAudioDestination());

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.7);
    osc2.stop(ctx.currentTime + 0.7);
  }

  public playWorldEventPulse(isEmp: boolean = false): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isEmp ? 'sawtooth' : 'sine';
    const startFreq = isEmp ? 440 : 180;
    const endFreq = isEmp ? 80 : 360;

    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(this.getAudioDestination());

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  public playWorldEventComplete(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Celestial triumphant arpeggio chime
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.09);

      gain.gain.setValueAtTime(0.01, ctx.currentTime + idx * 0.09);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.09 + 0.55);

      osc.connect(gain);
      gain.connect(this.getAudioDestination());

      osc.start(ctx.currentTime + idx * 0.09);
      osc.stop(ctx.currentTime + idx * 0.09 + 0.55);
    });
  }
}

