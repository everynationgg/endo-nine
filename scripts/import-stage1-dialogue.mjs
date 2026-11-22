import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FFMPEG_BIN = 'C:\\Users\\yoggn\\Desktop\\EN Music Bot\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const CMD_DIR = 'C:\\Users\\yoggn\\Downloads\\Endo Nine\\Voice Lines\\Commander - Voice Lines Stage 1\\Gameplay Voice Lines';
const DOC_DIR = 'C:\\Users\\yoggn\\Downloads\\Endo Nine\\Voice Lines\\Doctor - Voice Lines Stage 1\\Gameplay Voice';
const DOC_ROOT = 'C:\\Users\\yoggn\\Downloads\\Endo Nine\\Voice Lines\\Doctor - Voice Lines Stage 1';
const OVR_DIR = 'C:\\Users\\yoggn\\Downloads\\Endo Nine\\Voice Lines\\Overseer - Voice Lines Stage 1\\Gameplay Voice Lines';

const AUDIO_OUT_ROOT = path.resolve('public/assets/audio/dialogue/stage1');
const MANIFEST_OUT_PATH = path.resolve('public/dialogue/stage1.json');
const REPORT_OUT_PATH =
  'C:\\Users\\yoggn\\.gemini\\antigravity\\brain\\ce6524ed-7599-4322-bb14-f0890fca2f44\\scratch\\stage1_normalization_report.json';

const EXCLUDED_SUPERSEDED = new Map([
  [path.join(OVR_DIR, 'withdraw threat level extreme.wav').toLowerCase(), 'Superseded earlier take of s10_02 ("Withdraw! Threat level... extreme!"); replaced by massive hostile detected.wav'],
  [path.join(OVR_DIR, 'artifact tower active.wav').toLowerCase(), 'Superseded standalone fragment ("Artifact tower... active."); replaced by structure confirmed artifact tower.wav'],
  [path.join(DOC_DIR, 'you just did.wav').toLowerCase(), 'Superseded earlier take of s07_cmd_03 ("You just did."); replaced by tomato tomato.wav'],
  [path.join(OVR_DIR, 'artifact tower detected investigate.wav').toLowerCase(), 'Superseded by visible tower + 4-module concealment lore (event_03b_concealment_revelation)'],
  [path.join(CMD_DIR, 'chandy mark that tower.wav').toLowerCase(), 'Superseded by visible tower + 4-module concealment lore (event_03b_concealment_revelation)'],
  [path.join(CMD_DIR, 'doc get to that tower.wav').toLowerCase(), 'Superseded by visible tower + 4-module concealment lore (event_03b_concealment_revelation)'],
  [path.join(DOC_DIR, 'great a giant alien tower.wav').toLowerCase(), 'Superseded by visible tower + 4-module concealment lore (event_03b_concealment_revelation)'],
  [path.join(OVR_DIR, 'teleporter charge complete.wav').toLowerCase(), 'Superseded by Stage 1 4-module unlock (four modules detected activation.wav)'],
  [path.join(OVR_DIR, 'destination unverified proceed.wav').toLowerCase(), 'Superseded obsolete Stage 1 charging warning'],
  [path.join(CMD_DIR, 'great so were jumping blind.wav').toLowerCase(), 'Superseded obsolete Stage 1 charging line'],
  [path.join(OVR_DIR, 'unknown entity.wav').toLowerCase(), 'Superseded by spliced boss emergence line (hostile entity unexpected restoration.wav)'],
  [path.join(CMD_DIR, 'then we stop it right fucking now.wav').toLowerCase(), 'Superseded by spliced boss emergence line (then were taking that thing down.wav)'],
  [path.join(OVR_DIR, 'immediate threat neutralized.wav').toLowerCase(), 'Superseded by threat neutralized concealment.wav in restoration/refreeze scene']
]);

const VOICE_TEMPO = 1.15;

function cmd(file) { return path.join(CMD_DIR, file); }
function doc(file) { return path.join(DOC_DIR, file); }
function docRoot(file) { return path.join(DOC_ROOT, file); }
function ovr(file) { return path.join(OVR_DIR, file); }

/**
 * Authoritative 117-clip Stage 1 dialogue mapping and verbatim-verified subtitles.
 * Shared turns specify `reuseAudioKey` pointing to `<folder>/<id>` so zero audio files are duplicated.
 */
const CONVERSATION_SPECS = [
  {
    id: 'scene_01_first_steps',
    folder: 'scene_01_first_steps',
    title: 'Scene 01 — First Steps',
    trigger: 'left_crash_site',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    onComplete: {
      codexEntryId: 'lore_stage1_crash_objectives',
      codexTitle: 'Crash Perimeter — Initial Objectives',
      codexSummary:
        'Locate missing crewmates and salvage replacement ship parts across the thawing crater while investigating the anomalous environment.'
    },
    variants: {
      commander: [
        { id: 's01_cmd_01', speaker: 'doctor', src: doc('Mander, you hear me.wav'), text: 'Mander, you hear me?' },
        { id: 's01_cmd_02', speaker: 'commander', src: cmd('yes maam although i was.wav'), text: "Yes, ma'am. Although I was enjoying the silence." },
        { id: 's01_cmd_03', speaker: 'doctor', src: doc('cute try not to die.wav'), text: 'Cute. Try not to die. Running low on medical supplies, and we still have people out there to find.' },
        { id: 's01_cmd_04', speaker: 'commander', src: cmd('any sign of them.wav'), text: 'Any sign of them?' },
        { id: 's01_cmd_05', speaker: 'doctor', src: doc('nothing yet and the ships.wav'), text: "Nothing yet. And the ship's still missing parts. We're not going anywhere until we find what we need.", unlocksObjectives: true },
        { id: 's01_cmd_06', speaker: 'overseer', src: ovr('Environment unscanned.wav'), text: 'Environment... unscanned. Exploration... not advised.', optionalOnResume: true },
        { id: 's01_cmd_07', speaker: 'commander', src: cmd('great the floating christmas.wav'), text: 'Oh, great. The floating Christmas ornament has concerns.', optionalOnResume: true },
        { id: 's01_cmd_08', speaker: 'overseer', src: ovr('human mortality rates explanation.wav'), text: 'Human mortality rate... explanation found. Poor judgment.', optionalOnResume: true }
      ],
      doctor: [
        { id: 's01_doc_01', speaker: 'commander', src: cmd('doc hows it looking out there.wav'), text: "Doc, how's it looking out there?" },
        { id: 's01_doc_02', speaker: 'doctor', src: doc('cold hostile biologically.wav'), text: 'Cold, hostile, and biologically fascinating. So, basically, my dream vacation.' },
        { id: 's01_doc_03', speaker: 'commander', src: cmd('keep your eyes open for our people.wav'), text: 'Keep your eyes open for our people. Any sign of them, you call it in.' },
        { id: 's01_doc_04', speaker: 'doctor', src: doc('mander i know.wav'), text: "Mander, I know. Missing crew, missing ship parts, questionable survival odds. I've got the list.", unlocksObjectives: true },
        { id: 's01_doc_05', speaker: 'overseer', src: ovr('enthusiasm detected.wav'), text: 'Enthusiasm detected. Caution... absent.', optionalOnResume: true },
        { id: 's01_doc_06', speaker: 'doctor', src: doc('oh shut up i literally.wav'), text: 'Oh, shut up. I literally brought you back to life.', optionalOnResume: true }
      ]
    }
  },
  {
    id: 'scene_02_planet_waking_up',
    folder: 'scene_02_planet_waking_up',
    title: 'Scene 02 — The Planet Is Waking Up',
    trigger: 'flora_discovered',
    enabled: true,
    category: 'contextual',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 's02_01', speaker: 'doctor', src: doc('wait those things are actually.wav'), text: "Wait. Those things... they're actually growing as we speak." },
        { id: 's02_02', speaker: 'overseer', src: ovr('growth detected impossible.wav'), text: 'Growth detected... impossible. Region frozen... until recently. Anomaly confirmed.' },
        { id: 's02_03', speaker: 'commander', src: cmd('well somebody forgot to tell.wav'), text: 'Well, somebody forgot to tell the plants.' },
        { id: 's02_04', speaker: 'doctor', src: doc('no seriously something.wav'), text: 'No, seriously. Something changed here. And I want to know what.' },
        { id: 's02_05', speaker: 'overseer', src: ovr('cause unknown investigation.wav'), text: 'Cause... unknown. Investigation... not advised.' },
        { id: 's02_06', speaker: 'doctor', src: doc('and being mysterious instead of.wav'), text: 'And being mysterious instead of being helpful is frequently annoying.' }
      ]
    }
  },
  {
    id: 'scene_03_first_hostile_encounter',
    folder: 'scene_03_first_hostile_encounter',
    title: 'Scene 03 — First Hostile Encounter',
    trigger: 'first_hostile_encounter',
    enabled: true,
    category: 'essential',
    priority: 0,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's03_01', speaker: 'commander', src: cmd('contact weve got movement.wav'), text: "Contact! We've got movement!" },
        { id: 's03_02', speaker: 'overseer', src: ovr('hostile lifeform detected.wav'), text: 'Hostile lifeform detected. Threat level... critical. Caution advised.' },
        { id: 's03_03', speaker: 'doctor', src: doc('wait i wanna see how it reacts.wav'), text: 'Wait, wait, I want to see how it reacts—' },
        { id: 's03_04', speaker: 'commander', src: cmd('doc its trying to kill me.wav'), text: "Doc, it's trying to kill me!" },
        { id: 's03_05', speaker: 'doctor', src: docRoot('well thats one reaction.wav'), text: "Well, that's one reaction." }
      ],
      doctor: [
        { id: 's03_doc_01', speaker: 'commander', src: cmd('doc youve got movement.wav'), text: "Doc, you've got movement!" },
        { id: 's03_02', speaker: 'overseer', reuseAudioKey: 'scene_03_first_hostile_encounter/s03_02', text: 'Hostile lifeform detected. Threat level... critical. Caution advised.' },
        { id: 's03_03', speaker: 'doctor', reuseAudioKey: 'scene_03_first_hostile_encounter/s03_03', text: 'Wait, wait, I want to see how it reacts—' },
        { id: 's03_doc_04', speaker: 'commander', src: cmd('doc its coming right at you.wav'), text: "Doc! It's coming right at you!" },
        { id: 's03_05', speaker: 'doctor', reuseAudioKey: 'scene_03_first_hostile_encounter/s03_05', text: "Well, that's one reaction." }
      ]
    }
  },
  {
    id: 'scene_04_something_in_the_water',
    folder: 'scene_04_something_in_the_water',
    title: 'Scene 04 — Something In The Water',
    trigger: 'water_discovered',
    enabled: true,
    category: 'contextual',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's04_01', speaker: 'doctor', src: doc('interesting theres a liquid water here.wav'), text: "Interesting. There's liquid water here. I want a sample." },
        { id: 's04_02', speaker: 'commander', src: cmd('can we make sure it doesnt dissolve.wav'), text: "Uh, can you make sure it doesn't dissolve my boots first?" },
        { id: 's04_03', speaker: 'overseer', src: ovr('liquid composition unknown.wav'), text: 'Liquid composition... unknown. Sample analysis... required.' },
        { id: 's04_04', speaker: 'doctor', src: doc('finally something we agree on.wav'), text: 'Finally. Something we agree on.' },
        { id: 's04_05', speaker: 'commander', src: cmd('you two agreeing on something.wav'), text: 'You two agreeing on something is somehow more disturbing than the water.' }
      ],
      doctor: [
        { id: 's04_01', speaker: 'doctor', reuseAudioKey: 'scene_04_something_in_the_water/s04_01', text: "Interesting. There's liquid water here. I want a sample." },
        { id: 's04_doc_02', speaker: 'commander', src: cmd('doc maybe check if that stuff dissolves.wav'), text: 'Doc, maybe check if that stuff dissolves your boots first?' },
        { id: 's04_03', speaker: 'overseer', reuseAudioKey: 'scene_04_something_in_the_water/s04_03', text: 'Liquid composition... unknown. Sample analysis... required.' },
        { id: 's04_04', speaker: 'doctor', reuseAudioKey: 'scene_04_something_in_the_water/s04_04', text: 'Finally. Something we agree on.' },
        { id: 's04_05', speaker: 'commander', reuseAudioKey: 'scene_04_something_in_the_water/s04_05', text: 'You two agreeing on something is somehow more disturbing than the water.' }
      ]
    }
  },
  {
    id: 'scene_05_biological_sacs',
    folder: 'scene_05_biological_sacs',
    title: 'Scene 05 — The Biological Sacs',
    trigger: 'first_pod_opened',
    enabled: true,
    category: 'contextual',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's05_01', speaker: 'doctor', src: doc('you just ripped that thing open.wav'), text: 'You just ripped that thing open?!' },
        { id: 's05_02', speaker: 'commander', src: cmd('there was something inside.wav'), text: 'There was something inside.' },
        { id: 's05_03', speaker: 'doctor', src: doc('thats not an answer what if its.wav'), text: "That's not an answer! What if it's an egg?" },
        { id: 's05_04', speaker: 'commander', src: cmd('then congratulations we just became.wav'), text: 'Then congratulations. We just became parents.' },
        { id: 's05_05', speaker: 'overseer', src: ovr('parenthood not advised.wav'), text: 'Parenthood... not advised. Survival odds... already questionable.' },
        { id: 's05_06', speaker: 'doctor', src: doc('oh my god.wav'), text: 'Oh my God.' }
      ],
      doctor: [
        { id: 's05_doc_01', speaker: 'commander', src: cmd('doc did you seriously just.wav'), text: 'Doc, did you seriously just rip that thing open?' },
        { id: 's05_doc_02', speaker: 'doctor', src: doc('okay why the fuck did i just.wav'), text: 'Okay... why the fuck did I just open that?' },
        { id: 's05_doc_03', speaker: 'commander', src: cmd('i was about to ask you the saem.wav'), text: 'I was about to ask you the same thing.' }
      ]
    }
  },
  {
    id: 'event_01_mutated_augment_enemy',
    folder: 'event_01_mutated_augment_enemy',
    title: 'New Event 01 — Mutated Augment Enemy',
    trigger: 'mutated_enemy_discovered',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 'ev01_doc_01', speaker: 'doctor', src: doc('hold on that ones different.wav'), text: "Hold on. That one's different. Its biology's... completely wrong." },
        { id: 'ev01_ovr_02', speaker: 'overseer', src: ovr('biological mutation detected.wav'), text: 'Biological mutation... detected. Origin... unknown.' },
        { id: 'ev01_cmd_03', speaker: 'commander', src: cmd('perfect an upgraded nightmare.wav'), text: 'Perfect. An upgraded nightmare. Just what we needed.', optionalOnResume: true }
      ],
      doctor: [
        { id: 'ev01_doc_01', speaker: 'doctor', reuseAudioKey: 'event_01_mutated_augment_enemy/ev01_doc_01', text: "Hold on. That one's different. Its biology's... completely wrong." },
        { id: 'ev01_ovr_02', speaker: 'overseer', reuseAudioKey: 'event_01_mutated_augment_enemy/ev01_ovr_02', text: 'Biological mutation... detected. Origin... unknown.' },
        { id: 'ev01_cmd_doc_03', speaker: 'commander', src: cmd('doc admire it later that.wav'), text: "Doc, admire it later. That thing's dangerous.", optionalOnResume: true }
      ]
    }
  },
  {
    id: 'scene_06_first_enhancement',
    folder: 'scene_06_first_enhancement',
    title: 'Scene 06 — The First Enhancement',
    trigger: 'first_enhancement_completed',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's06_01', speaker: 'doctor', src: doc('okay that was interesting something al.wav'), text: "Okay, that was interesting. Something just altered your equipment's output." },
        { id: 's06_02', speaker: 'commander', src: cmd('im choosing to interpret that as a good.wav'), text: "I'm choosing to interpret that as a good thing." },
        { id: 's06_03', speaker: 'overseer', src: ovr('technology ours effects on.wav'), text: 'Technology... ours. Effects on human subjects... unknown.' },
        { id: 's06_04', speaker: 'doctor', src: doc('thats literally how half.wav'), text: "That's literally how half of science starts.", optionalOnResume: true },
        { id: 's06_05', speaker: 'overseer', src: ovr('scientific methodology questionable.wav'), text: 'Scientific methodology... questionable.', optionalOnResume: true }
      ],
      doctor: [
        { id: 's06_doc_01', speaker: 'doctor', src: doc('whoa something just changed my.wav'), text: "Whoa. Something just changed my equipment's output. That's... interesting." },
        { id: 's06_doc_02', speaker: 'commander', src: cmd('doc tell me that thing didnt just fry your.wav'), text: "Doc, tell me if that thing didn't just fry your gear." },
        { id: 's06_03', speaker: 'overseer', reuseAudioKey: 'scene_06_first_enhancement/s06_03', text: 'Technology... ours. Effects on human subjects... unknown.' },
        { id: 's06_04', speaker: 'doctor', reuseAudioKey: 'scene_06_first_enhancement/s06_04', text: "That's literally how half of science starts.", optionalOnResume: true },
        { id: 's06_05', speaker: 'overseer', reuseAudioKey: 'scene_06_first_enhancement/s06_05', text: 'Scientific methodology... questionable.', optionalOnResume: true }
      ]
    }
  },
  {
    id: 'scene_07_first_artifact_clue',
    folder: 'scene_07_first_artifact_clue',
    title: 'Scene 07 — The First Artifact Clue',
    trigger: 'artifact_discovered',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only & before_fourth_enhancement',
    relevanceRule: 'before_fourth_enhancement',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's07_cmd_01', speaker: 'commander', src: cmd('chandy you recognize this.wav'), text: 'Chandy, you recognize this?' },
        { id: 's07_cmd_02', speaker: 'overseer', src: ovr('chandy invalid designation.wav'), text: 'Chandy... invalid designation. Correct: Overseer.', optionalOnResume: true },
        { id: 's07_cmd_03', speaker: 'doctor', src: doc('tomato tomato.wav'), text: 'Tomato, tomato.', optionalOnResume: true, requiresPreviousTurnId: 's07_cmd_02' },
        { id: 's07_cmd_04', speaker: 'overseer', src: ovr('artifact recognized current condition.wav'), text: 'Artifact... recognized. Current condition... unexpected.' },
        { id: 's07_cmd_05', speaker: 'doctor', src: doc('unexpected how.wav'), text: 'Unexpected how?' },
        { id: 's07_cmd_06', speaker: 'overseer', src: ovr('discrepancy unexplained data insufficient.wav'), text: 'Discrepancy... unexplained. Data insufficient.' },
        { id: 's07_cmd_07', speaker: 'commander', src: cmd('first time for everything chandy.wav'), text: 'First time for everything, Chandy.', optionalOnResume: true }
      ],
      doctor: [
        { id: 's07_doc_01', speaker: 'commander', src: cmd('chandy you recognize what doc found.wav'), text: 'Chandy, do you recognize what Doc found?' },
        { id: 's07_doc_02', speaker: 'overseer', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_02', text: 'Chandy... invalid designation. Correct: Overseer.', optionalOnResume: true },
        { id: 's07_doc_03', speaker: 'doctor', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_03', text: 'Tomato, tomato.', optionalOnResume: true, requiresPreviousTurnId: 's07_doc_02' },
        { id: 's07_doc_04', speaker: 'overseer', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_04', text: 'Artifact... recognized. Current condition... unexpected.' },
        { id: 's07_doc_05', speaker: 'doctor', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_05', text: 'Unexpected how?' },
        { id: 's07_doc_06', speaker: 'overseer', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_06', text: 'Discrepancy... unexplained. Data insufficient.' },
        { id: 's07_doc_07', speaker: 'commander', reuseAudioKey: 'scene_07_first_artifact_clue/s07_cmd_07', text: 'First time for everything, Chandy.', optionalOnResume: true }
      ]
    }
  },
  {
    id: 'event_02_first_earthquake',
    folder: 'event_02_first_earthquake',
    title: 'New Event 02 — First Earthquake',
    trigger: 'second_augment_earthquake',
    enabled: true,
    category: 'essential',
    priority: 0,
    leadInSec: 1.4,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 6,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 'ev02_cmd_01', speaker: 'commander', src: cmd('whoa what the hell was that.wav'), text: 'Whoa! What the hell was that?!' },
        { id: 'ev02_doc_02', speaker: 'doctor', src: doc('shit was that an earthquake.wav'), text: 'Shit! Was that an earthquake? What the hell caused that?' },
        { id: 'ev02_ovr_03', speaker: 'overseer', src: ovr('seismic activity detected.wav'), text: 'Seismic activity detected! Source... unknown!' }
      ],
      doctor: [
        { id: 'ev02_doc_02', speaker: 'doctor', reuseAudioKey: 'event_02_first_earthquake/ev02_doc_02', text: 'Shit! Was that an earthquake? What the hell caused that?' },
        { id: 'ev02_cmd_doc_01', speaker: 'commander', src: cmd('doc you alright that shake came.wav'), text: 'Doc! You alright? That shake came through the comms!' },
        { id: 'ev02_ovr_03', speaker: 'overseer', reuseAudioKey: 'event_02_first_earthquake/ev02_ovr_03', text: 'Seismic activity detected! Source... unknown!' }
      ]
    }
  },
  {
    id: 'event_03a_major_earthquake',
    folder: 'event_03_major_earthquake',
    title: 'New Event 03 — Major Earthquake',
    trigger: 'fourth_augment_earthquake',
    enabled: true,
    category: 'essential',
    priority: 0,
    leadInSec: 1.8,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 6,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 'ev04_cmd_01', speaker: 'commander', src: cmd('fuck again this whole place is.wav'), text: 'Fuck! Again?! This whole place is coming apart!' },
        { id: 'ev04_doc_02', speaker: 'doctor', src: doc('fuck that was worse something.wav'), text: "Fuck! That was worse! Something's seriously wrong here!" },
        { id: 'ev04_ovr_03', speaker: 'overseer', src: ovr('seismic intesity increasing.wav'), text: 'Seismic intensity... increasing! Structural instability... critical!' }
      ],
      doctor: [
        { id: 'ev04_doc_02', speaker: 'doctor', reuseAudioKey: 'event_03_major_earthquake/ev04_doc_02', text: "Fuck! That was worse! Something's seriously wrong here!" },
        { id: 'ev04_ovr_03', speaker: 'overseer', reuseAudioKey: 'event_03_major_earthquake/ev04_ovr_03', text: 'Seismic intensity... increasing! Structural instability... critical!' }
      ]
    }
  },
  {
    id: 'event_03b_concealment_revelation',
    folder: 'event_03b_concealment_revelation',
    title: 'New Event 03b — Concealment Memory Recovered',
    trigger: 'fourth_enhancement_revelation',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    onComplete: {
      codexEntryId: 'lore_stage1_tower_concealment',
      codexTitle: 'Tower Concealment System Recovered',
      codexSummary:
        'All four enhancement modules were scattered components of the Artifact Tower concealment array. Return to the tower to restore planetary stasis protection.'
    },
    variants: {
      default: [
        { id: 'rev_ovr_01', speaker: 'overseer', src: ovr('four signatures matched memory.wav'), text: 'Four signatures... matched. Memory recovered. Tower concealment.' },
        { id: 'rev_cmd_02', speaker: 'commander', src: cmd('you remember something chandy.wav'), text: 'You remember something, Chandy?' },
        { id: 'rev_ovr_03', speaker: 'overseer', src: ovr('ship impact damaged tower.wav'), text: 'Ship impact damaged tower. Four concealment modules... scattered.' },
        { id: 'rev_doc_04', speaker: 'doctor', src: doc('wait these upgrades weve been.wav'), text: "Wait. These upgrades? We've been carrying pieces of its security system?" },
        { id: 'rev_ovr_05', speaker: 'overseer', src: ovr('correct tower maintains planetary.wav'), text: 'Correct. Tower maintains planetary stasis. Alien attempts thaw. Exposed tower... vulnerable.' },
        { id: 'rev_cmd_06', speaker: 'commander', src: cmd('so we put the protection back before the alien.wav'), text: 'So we put its protection back before the Alien interferes again.' },
        { id: 'rev_ovr_07', speaker: 'overseer', src: ovr('affirmative components recovered.wav'), text: 'Affirmative. Components recovered. Activate tower to initiate restoration.', unlocksObjectives: true }
      ]
    }
  },
  {
    id: 'scene_08_why_attacking',
    folder: 'scene_08_why_attacking',
    title: 'Scene 08 — Why Is Everything Attacking Us?',
    trigger: 'extended_hostility_quiet',
    enabled: true,
    category: 'banter',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 's08_01', speaker: 'commander', src: cmd('is everything on this planet trying.wav'), text: 'Is everything on this planet trying to kill us?' },
        { id: 's08_02', speaker: 'overseer', src: ovr('indigenous organisms high threat.wav'), text: 'Indigenous organisms... high threat.' },
        { id: 's08_03', speaker: 'doctor', src: doc('thats an observation not an explanation.wav'), text: "That's an observation, not an explanation." },
        { id: 's08_04', speaker: 'overseer', src: ovr('hostility confirmed.wav'), text: 'Hostility confirmed. Organisms displaying... hostile behavioral patterns.' },
        { id: 's08_05', speaker: 'doctor', src: doc('you just used more words.wav'), text: 'You just used more words to tell me the exact same thing.' },
        { id: 's08_06', speaker: 'commander', src: cmd('doc i think youre breaking our gps.wav'), text: "Doc, I think you're breaking our GPS." }
      ]
    }
  },
  {
    id: 'event_04_artifact_tower_reached',
    folder: 'event_04_artifact_tower_reached',
    title: 'New Event 04 — Artifact Tower Reached',
    trigger: 'tower_reached',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only & before_fourth_enhancement',
    relevanceRule: 'before_fourth_enhancement',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 'tower_cmd_01', speaker: 'commander', src: cmd('so this is the tower what exactly.wav'), text: 'So this is the tower. Chandy, what exactly are we looking at?' },
        { id: 'tower_doc_02', speaker: 'doctor', src: doc('so this is it chandy.wav'), text: 'So this is it? Chandy, tell me you actually know what this thing does.' },
        { id: 'tower_ovr_03', speaker: 'overseer', src: ovr('structure confirmed artifact tower.wav'), text: 'Structure confirmed. Artifact tower... active. Function... uncertain.' }
      ],
      doctor: [
        { id: 'tower_cmd_doc_01', speaker: 'commander', src: cmd('doc check that structure lets see what.wav'), text: "Doc, check that structure. Let's see what we're dealing with." },
        { id: 'tower_doc_02', speaker: 'doctor', reuseAudioKey: 'event_04_artifact_tower_reached/tower_doc_02', text: 'So this is it? Chandy, tell me you actually know what this thing does.' },
        { id: 'tower_ovr_03', speaker: 'overseer', reuseAudioKey: 'event_04_artifact_tower_reached/tower_ovr_03', text: 'Structure confirmed. Artifact tower... active. Function... uncertain.' }
      ]
    }
  },
  {
    id: 'event_04a_tower_locked_warning',
    folder: 'event_04a_tower_locked_warning',
    title: 'New Event 04a — Tower Safeguards Offline',
    trigger: 'tower_activation_locked_attempt',
    enabled: true,
    category: 'contextual',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 4,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only & fewer_than_4_enhancements',
    relevanceRule: 'before_fourth_enhancement',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 'twlock_ovr_01', speaker: 'overseer', src: ovr('tower safeguards offline activation.wav'), text: 'Tower safeguards... offline. Activation prohibited.' },
        { id: 'twlock_doc_02', speaker: 'doctor', src: doc('then we need to figure out what broke it.wav'), text: 'Then we need to figure out what broke it.' }
      ]
    }
  },
  {
    id: 'scene_09_teleporter_ready',
    folder: 'scene_09_teleporter_ready',
    title: 'Scene 09 — Tower Activation Unlocked',
    trigger: 'tower_activation_unlocked',
    enabled: true,
    category: 'contextual',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 5,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only & tower_unlocked_not_spawned',
    relevanceRule: 'tower_ready_only',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 's09_ovr_01_unlocked', speaker: 'overseer', src: ovr('four modules detected activation.wav'), text: 'Four modules detected. Activation unlocked.' },
        { id: 's09_02', speaker: 'commander', src: cmd('finally something that works.wav'), text: 'Finally. Something that works.' },
        { id: 's09_03', speaker: 'doctor', src: doc('dont celebrate yet we still.wav'), text: "Don't celebrate yet. We still don't know what happens when you activate it." }
      ]
    }
  },
  {
    id: 'scene_10_stage1_boss',
    folder: 'scene_10_stage1_boss',
    title: 'Scene 10 — Stage 1 Boss Emerges',
    trigger: 'boss_emerged',
    enabled: true,
    category: 'essential',
    priority: 0,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 5,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'boss_active',
    needsHeroVariantReview: false,
    variants: {
      commander: [
        { id: 's10_01', speaker: 'doctor', src: doc('what the fuck is that.wav'), text: 'What the FUCK is that?!' },
        { id: 's10_02', speaker: 'overseer', src: ovr('massive hostile detected.wav'), text: 'Massive hostile... detected! Threat level... extreme!' },
        { id: 's10_03', speaker: 'commander', src: cmd('yeah i can fucking see that.wav'), text: 'Yeah, I can fucking see that!' },
        { id: 's10_04', speaker: 'doctor', src: doc('look at the size of that thing.wav'), text: 'Look at the size of that thing!' },
        { id: 's10_ovr_05_restoration', speaker: 'overseer', src: ovr('hostile entity unexpected restoration.wav'), text: 'Hostile entity... unexpected! Restoration sequence compromised!' },
        { id: 's10_06', speaker: 'commander', src: cmd('your scanner picked a hell of a time.wav'), text: 'Your scanner picked a hell of a time to fail!' },
        { id: 's10_doc_07', speaker: 'doctor', src: doc('we cant let that bastard anywhere.wav'), text: "We can't let that bastard anywhere near the ship!" },
        { id: 's10_cmd_08_takedown', speaker: 'commander', src: cmd('then were taking that thing down.wav'), text: "Then we're taking that thing down!" }
      ],
      doctor: [
        { id: 's10_01', speaker: 'doctor', reuseAudioKey: 'scene_10_stage1_boss/s10_01', text: 'What the FUCK is that?!' },
        { id: 's10_02', speaker: 'overseer', reuseAudioKey: 'scene_10_stage1_boss/s10_02', text: 'Massive hostile... detected! Threat level... extreme!' },
        { id: 's10_04', speaker: 'doctor', reuseAudioKey: 'scene_10_stage1_boss/s10_04', text: 'Look at the size of that thing!' },
        { id: 's10_ovr_05_restoration', speaker: 'overseer', reuseAudioKey: 'scene_10_stage1_boss/s10_ovr_05_restoration', text: 'Hostile entity... unexpected! Restoration sequence compromised!' },
        { id: 's10_06', speaker: 'commander', reuseAudioKey: 'scene_10_stage1_boss/s10_06', text: 'Your scanner picked a hell of a time to fail!' },
        { id: 's10_cmd_doc_07', speaker: 'commander', src: cmd('doc keep that bastard away from the ship.wav'), text: 'Doc, keep that bastard away from the ship! Take it down!' }
      ]
    }
  },
  {
    id: 'event_05_tower_restoration_refreeze',
    folder: 'event_05_tower_restoration_refreeze',
    title: 'New Event 05 — Concealment Restored & Regional Refreeze',
    trigger: 'tower_restoration_refreeze',
    enabled: true,
    category: 'essential',
    priority: 0,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'boss_defeated_before_exit',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 'refreeze_ovr_01', speaker: 'overseer', src: ovr('threat neutralized concealment.wav'), text: 'Threat neutralized. Concealment restored. Stasis field... reactivated.' },
        { id: 'refreeze_doc_02', speaker: 'doctor', src: doc('mander look the ground is freezing again.wav'), text: "Mander, look! The ground's freezing again." },
        { id: 'refreeze_cmd_03', speaker: 'commander', src: cmd('good at least one thing we broke.wav'), text: 'Good. At least one thing we broke is fixed.' }
      ]
    }
  },
  {
    id: 'scene_11_after_the_battle',
    folder: 'scene_11_after_the_battle',
    title: 'Scene 11 — After The Battle',
    trigger: 'boss_defeated_aftermath',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_deferred',
    resumable: true,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'boss_defeated_before_exit',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 's11_01', speaker: 'commander', src: cmd('is it dead.wav'), text: 'Is it dead?' },
        { id: 's11_02', speaker: 'doctor', src: doc('give me a second im trying to.wav'), text: "Give me a second. I'm trying to read the biological signals." },
        { id: 's11_04', speaker: 'doctor', src: doc('you now what bothers me some.wav'), text: "You know what bothers me? Some of its readings don't make sense." },
        { id: 's11_05', speaker: 'commander', src: cmd('doc please can we have one moment where.wav'), text: 'Doc, please. Can we have one moment where nothing tries to kill us?' },
        { id: 's11_06', speaker: 'doctor', src: doc('fine but were coming back.wav'), text: "Fine. But we're coming back to this." }
      ]
    }
  },
  {
    id: 'scene_12_leaving_the_wreckage',
    folder: 'scene_12_leaving_the_wreckage',
    title: 'Scene 12 — Leaving The Wreckage',
    trigger: 'stage_leaving',
    enabled: true,
    category: 'essential',
    priority: 1,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 5,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'during_stage_clear',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 's12_01', speaker: 'commander', src: cmd('chandy this thing takes us to another.wav'), text: 'Chandy, this thing takes us to another artifact, right?' },
        { id: 's12_02', speaker: 'overseer', src: ovr('affirmative destination another.wav'), text: 'Affirmative. Destination... another location. Same planet.' },
        { id: 's12_03', speaker: 'doctor', src: doc('so were still looking for our people.wav'), text: "So we're still looking for our people, still missing ship parts, and now we're teleporting into more alien bullshit." },
        { id: 's12_04', speaker: 'commander', src: cmd('pretty much.wav'), text: 'Pretty much.' },
        { id: 's12_05', speaker: 'overseer', src: ovr('remaining here no benefit.wav'), text: 'Remaining here... no benefit. Departure... advised.' },
        { id: 's12_06', speaker: 'doctor', src: doc('i hate that he has a point.wav'), text: 'I hate that he has a point.' }
      ]
    }
  },
  {
    id: 'ambient_a_doctors_curiosity',
    folder: 'ambient_a_doctors_curiosity',
    title: "Ambient A — Doctor's Curiosity",
    trigger: 'ambient_exploration',
    enabled: true,
    category: 'banter',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 2,
    cooldownSec: 45,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 'amb_a_01', speaker: 'doctor', src: doc('you know id love to get a sample.wav'), text: "You know, I'd love to get a sample from one of those creatures back at the ship." },
        { id: 'amb_a_02', speaker: 'commander', src: cmd('absolutely not.wav'), text: 'Absolutely not.' },
        { id: 'amb_a_03', speaker: 'doctor', src: doc('i havent even told you what i wanna do.wav'), text: "I haven't even told you what I want to do with it." },
        { id: 'amb_a_04', speaker: 'commander', src: cmd('thats exactly why i said no.wav'), text: "That's exactly why I said no." }
      ]
    }
  },
  {
    id: 'ambient_b_overseers_patience',
    folder: 'ambient_b_overseers_patience',
    title: "Ambient B — Overseer's Patience",
    trigger: 'ambient_exploration',
    enabled: true,
    category: 'banter',
    priority: 3,
    persistenceScope: 'once_per_run',
    retention: 'stage_immediate',
    ttlSec: 2,
    cooldownSec: 45,
    resumable: false,
    prerequisiteRule: 'stage1_campaign_only',
    relevanceRule: 'before_boss_spawned',
    needsHeroVariantReview: false,
    variants: {
      default: [
        { id: 'amb_b_01', speaker: 'overseer', src: ovr('current approach reckless.wav'), text: 'Current approach... reckless. Risk... unnecessary.' },
        { id: 'amb_b_02', speaker: 'commander', src: cmd('got a better idea.wav'), text: 'Got a better idea?' },
        { id: 'amb_b_03', speaker: 'overseer', src: ovr('several.wav'), text: 'Several.' },
        { id: 'amb_b_04', speaker: 'commander', src: cmd('great keep them to yourself.wav'), text: 'Great. Keep them to yourself.' },
        { id: 'amb_b_05', speaker: 'doctor', src: doc('im actually with the floating chandelier.wav'), text: 'I\'m actually with the floating chandelier on this one.' }
      ]
    }
  }
];

function median(values) {
  if (values.length === 0) return -24;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getWavDurationSec(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length <= 44) return 1.0;
  const byteRate = buf.readUInt32LE(28) || 96000;
  return Math.max(0.2, (buf.length - 44) / byteRate);
}

function measureAudio(filePath) {
  try {
    execFileSync(
      FFMPEG_BIN,
      ['-hide_banner', '-i', filePath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    // ffmpeg returns 0 usually, fall through
    const stderr = err?.stderr?.toString('utf8') || '';
    return parseFfmpegOutput(stderr);
  }
  return null;
}

function measureAudioSpawn(filePath) {
  const res = execFileSync(
    FFMPEG_BIN,
    ['-hide_banner', '-i', filePath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return res;
}

import { spawnSync } from 'node:child_process';

function probeWithLoudnorm(filePath) {
  const proc = spawnSync(
    FFMPEG_BIN,
    ['-hide_banner', '-i', filePath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  if (proc.status !== 0) {
    throw new Error(`ffmpeg loudnorm probe failed for ${filePath}: ${proc.stderr}`);
  }
  const text = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  const jsonMatch = text.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Missing loudnorm JSON output for ${filePath}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let durationSec = 0;
  if (durMatch) {
    durationSec =
      parseInt(durMatch[1], 10) * 3600 +
      parseInt(durMatch[2], 10) * 60 +
      parseFloat(durMatch[3]);
  }
  const inputI = Number(parsed.input_i);
  const inputTp = Number(parsed.input_tp);
  const inputLra = Number(parsed.input_lra);
  return {
    inputI: Number.isFinite(inputI) ? inputI : null,
    inputTp: Number.isFinite(inputTp) ? inputTp : null,
    inputLra: Number.isFinite(inputLra) ? inputLra : null,
    durationSec
  };
}

function encodeOgg(srcWav, dstOgg, gainDb, limitDb = null) {
  fs.mkdirSync(path.dirname(dstOgg), { recursive: true });
  const filters = [`atempo=${VOICE_TEMPO}`, `volume=${gainDb.toFixed(2)}dB`];
  if (limitDb !== null) {
    filters.push(`alimiter=limit=${limitDb.toFixed(2)}dB:attack=5:release=50:level=disabled`);
  }
  const proc = spawnSync(
    FFMPEG_BIN,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcWav,
      '-af',
      filters.join(','),
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'libvorbis',
      '-b:a',
      '112k',
      dstOgg
    ],
    { encoding: 'utf8' }
  );
  if (proc.status !== 0) {
    throw new Error(`ffmpeg encode failed for ${srcWav} -> ${dstOgg}: ${proc.stderr}`);
  }
}

function decodeCheckOgg(oggPath) {
  const proc = spawnSync(
    FFMPEG_BIN,
    ['-v', 'error', '-i', oggPath, '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  if (proc.status !== 0 || (proc.stderr && proc.stderr.trim().length > 0)) {
    throw new Error(`OGG decode verification failed for ${oggPath}: ${proc.stderr}`);
  }
}

function listFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(dir, d.name));
}

function main() {
  if (!fs.existsSync(FFMPEG_BIN)) {
    throw new Error(`FFmpeg binary not found: ${FFMPEG_BIN}`);
  }

  // 1. Collect unique clips across all scenes
  const uniqueClips = new Map(); // audioKey -> clip metadata
  for (const conv of CONVERSATION_SPECS) {
    for (const [variantKey, turns] of Object.entries(conv.variants)) {
      for (const turn of turns) {
        if (turn.reuseAudioKey) {
          if (!uniqueClips.has(turn.reuseAudioKey)) {
            throw new Error(`reuseAudioKey "${turn.reuseAudioKey}" must appear after its primary definition.`);
          }
          continue;
        }
        if (!turn.src) {
          throw new Error(`Missing src for ${conv.id}.${variantKey}.${turn.id}`);
        }
        if (!fs.existsSync(turn.src)) {
          throw new Error(`Source WAV not found: ${turn.src}`);
        }
        const audioKey = `${conv.folder}/${turn.id}`;
        if (uniqueClips.has(audioKey)) {
          throw new Error(`Duplicate audioKey "${audioKey}"`);
        }
        uniqueClips.set(audioKey, {
          audioKey,
          sceneId: conv.id,
          sceneFolder: conv.folder,
          lineId: turn.id,
          speaker: turn.speaker,
          srcWav: turn.src,
          originalFilename: path.basename(turn.src),
          outOgg: path.join(AUDIO_OUT_ROOT, conv.folder, `${turn.id}.ogg`),
          audioUrl: `/assets/audio/dialogue/stage1/${conv.folder}/${turn.id}.ogg`,
          trigger: conv.trigger,
          priority: conv.priority
        });
      }
    }
  }

  // Inventory audit against source directories
  const allDiscovered = [
    ...listFiles(CMD_DIR),
    ...listFiles(DOC_DIR),
    path.join(DOC_ROOT, 'well thats one reaction.wav'),
    ...listFiles(OVR_DIR)
  ];
  const mappedSrcSet = new Set([...uniqueClips.values()].map((c) => c.srcWav.toLowerCase()));
  const unmapped = [];
  for (const f of allDiscovered) {
    const low = f.toLowerCase();
    if (!mappedSrcSet.has(low) && !EXCLUDED_SUPERSEDED.has(low)) {
      unmapped.push(f);
    }
  }
  if (unmapped.length > 0) {
    throw new Error(`Unaccounted source recordings found:\n- ${unmapped.join('\n- ')}`);
  }

  console.log(`Discovered ${allDiscovered.length} gameplay WAVs (${uniqueClips.size} active, ${EXCLUDED_SUPERSEDED.size} excluded superseded).`);
  console.log('Pass 1: Measuring integrated loudness & true peak of all 117 source WAVs...');

  const measuredBySpeaker = { commander: [], doctor: [], overseer: [] };
  for (const clip of uniqueClips.values()) {
    const wavDur = getWavDurationSec(clip.srcWav);
    const probe = probeWithLoudnorm(clip.srcWav);
    clip.rawDurationSec = probe.durationSec || wavDur;
    clip.inputI = probe.inputI;
    clip.inputTp = probe.inputTp;
    clip.inputLra = probe.inputLra;
    if (clip.inputI !== null && clip.rawDurationSec >= 2.0) {
      measuredBySpeaker[clip.speaker].push(clip.inputI);
    }
  }

  const charBaseline = {};
  for (const spk of ['commander', 'doctor', 'overseer']) {
    const medI = median(measuredBySpeaker[spk]);
    charBaseline[spk] = {
      medianInputI: Number(medI.toFixed(2)),
      baseGainDb: Number((-16.0 - medI).toFixed(2))
    };
    console.log(`  ${spk}: median input_i = ${charBaseline[spk].medianInputI} LUFS, base gain = ${charBaseline[spk].baseGainDb} dB`);
  }

  console.log('Encoding 117 normalized OGG/Vorbis files & running Pass 2 verification...');
  const results = [];
  for (const clip of uniqueClips.values()) {
    const baseGain = charBaseline[clip.speaker].baseGainDb;
    let gainDb = baseGain;
    let specialTreatment = null;

    if (clip.inputI === null) {
      gainDb = baseGain;
      specialTreatment = 'non_finite_lufs_used_character_baseline';
    } else {
      const rawGain = -16.0 - clip.inputI;
      const dev = rawGain - baseGain;
      if (clip.rawDurationSec < 2.0) {
        const clampedDev = Math.max(-1.5, Math.min(1.5, dev));
        gainDb = baseGain + clampedDev * 0.5;
        specialTreatment = 'short_clip_damped_gain';
      } else {
        const clampedDev = Math.max(-3.0, Math.min(3.0, dev * 0.65));
        gainDb = baseGain + clampedDev;
      }
    }

    const inputTp = clip.inputTp !== null ? clip.inputTp : -10;
    const maxGainForLimiter = -1.8 - inputTp + 9.0;
    if (gainDb > maxGainForLimiter) {
      gainDb = maxGainForLimiter;
      specialTreatment = specialTreatment ? `${specialTreatment}+tp_capped` : 'tp_capped';
    }

    let needsLimiter = inputTp + gainDb > -1.9;
    if (needsLimiter) {
      specialTreatment = specialTreatment ? `${specialTreatment}+peak_limited` : 'peak_limited';
    }

    encodeOgg(clip.srcWav, clip.outOgg, gainDb, needsLimiter ? -1.8 : null);
    let post = probeWithLoudnorm(clip.outOgg);

    // If peak limiting left the speech body >1.2 dB below target, re-encode once directly from lossless WAV with gentle makeup
    const targetFloor = clip.rawDurationSec < 2.0 ? -17.6 : -17.0;
    if (post.inputI !== null && post.inputI < targetFloor) {
      const makeupDb = Math.min(3.2, -16.1 - post.inputI);
      gainDb += makeupDb;
      needsLimiter = inputTp + gainDb > -1.9;
      encodeOgg(clip.srcWav, clip.outOgg, gainDb, needsLimiter ? -1.8 : null);
      post = probeWithLoudnorm(clip.outOgg);
      specialTreatment = specialTreatment ? `${specialTreatment}+makeup` : 'makeup';
    }

    // Safety pass if Vorbis lossy encoding caused TP overshoot above -1.4 dBTP
    if (post.inputTp !== null && post.inputTp > -1.4) {
      encodeOgg(clip.srcWav, clip.outOgg, gainDb, -2.2);
      post = probeWithLoudnorm(clip.outOgg);
      specialTreatment = specialTreatment ? `${specialTreatment}+strict_tp_limit` : 'strict_tp_limit';
    }

    decodeCheckOgg(clip.outOgg);

    clip.appliedGainDb = Number(gainDb.toFixed(2));
    clip.outputI = post.inputI;
    clip.outputTp = post.inputTp;
    clip.outputLra = post.inputLra;
    clip.durationSec = Math.max(0.4, Number(post.durationSec.toFixed(2)));
    clip.oggBytes = fs.statSync(clip.outOgg).size;
    clip.specialTreatment = specialTreatment || 'linear_gain_only';
    results.push(clip);
  }

  // Build stage1.json
  const manifestConversations = CONVERSATION_SPECS.map((conv) => {
    const outConv = {
      id: conv.id,
      title: conv.title,
      trigger: conv.trigger,
      enabled: conv.enabled,
      category: conv.category,
      priority: conv.priority,
      persistenceScope: conv.persistenceScope,
      retention: conv.retention
    };
    if (conv.ttlSec !== undefined) outConv.ttlSec = conv.ttlSec;
    if (conv.cooldownSec !== undefined) outConv.cooldownSec = conv.cooldownSec;
    if (conv.leadInSec !== undefined) outConv.leadInSec = conv.leadInSec;
    outConv.resumable = conv.resumable;
    outConv.prerequisiteRule = conv.prerequisiteRule;
    outConv.relevanceRule = conv.relevanceRule;
    outConv.needsHeroVariantReview = conv.needsHeroVariantReview;
    outConv.variants = {};

    for (const [variantKey, turns] of Object.entries(conv.variants)) {
      outConv.variants[variantKey] = turns.map((t) => {
        const key = t.reuseAudioKey || `${conv.folder}/${t.id}`;
        const clip = uniqueClips.get(key);
        const turnObj = {
          id: t.id,
          speaker: t.speaker,
          text: t.text,
          audioUrl: clip.audioUrl,
          durationSec: clip.durationSec
        };
        if (t.optionalOnResume) turnObj.optionalOnResume = true;
        if (t.unlocksObjectives) turnObj.unlocksObjectives = true;
        if (t.requiresPreviousTurnId) turnObj.requiresPreviousTurnId = t.requiresPreviousTurnId;
        return turnObj;
      });
    }

    if (conv.onComplete) outConv.onComplete = conv.onComplete;
    return outConv;
  });

  const manifest = {
    version: '1.0',
    stageNumber: 1,
    conversations: manifestConversations
  };
  fs.writeFileSync(MANIFEST_OUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Remove superseded legacy .wav files inside public/assets/audio/dialogue/stage1 ONLY
  let removedLegacyWavCount = 0;
  function purgeLegacyWavs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        purgeLegacyWavs(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) {
        fs.unlinkSync(full);
        removedLegacyWavCount++;
      }
    }
  }
  purgeLegacyWavs(AUDIO_OUT_ROOT);

  // Build summary report
  const summaryBySpeaker = {};
  for (const spk of ['commander', 'doctor', 'overseer']) {
    const items = results.filter((r) => r.speaker === spk);
    const inIs = items.map((r) => r.inputI).filter((v) => v !== null);
    const outIs = items.map((r) => r.outputI).filter((v) => v !== null);
    const outTps = items.map((r) => r.outputTp).filter((v) => v !== null);
    summaryBySpeaker[spk] = {
      clipCount: items.length,
      inputMedianLUFS: Number(median(inIs).toFixed(2)),
      inputMinLUFS: Number(Math.min(...inIs).toFixed(2)),
      inputMaxLUFS: Number(Math.max(...inIs).toFixed(2)),
      outputMedianLUFS: Number(median(outIs).toFixed(2)),
      outputMinLUFS: Number(Math.min(...outIs).toFixed(2)),
      outputMaxLUFS: Number(Math.max(...outIs).toFixed(2)),
      outputMaxTruePeakDbTP: Number(Math.max(...outTps).toFixed(2))
    };
  }

  fs.mkdirSync(path.dirname(REPORT_OUT_PATH), { recursive: true });
  fs.writeFileSync(
    REPORT_OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        voiceTempo: VOICE_TEMPO,
        totalDiscoveredWavs: allDiscovered.length,
        activeNormalizedOggs: results.length,
        removedLegacyWavs: removedLegacyWavCount,
        excludedSuperseded: [...EXCLUDED_SUPERSEDED.entries()].map(([file, reason]) => ({ file, reason })),
        summaryBySpeaker,
        clips: results.map((r) => ({
          lineId: r.lineId,
          sceneId: r.sceneId,
          speaker: r.speaker,
          originalFilename: r.originalFilename,
          srcWav: r.srcWav,
          audioUrl: r.audioUrl,
          trigger: r.trigger,
          priority: r.priority,
          durationSec: r.durationSec,
          inputI: r.inputI,
          inputTp: r.inputTp,
          inputLra: r.inputLra,
          appliedGainDb: r.appliedGainDb,
          outputI: r.outputI,
          outputTp: r.outputTp,
          outputLra: r.outputLra,
          oggBytes: r.oggBytes,
          specialTreatment: r.specialTreatment
        }))
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('=== SUMMARY BY SPEAKER ===');
  console.table(summaryBySpeaker);
  console.log(`Manifest written: ${MANIFEST_OUT_PATH}`);
  console.log(`Removed legacy WAVs: ${removedLegacyWavCount}`);
  console.log(`Report written: ${REPORT_OUT_PATH}`);
}

main();
