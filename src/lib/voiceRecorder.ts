/**
 * Microphone capture that always produces a complete, decodable WAV file.
 *
 * MediaRecorder chunks are headerless after the first slice and Safari records
 * fragmented MP4, both of which speech-to-text providers reject. Capturing raw
 * PCM through the Web Audio API and encoding a 16 kHz mono WAV avoids that.
 */

const TARGET_RATE = 16000;

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  /** Peak amplitude, used to detect a silent / dead microphone. */
  peak: number;
}

export interface VoiceRecorderHandle {
  stop: () => Promise<VoiceRecording>;
  cancel: () => void;
}

export async function startVoiceRecording(): Promise<VoiceRecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let peak = 0;
  node.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    chunks.push(new Float32Array(data));
  };
  source.connect(node);
  // Keep the processor alive without echoing the mic to the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);
  const started = Date.now();

  const teardown = async () => {
    node.onaudioprocess = null;
    try {
      node.disconnect();
      mute.disconnect();
      source.disconnect();
    } catch {
      /* already torn down */
    }
    stream.getTracks().forEach((t) => t.stop());
    try {
      await ctx.close();
    } catch {
      /* already closed */
    }
  };

  return {
    async stop() {
      const rate = ctx.sampleRate;
      await teardown();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        merged.set(c, o);
        o += c.length;
      }
      const resampled = downsample(merged, rate, TARGET_RATE);
      return { blob: encodeWav(resampled, TARGET_RATE), durationMs: Date.now() - started, peak };
    },
    cancel() {
      void teardown();
    },
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read the recording"));
    fr.onload = () => {
      const res = String(fr.result || "");
      resolve(res.slice(res.indexOf(",") + 1));
    };
    fr.readAsDataURL(blob);
  });
}