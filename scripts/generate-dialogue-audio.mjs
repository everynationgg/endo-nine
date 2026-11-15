/**
 * Offline Gemini TTS Dialogue Audio Generator for Endo Nine
 *
 * Generates prerecorded character voice WAV files from public/dialogue/stage1.json
 * and automatically updates exact durationSec values in the manifest.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/generate-dialogue-audio.mjs --scene scene_01_first_steps
 *   node scripts/generate-dialogue-audio.mjs --line s01_cmd_01
 *   node scripts/generate-dialogue-audio.mjs --all
 *   node scripts/generate-dialogue-audio.mjs --scene scene_01_first_steps --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_PATH = path.resolve('public/dialogue/stage1.json');
const PUBLIC_ROOT = path.resolve('public');
const DEFAULT_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';

// Distinct, consistent Gemini TTS prebuilt voice profiles per character
const VOICE_PROFILES = {
  commander: {
    voiceName: process.env.TTS_VOICE_COMMANDER || 'Fenrir',
    persona:
      'Adult male field commander: grounded, authoritative, confident, relaxed and dryly sarcastic with Doctor, decisive in combat.'
  },
  doctor: {
    voiceName: process.env.TTS_VOICE_DOCTOR || 'Aoede',
    persona:
      'Adult female chief medical officer: intelligent, expressive, analytical, playfully sarcastic and slightly chaotic.'
  },
  overseer: {
    voiceName: process.env.TTS_VOICE_OVERSEER || 'Kore',
    persona:
      'Ancient, composed, formal, precise androgynous synthetic intelligence: emotionally restrained, articulate, subtly dry sarcasm, never choppy or robotic.'
  }
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function parseArgs(argv) {
  const args = {
    scene: null,
    line: null,
    all: false,
    force: false,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scene' && argv[i + 1]) args.scene = argv[++i];
    else if (a === '--line' && argv[i + 1]) args.line = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function computeWavDurationSec(wavBuffer) {
  if (wavBuffer.length <= 44) return 1.0;
  const sampleRate = wavBuffer.readUInt32LE(24) || 24000;
  const byteRate = wavBuffer.readUInt32LE(28) || sampleRate * 2;
  const dataSize = wavBuffer.length - 44;
  return Math.max(0.5, Number((dataSize / byteRate).toFixed(2)));
}

async function synthesizeLineWithGemini(apiKey, model, turn) {
  const profile = VOICE_PROFILES[turn.speaker] || VOICE_PROFILES.commander;
  const styleParts = [profile.persona, turn.direction ? `Delivery: ${turn.direction}` : ''].filter(Boolean);
  const styleText = styleParts.join(' ');

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: turn.text,
              annotations: [
                {
                  type: 'speech_metadata',
                  style: styleText
                }
              ]
            }
          ]
        }
      ],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice: profile.voiceName }]
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS API error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  let audioBlock = null;
  for (const step of json?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const item of step?.content || []) {
      if (item?.type === 'audio' && item?.data) {
        audioBlock = item;
      }
    }
  }
  const fallbackAudio = audioBlock || json?.output_audio;
  if (!fallbackAudio?.data) {
    throw new Error(`No audio output returned for line ${turn.id}: ${JSON.stringify(json)}`);
  }

  const rawBytes = Buffer.from(fallbackAudio.data, 'base64');
  const mime = String(fallbackAudio.mime_type || 'audio/wav');

  if (mime.includes('wav') || rawBytes.slice(0, 4).toString('ascii') === 'RIFF') {
    return rawBytes;
  }

  const rateMatch = mime.match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  return pcmToWavBuffer(rawBytes, sampleRate, 1, 16);
}

async function main() {
  loadEnvFile(path.resolve('.env'));
  loadEnvFile(path.resolve('.env.local'));

  const args = parseArgs(process.argv.slice(2));
  if (!args.scene && !args.line && !args.all) {
    console.error('Specify --scene <id>, --line <lineId>, or --all');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!args.dryRun && !apiKey) {
    console.error(
      'Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Set it in your environment or .env before generating audio.'
    );
    process.exit(2);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const seenAudioPaths = new Set();
  let processed = 0;
  let generated = 0;
  let manifestUpdated = false;

  for (const conv of manifest.conversations) {
    if (args.scene && conv.id !== args.scene) continue;

    for (const turns of Object.values(conv.variants || {})) {
      if (!Array.isArray(turns)) continue;

      for (const turn of turns) {
        if (args.line && turn.id !== args.line) continue;
        if (!turn.audioUrl) continue;

        const relUrl = turn.audioUrl.replace(/^\//, '');
        const outPath = path.join(PUBLIC_ROOT, relUrl);
        if (seenAudioPaths.has(outPath)) continue;
        seenAudioPaths.add(outPath);

        processed++;
        if (fs.existsSync(outPath) && !args.force && !args.line) {
          const existing = fs.readFileSync(outPath);
          const dur = computeWavDurationSec(existing);
          if (turn.durationSec !== dur) {
            turn.durationSec = dur;
            manifestUpdated = true;
          }
          console.log(`[skip] ${turn.id} (${turn.speaker}) -> exists (${dur}s)`);
          continue;
        }

        if (args.dryRun) {
          console.log(
            `[dry-run] ${turn.id} (${turn.speaker} / ${VOICE_PROFILES[turn.speaker]?.voiceName}) -> ${outPath}\n  "${turn.text}"`
          );
          continue;
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        console.log(`[tts] Generating ${turn.id} (${turn.speaker})...`);
        const wavBuf = await synthesizeLineWithGemini(apiKey, DEFAULT_MODEL, turn);
        fs.writeFileSync(outPath, wavBuf);

        const dur = computeWavDurationSec(wavBuf);
        if (turn.durationSec !== dur) {
          turn.durationSec = dur;
          manifestUpdated = true;
        }
        generated++;
        console.log(`[ok]  ${turn.id} -> ${relUrl} (${dur}s)`);
      }
    }
  }

  // Sync shared audioUrl durations across variants (e.g. Scene 07 shared lines)
  if (manifestUpdated) {
    const durationByUrl = new Map();
    for (const conv of manifest.conversations) {
      for (const turns of Object.values(conv.variants || {})) {
        if (!Array.isArray(turns)) continue;
        for (const turn of turns) {
          const outPath = path.join(PUBLIC_ROOT, turn.audioUrl.replace(/^\//, ''));
          if (fs.existsSync(outPath)) {
            const dur = computeWavDurationSec(fs.readFileSync(outPath));
            durationByUrl.set(turn.audioUrl, dur);
            turn.durationSec = dur;
          }
        }
      }
    }
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`[manifest] Updated durations in ${MANIFEST_PATH}`);
  }

  console.log(`Done. Scanned ${processed} unique lines, generated ${generated} WAV files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
