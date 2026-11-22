import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FFMPEG_BIN = 'C:\\Users\\yoggn\\Desktop\\EN Music Bot\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const MANIFEST_PATH = path.resolve('public/dialogue/stage1.json');
const AUDIO_STAGE1_ROOT = path.resolve('public/assets/audio/dialogue/stage1');
const OPENING_CINEMATIC_ROOT = path.resolve('public/dialogue/Voice Lines');

const EXPECTED_SCENES = [
  { id: 'scene_01_first_steps', trigger: 'left_crash_site', priority: 1, variants: { commander: ['doctor', 'commander', 'doctor', 'commander', 'doctor', 'overseer', 'commander', 'overseer'], doctor: ['commander', 'doctor', 'commander', 'doctor', 'overseer', 'doctor'] } },
  { id: 'scene_02_planet_waking_up', trigger: 'flora_discovered', priority: 3, variants: { default: ['doctor', 'overseer', 'commander', 'doctor', 'overseer', 'doctor'] } },
  { id: 'scene_03_first_hostile_encounter', trigger: 'first_hostile_encounter', priority: 0, variants: { commander: ['commander', 'overseer', 'doctor', 'commander', 'doctor'], doctor: ['commander', 'overseer', 'doctor', 'commander', 'doctor'] } },
  { id: 'scene_04_something_in_the_water', trigger: 'water_discovered', priority: 3, variants: { commander: ['doctor', 'commander', 'overseer', 'doctor', 'commander'], doctor: ['doctor', 'commander', 'overseer', 'doctor', 'commander'] } },
  { id: 'scene_05_biological_sacs', trigger: 'first_pod_opened', priority: 3, variants: { commander: ['doctor', 'commander', 'doctor', 'commander', 'overseer', 'doctor'], doctor: ['commander', 'doctor', 'commander'] } },
  { id: 'event_01_mutated_augment_enemy', trigger: 'mutated_enemy_discovered', priority: 1, variants: { commander: ['doctor', 'overseer', 'commander'], doctor: ['doctor', 'overseer', 'commander'] } },
  { id: 'scene_06_first_enhancement', trigger: 'first_enhancement_completed', priority: 1, variants: { commander: ['doctor', 'commander', 'overseer', 'doctor', 'overseer'], doctor: ['doctor', 'commander', 'overseer', 'doctor', 'overseer'] } },
  { id: 'scene_07_first_artifact_clue', trigger: 'artifact_discovered', priority: 1, variants: { commander: ['commander', 'overseer', 'doctor', 'overseer', 'doctor', 'overseer', 'commander'], doctor: ['commander', 'overseer', 'doctor', 'overseer', 'doctor', 'overseer', 'commander'] } },
  { id: 'event_02_first_earthquake', trigger: 'second_augment_earthquake', priority: 0, variants: { commander: ['commander', 'doctor', 'overseer'], doctor: ['doctor', 'commander', 'overseer'] } },
  { id: 'event_03a_major_earthquake', trigger: 'fourth_augment_earthquake', priority: 0, variants: { commander: ['commander', 'doctor', 'overseer'], doctor: ['doctor', 'overseer'] } },
  { id: 'event_03b_concealment_revelation', trigger: 'fourth_enhancement_revelation', priority: 1, variants: { default: ['overseer', 'commander', 'overseer', 'doctor', 'overseer', 'commander', 'overseer'] } },
  { id: 'scene_08_why_attacking', trigger: 'extended_hostility_quiet', priority: 3, variants: { default: ['commander', 'overseer', 'doctor', 'overseer', 'doctor', 'commander'] } },
  { id: 'event_04_artifact_tower_reached', trigger: 'tower_reached', priority: 1, variants: { commander: ['commander', 'doctor', 'overseer'], doctor: ['commander', 'doctor', 'overseer'] } },
  { id: 'event_04a_tower_locked_warning', trigger: 'tower_activation_locked_attempt', priority: 1, variants: { default: ['overseer', 'doctor'] } },
  { id: 'scene_09_teleporter_ready', trigger: 'tower_activation_unlocked', priority: 1, variants: { default: ['overseer', 'commander', 'doctor'] } },
  { id: 'scene_10_stage1_boss', trigger: 'boss_emerged', priority: 0, variants: { commander: ['doctor', 'overseer', 'commander', 'doctor', 'overseer', 'commander', 'doctor', 'commander'], doctor: ['doctor', 'overseer', 'doctor', 'overseer', 'commander', 'commander'] } },
  { id: 'event_05_tower_restoration_refreeze', trigger: 'tower_restoration_refreeze', priority: 0, variants: { default: ['overseer', 'doctor', 'commander'] } },
  { id: 'scene_11_after_the_battle', trigger: 'boss_defeated_aftermath', priority: 1, variants: { default: ['commander', 'doctor', 'doctor', 'commander', 'doctor'] } },
  { id: 'scene_12_leaving_the_wreckage', trigger: 'stage_leaving', priority: 1, variants: { default: ['commander', 'overseer', 'doctor', 'commander', 'overseer', 'doctor'] } },
  { id: 'ambient_a_doctors_curiosity', trigger: 'ambient_exploration', priority: 3, variants: { default: ['doctor', 'commander', 'doctor', 'commander'] } },
  { id: 'ambient_b_overseers_patience', trigger: 'ambient_exploration', priority: 3, variants: { default: ['overseer', 'commander', 'overseer', 'commander', 'doctor'] } }
];

const ARCHIVED_LEGACY_OGGS = new Set([
  'ev04_ovr_04.ogg',
  'ev04_cmd_05.ogg',
  'ev04_cmd_doc_05.ogg',
  'ev04_doc_06.ogg',
  's09_01.ogg',
  's09_04.ogg',
  's09_05.ogg',
  's10_05.ogg',
  's10_cmd_08.ogg',
  's11_03.ogg'
]);

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function probeOgg(oggPath) {
  const dec = spawnSync(FFMPEG_BIN, ['-v', 'error', '-i', oggPath, '-f', 'null', '-'], { encoding: 'utf8' });
  if (dec.status !== 0 || (dec.stderr && dec.stderr.trim())) {
    throw new Error(`Decode error for ${oggPath}: ${dec.stderr}`);
  }
  const ln = spawnSync(
    FFMPEG_BIN,
    ['-hide_banner', '-i', oggPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const txt = `${ln.stdout || ''}\n${ln.stderr || ''}`;
  const jsonMatch = txt.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  const durMatch = txt.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!jsonMatch || !durMatch) {
    throw new Error(`Probe parse failed for ${oggPath}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const durationSec = parseInt(durMatch[1], 10) * 3600 + parseInt(durMatch[2], 10) * 60 + parseFloat(durMatch[3]);
  return {
    durationSec,
    inputI: Number(parsed.input_i),
    inputTp: Number(parsed.input_tp)
  };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = [];

  if (manifest.conversations.length !== EXPECTED_SCENES.length) {
    errors.push(`Expected ${EXPECTED_SCENES.length} conversations, found ${manifest.conversations.length}`);
  }

  const referencedPaths = new Set();
  const speakerByUrl = new Map();
  const durationByUrl = new Map();

  for (let i = 0; i < EXPECTED_SCENES.length; i++) {
    const exp = EXPECTED_SCENES[i];
    const actual = manifest.conversations.find((c) => c.id === exp.id);
    if (!actual) {
      errors.push(`Missing conversation ${exp.id}`);
      continue;
    }
    if (actual.trigger !== exp.trigger) errors.push(`${exp.id}: expected trigger ${exp.trigger}, got ${actual.trigger}`);
    if (actual.priority !== exp.priority) errors.push(`${exp.id}: expected priority ${exp.priority}, got ${actual.priority}`);
    if (actual.enabled === false) errors.push(`${exp.id}: expected enabled=true`);

    const expectedVariantKeys = Object.keys(exp.variants).sort();
    const actualVariantKeys = Object.keys(actual.variants || {}).sort();
    if (JSON.stringify(expectedVariantKeys) !== JSON.stringify(actualVariantKeys)) {
      errors.push(`${exp.id}: variant keys mismatch: expected ${expectedVariantKeys.join(',')} vs ${actualVariantKeys.join(',')}`);
    }

    for (const vKey of expectedVariantKeys) {
      const expSpeakers = exp.variants[vKey];
      const turns = actual.variants[vKey] || [];
      if (turns.length !== expSpeakers.length) {
        errors.push(`${exp.id}.${vKey}: expected ${expSpeakers.length} turns, got ${turns.length}`);
        continue;
      }
      for (let tIdx = 0; tIdx < turns.length; tIdx++) {
        const turn = turns[tIdx];
        if (turn.speaker !== expSpeakers[tIdx]) {
          errors.push(`${exp.id}.${vKey}[${tIdx}]: expected speaker ${expSpeakers[tIdx]}, got ${turn.speaker}`);
        }
        if (!turn.audioUrl || !turn.audioUrl.endsWith('.ogg')) {
          errors.push(`${exp.id}.${vKey}[${tIdx}]: expected .ogg audioUrl, got ${turn.audioUrl}`);
        }
        const diskPath = path.resolve('public', turn.audioUrl.replace(/^\//, ''));
        if (!fs.existsSync(diskPath)) {
          errors.push(`Missing runtime audio file: ${diskPath}`);
        } else {
          referencedPaths.add(diskPath.toLowerCase());
          speakerByUrl.set(diskPath, turn.speaker);
          durationByUrl.set(diskPath, turn.durationSec);
        }
        if (!turn.text || turn.text.trim().length === 0) {
          errors.push(`${exp.id}.${vKey}[${tIdx}]: empty subtitle text`);
        }
      }
    }
  }

  // Narrative rule assertions
  const s06 = manifest.conversations.find((c) => c.id === 'scene_06_first_enhancement');
  const s06Line3 = s06?.variants?.commander?.[2]?.text || '';
  if (!s06Line3.includes('Technology... ours')) {
    errors.push(`scene_06_first_enhancement s06_03 must use Overseer's corrected technology line; got "${s06Line3}"`);
  }
  const s09 = manifest.conversations.find((c) => c.id === 'scene_09_teleporter_ready');
  for (const t of s09?.variants?.default || []) {
    if (/boss|titan|defensive response/i.test(t.text)) {
      errors.push(`scene_09_teleporter_ready must not spoil boss: "${t.text}"`);
    }
  }
  if (manifest.conversations.some((c) => /third_augment/i.test(c.id))) {
    errors.push('Found unexpected third augment conversation.');
  }

  // Verify "You just did." is gone and "Tomato, tomato." only appears in Scene 07 index 2 right after Overseer's Chandy designation line
  for (const conv of manifest.conversations) {
    for (const [vKey, turns] of Object.entries(conv.variants || {})) {
      turns.forEach((turn, idx) => {
        if (/you just did/i.test(turn.text)) {
          errors.push(`Superseded "You just did." still present at ${conv.id}.${vKey}[${idx}] (${turn.id})`);
        }
        if (/tomato,\s*tomato/i.test(turn.text)) {
          const expectedPrev = vKey === 'doctor' ? 's07_doc_02' : 's07_cmd_02';
          if (conv.id !== 'scene_07_first_artifact_clue' || idx !== 2) {
            errors.push(`"Tomato, tomato." appeared unexpectedly at ${conv.id}.${vKey}[${idx}] (${turn.id})`);
          } else {
            if (!turn.optionalOnResume) {
              errors.push(`${conv.id}.${vKey}[${idx}] (${turn.id}) must set optionalOnResume=true`);
            }
            if (turn.requiresPreviousTurnId !== expectedPrev) {
              errors.push(`${conv.id}.${vKey}[${idx}] (${turn.id}) must require previous turn "${expectedPrev}", got "${turn.requiresPreviousTurnId}"`);
            }
            if (turns[idx - 1]?.id !== expectedPrev) {
              errors.push(`${conv.id}.${vKey}[${idx - 1}] must be "${expectedPrev}" right before "Tomato, tomato."`);
            }
          }
        }
      });
    }
  }

  // Verify pre-dialogue seismic camera shake lead-in on both earthquake scenes
  const eq1 = manifest.conversations.find((c) => c.id === 'event_02_first_earthquake');
  const eq2 = manifest.conversations.find((c) => c.id === 'event_03a_major_earthquake');
  if (!(typeof eq1?.leadInSec === 'number' && eq1.leadInSec >= 1.0)) {
    errors.push(`event_02_first_earthquake must define leadInSec >= 1.0, got ${eq1?.leadInSec}`);
  }
  if (!(typeof eq2?.leadInSec === 'number' && eq2.leadInSec > (eq1?.leadInSec || 0))) {
    errors.push(`event_03a_major_earthquake must define leadInSec > event_02 leadInSec, got ${eq2?.leadInSec}`);
  }

  // Check disk files in public/assets/audio/dialogue/stage1
  const diskFiles = walkFiles(AUDIO_STAGE1_ROOT);
  const wavLeftovers = diskFiles.filter((f) => f.toLowerCase().endsWith('.wav'));
  if (wavLeftovers.length > 0) {
    errors.push(`Found ${wavLeftovers.length} leftover WAV files in stage1 audio directory.`);
  }
  const oggFiles = diskFiles.filter((f) => f.toLowerCase().endsWith('.ogg'));
  if (oggFiles.length !== 132) {
    errors.push(`Expected 132 unique .ogg files in stage1 audio directory (122 active + 10 preserved legacy), found ${oggFiles.length}`);
  }
  const activeOggCount = oggFiles.filter((f) => referencedPaths.has(f.toLowerCase())).length;
  if (activeOggCount !== 122) {
    errors.push(`Expected 122 active referenced .ogg files, found ${activeOggCount}`);
  }
  for (const archivedName of ARCHIVED_LEGACY_OGGS) {
    const found = oggFiles.some((f) => path.basename(f).toLowerCase() === archivedName);
    if (!found) {
      errors.push(`Expected preserved legacy OGG file missing: ${archivedName}`);
    }
  }
  for (const f of oggFiles) {
    if (!referencedPaths.has(f.toLowerCase()) && !ARCHIVED_LEGACY_OGGS.has(path.basename(f).toLowerCase())) {
      errors.push(`Unreferenced orphan OGG file on disk: ${f}`);
    }
  }

  // Verify opening cinematic WAVs untouched
  const cinematicFiles = walkFiles(OPENING_CINEMATIC_ROOT).filter((f) => f.toLowerCase().endsWith('.wav'));
  if (cinematicFiles.length !== 47) {
    errors.push(`Expected 47 untouched opening cinematic WAVs in public/dialogue/Voice Lines, found ${cinematicFiles.length}`);
  }

  // Decode & loudness verification across all 117 OGGs
  const loudnessBySpeaker = { commander: [], doctor: [], overseer: [] };
  let maxTp = -Infinity;
  for (const [diskPath, spk] of speakerByUrl.entries()) {
    const info = probeOgg(diskPath);
    const expectedDur = durationByUrl.get(diskPath);
    if (Math.abs(info.durationSec - expectedDur) > 0.05) {
      errors.push(`Duration mismatch on ${path.basename(diskPath)}: manifest=${expectedDur}s, actual=${info.durationSec.toFixed(2)}s`);
    }
    if (Number.isFinite(info.inputTp)) {
      maxTp = Math.max(maxTp, info.inputTp);
      if (info.inputTp > -1.4) {
        errors.push(`True peak above -1.4 dBTP on ${path.basename(diskPath)}: ${info.inputTp} dBTP`);
      }
    }
    if (Number.isFinite(info.inputI)) {
      loudnessBySpeaker[spk].push(info.inputI);
    }
  }

  const speakerMedians = {};
  for (const spk of ['commander', 'doctor', 'overseer']) {
    const med = Number(median(loudnessBySpeaker[spk]).toFixed(2));
    speakerMedians[spk] = med;
    if (Math.abs(med - -16.0) > 1.2) {
      errors.push(`Speaker ${spk} median loudness ${med} LUFS is outside -16.0 ± 1.2 LUFS`);
    }
  }

  console.log('=== STAGE 1 VALIDATION SUMMARY ===');
  console.log(`Conversations validated: ${manifest.conversations.length}`);
  console.log(`Unique runtime OGG files: ${oggFiles.length}`);
  console.log(`Untouched opening cinematic WAVs: ${cinematicFiles.length}`);
  console.log(`Speaker median loudness (LUFS):`, speakerMedians);
  console.log(`Max true peak across all 117 OGGs: ${maxTp.toFixed(2)} dBTP`);

  if (errors.length > 0) {
    console.error('VALIDATION ERRORS:\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('ALL STAGE 1 MANIFEST, VARIANT, AUDIO & LOUDNESS CHECKS PASSED!');
}

main();
