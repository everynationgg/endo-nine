import { GameState } from '../sim/GameState';
import { Simulation } from '../sim/Simulation';
import { ITEM_REGISTRY, BUFF_REGISTRY } from '../sim/ItemDefs';
import { getStageArtifactPolicy } from '../sim/StageProgressionPolicy';
import { ItemId, BuffId, HeroId, SkillSlot, SkillEnhancementId } from '../sim/types';
import { getDifficultyTier } from '../sim/DifficultyDefs';
import { SkillPreviewScene } from '../render/SkillPreviewScene';
import {
  AbilityPreviewData,
  getHeroBaseSkills,
  getHeroSkillUpgrades,
  getAllPassiveBuffsCatalog
} from '../sim/SkillPreviewCatalog';
import type {
  CommsPresentationState,
  DevConversationSummary,
  TranscriptEntry,
  UnlockedCodexLore
} from '../narrative/types';

export interface DialogueUIController {
  getConversationSummaries(): DevConversationSummary[];
  forcePlayConversation(conversationId: string, heroOverride?: HeroId): Promise<boolean>;
  triggerDevSignal(triggerId: string): void;
  forceStop(): void;
  reloadManifest(clearBuffers?: boolean): Promise<{ count: number; voicedCount: number }>;
  resetSavePersistence(): void;
  getTranscript(): TranscriptEntry[];
  getUnlockedCodexLore(): UnlockedCodexLore[];
  getActiveRunObjectives(): UnlockedCodexLore[];
  getPresentationState(): CommsPresentationState;
  getDebugInfo(): {
    lifecycleState: string;
    activeId: string | null;
    turnIndex: number;
    queueIds: string[];
    completedSaveIds: string[];
    completedRunIds: string[];
    voicedBufferedCount: number;
    voicedTotalEnabledUrls: number;
  };
  isCustomTestMapActive(): boolean;
}

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GameSettings {
  invertCameraPan: boolean;
  invertCameraPitch: boolean;
  mouseSensitivity: number;
  autoCastPrimary: boolean;
  autoCastSecondary: boolean;
  masterVolume: number;
  voiceVolume: number;
  subtitlesEnabled: boolean;
  isMuted: boolean;
  use3DCommander: boolean;
  graphicsQuality: GraphicsQuality;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCommsTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export class UIManager {
  private container: HTMLElement;
  private simulation: Simulation | null = null;
  private onStartRunCallback: (() => void | Promise<void>) | null = null;
  private onRestartCallback: (() => void | Promise<void>) | null = null;

  // Settings State & Callbacks
  public settings: GameSettings = {
    invertCameraPan: false,
    invertCameraPitch: false,
    mouseSensitivity: 1.0,
    autoCastPrimary: true,
    autoCastSecondary: true,
    masterVolume: 0.8,
    voiceVolume: 0.95,
    subtitlesEnabled: true,
    isMuted: false,
    use3DCommander: false,
    graphicsQuality: 'medium'
  };
  public onSettingsChangedCallback: ((settings: GameSettings) => void) | null = null;
  public onExitToMenuCallback: (() => void) | null = null;
  private dialogueController: DialogueUIController | null = null;
  public onLoadTestMapCallback: ((file: File, scaleMode: 'auto' | 'x100' | 'x25' | 'x1') => Promise<string>) | null = null;
  public onResetDefaultMapCallback: (() => Promise<string>) | null = null;
  public onOpenDeveloperModeCallback: (() => void | Promise<void>) | null = null;
  public activeMapName: string = 'Blenderrr.glb';
  public isCustomUploadedMap: boolean = false;
  private settingsReturnScreenId: string = 'screen-main-menu';

  // DOM elements cache
  private elMainMenu!: HTMLElement;
  private elHeroSelect!: HTMLElement;
  private elHudContainer!: HTMLElement;
  private elBuffChoiceModal!: HTMLElement;
  private elBuffCardsGrid!: HTMLElement;
  private elGameOverModal!: HTMLElement;
  private elStageClearModal!: HTMLElement;
  private elSettingsModal!: HTMLElement;
  private elPauseModal!: HTMLElement;
  private btnPauseResume!: HTMLElement;
  private btnPauseUnstuck!: HTMLElement;
  private btnPauseSettings!: HTMLElement;
  private btnPauseRestart!: HTMLElement;
  private btnPauseExit!: HTMLElement;
  private pauseStatTime!: HTMLElement;
  private pauseStatThreat!: HTMLElement;
  private pauseStatGenes!: HTMLElement;
  private pauseStatKills!: HTMLElement;

  public selectedHeroId: HeroId = 'commander';
  public onHeroSelectedCallback: ((heroId: HeroId) => void) | null = null;
  private elPortraitImg!: HTMLImageElement;
  private elHeroName!: HTMLElement;

  // Skills & Upgrades Pre-Game Interactive Preview Hub
  private previewScene: SkillPreviewScene | null = null;
  private currentPreviewTab: 'base' | 'upgrades' | 'passives' | 'dossier' = 'base';
  private currentPassiveFilter: string = 'all';
  private currentSelectedAbility: AbilityPreviewData | null = null;
  private selectedExtraProjectiles: number = 0;

  // Settings Modal Controls
  private btnSettingPan!: HTMLElement;
  private btnSettingPitch!: HTMLElement;
  private rangeSettingSens!: HTMLInputElement;
  private valSettingSens!: HTMLElement;
  private btnSettingPrimary!: HTMLElement;
  private btnSettingSecondary!: HTMLElement;
  private btnSettingAudio!: HTMLElement;
  private rangeSettingVol!: HTMLInputElement;
  private valSettingVol!: HTMLElement;
  private rangeSettingVoice!: HTMLInputElement;
  private valSettingVoice!: HTMLElement;
  private btnSettingSubtitles!: HTMLElement;
  private btnSettingReset!: HTMLElement;
  private btnSettingConfirm!: HTMLElement;
  private btnSetting3D!: HTMLElement;
  private btnQualityLow!: HTMLElement;
  private btnQualityMed!: HTMLElement;
  private btnQualityHigh!: HTMLElement;
  private descQualityPreset!: HTMLElement;

  // Radio Comms HUD & Dev Tester Elements
  private elCommsPanel!: HTMLElement;
  private elCommsPortrait!: HTMLImageElement;
  private elCommsSpeaker!: HTMLElement;
  private elCommsRole!: HTMLElement;
  private elCommsTurn!: HTMLElement;
  private elCommsMode!: HTMLElement;
  private elCommsText!: HTMLElement;
  private elQuestTracker!: HTMLElement;
  private elQuestTrackerList!: HTMLElement;
  private lastQuestTrackerKey: string = '';
  private lastCommsRenderKey: string = '';
  private lastDialoguePresentation: CommsPresentationState | null = null;
  private tacticalCommTimer: number | null = null;
  private elDevTesterPanel!: HTMLElement;
  private elDevTesterSelect!: HTMLSelectElement;
  private elDevTesterHero!: HTMLSelectElement;
  private elDevTesterStatus!: HTMLElement;
  private devStatusInterval: number | null = null;

  // HUD elements
  private elLevelPill!: HTMLElement;
  private elHpFill!: HTMLElement;
  private elHpText!: HTMLElement;
  private elShieldRow!: HTMLElement;
  private elShieldFill!: HTMLElement;
  private elShieldText!: HTMLElement;
  private elXpFill!: HTMLElement;
  private elStageLabel!: HTMLElement;
  private elCurrencyText!: HTMLElement;
  private elKillsText!: HTMLElement;
  private elArtifactBar!: HTMLElement;
  private elArtifactFill!: HTMLElement;
  private elArtifactStatus!: HTMLElement;
  private elPickupToast!: HTMLElement;
  private elBuffsRow!: HTMLElement;
  private lastBuffsHtml: string = '';

  // Top-Right Terrain Minimap
  private elMinimapCanvas: HTMLCanvasElement | null = null;
  private elMinimapNorth: HTMLElement | null = null;
  private terrainMapCanvas: HTMLCanvasElement | null = null;
  private terrainMapWorldW: number = 0;
  private terrainMapWorldH: number = 0;
  private terrainMapMargin: number = 0;

  // Right-Side Expandable Passive Items Dock
  private elItemsDock!: HTMLElement;
  private btnItemsToggle!: HTMLElement;

  // In-Game Inventory & Codex Modals
  private elInventoryModal!: HTMLElement;
  private elInventoryBody!: HTMLElement;
  private elCodexModal!: HTMLElement;
  private elCodexBody!: HTMLElement;
  private currentCodexTab: 'skills' | 'items' | 'comms' = 'skills';

  // Boss Health Bar
  private elBossBarWrap!: HTMLElement;
  private elBossTitle!: HTMLElement;
  private elBossHpText!: HTMLElement;
  private elBossBarFill!: HTMLElement;

  // Interaction & World Event HUD elements
  private elInteractPrompt!: HTMLElement;
  private elInteractKey!: HTMLElement;
  private elInteractLabel!: HTMLElement;
  private elEventBanner!: HTMLElement;
  private eventBannerTitle!: HTMLElement;
  private eventProgressBar!: HTMLElement;
  private eventBannerDesc!: HTMLElement;

  public onRequestPointerLock: (() => void) | null = null;

  // Skills & Traversal
  private elPulseCd!: HTMLElement;
  private elWaveCd!: HTMLElement;
  private elDashCd!: HTMLElement;
  private elUltCd!: HTMLElement;
  private elSweepPrimary!: HTMLElement;
  private elSweepSecondary!: HTMLElement;
  private elSweepUtility!: HTMLElement;
  private elSweepUltimate!: HTMLElement;
  private elPrimaryIcon: HTMLImageElement | null = null;
  private elSecondaryIcon: HTMLImageElement | null = null;
  private elUtilityIcon: HTMLImageElement | null = null;
  private elUltimateIcon: HTMLImageElement | null = null;
  private elEnhBadgePrimary!: HTMLElement;
  private elEnhBadgeSecondary!: HTMLElement;
  private elEnhBadgeUtility!: HTMLElement;
  private elEnhBadgeUltimate!: HTMLElement;
  private elJetpackFill!: HTMLElement;
  private elJetpackStatus!: HTMLElement;
  private btnAutoPrimary!: HTMLElement;
  private btnAutoSecondary!: HTMLElement;

  // Items
  private elItemsTray!: HTMLElement;
  private lastItemsHtml: string = '';

  // Modals stats
  private elClearStats!: HTMLElement;
  private elGameOverStats!: HTMLElement;

  // Difficulty / Clock Elements
  private elDiffClockText!: HTMLElement;
  private elDiffBarFill!: HTMLElement;
  private elDiffBanner!: HTMLElement;
  private elDiffBannerTier!: HTMLElement;
  private elDiffBannerDesc!: HTMLElement;
  private diffBannerTimer: number | null = null;

  private lastRenderedBuffKey: string = '';
  private toastTimer: number | null = null;
  public onToggleMuteCallback: (() => boolean) | null = null;
  public onToggleCameraPanCallback: (() => boolean) | null = null;

  constructor() {
    this.container = document.getElementById('ui-layer') as HTMLElement;
    this.loadSettings();
    this.renderInitialDOM();
    this.cacheElements();
    this.attachEventListeners();
    this.syncSettingsUI();
  }

  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('endo_nine_settings') || localStorage.getItem('ender_nine_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate to 2.5D Illustrated active mode as default
        if (parsed.version !== '2.5d_restored') {
          parsed.use3DCommander = false;
          parsed.version = '2.5d_restored';
        }
        this.settings = { ...this.settings, ...parsed };
      }
    } catch {
      // ignore
    }
  }

  public saveSettings(): void {
    try {
      localStorage.setItem('endo_nine_settings', JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    if (this.onSettingsChangedCallback) {
      this.onSettingsChangedCallback(this.settings);
    }
    if (this.simulation) {
      this.simulation.state.player.autoCastPrimary = this.settings.autoCastPrimary;
      this.simulation.state.player.autoCastSecondary = this.settings.autoCastSecondary;
    }
  }

  public syncSettingsUI(): void {
    // Camera Pan
    if (this.btnSettingPan) {
      if (this.settings.invertCameraPan) {
        this.btnSettingPan.classList.add('active');
        this.btnSettingPan.textContent = 'INVERTED';
      } else {
        this.btnSettingPan.classList.remove('active');
        this.btnSettingPan.textContent = 'STANDARD';
      }
    }
    this.updateCameraPanIcon(this.settings.invertCameraPan);

    // Camera Pitch
    if (this.btnSettingPitch) {
      if (this.settings.invertCameraPitch) {
        this.btnSettingPitch.classList.add('active');
        this.btnSettingPitch.textContent = 'INVERTED';
      } else {
        this.btnSettingPitch.classList.remove('active');
        this.btnSettingPitch.textContent = 'STANDARD';
      }
    }

    // Sensitivity
    if (this.rangeSettingSens) {
      this.rangeSettingSens.value = this.settings.mouseSensitivity.toString();
    }
    if (this.valSettingSens) {
      this.valSettingSens.textContent = `${this.settings.mouseSensitivity.toFixed(1)}x`;
    }

    // Auto primary
    if (this.btnSettingPrimary) {
      if (this.settings.autoCastPrimary) {
        this.btnSettingPrimary.classList.add('active');
        this.btnSettingPrimary.textContent = 'AUTO-TARGET';
      } else {
        this.btnSettingPrimary.classList.remove('active');
        this.btnSettingPrimary.textContent = 'MANUAL AIM';
      }
    }
    if (this.btnAutoPrimary) {
      if (this.settings.autoCastPrimary) {
        this.btnAutoPrimary.classList.add('active');
        this.btnAutoPrimary.textContent = 'AUTO';
      } else {
        this.btnAutoPrimary.classList.remove('active');
        this.btnAutoPrimary.textContent = 'MANUAL';
      }
    }

    // Auto secondary
    if (this.btnSettingSecondary) {
      if (this.settings.autoCastSecondary) {
        this.btnSettingSecondary.classList.add('active');
        this.btnSettingSecondary.textContent = 'AUTO-CAST';
      } else {
        this.btnSettingSecondary.classList.remove('active');
        this.btnSettingSecondary.textContent = 'MANUAL CLICK';
      }
    }
    if (this.btnAutoSecondary) {
      if (this.settings.autoCastSecondary) {
        this.btnAutoSecondary.classList.add('active');
        this.btnAutoSecondary.textContent = 'AUTO';
      } else {
        this.btnAutoSecondary.classList.remove('active');
        this.btnAutoSecondary.textContent = 'MANUAL';
      }
    }

    // Audio & Volume
    if (this.btnSettingAudio) {
      if (this.settings.isMuted) {
        this.btnSettingAudio.classList.remove('active');
        this.btnSettingAudio.textContent = 'AUDIO MUTED';
      } else {
        this.btnSettingAudio.classList.add('active');
        this.btnSettingAudio.textContent = 'AUDIO ON';
      }
    }
    this.updateAudioIcon(this.settings.isMuted);

    if (this.rangeSettingVol) {
      this.rangeSettingVol.value = Math.round(this.settings.masterVolume * 100).toString();
    }
    if (this.valSettingVol) {
      this.valSettingVol.textContent = `${Math.round(this.settings.masterVolume * 100)}%`;
    }

    const voiceVol = this.settings.voiceVolume ?? 0.95;
    if (this.rangeSettingVoice) {
      this.rangeSettingVoice.value = Math.round(voiceVol * 100).toString();
    }
    if (this.valSettingVoice) {
      this.valSettingVoice.textContent = `${Math.round(voiceVol * 100)}%`;
    }

    if (this.btnSettingSubtitles) {
      if (this.settings.subtitlesEnabled !== false) {
        this.btnSettingSubtitles.classList.add('active');
        this.btnSettingSubtitles.textContent = 'SUBTITLES ON';
      } else {
        this.btnSettingSubtitles.classList.remove('active');
        this.btnSettingSubtitles.textContent = 'SUBTITLES OFF';
      }
    }

    // Character Rendering Toggle
    if (this.btnSetting3D) {
      if (this.settings.use3DCommander) {
        this.btnSetting3D.classList.add('active');
        this.btnSetting3D.textContent = '3D EXPERIMENTAL (ROLLBACK)';
      } else {
        this.btnSetting3D.classList.remove('active');
        this.btnSetting3D.textContent = '2.5D ILLUSTRATED (ACTIVE)';
      }
    }

    // Graphics Quality Preset
    const quality: GraphicsQuality = this.settings.graphicsQuality || 'medium';
    this.btnQualityLow?.classList.toggle('active', quality === 'low');
    this.btnQualityMed?.classList.toggle('active', quality === 'medium');
    this.btnQualityHigh?.classList.toggle('active', quality === 'high');
    if (this.descQualityPreset) {
      if (quality === 'low') {
        this.descQualityPreset.textContent = 'Low: 1.0x scale, no bloom, static clouds & up to 4 dynamic lights (best FPS).';
      } else if (quality === 'high') {
        this.descQualityPreset.textContent = 'High: crisp 1.5x scale, richer bloom, drifting clouds & up to 10 dynamic lights.';
      } else {
        this.descQualityPreset.textContent = 'Medium: balanced 60 FPS target (1.25x cap, half-res bloom, up to 8 dynamic lights).';
      }
    }
  }

  public openSettings(fromScreenId: string = 'screen-main-menu'): void {
    this.settingsReturnScreenId = fromScreenId;
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    const curScreen = document.getElementById(fromScreenId);
    if (curScreen && fromScreenId !== 'hud-container') {
      curScreen.classList.add('hidden');
    }
    this.elSettingsModal.classList.remove('hidden');
    this.syncSettingsUI();
  }

  public closeSettings(): void {
    this.elSettingsModal.classList.add('hidden');
    const returnScreen = document.getElementById(this.settingsReturnScreenId);
    if (returnScreen && this.settingsReturnScreenId !== 'hud-container') {
      returnScreen.classList.remove('hidden');
    }
    if (this.settingsReturnScreenId === 'hud-container' && this.simulation?.state.isGameStarted) {
      window.focus();
    }
  }

  public pauseGame(): void {
    if (!this.simulation || !this.simulation.state.isGameStarted) return;
    this.simulation.state.isPaused = true;
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
    const minutes = Math.floor(this.simulation.state.gameTime / 60);
    const seconds = Math.floor(this.simulation.state.gameTime % 60);
    this.pauseStatTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const { tierDef } = getDifficultyTier(this.simulation.state.gameTime);
    this.pauseStatThreat.textContent = `${tierDef.name} (${tierDef.threatMultiplier.toFixed(1)}x)`;
    this.pauseStatGenes.textContent = `${this.simulation.state.player.currency}`;
    this.pauseStatKills.textContent = `${this.simulation.state.player.killCount}`;
    this.syncPauseEnhancementsUI();
    this.elPauseModal.classList.remove('hidden');
  }

  public syncPauseEnhancementsUI(): void {
    if (!this.simulation) return;
    const heroId = this.simulation.state.player.heroId === 'doctor' ? 'doctor' : 'commander';
    const titleEl = this.container.querySelector('.pause-enh-title');
    if (titleEl) {
      titleEl.innerHTML = `${heroId === 'doctor' ? 'DOCTOR' : 'COMMANDER'} SKILL ENHANCEMENTS <span class="pause-enh-sub">[Hotkeys: F1 LMB, F2 RMB, F3 Dash, F4 Ult]</span>`;
    }

    const HERO_PAUSE_ENHS: Record<'commander' | 'doctor', Record<SkillSlot, { enh: string; label: string }[]>> = {
      commander: {
        primary: [
          { enh: 'base', label: 'Base' },
          { enh: 'chill_beam', label: 'Chill Beam' },
          { enh: 'piercing_laser', label: 'Piercing Laser' },
          { enh: 'extended_slash', label: 'Extended Slash' }
        ],
        secondary: [
          { enh: 'base', label: 'Base' },
          { enh: 'scissor_slash', label: 'Scissor Slash' },
          { enh: 'frost_burst', label: 'Frost Burst' },
          { enh: 'orbiting_blade', label: 'Orbiting Swords' }
        ],
        utility: [
          { enh: 'base', label: 'Base' },
          { enh: 'shock_dash', label: 'Shock Dash' },
          { enh: 'extended_dash', label: 'Extended Dash' },
          { enh: 'teleport', label: 'Teleport' }
        ],
        ultimate: [
          { enh: 'base', label: 'Base' },
          { enh: 'singularity', label: 'Singularity' },
          { enh: 'convergence_barrage', label: 'Five-Strike' },
          { enh: 'cryogenic_impact', label: 'Cryo Impact' }
        ]
      },
      doctor: {
        primary: [
          { enh: 'base', label: 'Base' },
          { enh: 'toxic_chain', label: 'Toxic Chain' },
          { enh: 'cryogenic_scalpel', label: 'Cryo Scalpel' },
          { enh: 'vital_extraction', label: 'Vital Extract' }
        ],
        secondary: [
          { enh: 'base', label: 'Base' },
          { enh: 'experimental_drones', label: 'Exp. Drones' },
          { enh: 'toxic_cluster_bomb', label: 'Cluster Bomb' },
          { enh: 'holographic_decoy', label: 'Holo Decoy' }
        ],
        utility: [
          { enh: 'base', label: 'Base' },
          { enh: 'extended_dash', label: 'Extended Dash' },
          { enh: 'phase_barrier', label: 'Phase Barrier' },
          { enh: 'adrenaline_rush', label: 'Adrenaline Rush' }
        ],
        ultimate: [
          { enh: 'base', label: 'Base' },
          { enh: 'mobile_sanctuary', label: 'Mobile Sanct.' },
          { enh: 'divine_intervention', label: 'Divine Angels' },
          { enh: 'rain_of_crosses', label: 'Rain of Crosses' }
        ]
      }
    };

    const enhs = this.simulation.state.player.skillEnhancements || {};
    const heroMap = HERO_PAUSE_ENHS[heroId];
    const rows = this.container.querySelectorAll('.pause-enh-row');
    const slotOrder: SkillSlot[] = ['primary', 'secondary', 'utility', 'ultimate'];
    rows.forEach((row, rIdx) => {
      const slot = slotOrder[rIdx];
      const defs = slot ? heroMap[slot] : undefined;
      const rowBtns = row.querySelectorAll('.pause-enh-btn');
      rowBtns.forEach((b, bIdx) => {
        if (defs && defs[bIdx]) {
          b.setAttribute('data-slot', slot);
          b.setAttribute('data-enh', defs[bIdx].enh);
          b.textContent = defs[bIdx].label;
        }
        const curSlot = b.getAttribute('data-slot') as SkillSlot | null;
        const enh = b.getAttribute('data-enh');
        const activeEnh = (curSlot && enhs[curSlot]) || null;
        if ((enh === 'base' && !activeEnh) || (enh && enh === activeEnh)) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    });
  }

  private updateSkillEnhBadge(
    el: HTMLElement | null,
    enhId: string | undefined,
    defs: Record<string, { label: string; color: string }>
  ): void {
    if (!el) return;
    if (enhId && defs[enhId]) {
      el.classList.remove('hidden');
      el.textContent = defs[enhId].label;
      el.style.color = defs[enhId].color;
      el.style.borderColor = defs[enhId].color;
      el.style.boxShadow = `0 0 6px ${defs[enhId].color}66`;
    } else {
      el.classList.add('hidden');
      el.textContent = '';
    }
  }

  public resumeGame(): void {
    if (this.simulation) {
      this.simulation.state.isPaused = false;
    }
    this.elPauseModal.classList.add('hidden');
    this.onRequestPointerLock?.();
  }

  public restartFromPause(): void {
    this.elPauseModal.classList.add('hidden');
    if (this.simulation) {
      this.simulation.state.isPaused = false;
    }
    this.onRestartCallback?.();
  }

  public exitToMenuFromPause(): void {
    this.elPauseModal.classList.add('hidden');
    this.elHudContainer.classList.add('hidden');
    this.elMainMenu.classList.remove('hidden');
    if (this.simulation) {
      this.simulation.state.isGameStarted = false;
      this.simulation.state.isPaused = false;
    }
    this.onExitToMenuCallback?.();
  }

  public hideAllGameModalsForDev(): void {
    this.elPauseModal?.classList.add('hidden');
    this.elGameOverModal?.classList.add('hidden');
    this.elStageClearModal?.classList.add('hidden');
    this.elBuffChoiceModal?.classList.add('hidden');
    this.elInventoryModal?.classList.add('hidden');
    this.elCodexModal?.classList.add('hidden');
    this.elHudContainer?.classList.add('hidden');
    this.elMainMenu?.classList.add('hidden');
    document.getElementById('screen-hero-select')?.classList.add('hidden');
  }

  public updateAudioIcon(isMuted: boolean): void {
    const icon = document.getElementById('audio-icon');
    if (icon) {
      icon.textContent = isMuted ? '🔇' : '🔊';
    }
  }

  public updateCameraPanIcon(isInverted: boolean): void {
    const icon = document.getElementById('pan-icon');
    if (icon) {
      icon.textContent = isInverted ? '⟲ Pan: Inv [I]' : '⟲ Pan: Std [I]';
    }
  }

  public setCallbacks(
    onStart: () => void | Promise<void>,
    onRestart: () => void | Promise<void>
  ): void {
    this.onStartRunCallback = onStart;
    this.onRestartCallback = onRestart;
  }

  public updateActiveMapStatus(fileName: string, isCustom: boolean): void {
    this.activeMapName = fileName;
    this.isCustomUploadedMap = isCustom;
  }

  public initGame(sim: Simulation): void {
    this.simulation = sim;
    this.lastRenderedBuffKey = '';
    this.lastBuffsHtml = '';
    this.terrainMapCanvas = null;
    this.elGameOverModal.classList.add('hidden');
    this.elStageClearModal.classList.add('hidden');
    this.elBuffChoiceModal.classList.add('hidden');
    this.elPauseModal.classList.add('hidden');
    this.elInventoryModal?.classList.add('hidden');
    this.elCodexModal?.classList.add('hidden');
    if (this.elBossBarWrap) this.elBossBarWrap.classList.add('hidden');

    this.buildMinimapTerrainCache(sim.state);

    // Apply saved settings
    sim.state.player.autoCastPrimary = this.settings.autoCastPrimary;
    sim.state.player.autoCastSecondary = this.settings.autoCastSecondary;

    if (sim.state.isGameStarted) {
      this.elHudContainer.classList.remove('hidden');
    } else {
      this.elHudContainer.classList.add('hidden');
    }
  }

  public showPickupNotification(message: string): void {
    if (!this.elPickupToast) return;
    this.elPickupToast.textContent = message;
    this.elPickupToast.classList.remove('hidden');

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.elPickupToast.classList.add('hidden');
    }, 2400);
  }

  private renderInitialDOM(): void {
    this.container.innerHTML = `
      <!-- 1. MAIN MENU SCREEN -->
      <div id="screen-main-menu" class="screen-modal">
        <div class="title-banner">
          <h1>ENDO NINE</h1>
          <div class="subtitle">Errant Night Chronicle — Sector 1: Permafrost</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px; width: 300px; align-items: stretch;">
          <button id="btn-enter-selection" class="sci-btn primary-gold">Play</button>
          <button id="btn-main-settings" class="sci-btn">Settings</button>
        </div>
        <button id="btn-main-dev-mode" class="dev-gear-btn" title="Developer Mode" aria-label="Developer Mode">⚙</button>
      </div>

      <!-- 2. SURVIVOR SELECTION SCREEN & PRE-GAME SKILLS/UPGRADES HUB -->
      <div id="screen-hero-select" class="screen-modal hidden">
        <div class="selection-card expanded-hub">
          <!-- Top Row: Hero Switcher & Navigation Tabs -->
          <div class="hero-select-nav-row">
            <!-- Hero Switchers -->
            <div class="hero-switch-group">
              <button id="btn-select-commander" class="sci-btn survivor-btn active" style="padding: 8px 18px; font-weight: 800; border-color: var(--accent-gold); background: rgba(250, 204, 21, 0.2); display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; letter-spacing: 1px;">⚔ COMMANDER</span>
              </button>
              <button id="btn-select-doctor" class="sci-btn survivor-btn" style="padding: 8px 18px; font-weight: 800; border-color: rgba(255, 255, 255, 0.2); display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; letter-spacing: 1px;">⚕ DOCTOR</span>
              </button>
            </div>

            <!-- Pre-Game Inspection Tabs -->
            <div class="hero-tab-group">
              <button class="hero-nav-tab active" data-tab="base">
                <span>⚡ BASE SKILLS</span>
              </button>
              <button class="hero-nav-tab" data-tab="upgrades">
                <span>★ SKILL UPGRADES (12)</span>
              </button>
              <button class="hero-nav-tab" data-tab="passives">
                <span>🧬 PASSIVE BUFFS & ITEMS</span>
              </button>
              <button class="hero-nav-tab" data-tab="dossier">
                <span>📜 DOSSIER & LORE</span>
              </button>
            </div>
          </div>

          <!-- Main 3-Column Content Grid -->
          <div class="selection-main-grid">
            <!-- Col 1: Hero Identity & Stats Summary -->
            <div class="hero-preview-col">
              <div class="hero-portrait-frame">
                <img id="hero-select-portrait" src="/assets/commander/commander_portrait.png?v=2.0" alt="Survivor" />
                <div id="hero-select-badge" class="hero-badge">READY FOR DEPLOYMENT</div>
              </div>
              <div class="hero-stats-panel">
                <div class="hero-name-label" id="hero-select-name">COMMANDER</div>
                <div class="hero-title-label" id="hero-select-title">Errant Night Vanguard</div>
                <div class="hero-stat-bars">
                  <div class="stat-row">
                    <span class="stat-lbl">MAX HEALTH</span>
                    <span class="stat-val" id="hero-stat-hp">120 HP</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-lbl">MOVE SPEED</span>
                    <span class="stat-val" id="hero-stat-spd">230 units/s</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-lbl">DEFENSE MATRIX</span>
                    <span class="stat-val" id="hero-stat-def">Bio-Kinetic</span>
                  </div>
                </div>
                <!-- Inherent Passive Card -->
                <div class="hero-inherent-passive-card" id="hero-inherent-passive-card">
                  <div class="passive-hdr">
                    <span class="passive-tag">INHERENT PASSIVE</span>
                    <span class="passive-title" id="hero-passive-name">Commander's Resolve</span>
                  </div>
                  <div class="passive-body" id="hero-passive-desc">
                    Taking damage deploys a kinetic shield, reducing incoming damage by 35% for 2.5s.
                  </div>
                </div>
              </div>
            </div>

            <!-- Col 2: Interactive List / Directory of Skills, Upgrades, or Passives -->
            <div class="hero-directory-col">
              <div class="directory-header">
                <span id="directory-title" class="directory-title">BASE TACTICAL LOADOUT</span>
                <span id="directory-subtitle" class="directory-subtitle">Select an ability to inspect live visual simulation</span>
              </div>

              <!-- Filter Pills for Passive Buffs tab -->
              <div id="passive-filter-bar" class="passive-filter-bar hidden">
                <button class="filter-pill active" data-filter="all">ALL (38)</button>
                <button class="filter-pill" data-filter="item">DROPPED ITEMS (3)</button>
                <button class="filter-pill" data-filter="offense">OFFENSE</button>
                <button class="filter-pill" data-filter="defense">DEFENSE</button>
                <button class="filter-pill" data-filter="utility">MOBILITY & UTILITY</button>
              </div>

              <!-- Scrollable Item List Container -->
              <div id="directory-items-container" class="directory-items-container">
                <!-- Dynamically populated cards -->
              </div>
            </div>

            <!-- Col 3: Interactive Ability & Upgrade Preview Hub -->
            <div class="hero-preview-hub-col">
              <!-- Holographic Simulation Viewport -->
              <div class="sim-viewport-card">
                <div class="sim-header">
                  <div style="display: flex; align-items: center;">
                    <div class="sim-status-dot"></div>
                    <span class="sim-header-text">LIVE HOLOGRAPHIC SIMULATION</span>
                  </div>
                  <span id="preview-loop-timer" class="sim-timer">0.0s / 3.2s</span>
                </div>
                <div class="canvas-wrapper">
                  <canvas id="skill-preview-canvas" width="440" height="230"></canvas>
                  <div id="passive-notice-overlay" class="passive-notice-overlay hidden">
                    <div class="passive-icon-large">🧬</div>
                    <div class="passive-notice-title">PASSIVE ATTRIBUTE ENHANCEMENT</div>
                    <div class="passive-notice-sub">Continuously amplifies combat statistics. Always active in combat without manual activation.</div>
                  </div>
                </div>
                <!-- Video Controls & Timeline Bar -->
                <div class="sim-timeline-bar">
                  <div id="sim-timeline-progress" class="sim-timeline-fill" style="width: 0%;"></div>
                </div>
                <div class="sim-controls-bar">
                  <div style="display: flex; gap: 8px;">
                    <button id="btn-preview-play" class="sci-btn control-btn" title="Play / Pause Simulation">⏸ PAUSE</button>
                    <button id="btn-preview-replay" class="sci-btn control-btn" title="Replay Ability from Start">↺ REPLAY</button>
                  </div>
                  <div id="preview-slot-badge" class="preview-slot-badge">PRIMARY [LMB]</div>
                </div>

                <!-- Interactive +Projectiles Attribute Modifier Bar -->
                <div class="sim-projectile-modifier-card">
                  <div class="sim-proj-header">
                    <span class="sim-proj-title">✨ +PROJECTILES MODIFIER</span>
                    <span id="sim-proj-status-badge" class="sim-proj-badge">+0 Projectiles (Base)</span>
                  </div>
                  <div class="sim-proj-btn-group">
                    <button class="sim-proj-btn active" data-proj="0">+0</button>
                    <button class="sim-proj-btn" data-proj="1">+1</button>
                    <button class="sim-proj-btn" data-proj="2">+2</button>
                    <button class="sim-proj-btn" data-proj="3">+3</button>
                    <button class="sim-proj-btn" data-proj="4">+4</button>
                    <button class="sim-proj-btn" data-proj="5">+5</button>
                    <button class="sim-proj-btn" data-proj="10">+10</button>
                  </div>
                  <div id="sim-proj-impact-desc" class="sim-proj-impact-desc">Base attack output. Toggle stacks to inspect individual skill scaling.</div>
                </div>
              </div>

              <!-- Detailed Ability Dossier & Evolution Analysis -->
              <div class="ability-dossier-card">
                <div class="dossier-header">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <img id="preview-ability-icon" class="dossier-icon" src="/assets/rally_command.png" alt="Icon" />
                    <div>
                      <div id="preview-ability-name" class="dossier-name">Service Pistol</div>
                      <div id="preview-ability-source" class="dossier-source">Standard Vanguard Issue</div>
                    </div>
                  </div>
                </div>

                <!-- Stat Grid -->
                <div class="dossier-stat-grid">
                  <div class="stat-pill">
                    <span class="stat-pill-label">DAMAGE</span>
                    <span id="preview-stat-damage" class="stat-pill-value">26 kinetic</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-pill-label">COOLDOWN</span>
                    <span id="preview-stat-cooldown" class="stat-pill-value">0.65s</span>
                  </div>
                  <div class="stat-pill">
                    <span class="stat-pill-label">RANGE</span>
                    <span id="preview-stat-range" class="stat-pill-value">460 units</span>
                  </div>
                </div>

                <!-- Evolution / Comparison Callout -->
                <div id="preview-comparison-box" class="dossier-comparison-box">
                  <div class="comparison-hdr">★ EVOLUTION ANALYSIS (CHANGES VS BASE)</div>
                  <div id="preview-comparison-text" class="comparison-text">
                    Standard tactical issue configuration for Vanguard field operatives.
                  </div>
                </div>

                <!-- Full Mechanics Description -->
                <div class="dossier-desc-box">
                  <div class="desc-hdr">TACTICAL MECHANICS & DETAILS</div>
                  <div id="preview-ability-desc" class="desc-text">
                    Fires standard high-velocity military pistol rounds toward valid targets within line of sight.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Action Row -->
          <div class="selection-footer-row">
            <button id="btn-select-back" class="sci-btn" style="padding: 9px 18px; font-size: 13px;">⟵ Back to Main</button>
            <div style="display: flex; gap: 12px; align-items: center;">
              <span style="font-size: 11px; color: var(--text-muted); letter-spacing: 0.5px;">Previewing does not alter active game progression</span>
              <button id="btn-hero-settings" class="sci-btn" style="padding: 9px 16px; font-size: 13px;">⚙ Settings</button>
              <button id="btn-start-run" class="sci-btn primary-gold" style="padding: 9px 24px; font-size: 13.5px; font-weight: 800;">🚀 Initiate Drop</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. OFFICIAL ENDO NINE IN-GAME HUD -->
      <div id="hud-container" class="hidden">
        <!-- Top Left: Borderless Endo Nine Wordmark & Orbital Arc -->
        <div class="hud-logo-wrap" aria-label="Endo Nine">
          <svg class="hud-logo-svg" width="172" height="44" viewBox="0 0 218 54" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M 80 18 A 27 27 0 0 1 131 18" stroke="rgba(192,132,252,0.78)" stroke-width="1.35" stroke-linecap="round"/>
            <path d="M 131 36 A 27 27 0 0 1 80 36" stroke="rgba(167,139,250,0.65)" stroke-width="1.35" stroke-linecap="round"/>
            <path d="M 136 22 L 143 17" stroke="rgba(226,232,240,0.65)" stroke-width="1.15" stroke-linecap="round"/>
            <text x="8" y="33" fill="#f8fafc" font-family="'Segoe UI','Inter',sans-serif" font-size="16" font-weight="500" letter-spacing="5.5">ENDO</text>
            <text x="116" y="33" fill="#f8fafc" font-family="'Segoe UI','Inter',sans-serif" font-size="16" font-weight="500" letter-spacing="5.5">NINE</text>
          </svg>
        </div>

        <!-- Top Center: Stage Metadata + Single Teleporter Progress Bar + Boss Bar -->
        <div class="hud-top-center-cluster">
          <div class="hud-stage-strip">
            <span id="hud-stage-label"><span class="hud-stage-num">Stage 1</span> / <span class="hud-stage-name">The Wreckage</span></span>
            <span class="hud-stage-sep">|</span>
            <span class="hud-stage-metric" title="Elapsed Run Time">
              <svg class="hud-metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 2h6"/><path d="M12 2v3"/>
              </svg>
              <span id="diff-clock-text">00:00</span>
            </span>
            <span class="hud-stage-sep">|</span>
            <span class="hud-stage-metric">
              <span>Kills:</span>
              <span id="hud-kills">0</span>
            </span>
            <span class="hud-stage-sep">|</span>
            <span class="hud-genes-discreet" title="Genes">
              <img src="/assets/currency_shard.png" alt="Genes" />
              <span id="hud-credits">15</span>
            </span>
            <div class="hud-diff-hairline"><div id="diff-bar-fill" class="diff-bar-fill"></div></div>
          </div>

          <!-- Single Teleporter Charging Indicator -->
          <div class="hud-teleporter-row">
            <svg class="hud-tp-emblem" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M12 3.5 L12 12 M12 12 L19.4 16.5 M12 12 L4.6 16.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="12" cy="12" r="2.1" fill="#e9d5ff"/>
            </svg>
            <div class="hud-tp-info">
              <div id="hud-artifact-status" class="hud-artifact-status">Safeguards Offline (0/4)</div>
              <div id="hud-artifact-bar" class="hud-artifact-bar">
                <div id="hud-artifact-fill" class="hud-artifact-fill"></div>
              </div>
            </div>
          </div>

          <!-- Boss Health Bar (Appears cleanly beneath Teleporter Indicator when active) -->
          <div id="hud-boss-bar-wrap" class="hud-boss-bar-wrap hidden">
            <div class="hud-boss-header">
              <span id="hud-boss-title" class="hud-boss-title">STAGE 1 BOSS</span>
              <span id="hud-boss-hp-text" class="hud-boss-hp-text">5400 / 5400</span>
            </div>
            <div class="hud-boss-bar-bg">
              <div id="hud-boss-bar-fill" class="hud-boss-bar-fill"></div>
            </div>
          </div>
        </div>

        <!-- Top Right: Circular Terrain Minimap -->
        <div class="hud-minimap-wrap" title="Terrain & Objective Minimap">
          <div id="hud-minimap-north" class="hud-minimap-north">N</div>
          <canvas id="hud-minimap-canvas" class="hud-minimap-canvas" width="244" height="244"></canvas>
        </div>

        <!-- Right Side: Expandable Permanent Passive Items Inventory -->
        <div id="hud-items-dock" class="hud-items-dock">
          <button id="btn-items-toggle" class="hud-items-toggle-btn interactive" title="Expand / Collapse Passive Items">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div id="items-container" class="hud-items-grid">
            <div class="hud-items-empty" title="No passive items collected yet">0</div>
          </div>
        </div>

        <!-- Left Side: Mission Quest Tracker (Visible once objectives are communicated or interrupted into tracker) -->
        <div id="hud-quest-tracker" class="hud-quest-tracker hidden" aria-live="polite">
          <div class="hud-quest-tracker-hdr">MISSION OBJECTIVES</div>
          <div id="hud-quest-tracker-list" class="hud-quest-tracker-list"></div>
        </div>

        <!-- Bottom Left: Compact Player Panel (Portrait, Name/Lv, Green HP, Conditional Purple Energy Shield) -->
        <div class="hud-player-panel">
          <div class="hud-portrait-wrap">
            <img id="hud-portrait-img" src="/assets/commander/commander_portrait.png?v=2.0" alt="Survivor" />
          </div>
          <div class="hud-player-info">
            <div class="hud-name-row">
              <span id="hud-hero-name" class="hud-hero-name">COMMANDER</span>
              <span id="hud-level-pill" class="hud-level-pill">Lv. 1</span>
            </div>
            <div class="hud-bar-row">
              <div class="hud-hp-bar">
                <div id="hud-hp-fill" class="hud-hp-fill"></div>
              </div>
              <span id="hud-hp-text" class="hud-bar-val">120 / 120</span>
            </div>
            <div id="hud-shield-row" class="hud-bar-row hidden" title="Energy Shield">
              <div class="hud-shield-bar">
                <div id="hud-shield-fill" class="hud-shield-fill"></div>
              </div>
              <span id="hud-shield-text" class="hud-bar-val">0 / 0</span>
            </div>
            <div class="hud-xp-bar" title="Experience Progress">
              <div id="hud-xp-fill" class="hud-xp-fill"></div>
            </div>
          </div>
        </div>

        <!-- Bottom Center: 4-Slot Skill Bar + Jetpack Gauge + Active Buffs/Debuffs -->
        <div class="hud-bottom-center-dock">
          <div class="hud-skills-bar">
            <div class="skill-slot">
              <div id="hud-enh-badge-primary" class="skill-enh-badge hidden"></div>
              <span class="skill-key-top">LMB</span>
              <div class="skill-icon-box">
                <img id="hud-skill-icon-primary" class="skill-icon-img" src="/assets/rally_command.png" alt="Primary" />
                <div id="cd-sweep-primary" class="skill-cd-sweep hidden"></div>
                <div id="cd-pulse" class="cooldown-overlay hidden">0.0</div>
              </div>
              <button id="toggle-auto-primary" class="auto-toggle active interactive">AUTO</button>
            </div>

            <div class="skill-slot">
              <div id="hud-enh-badge-secondary" class="skill-enh-badge hidden"></div>
              <span class="skill-key-top">RMB</span>
              <div class="skill-icon-box">
                <img id="hud-skill-icon-secondary" class="skill-icon-img" src="/assets/defensive_protocol.png" alt="Secondary" />
                <div id="cd-sweep-secondary" class="skill-cd-sweep hidden"></div>
                <div id="cd-wave" class="cooldown-overlay hidden">0.0</div>
              </div>
              <button id="toggle-auto-secondary" class="auto-toggle active interactive">AUTO</button>
            </div>

            <div class="skill-slot">
              <div id="hud-enh-badge-utility" class="skill-enh-badge hidden"></div>
              <span class="skill-key-top">SHIFT</span>
              <div class="skill-icon-box">
                <img id="hud-skill-icon-utility" class="skill-icon-img" src="/assets/combat_dash.png" alt="Dash" />
                <div id="cd-sweep-utility" class="skill-cd-sweep hidden"></div>
                <div id="cd-dash" class="cooldown-overlay hidden">0.0</div>
              </div>
              <div class="skill-sub-spacer"></div>
            </div>

            <div class="skill-slot skill-slot-ult">
              <div id="hud-enh-badge-ultimate" class="skill-enh-badge hidden"></div>
              <span class="skill-key-top">R</span>
              <div class="skill-icon-box">
                <img id="hud-skill-icon-ultimate" class="skill-icon-img" src="/assets/tactical_strike.png" alt="Ultimate" />
                <div id="cd-sweep-ultimate" class="skill-cd-sweep hidden"></div>
                <div id="cd-ult" class="cooldown-overlay hidden">0.0</div>
              </div>
              <div class="skill-sub-spacer"></div>
            </div>

            <!-- Jetpack Fuel Gauge integrated seamlessly inside Skill UI -->
            <div class="hud-jetpack-slot" title="Jetpack Fuel [SPACE]">
              <span class="skill-key-top">JET</span>
              <div class="hud-jetpack-box">
                <div id="hud-jetpack-fill" class="jetpack-fuel-meter" style="height: 100%;"></div>
              </div>
              <span id="hud-jetpack-status" class="skill-sub-spacer">RDY</span>
            </div>
          </div>

          <!-- Active Temporary Buffs & Debuffs (only visible while duration > 0) -->
          <div id="hud-buffs-row" class="hud-buffs-row"></div>
        </div>

        <!-- Bottom Right: Utility Controls (Inventory | Codex | Settings) -->
        <div class="hud-utility-bar">
          <button id="btn-hud-inventory" class="hud-util-btn interactive" title="Inventory & Stats">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 7V6a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1"/>
              <rect x="4" y="7" width="16" height="14" rx="3"/>
              <path d="M4 12h16"/><path d="M10 12v2h4v-2"/>
            </svg>
          </button>
          <div class="hud-util-sep"></div>
          <button id="btn-hud-codex" class="hud-util-btn interactive" title="Field Codex">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H12v17H4.5A2.5 2.5 0 0 0 2 22Z"/>
              <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H12v17h7.5A2.5 2.5 0 0 1 22 22Z"/>
            </svg>
          </button>
          <div class="hud-util-sep"></div>
          <button id="btn-hud-settings" class="hud-util-btn interactive" title="Settings [O]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>

        <!-- In-World Interaction Prompt Pill -->
        <div id="hud-interact-prompt" class="hud-interact-prompt hidden">
          <span id="interact-key" class="interact-key">[E]</span>
          <span id="interact-label">Open Bio-Sac</span>
        </div>

        <!-- World Event Status Banner -->
        <div id="hud-event-banner" class="hud-event-banner hidden">
          <div id="event-banner-title" class="event-banner-title">EVENT ACTIVE</div>
          <div class="event-progress-wrap">
            <div id="event-progress-bar" class="event-progress-bar"></div>
          </div>
          <div id="event-banner-desc" class="event-banner-desc">Stand within zone to synchronize</div>
        </div>

        <!-- Full-screen Threat Level Surge Banner -->
        <div id="hud-diff-banner" class="hud-diff-banner hidden">
          <div class="diff-banner-header">⚠ THREAT LEVEL ADVANCED ⚠</div>
          <div id="diff-banner-tier" class="diff-banner-tier">[HARD]</div>
          <div id="diff-banner-desc" class="diff-banner-desc">Alien Hive Aggression Elevated — Enemy HP &amp; Speed Surging!</div>
        </div>

        <!-- Pointer Lock Engagement Prompt -->
        <div id="hud-click-to-lock" class="hud-click-to-lock">CLICK TO LOCK AIM</div>

        <!-- Pickup Toast Notification -->
        <div id="hud-pickup-toast" class="hud-pickup-toast hidden"></div>

        <!-- Crosshair Reticle -->
        <div id="hud-crosshair" class="hud-crosshair">
          <div class="crosshair-dot"></div>
          <div class="crosshair-ring"></div>
        </div>
      </div>

      <!-- DIEGETIC RADIO COMMS OVERLAY (Non-blocking, works in gameplay & dev tester) -->
      <div id="hud-comms-panel" class="hud-comms-panel hidden" aria-live="polite">
        <div class="hud-comms-portrait-wrap">
          <img id="hud-comms-portrait" src="/assets/commander/commander_portrait.png" alt="Speaker" />
        </div>
        <div class="hud-comms-content">
          <div class="hud-comms-header">
            <span id="hud-comms-speaker" class="hud-comms-speaker">COMMANDER</span>
            <span id="hud-comms-role" class="hud-comms-role">COMMS</span>
            <span id="hud-comms-mode" class="hud-comms-mode">TEXT</span>
            <span id="hud-comms-turn" class="hud-comms-turn">1/1</span>
          </div>
          <div id="hud-comms-text" class="hud-comms-text"></div>
        </div>
      </div>

      <!-- IN-GAME INVENTORY & STATS MODAL -->
      <div id="modal-hud-inventory" class="screen-modal hidden">
        <div class="hud-modal-card">
          <div class="hud-modal-header">
            <span class="hud-modal-title">SURVIVOR INVENTORY &amp; TELEMETRY</span>
            <button id="btn-close-inventory" class="hud-modal-close interactive">Close [ESC]</button>
          </div>
          <div id="hud-inventory-body" class="hud-modal-body"></div>
        </div>
      </div>

      <!-- IN-GAME FIELD CODEX MODAL -->
      <div id="modal-hud-codex" class="screen-modal hidden">
        <div class="hud-modal-card">
          <div class="hud-modal-header">
            <span class="hud-modal-title">ENDO NINE FIELD CODEX</span>
            <button id="btn-close-codex" class="hud-modal-close interactive">Close [ESC]</button>
          </div>
          <div class="hud-codex-tabs">
            <button id="codex-tab-skills" class="hud-codex-tab active interactive">Abilities &amp; Augments</button>
            <button id="codex-tab-items" class="hud-codex-tab interactive">Items &amp; Upgrades</button>
            <button id="codex-tab-comms" class="hud-codex-tab interactive">Comms Log</button>
          </div>
          <div id="hud-codex-body" class="hud-modal-body"></div>
        </div>
      </div>

      <!-- 4. TACTICAL FIELD CONFIGURATION MODAL (PRE-GAME & IN-GAME) -->
      <div id="screen-settings" class="screen-modal hidden">
        <div class="settings-modal-card">
          <div class="settings-header">
            <h2>TACTICAL FIELD CONFIGURATION</h2>
            <div class="settings-subtitle">Controls, Camera Steering, Weapon Systems &amp; Audio</div>
          </div>

          <div class="settings-body">
            <!-- Group 1: Camera & Mouse Look -->
            <div class="settings-section">
              <div class="settings-section-title">CAMERA &amp; MOUSE LOOK</div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Camera Pan Direction (Horizontal)</div>
                  <div class="setting-desc">Moving mouse right rotates camera view right (PokéBonk style). [HotKey: I]</div>
                </div>
                <button id="setting-btn-pan" class="setting-toggle-btn active">STANDARD</button>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Camera Pitch Invert (Vertical)</div>
                  <div class="setting-desc">Invert vertical tilt direction when moving mouse up/down.</div>
                </div>
                <button id="setting-btn-pitch" class="setting-toggle-btn">STANDARD</button>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Mouse Look Sensitivity</div>
                  <div class="setting-desc">Adjust camera rotational speed and responsiveness.</div>
                </div>
                <div class="setting-slider-wrap">
                  <input type="range" id="setting-range-sens" min="0.2" max="3.0" step="0.1" value="1.0" class="setting-range" />
                  <span id="setting-val-sens" class="setting-badge">1.0x</span>
                </div>
              </div>
            </div>

            <!-- Group 2: Combat Systems -->
            <div class="settings-section">
              <div class="settings-section-title">COMBAT &amp; WEAPON SYSTEMS</div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Primary Weapon Auto-Target [LMB]</div>
                  <div class="setting-desc">Automatically target closest threat within firing range.</div>
                </div>
                <button id="setting-btn-primary" class="setting-toggle-btn active">AUTO-TARGET</button>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Secondary Skill Auto-Cast [RMB]</div>
                  <div class="setting-desc">Automatically unleash Defensive Protocol wave when threats approach.</div>
                </div>
                <button id="setting-btn-secondary" class="setting-toggle-btn active">AUTO-CAST</button>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Ultimate Skill Cast [R]</div>
                  <div class="setting-desc">Celestial blast strikes from above directly onto the Commander's ground location.</div>
                </div>
                <span class="setting-badge-gold">MANUAL ONLY [R]</span>
              </div>
            </div>

            <!-- Group 3: Audio & SFX -->
            <div class="settings-section">
              <div class="settings-section-title">AUDIO &amp; SOUND EFFECTS</div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Master Audio Synthesis</div>
                  <div class="setting-desc">Enable tactical synthesizers, laser impacts, and audio cues. [HotKey: M]</div>
                </div>
                <button id="setting-btn-audio" class="setting-toggle-btn active">AUDIO ON</button>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Master Volume</div>
                  <div class="setting-desc">Adjust overall sound effect gain.</div>
                </div>
                <div class="setting-slider-wrap">
                  <input type="range" id="setting-range-vol" min="0" max="100" step="5" value="80" class="setting-range" />
                  <span id="setting-val-vol" class="setting-badge">80%</span>
                </div>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Voice Dialogue Volume</div>
                  <div class="setting-desc">Adjust radio &amp; field character speech volume independently of SFX.</div>
                </div>
                <div class="setting-slider-wrap">
                  <input type="range" id="setting-range-voice" min="0" max="100" step="5" value="95" class="setting-range" />
                  <span id="setting-val-voice" class="setting-badge">95%</span>
                </div>
              </div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Radio Comms Subtitles</div>
                  <div class="setting-desc">Show synchronized speaker subtitles during diegetic radio dialogue.</div>
                </div>
                <button id="setting-btn-subtitles" class="setting-toggle-btn active">SUBTITLES ON</button>
              </div>
            </div>

            <!-- Group 4: Graphics & Performance -->
            <div class="settings-section">
              <div class="settings-section-title">GRAPHICS &amp; PERFORMANCE</div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Graphics Quality Preset</div>
                  <div id="setting-desc-quality" class="setting-desc">Medium: balanced 60 FPS target (1.25x cap, half-res bloom, up to 8 dynamic lights).</div>
                </div>
                <div class="setting-quality-group">
                  <button id="setting-btn-quality-low" class="setting-toggle-btn setting-quality-btn">LOW</button>
                  <button id="setting-btn-quality-medium" class="setting-toggle-btn setting-quality-btn active">MEDIUM</button>
                  <button id="setting-btn-quality-high" class="setting-toggle-btn setting-quality-btn">HIGH</button>
                </div>
              </div>
            </div>

            <!-- Group 5: Character Visuals & Model -->
            <div class="settings-section">
              <div class="settings-section-title">COMMANDER CHARACTER RENDERING</div>

              <div class="setting-item">
                <div class="setting-label-block">
                  <div class="setting-title">Character Rendering Mode</div>
                  <div class="setting-desc">Original Illustrated 2.5D Directional Sprites vs Experimental Procedural 3D Model.</div>
                </div>
                <button id="setting-btn-3d" class="setting-toggle-btn">2.5D ILLUSTRATED (ACTIVE)</button>
              </div>
            </div>
          </div>

          <div class="settings-footer">
            <button id="setting-btn-reset" class="sci-btn" style="padding: 10px 20px; font-size: 13px;">Reset Defaults</button>
            <button id="setting-btn-confirm" class="sci-btn primary-gold" style="padding: 10px 28px; font-size: 13px;">Confirm &amp; Close</button>
          </div>
        </div>
      </div>

      <!-- 5. 3-CHOICE BUFF SELECTION MODAL (PAUSES SINGLE-PLAYER) -->
      <div id="screen-buff-choice" class="screen-modal hidden">
        <div class="buff-choice-container">
          <div class="buff-header-banner">
            <div class="pause-pill">SIMULATION PAUSED — TACTICAL RANK UP</div>
            <h2>SELECT COMMANDER AUGMENTATION</h2>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
              Choose 1 of 3 tactical buffs (Click card or press <strong>1</strong>, <strong>2</strong>, or <strong>3</strong>)
            </div>
          </div>
          <div id="buff-cards-grid" class="buff-cards-grid"></div>
        </div>
      </div>

      <!-- 5. STAGE CLEAR SCREEN -->
      <div id="screen-stage-clear" class="screen-modal hidden">
        <div class="title-banner">
          <h1 style="color: var(--accent-gold);">STAGE 1 COMPLETE</h1>
          <div class="subtitle">Overseer Resonance Secured</div>
        </div>
        <div id="clear-stats" style="margin-bottom: 24px; font-size: 15px; text-align: center; line-height: 1.8;"></div>
        <button id="btn-restart-victory" class="sci-btn primary-gold">Deploy Next Expedition</button>
      </div>

      <!-- 6. GAME OVER SCREEN -->
      <div id="screen-game-over" class="screen-modal hidden">
        <div class="title-banner">
          <h1 style="color: var(--danger-red);">COMMANDER FALLEN</h1>
          <div class="subtitle">Bio-Kinetic Link Terminated</div>
        </div>
        <div id="game-over-stats" style="margin-bottom: 24px; font-size: 15px; text-align: center; line-height: 1.8;"></div>
        <button id="btn-restart-defeat" class="sci-btn">Re-engage Simulation</button>
      </div>

      <!-- 7. TACTICAL ESCAPE PAUSE MENU MODAL -->
      <div id="screen-pause-menu" class="screen-modal hidden">
        <div class="pause-card">
          <div class="pause-header">
            <h2>MISSION PAUSED</h2>
            <div class="pause-subtitle">Sector 1: Permafrost — Crash Site Perimeter</div>
          </div>
          <div class="pause-stats-grid">
            <div class="pause-stat-item">
              <span class="pause-stat-label">ELAPSED TIME</span>
              <span id="pause-stat-time" class="pause-stat-val">00:00</span>
            </div>
            <div class="pause-stat-item">
              <span class="pause-stat-label">THREAT LEVEL</span>
              <span id="pause-stat-threat" class="pause-stat-val">VERY EASY (1.0x)</span>
            </div>
            <div class="pause-stat-item">
              <span class="pause-stat-label">GENES HARVESTED</span>
              <span id="pause-stat-genes" class="pause-stat-val">15</span>
            </div>
            <div class="pause-stat-item">
              <span class="pause-stat-label">HOSTILES ELIMINATED</span>
              <span id="pause-stat-kills" class="pause-stat-val">0</span>
            </div>
          </div>
          <div class="pause-enhancements-panel">
            <div class="pause-enh-title">COMMANDER SKILL ENHANCEMENTS <span class="pause-enh-sub">[Hotkeys: F1 LMB, F2 RMB, F3 Dash, F4 Ult]</span></div>
            <div class="pause-enh-row">
              <span class="pause-enh-slot-tag">LMB [F1]:</span>
              <button class="pause-enh-btn active" data-slot="primary" data-enh="base">Base</button>
              <button class="pause-enh-btn" data-slot="primary" data-enh="chill_beam">Chill Beam</button>
              <button class="pause-enh-btn" data-slot="primary" data-enh="piercing_laser">Piercing Laser</button>
              <button class="pause-enh-btn" data-slot="primary" data-enh="extended_slash">Extended Slash</button>
            </div>
            <div class="pause-enh-row">
              <span class="pause-enh-slot-tag">RMB [F2]:</span>
              <button class="pause-enh-btn active" data-slot="secondary" data-enh="base">Base</button>
              <button class="pause-enh-btn" data-slot="secondary" data-enh="scissor_slash">Scissor Slash</button>
              <button class="pause-enh-btn" data-slot="secondary" data-enh="frost_burst">Frost Burst</button>
              <button class="pause-enh-btn" data-slot="secondary" data-enh="orbiting_blade">Orbiting Swords</button>
            </div>
            <div class="pause-enh-row">
              <span class="pause-enh-slot-tag">DASH [F3]:</span>
              <button class="pause-enh-btn active" data-slot="utility" data-enh="base">Base</button>
              <button class="pause-enh-btn" data-slot="utility" data-enh="shock_dash">Shock Dash</button>
              <button class="pause-enh-btn" data-slot="utility" data-enh="extended_dash">Extended Dash</button>
              <button class="pause-enh-btn" data-slot="utility" data-enh="teleport">Teleport</button>
            </div>
            <div class="pause-enh-row">
              <span class="pause-enh-slot-tag">ULT [F4]:</span>
              <button class="pause-enh-btn active" data-slot="ultimate" data-enh="base">Base</button>
              <button class="pause-enh-btn" data-slot="ultimate" data-enh="singularity">Singularity</button>
              <button class="pause-enh-btn" data-slot="ultimate" data-enh="convergence_barrage">Five-Strike</button>
              <button class="pause-enh-btn" data-slot="ultimate" data-enh="cryogenic_impact">Cryo Impact</button>
            </div>
          </div>
          <div class="pause-buttons-col">
            <button id="btn-pause-resume" class="sci-btn primary-gold">Resume Mission [ESC]</button>
            <button id="btn-pause-unstuck" class="sci-btn">⌖ Unstuck (Nearest Ground)</button>
            <button id="btn-pause-settings" class="sci-btn">⚙ Tactical Settings</button>
            <button id="btn-pause-dev-dialogue" class="sci-btn" style="border-color: rgba(167, 139, 250, 0.45); color: #ddd6fe;">🎙 Dev Dialogue Tester [F9]</button>
            <button id="btn-pause-restart" class="sci-btn">⟳ Restart Run</button>
            <button id="btn-pause-exit" class="sci-btn danger-btn">Abort Mission to Menu</button>
          </div>
        </div>
      </div>

      <!-- 8. DEVELOPMENT DIALOGUE TESTING INTERFACE [F9] -->
      <div id="dev-dialogue-tester" class="dev-dialogue-tester hidden">
        <div class="dev-dlg-header">
          <span>🎙 DEV DIALOGUE TESTER [F9]</span>
          <button id="btn-dev-dlg-close" class="dev-dlg-close interactive" title="Close [F9]">✕</button>
        </div>
        <div id="dev-dlg-status" class="dev-dlg-status">Initializing narrative director...</div>
        <div class="dev-dlg-row">
          <label for="dev-dlg-select">Scene:</label>
          <select id="dev-dlg-select" class="dev-dlg-input interactive"></select>
        </div>
        <div class="dev-dlg-row">
          <label for="dev-dlg-hero">Variant:</label>
          <select id="dev-dlg-hero" class="dev-dlg-input interactive">
            <option value="active">Use Active Hero</option>
            <option value="commander">Force Commander Variant</option>
            <option value="doctor">Force Doctor Variant</option>
          </select>
        </div>
        <div class="dev-dlg-actions">
          <button id="btn-dev-dlg-play" class="sci-btn primary-gold interactive">▶ Play Scene</button>
          <button id="btn-dev-dlg-stop" class="sci-btn interactive">⏹ Stop</button>
          <button id="btn-dev-dlg-boss" class="sci-btn interactive" title="Emit boss_emerged trigger to test Scene 10 interruption">⚠ Sim Boss Signal</button>
          <button id="btn-dev-dlg-reload" class="sci-btn interactive">↻ Reload JSON + Audio</button>
          <button id="btn-dev-dlg-reset-save" class="sci-btn danger-btn interactive">🗑 Reset Save Flags</button>
        </div>
        <div class="dev-dlg-note">Works on Stage 1 and Custom Test Maps. Automatic map triggers stay off on custom test maps.</div>
      </div>
    `;
  }

  private cacheElements(): void {
    this.elMainMenu = document.getElementById('screen-main-menu')!;
    this.elHeroSelect = document.getElementById('screen-hero-select')!;
    this.elHudContainer = document.getElementById('hud-container')!;
    this.elBuffChoiceModal = document.getElementById('screen-buff-choice')!;
    this.elBuffCardsGrid = document.getElementById('buff-cards-grid')!;
    this.elGameOverModal = document.getElementById('screen-game-over')!;
    this.elStageClearModal = document.getElementById('screen-stage-clear')!;

    this.elLevelPill = document.getElementById('hud-level-pill')!;
    this.elPortraitImg = document.getElementById('hud-portrait-img') as HTMLImageElement;
    this.elHeroName = document.getElementById('hud-hero-name')!;
    this.elHpFill = document.getElementById('hud-hp-fill')!;
    this.elHpText = document.getElementById('hud-hp-text')!;
    this.elShieldRow = document.getElementById('hud-shield-row')!;
    this.elShieldFill = document.getElementById('hud-shield-fill')!;
    this.elShieldText = document.getElementById('hud-shield-text')!;
    this.elXpFill = document.getElementById('hud-xp-fill')!;
    this.elStageLabel = document.getElementById('hud-stage-label')!;
    this.elCurrencyText = document.getElementById('hud-credits')!;
    this.elKillsText = document.getElementById('hud-kills')!;
    this.elArtifactBar = document.getElementById('hud-artifact-bar')!;
    this.elArtifactFill = document.getElementById('hud-artifact-fill')!;
    this.elArtifactStatus = document.getElementById('hud-artifact-status')!;
    this.elPickupToast = document.getElementById('hud-pickup-toast')!;
    this.elBuffsRow = document.getElementById('hud-buffs-row')!;
    this.elQuestTracker = document.getElementById('hud-quest-tracker')!;
    this.elQuestTrackerList = document.getElementById('hud-quest-tracker-list')!;

    this.elMinimapCanvas = document.getElementById('hud-minimap-canvas') as HTMLCanvasElement;
    this.elMinimapNorth = document.getElementById('hud-minimap-north');
    this.elItemsDock = document.getElementById('hud-items-dock')!;
    this.btnItemsToggle = document.getElementById('btn-items-toggle')!;
    this.elInventoryModal = document.getElementById('modal-hud-inventory')!;
    this.elInventoryBody = document.getElementById('hud-inventory-body')!;
    this.elCodexModal = document.getElementById('modal-hud-codex')!;
    this.elCodexBody = document.getElementById('hud-codex-body')!;

    this.elPulseCd = document.getElementById('cd-pulse')!;
    this.elWaveCd = document.getElementById('cd-wave')!;
    this.elDashCd = document.getElementById('cd-dash')!;
    this.elUltCd = document.getElementById('cd-ult')!;
    this.elSweepPrimary = document.getElementById('cd-sweep-primary')!;
    this.elSweepSecondary = document.getElementById('cd-sweep-secondary')!;
    this.elSweepUtility = document.getElementById('cd-sweep-utility')!;
    this.elSweepUltimate = document.getElementById('cd-sweep-ultimate')!;
    this.elPrimaryIcon = document.getElementById('hud-skill-icon-primary') as HTMLImageElement;
    this.elSecondaryIcon = document.getElementById('hud-skill-icon-secondary') as HTMLImageElement;
    this.elUtilityIcon = document.getElementById('hud-skill-icon-utility') as HTMLImageElement;
    this.elUltimateIcon = document.getElementById('hud-skill-icon-ultimate') as HTMLImageElement;
    this.elEnhBadgePrimary = document.getElementById('hud-enh-badge-primary')!;
    this.elEnhBadgeSecondary = document.getElementById('hud-enh-badge-secondary')!;
    this.elEnhBadgeUtility = document.getElementById('hud-enh-badge-utility')!;
    this.elEnhBadgeUltimate = document.getElementById('hud-enh-badge-ultimate')!;
    this.elJetpackFill = document.getElementById('hud-jetpack-fill')!;
    this.elJetpackStatus = document.getElementById('hud-jetpack-status')!;

    this.btnAutoPrimary = document.getElementById('toggle-auto-primary')!;
    this.btnAutoSecondary = document.getElementById('toggle-auto-secondary')!;
    this.elItemsTray = document.getElementById('items-container')!;

    // Settings Modal Elements
    this.elSettingsModal = document.getElementById('screen-settings')!;
    this.btnSettingPan = document.getElementById('setting-btn-pan')!;
    this.btnSettingPitch = document.getElementById('setting-btn-pitch')!;
    this.rangeSettingSens = document.getElementById('setting-range-sens') as HTMLInputElement;
    this.valSettingSens = document.getElementById('setting-val-sens')!;
    this.btnSettingPrimary = document.getElementById('setting-btn-primary')!;
    this.btnSettingSecondary = document.getElementById('setting-btn-secondary')!;
    this.btnSettingAudio = document.getElementById('setting-btn-audio')!;
    this.rangeSettingVol = document.getElementById('setting-range-vol') as HTMLInputElement;
    this.valSettingVol = document.getElementById('setting-val-vol')!;
    this.rangeSettingVoice = document.getElementById('setting-range-voice') as HTMLInputElement;
    this.valSettingVoice = document.getElementById('setting-val-voice')!;
    this.btnSettingSubtitles = document.getElementById('setting-btn-subtitles')!;
    this.btnSettingReset = document.getElementById('setting-btn-reset')!;
    this.btnSettingConfirm = document.getElementById('setting-btn-confirm')!;
    this.btnSetting3D = document.getElementById('setting-btn-3d')!;
    this.btnQualityLow = document.getElementById('setting-btn-quality-low')!;
    this.btnQualityMed = document.getElementById('setting-btn-quality-medium')!;
    this.btnQualityHigh = document.getElementById('setting-btn-quality-high')!;
    this.descQualityPreset = document.getElementById('setting-desc-quality')!;

    this.elCommsPanel = document.getElementById('hud-comms-panel')!;
    this.elCommsPortrait = document.getElementById('hud-comms-portrait') as HTMLImageElement;
    this.elCommsSpeaker = document.getElementById('hud-comms-speaker')!;
    this.elCommsRole = document.getElementById('hud-comms-role')!;
    this.elCommsTurn = document.getElementById('hud-comms-turn')!;
    this.elCommsMode = document.getElementById('hud-comms-mode')!;
    this.elCommsText = document.getElementById('hud-comms-text')!;

    this.elDevTesterPanel = document.getElementById('dev-dialogue-tester')!;
    this.elDevTesterSelect = document.getElementById('dev-dlg-select') as HTMLSelectElement;
    this.elDevTesterHero = document.getElementById('dev-dlg-hero') as HTMLSelectElement;
    this.elDevTesterStatus = document.getElementById('dev-dlg-status')!;

    // Pause Modal Elements
    this.elPauseModal = document.getElementById('screen-pause-menu')!;
    this.btnPauseResume = document.getElementById('btn-pause-resume')!;
    this.btnPauseUnstuck = document.getElementById('btn-pause-unstuck')!;
    this.btnPauseSettings = document.getElementById('btn-pause-settings')!;
    this.btnPauseRestart = document.getElementById('btn-pause-restart')!;
    this.btnPauseExit = document.getElementById('btn-pause-exit')!;
    this.pauseStatTime = document.getElementById('pause-stat-time')!;
    this.pauseStatThreat = document.getElementById('pause-stat-threat')!;
    this.pauseStatGenes = document.getElementById('pause-stat-genes')!;
    this.pauseStatKills = document.getElementById('pause-stat-kills')!;

    this.elClearStats = document.getElementById('clear-stats')!;
    this.elGameOverStats = document.getElementById('game-over-stats')!;

    // Risk of Rain 2 Difficulty Elements (Clock + Hairline Meter)
    this.elDiffClockText = document.getElementById('diff-clock-text')!;
    this.elDiffBarFill = document.getElementById('diff-bar-fill')!;
    this.elDiffBanner = document.getElementById('hud-diff-banner')!;
    this.elDiffBannerTier = document.getElementById('diff-banner-tier')!;
    this.elDiffBannerDesc = document.getElementById('diff-banner-desc')!;

    // Boss Health Bar Elements
    this.elBossBarWrap = document.getElementById('hud-boss-bar-wrap')!;
    this.elBossTitle = document.getElementById('hud-boss-title')!;
    this.elBossHpText = document.getElementById('hud-boss-hp-text')!;
    this.elBossBarFill = document.getElementById('hud-boss-bar-fill')!;

    // Interaction Prompt & World Event Elements
    this.elInteractPrompt = document.getElementById('hud-interact-prompt')!;
    this.elInteractKey = document.getElementById('interact-key')!;
    this.elInteractLabel = document.getElementById('interact-label')!;

    this.elEventBanner = document.getElementById('hud-event-banner')!;
    this.eventBannerTitle = document.getElementById('event-banner-title')!;
    this.eventProgressBar = document.getElementById('event-progress-bar')!;
    this.eventBannerDesc = document.getElementById('event-banner-desc')!;
  }

  public showDifficultyAlert(name: string, color: string, description: string): void {
    if (!this.elDiffBanner) return;
    this.elDiffBannerTier.textContent = `[${name}]`;
    this.elDiffBannerTier.style.color = color;
    this.elDiffBannerTier.style.textShadow = `0 0 16px ${color}`;
    this.elDiffBannerDesc.textContent = description;
    this.elDiffBanner.style.borderColor = color;
    this.elDiffBanner.style.boxShadow = `0 0 35px ${color}`;
    this.elDiffBanner.classList.remove('hidden');

    if (this.diffBannerTimer) clearTimeout(this.diffBannerTimer);
    this.diffBannerTimer = window.setTimeout(() => {
      this.elDiffBanner.classList.add('hidden');
    }, 4200);
  }

  private attachEventListeners(): void {
    document.getElementById('btn-enter-selection')?.addEventListener('click', () => {
      this.elMainMenu.classList.add('hidden');
      this.elHeroSelect.classList.remove('hidden');
      this.initPreviewHub();
    });

    document.getElementById('btn-select-back')?.addEventListener('click', () => {
      this.elHeroSelect.classList.add('hidden');
      this.elMainMenu.classList.remove('hidden');
      if (this.previewScene) {
        this.previewScene.destroy();
        this.previewScene = null;
      }
    });

    document.getElementById('btn-select-commander')?.addEventListener('click', () => {
      this.selectHero('commander');
    });

    document.getElementById('btn-select-doctor')?.addEventListener('click', () => {
      this.selectHero('doctor');
    });

    // Open Settings Modal Buttons (Main Menu, Hero Select, HUD)
    document.getElementById('btn-main-settings')?.addEventListener('click', () => {
      this.openSettings('screen-main-menu');
    });

    document.getElementById('btn-main-dev-mode')?.addEventListener('click', () => {
      void this.onOpenDeveloperModeCallback?.();
    });

    document.getElementById('btn-hero-settings')?.addEventListener('click', () => {
      this.openSettings('screen-hero-select');
    });

    document.getElementById('btn-hud-settings')?.addEventListener('click', () => {
      this.openSettings('hud-container');
    });

    const syncHudScale = () => {
      const ratio = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      const clamped = Math.max(0.95, Math.min(2.0, (ratio || 1) * 1.6875));
      this.elHudContainer.style.setProperty('--hud-scale', clamped.toFixed(3));
    };
    syncHudScale();
    window.addEventListener('resize', syncHudScale);

    this.btnItemsToggle?.addEventListener('click', () => {
      this.elItemsDock.classList.toggle('expanded');
    });

    document.getElementById('btn-hud-inventory')?.addEventListener('click', () => {
      this.openHudModal('inventory');
    });

    document.getElementById('btn-hud-codex')?.addEventListener('click', () => {
      this.openHudModal('codex');
    });

    document.getElementById('btn-close-inventory')?.addEventListener('click', () => {
      this.closeHudModals(true);
    });

    document.getElementById('btn-close-codex')?.addEventListener('click', () => {
      this.closeHudModals(true);
    });

    document.getElementById('codex-tab-skills')?.addEventListener('click', () => {
      this.currentCodexTab = 'skills';
      this.renderCodexModal();
    });

    document.getElementById('codex-tab-items')?.addEventListener('click', () => {
      this.currentCodexTab = 'items';
      this.renderCodexModal();
    });

    document.getElementById('codex-tab-comms')?.addEventListener('click', () => {
      this.currentCodexTab = 'comms';
      this.renderCodexModal();
    });

    // Settings Modal Interactive Controls
    this.btnSettingPan.addEventListener('click', () => {
      this.settings.invertCameraPan = !this.settings.invertCameraPan;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(this.settings.invertCameraPan ? 'Camera Pan: Inverted [I]' : 'Camera Pan: Standard [I]');
    });

    this.btnSettingPitch.addEventListener('click', () => {
      this.settings.invertCameraPitch = !this.settings.invertCameraPitch;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.rangeSettingSens.addEventListener('input', () => {
      this.settings.mouseSensitivity = parseFloat(this.rangeSettingSens.value);
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.btnSettingPrimary.addEventListener('click', () => {
      this.settings.autoCastPrimary = !this.settings.autoCastPrimary;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.btnSettingSecondary.addEventListener('click', () => {
      this.settings.autoCastSecondary = !this.settings.autoCastSecondary;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.btnSettingAudio.addEventListener('click', () => {
      this.settings.isMuted = !this.settings.isMuted;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(this.settings.isMuted ? 'Sound Muted [M]' : 'Sound Enabled [M]');
    });

    this.rangeSettingVol.addEventListener('input', () => {
      this.settings.masterVolume = parseInt(this.rangeSettingVol.value, 10) / 100;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.rangeSettingVoice?.addEventListener('input', () => {
      this.settings.voiceVolume = parseInt(this.rangeSettingVoice.value, 10) / 100;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.btnSettingSubtitles?.addEventListener('click', () => {
      this.settings.subtitlesEnabled = !this.settings.subtitlesEnabled;
      this.syncSettingsUI();
      this.saveSettings();
    });

    const setQuality = (q: GraphicsQuality) => {
      this.settings.graphicsQuality = q;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(`Graphics Quality: ${q.toUpperCase()}`);
    };
    this.btnQualityLow?.addEventListener('click', () => setQuality('low'));
    this.btnQualityMed?.addEventListener('click', () => setQuality('medium'));
    this.btnQualityHigh?.addEventListener('click', () => setQuality('high'));

    this.btnSetting3D.addEventListener('click', () => {
      this.settings.use3DCommander = !this.settings.use3DCommander;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(this.settings.use3DCommander ? 'Character Mode: 3D Experimental (Rollback)' : 'Character Mode: 2.5D Illustrated (Active)');
    });

    this.btnSettingReset.addEventListener('click', () => {
      this.settings = {
        invertCameraPan: false,
        invertCameraPitch: false,
        mouseSensitivity: 1.0,
        autoCastPrimary: true,
        autoCastSecondary: true,
        masterVolume: 0.8,
        voiceVolume: 0.95,
        subtitlesEnabled: true,
        isMuted: false,
        use3DCommander: false,
        graphicsQuality: 'medium'
      };
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification('Tactical Settings Reset to Defaults');
    });

    this.btnSettingConfirm.addEventListener('click', () => {
      this.closeSettings();
    });

    document.getElementById('btn-camera-pan')?.addEventListener('click', () => {
      this.settings.invertCameraPan = !this.settings.invertCameraPan;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(this.settings.invertCameraPan ? 'Camera Pan: Inverted [I]' : 'Camera Pan: Standard [I]');
    });

    document.getElementById('btn-audio-toggle')?.addEventListener('click', () => {
      this.settings.isMuted = !this.settings.isMuted;
      this.syncSettingsUI();
      this.saveSettings();
      this.showPickupNotification(this.settings.isMuted ? 'Sound Muted [M]' : 'Sound Enabled [M]');
    });

    document.getElementById('btn-start-run')?.addEventListener('click', async () => {
      const startBtn = document.getElementById('btn-start-run') as HTMLButtonElement | null;
      const prevLabel = startBtn?.textContent || '🚀 Initiate Drop';
      let loadingHintTimer: number | null = null;
      if (startBtn) {
        startBtn.disabled = true;
        loadingHintTimer = window.setTimeout(() => {
          startBtn.textContent = '⏳ Loading Stage 1...';
        }, 80);
      }
      try {
        if (this.onStartRunCallback) {
          await this.onStartRunCallback();
        }
        this.elHeroSelect.classList.add('hidden');
        this.elMainMenu.classList.add('hidden');
        this.elHudContainer.classList.remove('hidden');
        if (this.previewScene) {
          this.previewScene.destroy();
          this.previewScene = null;
        }
      } catch (err: any) {
        this.showPickupNotification(err?.message || 'Failed to start Stage 1');
      } finally {
        if (loadingHintTimer !== null) window.clearTimeout(loadingHintTimer);
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = prevLabel;
        }
      }
    });

    this.btnAutoPrimary.addEventListener('click', () => {
      this.settings.autoCastPrimary = !this.settings.autoCastPrimary;
      this.syncSettingsUI();
      this.saveSettings();
    });

    this.btnAutoSecondary.addEventListener('click', () => {
      this.settings.autoCastSecondary = !this.settings.autoCastSecondary;
      this.syncSettingsUI();
      this.saveSettings();
    });

    document.getElementById('btn-restart-victory')?.addEventListener('click', () => {
      if (this.onRestartCallback) this.onRestartCallback();
    });

    document.getElementById('btn-restart-defeat')?.addEventListener('click', () => {
      if (this.onRestartCallback) this.onRestartCallback();
    });

    // Pause Modal Action Buttons
    this.btnPauseResume.addEventListener('click', () => {
      this.resumeGame();
    });

    this.btnPauseUnstuck.addEventListener('click', () => {
      this.simulation?.unstuckPlayer();
      this.resumeGame();
      this.showPickupNotification('Reset to nearest walkable terrain');
    });

    this.btnPauseSettings.addEventListener('click', () => {
      this.openSettings('screen-pause-menu');
    });

    this.btnPauseRestart.addEventListener('click', () => {
      this.restartFromPause();
    });

    this.btnPauseExit.addEventListener('click', () => {
      this.exitToMenuFromPause();
    });

    document.getElementById('btn-pause-dev-dialogue')?.addEventListener('click', () => {
      this.toggleDevDialogueTester(true);
    });

    document.getElementById('btn-dev-dlg-close')?.addEventListener('click', () => {
      this.toggleDevDialogueTester(false);
    });

    document.getElementById('btn-dev-dlg-play')?.addEventListener('click', async () => {
      if (!this.dialogueController) return;
      const convId = this.elDevTesterSelect?.value;
      if (!convId) return;
      // Ensure HUD is visible when testing from menu/pause if user wants to see subtitles immediately,
      // and resume active game if pause menu is open so active playback can run live.
      if (this.simulation?.state.isGameStarted && this.simulation.state.isPaused) {
        this.resumeGame();
      }
      const heroVal = this.elDevTesterHero?.value;
      const heroOverride = heroVal === 'commander' || heroVal === 'doctor' ? heroVal : undefined;
      await this.dialogueController.forcePlayConversation(convId, heroOverride);
      this.refreshDevDialogueTester();
    });

    document.getElementById('btn-dev-dlg-stop')?.addEventListener('click', () => {
      this.dialogueController?.forceStop();
      this.refreshDevDialogueTester();
    });

    document.getElementById('btn-dev-dlg-boss')?.addEventListener('click', () => {
      if (!this.dialogueController) return;
      if (this.simulation?.state.isGameStarted && this.simulation.state.isPaused) {
        this.resumeGame();
      }
      this.dialogueController.triggerDevSignal('boss_emerged');
      this.refreshDevDialogueTester();
    });

    document.getElementById('btn-dev-dlg-reload')?.addEventListener('click', async () => {
      if (!this.dialogueController) return;
      const res = await this.dialogueController.reloadManifest(true);
      this.populateDevDialogueSelect();
      this.refreshDevDialogueTester();
      this.showPickupNotification(`Dialogue Reloaded: ${res.count} scenes (${res.voicedCount} voiced)`);
    });

    document.getElementById('btn-dev-dlg-reset-save')?.addEventListener('click', () => {
      this.dialogueController?.resetSavePersistence();
      this.refreshDevDialogueTester();
      this.showPickupNotification('Narrative Save Persistence Cleared');
    });

    // Pause menu tactical enhancement selectors
    const pauseEnhBtns = this.container.querySelectorAll('.pause-enh-btn');
    pauseEnhBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const slot = target.getAttribute('data-slot') as SkillSlot | null;
        const enh = target.getAttribute('data-enh') as SkillEnhancementId | 'base' | null;
        if (this.simulation && slot) {
          if (enh === 'base' || !enh) {
            this.simulation.setSkillEnhancement(slot, null);
            this.showPickupNotification(`${slot.toUpperCase()}: Restored to Base Skill`);
          } else {
            this.simulation.setSkillEnhancement(slot, enh);
            const skillName = this.simulation.state.player.equippedSkills[slot]?.name || enh;
            this.showPickupNotification(`${slot.toUpperCase()} Enhanced: ${skillName}`);
          }
          this.syncPauseEnhancementsUI();
          this.update(this.simulation.state);
        }
      });
    });

    // Keyboard hotkeys: O toggles settings, Esc pauses or closes modals, 1-3 selects buff, F1-F4 cycle skill enhancements
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        if (this.simulation) {
          const res = this.simulation.cycleSkillEnhancement('primary');
          this.showPickupNotification(`[F1] LMB: ${res.name.toUpperCase()}`);
          this.syncPauseEnhancementsUI();
          this.update(this.simulation.state);
        }
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        if (this.simulation) {
          const res = this.simulation.cycleSkillEnhancement('secondary');
          this.showPickupNotification(`[F2] RMB: ${res.name.toUpperCase()}`);
          this.syncPauseEnhancementsUI();
          this.update(this.simulation.state);
        }
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (this.simulation) {
          const res = this.simulation.cycleSkillEnhancement('utility');
          this.showPickupNotification(`[F3] DASH: ${res.name.toUpperCase()}`);
          this.syncPauseEnhancementsUI();
          this.update(this.simulation.state);
        }
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (this.simulation) {
          const res = this.simulation.cycleSkillEnhancement('ultimate');
          this.showPickupNotification(`[F4] ULTIMATE: ${res.name.toUpperCase()}`);
          this.syncPauseEnhancementsUI();
          this.update(this.simulation.state);
        }
        return;
      }

      if (e.key === 'F9') {
        e.preventDefault();
        this.toggleDevDialogueTester();
        return;
      }

      if (e.key === 'o' || e.key === 'O') {
        if (!this.elSettingsModal.classList.contains('hidden')) {
          this.closeSettings();
        } else {
          const curScreen = !this.elMainMenu.classList.contains('hidden')
            ? 'screen-main-menu'
            : !this.elHeroSelect.classList.contains('hidden')
              ? 'screen-hero-select'
              : !this.elPauseModal.classList.contains('hidden')
                ? 'screen-pause-menu'
                : 'hud-container';
          this.openSettings(curScreen);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (this.elDevTesterPanel && !this.elDevTesterPanel.classList.contains('hidden')) {
          this.toggleDevDialogueTester(false);
          return;
        }
        if (!this.elSettingsModal.classList.contains('hidden')) {
          this.closeSettings();
          return;
        }
        if (
          (this.elInventoryModal && !this.elInventoryModal.classList.contains('hidden')) ||
          (this.elCodexModal && !this.elCodexModal.classList.contains('hidden'))
        ) {
          this.closeHudModals(true);
          return;
        }

        // Active gameplay pause toggle
        if (
          this.simulation &&
          this.simulation.state.isGameStarted &&
          !this.simulation.state.isGameOver &&
          !this.simulation.state.isStageCleared &&
          !this.simulation.state.isPausedForBuffChoice
        ) {
          if (!this.elPauseModal.classList.contains('hidden')) {
            this.resumeGame();
          } else {
            this.pauseGame();
          }
          return;
        }
      }

      if (!this.simulation || !this.simulation.state.isPausedForBuffChoice) return;
      const choices = this.simulation.state.currentBuffChoices;
      if (e.key === '1' && choices[0]) {
        this.simulation.selectBuffChoice(choices[0]);
        this.onRequestPointerLock?.();
      } else if (e.key === '2' && choices[1]) {
        this.simulation.selectBuffChoice(choices[1]);
        this.onRequestPointerLock?.();
      } else if (e.key === '3' && choices[2]) {
        this.simulation.selectBuffChoice(choices[2]);
        this.onRequestPointerLock?.();
      }
    });
  }

  public selectHero(heroId: HeroId): void {
    this.selectedHeroId = heroId;
    if (this.onHeroSelectedCallback) {
      this.onHeroSelectedCallback(heroId);
    }
    this.updateHeroSelectUI();
  }

  public updateHeroSelectUI(): void {
    const isDoc = this.selectedHeroId === 'doctor';
    const btnCmd = document.getElementById('btn-select-commander');
    const btnDoc = document.getElementById('btn-select-doctor');
    if (btnCmd && btnDoc) {
      if (isDoc) {
        btnDoc.classList.add('active');
        btnDoc.style.borderColor = '#10b981';
        btnDoc.style.background = 'rgba(16, 185, 129, 0.2)';
        btnCmd.classList.remove('active');
        btnCmd.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        btnCmd.style.background = '';
      } else {
        btnCmd.classList.add('active');
        btnCmd.style.borderColor = 'var(--accent-gold)';
        btnCmd.style.background = 'rgba(250, 204, 21, 0.2)';
        btnDoc.classList.remove('active');
        btnDoc.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        btnDoc.style.background = '';
      }
    }

    const img = document.getElementById('hero-select-portrait') as HTMLImageElement;
    const nameEl = document.getElementById('hero-select-name');
    const titleEl = document.getElementById('hero-select-title');
    const badgeEl = document.getElementById('hero-select-badge');
    const hpEl = document.getElementById('hero-stat-hp');
    const spdEl = document.getElementById('hero-stat-spd');
    const defEl = document.getElementById('hero-stat-def');
    const passNameEl = document.getElementById('hero-passive-name');
    const passDescEl = document.getElementById('hero-passive-desc');

    if (isDoc) {
      if (img) img.src = '/assets/doctor/doctor_portrait.png';
      if (nameEl) nameEl.textContent = 'DOCTOR';
      if (titleEl) titleEl.textContent = 'Chief Medical Officer';
      if (badgeEl) {
        badgeEl.textContent = 'BIO-SYNTHESIS READY';
        badgeEl.style.color = '#10b981';
      }
      if (hpEl) hpEl.textContent = '140 HP';
      if (spdEl) spdEl.textContent = '225 units/s';
      if (defEl) defEl.textContent = 'Cellular Triage';
      if (passNameEl) passNameEl.textContent = 'Bio-Cellular Triage';
      if (passDescEl) {
        passDescEl.textContent = 'Passively regenerates 3 HP/s (boosted to 7 HP/s when below 50% HP). Healing efficiency is enhanced.';
      }
    } else {
      if (img) img.src = '/assets/commander/commander_portrait.png?v=2.0';
      if (nameEl) nameEl.textContent = 'COMMANDER';
      if (titleEl) titleEl.textContent = 'Errant Night Vanguard';
      if (badgeEl) {
        badgeEl.textContent = 'READY FOR DEPLOYMENT';
        badgeEl.style.color = 'var(--accent-gold)';
      }
      if (hpEl) hpEl.textContent = '120 HP';
      if (spdEl) spdEl.textContent = '230 units/s';
      if (defEl) defEl.textContent = 'Bio-Kinetic Matrix';
      if (passNameEl) passNameEl.textContent = "Commander's Resolve";
      if (passDescEl) {
        passDescEl.textContent = 'Taking damage deploys a kinetic shield, reducing incoming damage by 35% for 2.5s.';
      }
    }

    if (this.previewScene) {
      this.previewScene.setHero(this.selectedHeroId);
    }
    this.renderDirectoryTab(this.currentPreviewTab);
  }

  public initPreviewHub(): void {
    const canvas = document.getElementById('skill-preview-canvas') as HTMLCanvasElement | null;
    if (canvas && !this.previewScene) {
      this.previewScene = new SkillPreviewScene(canvas);
      (window as any).__previewScene = this.previewScene;
      let lastTimerTextUpdate = 0;
      this.previewScene.setTimeCallback((progress, cur, dur) => {
        const fill = document.getElementById('sim-timeline-progress');
        if (fill) fill.style.transform = `scaleX(${progress})`;
        const now = performance.now();
        if (now - lastTimerTextUpdate > 100) {
          lastTimerTextUpdate = now;
          const timer = document.getElementById('preview-loop-timer');
          if (timer) timer.textContent = `${cur.toFixed(1)}s / ${dur.toFixed(1)}s`;
        }
      });
    }

    // Attach Play / Pause and Replay buttons
    const btnPlay = document.getElementById('btn-preview-play');
    if (btnPlay) {
      btnPlay.onclick = () => {
        if (!this.previewScene) return;
        const isPlaying = this.previewScene.togglePlay();
        btnPlay.textContent = isPlaying ? '⏸ PAUSE' : '▶ PLAY';
      };
    }

    const btnReplay = document.getElementById('btn-preview-replay');
    if (btnReplay) {
      btnReplay.onclick = () => {
        if (!this.previewScene) return;
        this.previewScene.replay();
      };
    }

    // Attach Hero Nav Tab buttons
    const tabBtns = document.querySelectorAll('.hero-nav-tab');
    tabBtns.forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = (btn as HTMLElement).dataset.tab as 'base' | 'upgrades' | 'passives' | 'dossier';
        this.currentPreviewTab = tab || 'base';
        this.renderDirectoryTab(this.currentPreviewTab);
      };
    });

    // Attach Passive Filter Pills
    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(pill => {
      (pill as HTMLElement).onclick = () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentPassiveFilter = (pill as HTMLElement).dataset.filter || 'all';
        this.renderDirectoryTab('passives');
      };
    });

    // Attach +Projectiles Interactive Modifier Selector
    const projBtns = document.querySelectorAll('.sim-proj-btn');
    projBtns.forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        projBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const count = parseInt((btn as HTMLElement).dataset.proj || '0', 10);
        this.selectedExtraProjectiles = count;
        if (this.previewScene) {
          this.previewScene.setExtraProjectiles(count);
        }
        this.updateProjectileModifierDescription(count);
      };
    });

    this.updateHeroSelectUI();
  }

  private updateProjectileModifierDescription(count: number): void {
    const badge = document.getElementById('sim-proj-status-badge');
    const desc = document.getElementById('sim-proj-impact-desc');
    if (!badge || !desc) return;

    badge.textContent = `+${count} Projectiles${count === 0 ? ' (Base)' : ''}`;

    const abilityId = this.currentSelectedAbility ? this.currentSelectedAbility.id : 'energy_pulse';

    if (count === 0) {
      desc.textContent = 'Base attack output. Select +1, +2, +3, +4, +5, or +10 stacks to inspect skill-specific scaling.';
      return;
    }

    switch (abilityId) {
      case 'energy_pulse':
        desc.textContent = `+${count} Projectiles: Fires ${1 + count} golden pistol shots simultaneously with spread (no laser visual).`;
        break;

      case 'explosive_bomb': // Cross Slash
        if (count === 1) {
          desc.textContent = `+1 Projectile: Base Cross Slash (Upper crossing blade layer unlocks at +2).`;
        } else if (count >= 2 && count < 4) {
          desc.textContent = `+${count} Projectiles: Adds an upper crossing scissor blade layer (+14 Y elevation) crossing in front.`;
        } else if (count === 4) {
          desc.textContent = `+4 Projectiles: Adds both upper (+14 Y) and lower (-14 Y) blade layers (3 total crossing blade pairs).`;
        } else {
          desc.textContent = `+${count} Projectiles: 3 crossing blade layers + Pierces ${1 + (count - 4)} extra targets through the collision path!`;
        }
        break;

      case 'chill_beam':
        desc.textContent = `+${count} Projectiles: Fires ${1 + count} consecutive icy-blue bolts with distinct spacing, frost trails, and Chill.`;
        break;

      case 'piercing_laser': {
        const branches = Math.min(5, count);
        desc.textContent = `+${count} Projectiles: 1 primary concentrated laser + ${branches} distinct secondary lightning branches seeking different nearby enemies along the beam with clear line-of-sight.`;
        break;
      }

      case 'extended_slash':
        desc.textContent = `+${count} Projectiles: Unleashes ${1 + count} forward extended sword slashes in rapid combo sequence.`;
        break;

      case 'scissor_slash':
        desc.textContent = `+${count} Projectiles: Executes ${1 + count} visible inward scissor blade sweeps before the final central explosion.`;
        break;

      case 'frost_burst':
        desc.textContent = `+${count} Projectiles: 360° radial frost nova followed by ${count} delayed ice-spike eruptions erupting from the ground.`;
        break;

      case 'orbiting_blade': {
        const totalSwords = Math.min(7, 1 + count);
        desc.textContent = `+${count} Projectiles: ${totalSwords} persistent electric swords in continuous 360° orbit around Commander (capped strictly at 7). Each sword independently damages the nearest enemy in its path.`;
        break;
      }

      // --- DOCTOR +PROJECTILES SCALING ---
      case 'medical_pulse':
        desc.textContent = `+${count} Projectiles: Fires ${1 + count} rapid-alternating green laser pistol bolts per shot with tactical spread.`;
        break;

      case 'toxic_chain':
        desc.textContent = `+${count} Projectiles: Fires ${1 + count} toxic ricochet bolts; each hit applies 1 poison stack (3 stacks trigger toxic explosion).`;
        break;

      case 'cryogenic_scalpel':
        desc.textContent = `+${count} Projectiles: Launches ${1 + count} independent rotating cryogenic scalpels that cut outward, return to Doctor, and leave 3s freezing trails.`;
        break;

      case 'vital_extraction': {
        const tetherCount = 3 + count;
        desc.textContent = `+${count} Projectiles: Sustains ${tetherCount} simultaneous medical HP-draining tethers (Base 3 + ${count}), prioritizing distinct enemies.`;
        break;
      }

      case 'toxic_contamination':
        desc.textContent = `+${count} Projectiles: Throws ${1 + count} bio-chemical toxic grenades creating organic slowing venom splatters across terrain.`;
        break;

      case 'experimental_drones': {
        const droneCount = Math.min(7, 1 + count);
        desc.textContent = `+${count} Projectiles: Deploys ${droneCount} autonomous medical-combat drones (capped strictly at 7) orbiting Doctor and firing green bio-bolts.`;
        break;
      }

      case 'toxic_cluster_bomb': {
        const mainBombs = Math.min(5, 1 + count);
        desc.textContent = `+${count} Projectiles: Launches ${mainBombs} cluster warheads (capped at 5), each bursting into scattered toxic sub-bombs and venom splatters.`;
        break;
      }

      case 'holographic_decoy':
        desc.textContent = `+${count} Projectiles: Projects a holographic Doctor decoy drawing nearby enemy aggro and exploding upon destruction or expiry.`;
        break;

      default:
        desc.textContent = `+${count} Projectiles: Modifies hero projectile attribute stack (+${count}).`;
        break;
    }
  }

  private renderDirectoryTab(tab: 'base' | 'upgrades' | 'passives' | 'dossier'): void {
    const container = document.getElementById('directory-items-container');
    const titleEl = document.getElementById('directory-title');
    const subEl = document.getElementById('directory-subtitle');
    const filterBar = document.getElementById('passive-filter-bar');

    if (!container || !titleEl || !subEl || !filterBar) return;
    container.innerHTML = '';

    if (tab === 'base') {
      titleEl.textContent = 'BASE TACTICAL LOADOUT';
      subEl.textContent = 'Core combat abilities active upon deployment';
      filterBar.classList.add('hidden');

      const skills = getHeroBaseSkills(this.selectedHeroId).filter(s => s.slot !== 'passive');
      skills.forEach((skill, idx) => {
        const card = this.createAbilityCard(skill);
        container.appendChild(card);
        if (idx === 0 && (!this.currentSelectedAbility || this.currentSelectedAbility.category !== 'base')) {
          this.selectAbilityPreview(skill);
        }
      });
    } else if (tab === 'upgrades') {
      titleEl.textContent = 'ALL 12 APPROVED SKILL EVOLUTIONS';
      subEl.textContent = 'Exclusive upgrades discovered across Sector 1 World Events';
      filterBar.classList.add('hidden');

      const groups = getHeroSkillUpgrades(this.selectedHeroId);
      let firstUpgrade: AbilityPreviewData | null = null;

      groups.forEach(g => {
        const header = document.createElement('div');
        header.className = 'category-header-banner';
        header.textContent = `${g.slotLabel} — Base: ${g.baseSkillName}`;
        container.appendChild(header);

        g.upgrades.forEach(upg => {
          if (!firstUpgrade) firstUpgrade = upg;
          const card = this.createAbilityCard(upg);
          container.appendChild(card);
        });
      });

      if (firstUpgrade && (!this.currentSelectedAbility || this.currentSelectedAbility.category !== 'upgrade')) {
        this.selectAbilityPreview(firstUpgrade);
      }
    } else if (tab === 'passives') {
      titleEl.textContent = 'PASSIVE BUFFS & ITEMS CATALOG';
      subEl.textContent = 'Permanent field drops and rank augments with full stacking mechanics';
      filterBar.classList.remove('hidden');

      const catalog = getAllPassiveBuffsCatalog();
      let allItems: AbilityPreviewData[] = [];

      if (this.currentPassiveFilter === 'all') {
        allItems = [...catalog.physicalItems, ...catalog.passiveBuffs];
      } else if (this.currentPassiveFilter === 'item') {
        allItems = catalog.physicalItems;
      } else if (this.currentPassiveFilter === 'offense') {
        allItems = catalog.passiveBuffs.filter(b =>
          b.name.includes('Amp') || b.name.includes('Damage') || b.name.includes('Crit') ||
          b.name.includes('Penetrator') || b.name.includes('Splitter') || b.name.includes('Sparks') ||
          b.name.includes('Spark') || b.name.includes('Overdrive') || b.name.includes('Plasma') ||
          b.name.includes('Ignition') || b.name.includes('Breaker') || b.name.includes('Ricochet')
        );
      } else if (this.currentPassiveFilter === 'defense') {
        allItems = catalog.passiveBuffs.filter(b =>
          b.name.includes('Vital') || b.name.includes('Shield') || b.name.includes('Spikes') ||
          b.name.includes('Exoskeleton') || b.name.includes('Armor') || b.name.includes('Nanite') ||
          b.name.includes('Siphon') || b.name.includes('Plating')
        );
      } else if (this.currentPassiveFilter === 'utility') {
        allItems = catalog.passiveBuffs.filter(b =>
          b.name.includes('Thruster') || b.name.includes('Speed') || b.name.includes('Array') ||
          b.name.includes('Harvester') || b.name.includes('Supercharger') || b.name.includes('Attunement') ||
          b.name.includes('Harmonizer') || b.name.includes('Drone')
        );
      }

      allItems.forEach((buff, idx) => {
        const card = this.createAbilityCard(buff);
        container.appendChild(card);
        if (idx === 0 && (!this.currentSelectedAbility || (this.currentSelectedAbility.category !== 'passive_buff' && this.currentSelectedAbility.category !== 'item'))) {
          this.selectAbilityPreview(buff);
        }
      });
    } else if (tab === 'dossier') {
      titleEl.textContent = 'EXPEDITIONARY DOSSIER & LORE';
      subEl.textContent = 'Errant Night / Endo Nine Sector 1 Mission Archives';
      filterBar.classList.add('hidden');

      const isDoc = this.selectedHeroId === 'doctor';
      const dossierDiv = document.createElement('div');
      dossierDiv.style.cssText = 'font-size: 11.5px; color: #cbd5e1; line-height: 1.5; padding: 10px; display: flex; flex-direction: column; gap: 10px;';
      dossierDiv.innerHTML = isDoc ? `
        <div style="font-weight: 800; color: var(--accent-gold); letter-spacing: 1px;">PERSONNEL RECORD: DOCTOR</div>
        <p>Chief Medical Officer aboard the Errant Night. Expert in xenobiological containment, nano-cellular surgery, and bio-kinetic neural stimulation. Dispatched to Sector 1 alongside Commander to assess the physiological effects of planetary thawing.</p>
        <div style="font-weight: 800; color: var(--accent-blue); letter-spacing: 0.8px;">TACTICAL ROLE</div>
        <p>High-agility combat medic. Employs twin rapid-firing laser pistols, bio-chemical contamination fields, and high-velocity phase rushes to sustain allies and neutralize hostile alien bio-strains.</p>
      ` : `
        <div style="font-weight: 800; color: var(--accent-gold); letter-spacing: 1px;">PERSONNEL RECORD: COMMANDER</div>
        <p>Supreme Vanguard Commander of the Errant Night expeditionary mission. Commissioned to explore the thawing permafrost of Sector 1 following the colony spacecraft crash near the primary Overseer resonance artifact.</p>
        <div style="font-weight: 800; color: var(--accent-blue); letter-spacing: 0.8px;">CANONICAL CONTEXT (STAGE 1 CRATER)</div>
        <p>Every deployment initiates at the crash furrow crater. The thawing ecosystem awakens dormant biological organisms. The Commander's arsenal can be evolved by attuning to the 4 ancient totems scattered across the basin.</p>
      `;
      container.appendChild(dossierDiv);
    }

    if (this.currentSelectedAbility) {
      this.highlightActiveCard(this.currentSelectedAbility.id);
    }
  }

  private createAbilityCard(data: AbilityPreviewData): HTMLElement {
    const card = document.createElement('div');
    card.className = `ability-card ${this.currentSelectedAbility?.id === data.id ? 'active' : ''}`;
    card.dataset.abilityId = data.id;

    card.innerHTML = `
      <img class="ability-card-icon" src="${data.icon}" alt="${data.name}" />
      <div class="ability-card-info">
        <div class="ability-card-slot">${data.slotLabel}</div>
        <div class="ability-card-name">${data.name}</div>
        <div class="ability-card-desc">${data.description}</div>
      </div>
    `;

    card.onclick = () => {
      this.selectAbilityPreview(data);
    };

    return card;
  }

  private selectAbilityPreview(data: AbilityPreviewData): void {
    this.currentSelectedAbility = data;
    this.highlightActiveCard(data.id);

    const nameEl = document.getElementById('preview-ability-name');
    const sourceEl = document.getElementById('preview-ability-source');
    const iconEl = document.getElementById('preview-ability-icon') as HTMLImageElement;
    const slotBadge = document.getElementById('preview-slot-badge');
    const dmgEl = document.getElementById('preview-stat-damage');
    const cdEl = document.getElementById('preview-stat-cooldown');
    const rngEl = document.getElementById('preview-stat-range');
    const compBox = document.getElementById('preview-comparison-box');
    const compText = document.getElementById('preview-comparison-text');
    const descEl = document.getElementById('preview-ability-desc');
    const noticeOverlay = document.getElementById('passive-notice-overlay');

    if (nameEl) nameEl.textContent = data.name;
    if (sourceEl) sourceEl.textContent = data.eventSource || (data.category === 'item' ? 'Field Drop' : 'Vanguard Loadout');
    if (iconEl) iconEl.src = data.icon;
    if (slotBadge) slotBadge.textContent = data.slotLabel;

    if (dmgEl) dmgEl.textContent = data.damage ? String(data.damage) : 'N/A';
    if (cdEl) cdEl.textContent = data.cooldown ? String(data.cooldown) : 'Passive';
    if (rngEl) rngEl.textContent = data.range ? String(data.range) : (data.stackingBehavior ? 'Stackable' : 'Self');

    if (compBox && compText) {
      if (data.baseComparison) {
        compBox.classList.remove('hidden');
        compText.textContent = data.baseComparison;
      } else {
        compBox.classList.add('hidden');
      }
    }

    if (descEl) {
      let fullDesc = data.description;
      if (data.stackingBehavior) {
        fullDesc += `\n\n[STACKING BEHAVIOR]: ${data.stackingBehavior}`;
      }
      descEl.textContent = fullDesc;
    }

    if (noticeOverlay) {
      if (!data.hasVisualPreview) {
        noticeOverlay.classList.remove('hidden');
      } else {
        noticeOverlay.classList.add('hidden');
      }
    }

    this.currentSelectedAbility = data;
    this.updateProjectileModifierDescription(this.selectedExtraProjectiles);

    if (this.previewScene) {
      this.previewScene.setAbility(this.selectedHeroId, data.id);
      this.previewScene.setExtraProjectiles(this.selectedExtraProjectiles);
    }
  }

  private highlightActiveCard(id: string): void {
    const cards = document.querySelectorAll('.ability-card');
    cards.forEach(c => {
      if ((c as HTMLElement).dataset.abilityId === id) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
  }

  public update(state: GameState): void {
    // If run has not been initiated yet, lock clock at 00:00
    if (!state.isGameStarted) {
      if (this.elDiffClockText) this.elDiffClockText.textContent = '00:00';
      if (this.elDiffBarFill) this.elDiffBarFill.style.width = '0%';
      return;
    }

    if (!state.isStageCleared && !state.isGameOver && this.elSettingsModal.classList.contains('hidden')) {
      this.elHudContainer.classList.remove('hidden');
    }

    const p = state.player;

    // 1. Level, Portrait, Health, Energy Shield & XP Hairline
    this.elLevelPill.textContent = `Lv. ${p.level}`;
    const hpPct = Math.max(0, Math.min(100, (p.health / Math.max(1, p.maxHealth)) * 100));
    this.elHpFill.style.width = `${hpPct}%`;
    this.elHpText.textContent = `${Math.ceil(p.health)} / ${p.maxHealth}`;

    // Conditional Purple Energy Shield Bar (shown strictly when maxEnergyShield > 0)
    if (this.elShieldRow) {
      if (p.maxEnergyShield > 0) {
        this.elShieldRow.classList.remove('hidden');
        const shPct = Math.max(0, Math.min(100, (p.energyShield / p.maxEnergyShield) * 100));
        this.elShieldFill.style.width = `${shPct}%`;
        this.elShieldText.textContent = `${Math.ceil(p.energyShield)} / ${p.maxEnergyShield}`;
      } else {
        this.elShieldRow.classList.add('hidden');
      }
    }

    const xpPct = Math.max(0, Math.min(100, (p.xp / Math.max(1, p.xpNeeded)) * 100));
    this.elXpFill.style.width = `${xpPct}%`;

    if (p.heroId === 'doctor') {
      if (this.elPortraitImg && !this.elPortraitImg.src.endsWith('doctor_portrait.png')) {
        this.elPortraitImg.src = '/assets/doctor/doctor_portrait.png';
      }
      if (this.elHeroName) this.elHeroName.textContent = 'DOCTOR';
    } else {
      if (this.elPortraitImg && !this.elPortraitImg.src.includes('commander_portrait.png')) {
        this.elPortraitImg.src = '/assets/commander/commander_portrait.png?v=2.0';
      }
      if (this.elHeroName) this.elHeroName.textContent = 'COMMANDER';
    }

    // 2. Stage Strip Metadata (Stage, Clock, Kills, Discreet Genes)
    const stNum = state.stageNumber || 1;
    if (this.elStageLabel) {
      const stName = state.stageName || 'The Wreckage';
      const nextHtml = `<span class="hud-stage-num">Stage ${stNum}</span> / <span class="hud-stage-name">${stName}</span>`;
      if (this.elStageLabel.innerHTML !== nextHtml) {
        this.elStageLabel.innerHTML = nextHtml;
      }
    }
    this.elCurrencyText.textContent = `${p.currency}`;
    this.elKillsText.textContent = `${p.killCount}`;

    // 3. Stage Artifact Status (Stage 1: 4-module concealment policy, no charge bar; Future stages: optional charging bar)
    const art = state.artifact;
    const artPolicy = getStageArtifactPolicy(stNum);
    if (!artPolicy.usesCharging) {
      if (this.elArtifactBar) this.elArtifactBar.style.display = 'none';
      const recovered = state.completedEnhancementCategories.size;
      const required = artPolicy.requiredEnhancementCategories.length || 4;
      const phase = art.phase || (recovered >= required ? 'unlocked_ready' : 'locked_missing_modules');
      if (phase === 'locked_missing_modules') {
        this.elArtifactStatus.textContent = `Safeguards Offline (${recovered}/${required})`;
        this.elArtifactStatus.classList.remove('ready');
      } else if (phase === 'unlocked_ready' && art.isTeleporterReady && !art.isBossSpawned) {
        this.elArtifactStatus.textContent = 'Tower Unlocked — Press [E]';
        this.elArtifactStatus.classList.add('ready');
      } else if (phase === 'boss_summoning' || art.isSummoning) {
        this.elArtifactStatus.textContent = 'Seismic Anomaly — Stage 1 Boss Emerging';
        this.elArtifactStatus.classList.remove('ready');
      } else if (phase === 'boss_active' || !art.isBossDefeated) {
        this.elArtifactStatus.textContent = 'Defeat Stage 1 Boss to Restore Tower';
        this.elArtifactStatus.classList.remove('ready');
      } else if (phase === 'restoring') {
        this.elArtifactStatus.textContent = 'Restoring Tower Stasis...';
        this.elArtifactStatus.classList.remove('ready');
      } else if (phase === 'teleport_preparing') {
        if (this.elArtifactBar) this.elArtifactBar.style.display = 'none';
        this.elArtifactStatus.textContent = 'AWAITING TELEPORT SYNCHRONIZATION...';
        this.elArtifactStatus.classList.remove('ready');
      } else {
        this.elArtifactStatus.textContent = 'Portal Ready — Press [E]';
        this.elArtifactStatus.classList.add('ready');
      }
    } else {
      if (this.elArtifactBar) this.elArtifactBar.style.display = '';
      const tpPct = Math.max(0, Math.min(100, Math.floor(art.chargeProgress)));
      this.elArtifactFill.style.width = `${Math.max(0, Math.min(100, art.chargeProgress))}%`;
      if (art.isCharged) {
        if (art.isTeleporterReady && !art.isBossSpawned) {
          this.elArtifactStatus.textContent = 'Teleporter Ready — Press [E]';
          this.elArtifactStatus.classList.add('ready');
        } else if (art.isSummoning) {
          this.elArtifactStatus.textContent = 'Teleporter Awakening — Guardian Emerging';
          this.elArtifactStatus.classList.remove('ready');
        } else if (!art.isBossDefeated) {
          this.elArtifactStatus.textContent = 'Defeat Guardian to Activate Teleporter';
          this.elArtifactStatus.classList.remove('ready');
        } else {
          this.elArtifactStatus.textContent = 'Teleporter Unlocked — Press [E]';
          this.elArtifactStatus.classList.add('ready');
        }
      } else {
        this.elArtifactStatus.textContent = `Teleporter Charging: ${tpPct}%`;
        this.elArtifactStatus.classList.remove('ready');
      }
    }

    // 3b. Active Boss Health Bar
    const activeBoss = state.enemies.find(e => (e.isBoss || e.type === 'boss') && e.health > 0 && !e.isSpawning && e.titanState !== 'emerging');
    if (activeBoss && this.elBossBarWrap) {
      this.elBossBarWrap.classList.remove('hidden');
      const bossHpPct = Math.max(0, Math.min(100, (activeBoss.health / activeBoss.maxHealth) * 100));
      this.elBossBarFill.style.width = `${bossHpPct}%`;
      this.elBossHpText.textContent = `${Math.ceil(activeBoss.health)} / ${activeBoss.maxHealth}`;
      this.elBossTitle.textContent = activeBoss.isStage1Titan ? 'STAGE 1 BOSS' : 'BROOD QUEEN';
    } else if (this.elBossBarWrap) {
      this.elBossBarWrap.classList.add('hidden');
    }

    // 4. Cooldowns (Desaturated Icon + Countdown + Radial Sweep) & Skill Icons
    const stats = p.calculatedStats;
    const maxPrimCd = (p.equippedSkills.primary?.cooldown || 0.5) / Math.max(0.25, stats.attackSpeedMultiplier || 1);
    const maxSecCd = (p.equippedSkills.secondary?.cooldown || 3.0) / Math.max(0.25, stats.attackSpeedMultiplier || 1);
    const maxDashCd = (p.equippedSkills.utility?.cooldown || 3.5) * (stats.dashCooldownMultiplier || 1);
    const maxUltCd = (p.equippedSkills.ultimate?.cooldown || 12.0) * (stats.ultimateCooldownMultiplier || 1);

    this.updateSkillCooldownSlot(this.elPulseCd, this.elSweepPrimary, this.elPrimaryIcon, p.primaryCooldownRemaining, maxPrimCd);
    this.updateSkillCooldownSlot(this.elWaveCd, this.elSweepSecondary, this.elSecondaryIcon, p.secondaryCooldownRemaining, maxSecCd);
    this.updateSkillCooldownSlot(this.elDashCd, this.elSweepUtility, this.elUtilityIcon, p.utilityCooldownRemaining, maxDashCd);
    this.updateSkillCooldownSlot(this.elUltCd, this.elSweepUltimate, this.elUltimateIcon, p.ultimateCooldownRemaining, maxUltCd);

    if (this.elPrimaryIcon && p.equippedSkills.primary?.icon) {
      if (!this.elPrimaryIcon.src.endsWith(p.equippedSkills.primary.icon)) {
        this.elPrimaryIcon.src = p.equippedSkills.primary.icon;
      }
    }
    if (this.elSecondaryIcon && p.equippedSkills.secondary?.icon) {
      if (!this.elSecondaryIcon.src.endsWith(p.equippedSkills.secondary.icon)) {
        this.elSecondaryIcon.src = p.equippedSkills.secondary.icon;
      }
    }
    if (this.elUtilityIcon && p.equippedSkills.utility?.icon) {
      if (!this.elUtilityIcon.src.endsWith(p.equippedSkills.utility.icon)) {
        this.elUtilityIcon.src = p.equippedSkills.utility.icon;
      }
    }
    if (this.elUltimateIcon && p.equippedSkills.ultimate?.icon) {
      if (!this.elUltimateIcon.src.endsWith(p.equippedSkills.ultimate.icon)) {
        this.elUltimateIcon.src = p.equippedSkills.ultimate.icon;
      }
    }

    // 4b. Active Skill Enhancement Badges (Commander & Doctor)
    const enhs = p.skillEnhancements || {};
    this.updateSkillEnhBadge(this.elEnhBadgePrimary, enhs.primary, {
      chill_beam: { label: 'CHILL BEAM', color: '#38bdf8' },
      piercing_laser: { label: 'PIERCING LASER', color: '#c084fc' },
      extended_slash: { label: 'EXT. SLASH', color: '#f59e0b' },
      toxic_chain: { label: 'TOXIC CHAIN', color: '#84cc16' },
      cryogenic_scalpel: { label: 'CRYO SCALPEL', color: '#38bdf8' },
      vital_extraction: { label: 'VITAL EXTRACT', color: '#10b981' }
    });
    this.updateSkillEnhBadge(this.elEnhBadgeSecondary, enhs.secondary, {
      scissor_slash: { label: 'SCISSOR', color: '#f59e0b' },
      frost_burst: { label: 'FROST BURST', color: '#00e5ff' },
      orbiting_blade: { label: 'SWORDS', color: '#c084fc' },
      experimental_drones: { label: 'DRONES', color: '#34d399' },
      toxic_cluster_bomb: { label: 'CLUSTER', color: '#a3e635' },
      holographic_decoy: { label: 'DECOY', color: '#2dd4bf' }
    });
    this.updateSkillEnhBadge(this.elEnhBadgeUtility, enhs.utility, {
      shock_dash: { label: 'SHOCK', color: '#f59e0b' },
      extended_dash: { label: 'EXTENDED', color: '#38bdf8' },
      teleport: { label: 'TELEPORT', color: '#c084fc' },
      phase_barrier: { label: 'BARRIER', color: '#6ee7b7' },
      adrenaline_rush: { label: 'ADRENALINE', color: '#22c55e' }
    });
    this.updateSkillEnhBadge(this.elEnhBadgeUltimate, enhs.ultimate, {
      singularity: { label: 'SINGULARITY', color: '#a855f7' },
      convergence_barrage: { label: '5-STRIKE', color: '#fbbf24' },
      cryogenic_impact: { label: 'CRYO', color: '#38bdf8' },
      mobile_sanctuary: { label: 'MOBILE', color: '#10b981' },
      divine_intervention: { label: 'CELESTIAL', color: '#fef08a' },
      rain_of_crosses: { label: 'RAIN', color: '#34d399' }
    });

    // Jetpack Fuel Gauge (Remains integrated in Skill UI)
    const fuelPct = Math.max(0, Math.min(100, (p.jetpackFuel / Math.max(1, p.maxJetpackFuel)) * 100));
    this.elJetpackFill.style.height = `${fuelPct}%`;
    if (p.isGliding) {
      this.elJetpackStatus.textContent = 'GLD';
      this.elJetpackStatus.style.color = '#7dd3fc';
    } else if (!p.isGrounded) {
      this.elJetpackStatus.textContent = 'AIR';
      this.elJetpackStatus.style.color = '#93c5fd';
    } else if (fuelPct < 96) {
      this.elJetpackStatus.textContent = 'CHG';
      this.elJetpackStatus.style.color = '#c4b5fd';
    } else {
      this.elJetpackStatus.textContent = 'RDY';
      this.elJetpackStatus.style.color = '#a5b4fc';
    }

    // 4c. Active Temporary Buffs & Debuffs (directly below Skill Bar)
    this.updateActiveBuffsRow(state);

    // 5. Right-Side Expandable Passive Buffs & Legacy Items Tray
    this.updateItemsTray(p.items, p.buffs);

    // 6. Top-Right Circular Terrain Minimap
    this.updateRadar(state);

    // 6b. Update Clock & Difficulty Progress Hairline
    if (this.elDiffClockText && this.elDiffBarFill) {
      const { progressInTier } = getDifficultyTier(state.gameTime);
      const mins = Math.floor(state.gameTime / 60);
      const secs = Math.floor(state.gameTime % 60);
      this.elDiffClockText.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      this.elDiffBarFill.style.width = `${(progressInTier * 100).toFixed(1)}%`;
    }

    // 6c. In-World Interaction Context Prompt [E]
    if (this.simulation && this.elInteractPrompt) {
      const prompt = this.simulation.getInteractionPrompt();
      if (prompt && !state.isPausedForBuffChoice && !state.isGameOver && !state.isStageCleared) {
        this.elInteractPrompt.classList.remove('hidden');
        this.elInteractKey.textContent = `[${prompt.key}]`;
        this.elInteractLabel.textContent = prompt.label;
        if (prompt.canAfford !== false) {
          this.elInteractPrompt.classList.remove('unaffordable');
        } else {
          this.elInteractPrompt.classList.add('unaffordable');
        }
      } else {
        this.elInteractPrompt.classList.add('hidden');
      }
    }

    // 6d. World Event Status Banner
    if (this.elEventBanner && state.worldEvents) {
      const activeEv = state.worldEvents.find(e => e.isActive && !e.isCompleted);
      if (activeEv && !state.isPausedForBuffChoice && !state.isGameOver && !state.isStageCleared) {
        this.elEventBanner.classList.remove('hidden');
        this.eventBannerTitle.textContent = activeEv.name.toUpperCase();

        if (activeEv.type === 'void_corruption') {
          const kills = activeEv.killCount || 0;
          const target = activeEv.killTarget || 12;
          const pct = Math.min(100, (kills / target) * 100);
          this.eventProgressBar.style.width = `${pct}%`;
          this.eventProgressBar.style.backgroundColor = '#c084fc';
          this.eventBannerTitle.style.color = '#c084fc';
          this.eventBannerDesc.textContent = `Trial of Corruption: ${kills}/${target} Void Foes Purged! (${Math.ceil(activeEv.durationTimer || 0)}s left)`;
        } else if (activeEv.type === 'primal_totem') {
          this.eventProgressBar.style.width = `${activeEv.chargeProgress.toFixed(0)}%`;
          this.eventProgressBar.style.backgroundColor = '#38bdf8';
          this.eventBannerTitle.style.color = '#38bdf8';
          const pDist = Math.hypot(p.pos.x - activeEv.pos.x, p.pos.y - activeEv.pos.y);
          this.eventBannerDesc.textContent = pDist <= activeEv.radius
            ? `Fight Within Range! Synchronizing Resonance... ${activeEv.chargeProgress.toFixed(0)}%`
            : `Resonance Decaying! Return to Totem Range! (${activeEv.chargeProgress.toFixed(0)}%)`;
        } else if (activeEv.type === 'secondary_totem') {
          const kills = activeEv.killCount || 0;
          const curWave = Math.min(3, kills + 1);
          this.eventProgressBar.style.width = `${activeEv.chargeProgress.toFixed(0)}%`;
          this.eventProgressBar.style.backgroundColor = '#f59e0b';
          this.eventBannerTitle.style.color = '#f59e0b';
          this.eventBannerDesc.textContent = `Sequential Elite Trial: Defeat Elite ${curWave} of 3 (${kills}/3 Eliminated)`;
        } else if (activeEv.type === 'dash_totem') {
          const reached = activeEv.highestPlatformReached || 0;
          this.eventProgressBar.style.width = `${activeEv.chargeProgress.toFixed(0)}%`;
          this.eventProgressBar.style.backgroundColor = '#818cf8';
          this.eventBannerTitle.style.color = '#818cf8';
          this.eventBannerDesc.textContent = `Ascend the 5 Phase Platforms to Reach the Summit Core! [${reached}/5 Platforms Reached]`;
        } else {
          this.eventProgressBar.style.width = `${activeEv.chargeProgress.toFixed(0)}%`;
          this.eventProgressBar.style.backgroundColor = '#fbbf24';
          this.eventBannerTitle.style.color = '#fbbf24';
          if (!activeEv.payloadCollected) {
            const itemDist = activeEv.payloadPos
              ? Math.round(Math.hypot(p.pos.x - activeEv.payloadPos.x, p.pos.y - activeEv.payloadPos.y))
              : 0;
            this.eventBannerDesc.textContent = `Follow the Vertical Light Beam to Collect the Quantum Core! (${itemDist}m)`;
          } else {
            const returnDist = Math.round(Math.hypot(p.pos.x - activeEv.pos.x, p.pos.y - activeEv.pos.y));
            this.eventBannerDesc.textContent = `Deliver Quantum Core to the Uplink Conduit! (+25% Move Speed · Weapons Offline · ${returnDist}m)`;
          }
        }
      } else {
        this.elEventBanner.classList.add('hidden');
      }
    }

    // 7. 3-Choice Buff / Augment Selection Pause Modal
    if (state.isPausedForBuffChoice) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      const firstDef = state.currentBuffChoices.length > 0 ? BUFF_REGISTRY[state.currentBuffChoices[0]] : undefined;
      const isAugmentDraft = !!(firstDef?.exclusiveEvent || firstDef?.enhancesSkillSlot || firstDef?.replacesSkillSlot);
      const buffTitleEl = this.elBuffChoiceModal.querySelector('h2');
      if (buffTitleEl) {
        if (isAugmentDraft) {
          buffTitleEl.textContent = p.heroId === 'doctor' ? 'SELECT DOCTOR AUGMENTATION' : 'SELECT COMMANDER AUGMENTATION';
        } else {
          buffTitleEl.textContent = 'SELECT A BUFF (CHOOSE ONE)';
        }
      }
      this.elBuffChoiceModal.classList.remove('hidden');
      const key = state.currentBuffChoices.join(',');
      if (key !== this.lastRenderedBuffKey) {
        this.lastRenderedBuffKey = key;
        this.renderBuffChoiceCards(state.currentBuffChoices, p.buffs, p.items);
      }
    } else {
      this.elBuffChoiceModal.classList.add('hidden');
      this.lastRenderedBuffKey = '';
    }

    // 8. End-of-Run Modals
    if (state.isStageCleared && this.elStageClearModal.classList.contains('hidden')) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      this.showStageClear(state);
    } else if (state.isGameOver && this.elGameOverModal.classList.contains('hidden')) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      const goTitleEl = this.elGameOverModal.querySelector('h1');
      if (goTitleEl) {
        goTitleEl.textContent = p.heroId === 'doctor' ? 'DOCTOR FALLEN' : 'COMMANDER FALLEN';
      }
      this.showGameOver(state);
    }
  }

  private renderBuffChoiceCards(
    choices: BuffId[],
    buffStacks: Record<BuffId, number>,
    itemStacks: Record<ItemId, number>
  ): void {
    this.elBuffCardsGrid.innerHTML = '';

    choices.forEach((buffId, idx) => {
      const def = BUFF_REGISTRY[buffId];
      if (!def) return;

      const curCount = def.linkedItemId
        ? itemStacks[def.linkedItemId] || 0
        : buffStacks[buffId] || 0;

      const isSkillSwap = !!(def.replacesSkillSlot && def.replacementSkillId);
      const isAugmentCard = !!(def.exclusiveEvent || def.enhancesSkillSlot || isSkillSwap);
      const maxCapLabel = def.maxStacks !== undefined ? `/${def.maxStacks}` : '';
      const stackLabel = isSkillSwap
        ? `★ REPLACES ${def.replacesSkillSlot!.toUpperCase()}`
        : isAugmentCard
          ? curCount > 0
            ? `STACK x${curCount} → x${curCount + 1}`
            : 'NEW AUGMENT'
          : curCount > 0
            ? `STACK x${curCount} → x${curCount + 1}${maxCapLabel}`
            : def.maxStacks !== undefined
              ? `NEW BUFF (MAX ${def.maxStacks})`
              : 'NEW BUFF';
      const buttonLabel = isSkillSwap ? 'Install & Equip Skill' : isAugmentCard ? 'Install Augment' : 'Select Buff';
      const cardBorder = isSkillSwap
        ? 'border: 2px solid #f59e0b; box-shadow: 0 0 18px rgba(245, 158, 11, 0.45);'
        : '';

      const card = document.createElement('div');
      card.className = 'buff-card interactive';
      if (cardBorder) card.style.cssText = cardBorder;
      card.innerHTML = `
        <span class="buff-key-hint">[${idx + 1}]</span>
        <span class="buff-stack-pill" style="${isSkillSwap ? 'background: rgba(245, 158, 11, 0.35); border-color: #f59e0b; color: #fef08a;' : ''}">${stackLabel}</span>
        <div class="buff-icon-circle" style="border-color: ${def.accentColor};">
          <img src="${def.icon}" alt="${def.name}" />
        </div>
        <div class="buff-category" style="color: ${def.accentColor};">${def.category}</div>
        <div class="buff-title">${def.name}</div>
        <div class="buff-desc">${def.description}</div>
        <div class="buff-select-btn" style="${isSkillSwap ? 'background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-weight: 800;' : ''}">${buttonLabel}</div>
      `;

      card.addEventListener('click', () => {
        if (this.simulation) {
          this.simulation.selectBuffChoice(buffId);
          this.onRequestPointerLock?.();
        }
      });

      this.elBuffCardsGrid.appendChild(card);
    });
  }

  private updateSkillCooldownSlot(
    cdEl: HTMLElement,
    sweepEl: HTMLElement | null,
    imgEl: HTMLImageElement | null,
    remaining: number,
    maxCooldown: number
  ): void {
    if (remaining > 0.05) {
      cdEl.classList.remove('hidden');
      cdEl.textContent = remaining.toFixed(1);
      imgEl?.classList.add('on-cooldown');
      if (sweepEl) {
        sweepEl.classList.remove('hidden');
        const ratio = Math.max(0, Math.min(1, remaining / Math.max(remaining, maxCooldown, 0.2)));
        sweepEl.style.setProperty('--cd-deg', `${(ratio * 360).toFixed(1)}deg`);
      }
    } else {
      cdEl.classList.add('hidden');
      imgEl?.classList.remove('on-cooldown');
      sweepEl?.classList.add('hidden');
    }
  }

  private updateActiveBuffsRow(state: GameState): void {
    if (!this.elBuffsRow) return;
    const p = state.player;
    const chips: string[] = [];

    const mkIcon = (svgPath: string, cls: string, title: string, timer?: number) => {
      const tHtml = timer && timer > 0 ? `<span class="hud-buff-timer">${timer.toFixed(1)}</span>` : '';
      chips.push(
        `<div class="hud-buff-chip ${cls}" title="${title}">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>` +
        `${tHtml}` +
        `</div>`
      );
    };

    if ((p.adrenalineRushTimer ?? 0) > 0) {
      mkIcon('<polyline points="17 11 12 6 7 11"/><polyline points="17 17 12 12 7 17"/>', 'is-buff', `Adrenaline Rush: +50% Move Speed (${(p.adrenalineRushTimer ?? 0).toFixed(1)}s)`, p.adrenalineRushTimer);
    }
    if ((p.phaseBarrierTimer ?? 0) > 0) {
      mkIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'is-gold', `Phase Barrier: Damage Immunity (${(p.phaseBarrierTimer ?? 0).toFixed(1)}s)`, p.phaseBarrierTimer);
    }
    if (p.inSanctuaryCross) {
      mkIcon('<path d="M12 5v14M5 12h14"/>', 'is-buff', 'Sacred Field: +HP/s Healing & Empowered Strikes');
    }
    if ((p.tempShieldAmount ?? 0) > 0 && (p.tempShieldTimer ?? 0) > 0) {
      mkIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'is-gold', `Barrier Shield: ${Math.round(p.tempShieldAmount)} HP (${(p.tempShieldTimer ?? 0).toFixed(1)}s)`, p.tempShieldTimer);
    }
    if ((p.bloodRushTimer ?? 0) > 0) {
      mkIcon('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 'is-gold', `Blood Rush: +LMB Atk Spd & Move Spd (${(p.bloodRushTimer ?? 0).toFixed(1)}s)`, p.bloodRushTimer);
    }
    if ((p.retaliationTimer ?? 0) > 0) {
      mkIcon('<path d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z"/>', 'is-buff', `Retaliation: +${(p.buffs.buff_retaliation || 0) * 2}% Damage (${(p.retaliationTimer ?? 0).toFixed(1)}s)`, p.retaliationTimer);
    }
    if ((p.killingMomentumTimer ?? 0) > 0 && (p.killingMomentumStacks ?? 0) > 0) {
      mkIcon('<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>', 'is-buff', `Killing Momentum x${p.killingMomentumStacks} (${(p.killingMomentumTimer ?? 0).toFixed(1)}s)`, p.killingMomentumTimer);
    }
    if ((p.survivalInstinctTimer ?? 0) > 0) {
      mkIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'is-gold', `Survival Instinct: Stun Immune + Speed (${(p.survivalInstinctTimer ?? 0).toFixed(1)}s)`, p.survivalInstinctTimer);
    }
    if (p.health > 0 && p.health / Math.max(1, p.maxHealth) < 0.40 && (p.buffs.buff_final_stand || 0) > 0) {
      const fs = p.buffs.buff_final_stand || 0;
      mkIcon('<polygon points="12 2 15 9 22 9 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9 9 9"/>', 'is-debuff', `Final Stand Active: +${fs * 3}% DMG & +${fs * 2}% DR`);
    }
    if (p.defenseBonusTimer > 0) {
      mkIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'is-buff', `Defensive Resolve: -35% Damage Taken (${p.defenseBonusTimer.toFixed(1)}s)`, p.defenseBonusTimer);
    }
    if (p.inWater) {
      mkIcon('<path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>', 'is-debuff', 'In Water: 68% Movement Speed (-32%)');
    }
    if ((p.maxAirJumps ?? 0) > 0) {
      mkIcon('<polyline points="17 11 12 6 7 11"/><polyline points="17 17 12 12 7 17"/>', 'is-gold', `Air Jumps Ready: ${p.airJumpsRemaining ?? 0}/${p.maxAirJumps}`);
    }
    if ((p.toxicRainTimer ?? 0) > 0) {
      mkIcon('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 'is-debuff', `Environmental Hazard (${(p.toxicRainTimer ?? 0).toFixed(1)}s)`, p.toxicRainTimer);
    }
    if (p.isCarryingEventPayload) {
      mkIcon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', 'is-gold', 'Carrying Quantum Core: +25% Move Speed (Weapons Offline)');
    }

    const html = chips.join('');
    if (html !== this.lastBuffsHtml) {
      this.elBuffsRow.innerHTML = html;
      this.lastBuffsHtml = html;
    }
  }

  private updateItemsTray(items: Record<ItemId, number>, buffs?: Record<BuffId, number>): void {
    let html = '';
    let countAny = false;

    if (buffs) {
      for (const [id, stack] of Object.entries(buffs) as [BuffId, number][]) {
        if (stack > 0) {
          const def = BUFF_REGISTRY[id];
          if (!def || def.exclusiveEvent || def.replacesSkillSlot || def.enhancesSkillSlot) continue;
          countAny = true;
          const capText = def.maxStacks !== undefined ? ` / Max ${def.maxStacks}` : '';
          html += `
            <div class="item-badge" title="${def.name} (x${stack}${capText}): ${def.description}">
              <img src="${def.icon}" alt="${def.name}" />
              <span class="item-stack-counter">x${stack}</span>
            </div>
          `;
        }
      }
    }

    for (const [id, stack] of Object.entries(items) as [ItemId, number][]) {
      if (stack > 0) {
        countAny = true;
        const def = ITEM_REGISTRY[id];
        if (!def) continue;
        html += `
          <div class="item-badge" title="${def.name}: ${def.description}">
            <img src="${def.icon}" alt="${def.name}" />
            <span class="item-stack-counter">x${stack}</span>
          </div>
        `;
      }
    }

    const emptyHtml = '<div class="hud-items-empty" title="No buffs collected yet">0</div>';
    const targetHtml = countAny ? html : emptyHtml;
    if (targetHtml !== this.lastItemsHtml) {
      this.elItemsTray.innerHTML = targetHtml;
      this.lastItemsHtml = targetHtml;
    }
  }

  private buildMinimapTerrainCache(state: GameState): void {
    const size = 280;
    const margin = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const ww = state.worldWidth || 3600;
    const wh = state.worldHeight || 3600;
    const spanW = ww + margin * 2;
    const spanH = wh + margin * 2;

    for (let py = 0; py < size; py++) {
      const wy = (py / size) * spanH - margin;
      for (let px = 0; px < size; px++) {
        const wx = (px / size) * spanW - margin;
        const clampedX = Math.max(0, Math.min(ww, wx));
        const clampedY = Math.max(0, Math.min(wh, wy));
        const outsideDist = Math.hypot(wx - clampedX, wy - clampedY);
        const h = state.terrain.getElevation(clampedX, clampedY).height;
        const idx = (py * size + px) * 4;

        // Topographical slate-violet contour palette fading smoothly past crater rim (eliminates hard black edge)
        const contour = outsideDist < 20 && Math.abs(((h % 26) + 26) % 26 - 13) < 1.8 ? 14 : 0;
        const norm = Math.max(0, Math.min(1, (h + 25) / 140));
        const rimFade = Math.max(0.42, 1.0 - outsideDist / 650);
        data[idx] = Math.round((18 + norm * 38 + contour * 0.7) * rimFade);
        data[idx + 1] = Math.round((16 + norm * 30 + contour * 0.5) * rimFade);
        data[idx + 2] = Math.round((36 + norm * 62 + contour) * rimFade);
        data[idx + 3] = 242;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.terrainMapCanvas = canvas;
    this.terrainMapWorldW = ww;
    this.terrainMapWorldH = wh;
    this.terrainMapMargin = margin;
  }

  private updateRadar(state: GameState): void {
    const canvas = this.elMinimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!this.terrainMapCanvas) {
      this.buildMinimapTerrainCache(state);
    }

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = w * 0.5 - 3;
    const viewWorldRadius = 1150;
    const scale = r / viewWorldRadius;

    const p = state.player;
    const yaw = p.cameraYaw || 0;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // Compass 'N' tracks world +Y rotated into camera frame (exact match to ThreeApp camFwd = (sinY, cosY))
    if (this.elMinimapNorth) {
      const northScreenDeg = (Math.atan2(-sinY, cosY) * 180) / Math.PI;
      this.elMinimapNorth.style.transform = `translate(-50%, 0) rotate(${northScreenDeg.toFixed(1)}deg)`;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Base wash matching deep outer ridge tone
    ctx.fillStyle = '#151228';
    ctx.fillRect(0, 0, w, h);

    // Pre-rendered Terrain Layer centered at player and rotated with camera yaw
    if (this.terrainMapCanvas && this.terrainMapWorldW > 0) {
      const m = this.terrainMapMargin || 0;
      const spanW = this.terrainMapWorldW + m * 2;
      const spanH = this.terrainMapWorldH + m * 2;
      const mapScaleX = (spanW / this.terrainMapCanvas.width) * scale;
      const mapScaleY = (spanH / this.terrainMapCanvas.height) * scale;
      const pImgX = ((p.pos.x + m) / spanW) * this.terrainMapCanvas.width;
      const pImgY = ((p.pos.y + m) / spanH) * this.terrainMapCanvas.height;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI + yaw);
      ctx.scale(mapScaleX, mapScaleY);
      ctx.drawImage(this.terrainMapCanvas, -pImgX, -pImgY);
      ctx.restore();
    }

    // Helper: world (wx, wy) -> camera-aligned minimap coordinates (clamped on rim if requested)
    const projectPoint = (wx: number, wy: number, clampEdge: boolean): { x: number; y: number; inRange: boolean } => {
      const dx = wx - p.pos.x;
      const dy = wy - p.pos.y;
      const sx = (-cosY * dx + sinY * dy) * scale;
      const sy = (-(sinY * dx + cosY * dy)) * scale;
      const dist = Math.hypot(sx, sy);
      if (dist <= r - 7) {
        return { x: cx + sx, y: cy + sy, inRange: true };
      }
      if (!clampEdge || dist < 0.001) {
        return { x: cx + sx, y: cy + sy, inRange: false };
      }
      const k = (r - 6) / dist;
      return { x: cx + sx * k, y: cy + sy * k, inRange: false };
    };

    // Subtle radar rings
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    // Unopened Bio-Sacs
    for (let i = 0; i < state.pods.length; i++) {
      const pod = state.pods[i];
      if (pod.isOpened) continue;
      const pt = projectPoint(pod.pos.x, pod.pos.y, false);
      if (!pt.inRange) continue;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // World Events
    if (state.worldEvents) {
      for (let i = 0; i < state.worldEvents.length; i++) {
        const ev = state.worldEvents[i];
        if (ev.isCompleted) continue;
        const pt = projectPoint(ev.pos.x, ev.pos.y, true);
        ctx.fillStyle = ev.type === 'void_corruption' ? '#c084fc' : ev.type === 'primal_totem' ? '#22d3ee' : '#fb923c';
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 4.5);
        ctx.lineTo(pt.x + 4.5, pt.y);
        ctx.lineTo(pt.x, pt.y + 4.5);
        ctx.lineTo(pt.x - 4.5, pt.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Active Enemies
    for (let i = 0; i < state.enemies.length; i++) {
      const en = state.enemies[i];
      if (en.health <= 0) continue;
      const pt = projectPoint(en.pos.x, en.pos.y, false);
      if (!pt.inRange) continue;
      ctx.fillStyle = en.isBoss ? '#f43f5e' : en.isElite ? '#fb7185' : 'rgba(244, 63, 94, 0.85)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, en.isBoss ? 5.2 : en.isElite ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Overseer Artifact Beacon (always tracked on map/perimeter)
    const artPt = projectPoint(state.artifact.pos.x, state.artifact.pos.y, true);
    ctx.fillStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(artPt.x, artPt.y, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ultimate Event Quantum Core Beacon on Minimap (clamped to rim so direction is always visible)
    for (let i = 0; i < state.worldEvents.length; i++) {
      const ev = state.worldEvents[i];
      if (ev.type === 'orbital_uplink' && ev.isActive && !ev.isCompleted) {
        const targetPos = !ev.payloadCollected && ev.payloadPos ? ev.payloadPos : ev.pos;
        const corePt = projectPoint(targetPos.x, targetPos.y, true);
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(corePt.x, corePt.y, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // Player Directional Chevron at Center
    const facingAngle = p.facing === 'right' ? Math.PI * 0.5 : p.facing === 'left' ? -Math.PI * 0.5 : p.facing === 'front' ? Math.PI : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(facingAngle);
    ctx.fillStyle = '#c4b5fd';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  private openHudModal(mode: 'inventory' | 'codex'): void {
    if (!this.simulation || !this.simulation.state.isGameStarted) return;
    this.simulation.state.isPaused = true;
    if (document.pointerLockElement) document.exitPointerLock?.();

    this.elInventoryModal?.classList.add('hidden');
    this.elCodexModal?.classList.add('hidden');

    if (mode === 'inventory') {
      this.renderInventoryModal();
      this.elInventoryModal?.classList.remove('hidden');
    } else {
      this.renderCodexModal();
      this.elCodexModal?.classList.remove('hidden');
    }
  }

  private closeHudModals(resumeSim: boolean): void {
    this.elInventoryModal?.classList.add('hidden');
    this.elCodexModal?.classList.add('hidden');
    if (resumeSim && this.simulation && this.simulation.state.isGameStarted) {
      if (this.elPauseModal.classList.contains('hidden') && this.elSettingsModal.classList.contains('hidden')) {
        this.simulation.state.isPaused = false;
        this.onRequestPointerLock?.();
      }
    }
  }

  private renderInventoryModal(): void {
    if (!this.simulation || !this.elInventoryBody) return;
    const state = this.simulation.state;
    const p = state.player;
    const stats = p.calculatedStats;

    const passiveItems = (Object.entries(p.items) as [ItemId, number][])
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const def = ITEM_REGISTRY[id];
        return `<div class="hud-codex-entry"><img src="${def.icon}" alt="${def.name}"/><div><div class="hud-codex-entry-meta">STACK x${count}</div><div class="hud-codex-entry-name">${def.name}</div><div class="hud-codex-entry-desc">${def.description}</div></div></div>`;
      })
      .join('');

    const runUpgrades = (Object.entries(p.buffs) as [BuffId, number][])
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const def = BUFF_REGISTRY[id];
        if (!def) return '';
        return `<div class="hud-codex-entry"><img src="${def.icon}" alt="${def.name}"/><div><div class="hud-codex-entry-meta">${def.category} · LV ${count}</div><div class="hud-codex-entry-name">${def.name}</div><div class="hud-codex-entry-desc">${def.description}</div></div></div>`;
      })
      .join('');

    this.elInventoryBody.innerHTML = `
      <div>
        <div class="hud-codex-entry-meta" style="margin-bottom:6px;">COMBAT TELEMETRY (${p.heroId.toUpperCase()} · Lv. ${p.level})</div>
        <div class="hud-inv-stats-grid">
          <div class="hud-inv-stat-box"><span>Max Health</span><span>${p.maxHealth}</span></div>
          <div class="hud-inv-stat-box"><span>Energy Shield</span><span>${p.maxEnergyShield}</span></div>
          <div class="hud-inv-stat-box"><span>Damage Mult</span><span>${Math.round(stats.damageMultiplier * 100)}%</span></div>
          <div class="hud-inv-stat-box"><span>Attack Speed</span><span>${Math.round((stats.attackSpeedMultiplier || 1) * 100)}%</span></div>
          <div class="hud-inv-stat-box"><span>Move Speed</span><span>${Math.round(stats.moveSpeed)}</span></div>
          <div class="hud-inv-stat-box"><span>Crit Chance</span><span>${Math.round(stats.critChance * 100)}%</span></div>
          <div class="hud-inv-stat-box"><span>Extra Projectiles</span><span>LMB +${stats.extraLmbProjectiles || 0} / RMB +${stats.extraRmbProjectiles || 0}</span></div>
          <div class="hud-inv-stat-box"><span>Genes Harvested</span><span>${p.currency}</span></div>
        </div>
      </div>
      <div>
        <div class="hud-codex-entry-meta" style="margin-bottom:6px;">COLLECTED PASSIVE ITEMS</div>
        <div class="hud-codex-list">${passiveItems || '<div class="hud-codex-entry-desc">No passive items collected yet.</div>'}</div>
      </div>
      <div>
        <div class="hud-codex-entry-meta" style="margin-bottom:6px;">INSTALLED AUGMENTS &amp; UPGRADES</div>
        <div class="hud-codex-list">${runUpgrades || '<div class="hud-codex-entry-desc">Level up or harvest Bio-Sacs to install upgrades.</div>'}</div>
      </div>
    `;
  }

  private renderCodexModal(): void {
    if (!this.elCodexBody) return;
    const heroId: HeroId = this.simulation?.state.player.heroId || this.selectedHeroId;

    document.getElementById('codex-tab-skills')?.classList.toggle('active', this.currentCodexTab === 'skills');
    document.getElementById('codex-tab-items')?.classList.toggle('active', this.currentCodexTab === 'items');
    document.getElementById('codex-tab-comms')?.classList.toggle('active', this.currentCodexTab === 'comms');

    if (this.currentCodexTab === 'skills') {
      const baseSkills = getHeroBaseSkills(heroId);
      const upgrades = getHeroSkillUpgrades(heroId).flatMap(g => g.upgrades);
      const cards = [...baseSkills, ...upgrades]
        .map(s => `<div class="hud-codex-entry"><img src="${s.icon}" alt="${s.name}"/><div><div class="hud-codex-entry-meta">${s.slotLabel} · ${s.cooldown}</div><div class="hud-codex-entry-name">${s.name}</div><div class="hud-codex-entry-desc">${s.description}</div></div></div>`)
        .join('');
      this.elCodexBody.innerHTML = `<div class="hud-codex-list">${cards}</div>`;
    } else if (this.currentCodexTab === 'items') {
      const catalogBuffs = Object.values(BUFF_REGISTRY)
        .filter((b) => !b.exclusiveEvent && !b.replacesSkillSlot && !b.enhancesSkillSlot && b.isAttributeUpgrade !== false)
        .map(
          (b) =>
            `<div class="hud-codex-entry"><img src="${b.icon}" alt="${b.name}"/><div><div class="hud-codex-entry-meta">${b.category}${b.maxStacks !== undefined ? ` · MAX ${b.maxStacks}` : ' · UNCAPPED'}</div><div class="hud-codex-entry-name">${b.name}</div><div class="hud-codex-entry-desc">${b.description}</div></div></div>`
        )
        .join('');
      const augments = getAllPassiveBuffsCatalog().passiveBuffs
        .map(b => `<div class="hud-codex-entry"><img src="${b.icon}" alt="${b.name}"/><div><div class="hud-codex-entry-meta">${b.slotLabel}</div><div class="hud-codex-entry-name">${b.name}</div><div class="hud-codex-entry-desc">${b.description}</div></div></div>`)
        .join('');
      this.elCodexBody.innerHTML = `
        <div><div class="hud-codex-entry-meta" style="margin-bottom:6px;">ACTIVE BUFF CATALOG (${Object.values(BUFF_REGISTRY).filter((b) => !b.exclusiveEvent && !b.replacesSkillSlot && !b.enhancesSkillSlot && b.isAttributeUpgrade !== false).length} BUFFS)</div><div class="hud-codex-list">${catalogBuffs}</div></div>
        <div><div class="hud-codex-entry-meta" style="margin-bottom:6px;">SKILL AUGMENTS</div><div class="hud-codex-list">${augments}</div></div>
      `;
    } else {
      const transcript = this.dialogueController?.getTranscript() || [];
      const unlockedLore = this.dialogueController?.getUnlockedCodexLore() || [];

      const loreHtml = unlockedLore.length
        ? `<div><div class="hud-codex-entry-meta" style="margin-bottom:6px;">UNLOCKED NARRATIVE INTEL</div><div class="hud-codex-list">${unlockedLore
          .map(
            (l) =>
              `<div class="hud-codex-entry hud-codex-comms-lore"><img src="/assets/overseer/overseer_portrait.png" alt="Intel"/><div><div class="hud-codex-entry-meta">FIELD ARCHIVE · ${escapeHtml(l.id)}</div><div class="hud-codex-entry-name">${escapeHtml(l.title)}</div><div class="hud-codex-entry-desc">${escapeHtml(l.summary)}</div></div></div>`
          )
          .join('')}</div></div>`
        : '';

      const logHtml = transcript.length
        ? transcript
          .map((entry) => {
            const portrait =
              entry.speaker === 'doctor'
                ? '/assets/doctor/doctor_portrait.png'
                : entry.speaker === 'overseer'
                  ? '/assets/overseer/overseer_portrait.png'
                  : '/assets/commander/commander_portrait.png';
            const roleBadge =
              entry.role === 'field_operative'
                ? 'FIELD'
                : entry.role === 'local_companion'
                  ? 'LOCAL'
                  : 'COMMS';
            const modeBadge = entry.voiced ? 'VOICED' : 'TEXT';
            return `
                <div class="hud-codex-entry hud-codex-comms-entry speaker-${entry.speaker}">
                  <img src="${portrait}" alt="${escapeHtml(entry.speaker)}"/>
                  <div>
                    <div class="hud-codex-entry-meta">[${formatCommsTimestamp(entry.gameTimeSec)}] ${escapeHtml(entry.speaker.toUpperCase())} · ${roleBadge} · ${modeBadge} · ${escapeHtml(entry.conversationTitle)}</div>
                    <div class="hud-codex-entry-desc" style="color:#e2e8f0; margin-top:4px;">${escapeHtml(entry.text)}</div>
                  </div>
                </div>
              `;
          })
          .join('')
        : '<div class="hud-codex-entry-desc">No radio transmissions logged yet in this mission. Leave the crash perimeter to establish comms.</div>';

      this.elCodexBody.innerHTML = `
        ${loreHtml}
        <div>
          <div class="hud-codex-entry-meta" style="margin-bottom:6px;">RADIO COMMS TRANSCRIPT (${transcript.length})</div>
          <div class="hud-codex-list">${logHtml}</div>
        </div>
      `;
    }
  }

  public setDialogueController(controller: DialogueUIController): void {
    this.dialogueController = controller;
    this.populateDevDialogueSelect();
    this.updateCommsPresentation(controller.getPresentationState());
    this.updateQuestTracker(controller.getActiveRunObjectives());
    this.refreshDevDialogueTester();
  }

  public updateQuestTracker(objectives: UnlockedCodexLore[]): void {
    if (!this.elQuestTracker || !this.elQuestTrackerList) return;
    if (!objectives || objectives.length === 0) {
      if (this.lastQuestTrackerKey !== '') {
        this.lastQuestTrackerKey = '';
        this.elQuestTrackerList.innerHTML = '';
      }
      this.elQuestTracker.classList.add('hidden');
      return;
    }

    const key = objectives.map((o) => `${o.id}:${o.title}`).join('|');
    this.elQuestTracker.classList.remove('hidden');
    if (key === this.lastQuestTrackerKey) return;
    this.lastQuestTrackerKey = key;

    this.elQuestTrackerList.innerHTML = objectives
      .map(
        (obj) => `
          <div class="hud-quest-item" data-quest-id="${escapeHtml(obj.id)}">
            <div class="hud-quest-item-title">${escapeHtml(obj.title)}</div>
            <div class="hud-quest-item-desc">${escapeHtml(obj.summary)}</div>
          </div>
        `
      )
      .join('');
  }

  public showOverseerTacticalComm(text: string, durationSec: number = 6.5): void {
    if (!this.elCommsPanel) return;
    // Do not overwrite an actively speaking narrative conversation
    if (this.lastDialoguePresentation && this.lastDialoguePresentation.visible && this.lastDialoguePresentation.speaker) {
      return;
    }

    if (this.tacticalCommTimer !== null) {
      window.clearTimeout(this.tacticalCommTimer);
      this.tacticalCommTimer = null;
    }

    this.elCommsPanel.classList.remove('hidden', 'is-suspended');
    this.elCommsPanel.setAttribute('data-speaker', 'overseer');
    if (this.elCommsPortrait) {
      this.elCommsPortrait.src = '/assets/overseer/overseer_portrait.png';
      this.elCommsPortrait.alt = 'OVERSEER';
    }
    if (this.elCommsSpeaker) {
      this.elCommsSpeaker.textContent = 'OVERSEER';
    }
    if (this.elCommsRole) {
      this.elCommsRole.textContent = 'TACTICAL GUIDE';
    }
    if (this.elCommsMode) {
      this.elCommsMode.textContent = 'TEXT COMM';
      this.elCommsMode.classList.remove('is-voiced');
    }
    if (this.elCommsTurn) {
      this.elCommsTurn.textContent = '1/1';
    }
    if (this.elCommsText) {
      this.elCommsText.textContent = text;
      this.elCommsText.classList.remove('hidden');
    }
    this.lastCommsRenderKey = `tactical_overseer|${text}`;

    this.tacticalCommTimer = window.setTimeout(() => {
      this.tacticalCommTimer = null;
      if (!this.lastDialoguePresentation || !this.lastDialoguePresentation.visible) {
        this.elCommsPanel.classList.add('hidden');
        this.lastCommsRenderKey = '';
      }
    }, Math.max(2000, Math.round(durationSec * 1000)));
  }

  public updateCommsPresentation(comms: CommsPresentationState): void {
    this.lastDialoguePresentation = comms;
    if (!this.elCommsPanel) return;

    const hideForOverlay = !comms.visible || !comms.speaker;

    if (hideForOverlay) {
      if (this.tacticalCommTimer !== null) return;
      this.elCommsPanel.classList.add('hidden');
      this.lastCommsRenderKey = '';
      return;
    }

    if (this.tacticalCommTimer !== null) {
      window.clearTimeout(this.tacticalCommTimer);
      this.tacticalCommTimer = null;
    }

    const renderKey = `${comms.conversationId}|${comms.turnIndex}|${comms.speaker}|${comms.role}|${comms.isSubtitlesEnabled}|${comms.isVoicedPlayback}|${comms.lifecycleState}|${comms.text}`;
    this.elCommsPanel.classList.remove('hidden');

    if (renderKey === this.lastCommsRenderKey) return;
    this.lastCommsRenderKey = renderKey;

    this.elCommsPanel.setAttribute('data-speaker', comms.speaker || 'commander');
    this.elCommsPanel.classList.toggle('is-suspended', comms.lifecycleState === 'suspended');

    if (this.elCommsPortrait && comms.portraitUrl) {
      if (this.elCommsPortrait.getAttribute('src') !== comms.portraitUrl) {
        this.elCommsPortrait.src = comms.portraitUrl;
      }
      this.elCommsPortrait.alt = comms.speakerDisplayName;
    }
    if (this.elCommsSpeaker) {
      this.elCommsSpeaker.textContent = comms.speakerDisplayName;
    }
    if (this.elCommsRole) {
      this.elCommsRole.textContent = comms.roleLabel;
    }
    if (this.elCommsMode) {
      this.elCommsMode.textContent =
        comms.lifecycleState === 'suspended'
          ? 'PAUSED'
          : comms.isVoicedPlayback
            ? 'VOICED'
            : 'TEXT FALLBACK';
      this.elCommsMode.classList.toggle('is-voiced', comms.isVoicedPlayback);
    }
    if (this.elCommsTurn) {
      this.elCommsTurn.textContent = `${comms.turnIndex + 1}/${Math.max(1, comms.turnCount)}`;
    }
    if (this.elCommsText) {
      if (comms.isSubtitlesEnabled) {
        this.elCommsText.textContent = comms.text;
        this.elCommsText.classList.remove('hidden');
      } else {
        this.elCommsText.textContent = '';
        this.elCommsText.classList.add('hidden');
      }
    }
  }

  public refreshCommsLogIfOpen(): void {
    if (
      this.elCodexModal &&
      !this.elCodexModal.classList.contains('hidden') &&
      this.currentCodexTab === 'comms'
    ) {
      this.renderCodexModal();
    }
    if (this.elDevTesterPanel && !this.elDevTesterPanel.classList.contains('hidden')) {
      this.refreshDevDialogueTester();
    }
  }

  private populateDevDialogueSelect(): void {
    if (!this.elDevTesterSelect || !this.dialogueController) return;
    const prev = this.elDevTesterSelect.value;
    const list = this.dialogueController.getConversationSummaries();
    this.elDevTesterSelect.innerHTML = list
      .map((item) => {
        const flags: string[] = [];
        if (!item.enabled) flags.push('P2-OFF');
        if (item.hasCommanderVariant && item.hasDoctorVariant) flags.push('CMD/DOC');
        else if (item.hasDefaultVariant) flags.push('SHARED');
        if (item.needsHeroVariantReview) flags.push('REVIEW');
        const label = `${item.title} [${flags.join(' | ')}]`;
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
      })
      .join('');
    if (prev && list.some((i) => i.id === prev)) {
      this.elDevTesterSelect.value = prev;
    }
  }

  public toggleDevDialogueTester(forceOpen?: boolean): void {
    if (!this.elDevTesterPanel) return;
    const shouldOpen =
      forceOpen !== undefined ? forceOpen : this.elDevTesterPanel.classList.contains('hidden');

    if (shouldOpen) {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      this.populateDevDialogueSelect();
      this.elDevTesterPanel.classList.remove('hidden');
      this.refreshDevDialogueTester();
      if (!this.devStatusInterval) {
        this.devStatusInterval = window.setInterval(() => {
          if (this.elDevTesterPanel.classList.contains('hidden')) return;
          this.refreshDevDialogueTester();
        }, 250);
      }
    } else {
      this.elDevTesterPanel.classList.add('hidden');
      if (this.devStatusInterval) {
        clearInterval(this.devStatusInterval);
        this.devStatusInterval = null;
      }
    }
  }

  public refreshDevDialogueTester(): void {
    if (!this.elDevTesterStatus || !this.dialogueController) return;
    const dbg = this.dialogueController.getDebugInfo();
    const pres = this.dialogueController.getPresentationState();
    const mapLabel = this.dialogueController.isCustomTestMapActive()
      ? 'Custom Test Map (Auto-Triggers OFF)'
      : 'Stage 1 (Auto-Triggers ON)';
    const activeTxt = dbg.activeId
      ? `${dbg.activeId} (Turn ${dbg.turnIndex + 1}/${Math.max(1, pres.turnCount)}${pres.speaker ? ` · ${pres.speakerDisplayName}` : ''})`
      : 'None';
    const queueTxt = dbg.queueIds.length ? dbg.queueIds.join(', ') : 'Empty';
    const audioTxt = `${dbg.voicedBufferedCount}/${dbg.voicedTotalEnabledUrls} enabled voice clips buffered`;
    this.elDevTesterStatus.innerHTML = `
      <div><strong>Map:</strong> ${escapeHtml(mapLabel)}</div>
      <div><strong>State:</strong> ${escapeHtml(dbg.lifecycleState)} · <strong>Active:</strong> ${escapeHtml(activeTxt)}</div>
      <div><strong>Queue:</strong> ${escapeHtml(queueTxt)} · <strong>Mode:</strong> ${pres.isVoicedPlayback ? 'VOICED' : 'TEXT FALLBACK'}</div>
      <div><strong>Audio:</strong> ${escapeHtml(audioTxt)} · <strong>Completed Save:</strong> ${dbg.completedSaveIds.length}</div>
    `;
  }

  private showStageClear(state: GameState): void {
    this.elHudContainer.classList.add('hidden');
    this.elStageClearModal.classList.remove('hidden');

    const totalItems = Object.values(state.player.items).reduce((a, b) => a + b, 0);
    this.elClearStats.innerHTML = `
      <div><strong>Expedition Time:</strong> ${Math.floor(state.gameTime)}s</div>
      <div><strong>Tactical Rank Reached:</strong> LV ${state.player.level}</div>
      <div><strong>Threats Neutralized:</strong> ${state.player.killCount}</div>
      <div><strong>Genes Harvested:</strong> ${state.player.currency} Genes</div>
      <div><strong>Modules Stacked:</strong> ${totalItems}</div>
    `;
  }

  private showGameOver(state: GameState): void {
    this.elHudContainer.classList.add('hidden');
    this.elGameOverModal.classList.remove('hidden');

    const totalItems = Object.values(state.player.items).reduce((a, b) => a + b, 0);
    this.elGameOverStats.innerHTML = `
      <div><strong>Time Survived:</strong> ${Math.floor(state.gameTime)}s</div>
      <div><strong>Tactical Rank Reached:</strong> LV ${state.player.level}</div>
      <div><strong>Enemies Eliminated:</strong> ${state.player.killCount}</div>
      <div><strong>Modules Collected:</strong> ${totalItems}</div>
    `;
  }
}
