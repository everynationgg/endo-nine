import { HeroId } from './types';

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string;
  lore: string;
  portrait: string;
  baseMaxHealth: number;
  baseMoveSpeed: number;
  passiveName: string;
  passiveDesc: string;
  defenseBonusDuration: number;
  defenseBonusReduction: number;
}

export const HERO_COMMANDER: HeroDef = {
  id: 'commander',
  name: 'Commander',
  title: 'Errant Night Vanguard',
  lore: 'Supreme field officer of the Errant Night expeditionary force. Equipped with tactical bio-kinetic armor and command pulse matrices. Dispatched to the thawing permafrost of Sector 1 to secure the primary resonance artifact.',
  portrait: '/assets/commander/commander_portrait.png',
  baseMaxHealth: 120,
  baseMoveSpeed: 230,
  passiveName: "Commander's Resolve",
  passiveDesc: 'Taking damage triggers a protective kinetic shield, reducing incoming damage by 35% for 2.5 seconds.',
  defenseBonusDuration: 2.5,
  defenseBonusReduction: 0.35
};

export const HERO_DOCTOR: HeroDef = {
  id: 'doctor',
  name: 'Doctor',
  title: 'Chief Medical Officer',
  lore: 'Chief medical officer of the Errant Night expeditionary crew. Master of bio-chemical synthesis, nano-cellular regeneration, and neuro-sedative compounds. Operates with tactical field agility and crowd-control incapacitation darts.',
  portrait: '/assets/doctor/doctor_portrait.png',
  baseMaxHealth: 140,
  baseMoveSpeed: 225,
  passiveName: 'Bio-Cellular Triage',
  passiveDesc: 'Passively regenerates 3 HP/s (surging to 7 HP/s when below 50% HP). Healing efficiency and vital stabilization are amplified.',
  defenseBonusDuration: 0,
  defenseBonusReduction: 0
};

export const HERO_REGISTRY: Record<HeroId, HeroDef> = {
  commander: HERO_COMMANDER,
  doctor: HERO_DOCTOR
};
