import { Simulation } from './sim/Simulation';
import { ThreeApp } from './render/ThreeApp';
import { UIManager, GameSettings } from './ui/UIManager';
import { SoundManager } from './render/SoundManager';
import { NarrativeObserver } from './narrative/NarrativeObserver';
import { DialogueDirector } from './narrative/DialogueDirector';
import { loadStageConfigFromServer } from './dev/StageConfig';

window.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('game-container') || document.body;
  const soundManager = new SoundManager();
  const uiManager = new UIManager();
  const stageConfig = await loadStageConfigFromServer('stage1');
  const simulation = new Simulation(undefined, stageConfig);

  const app = new ThreeApp(container, simulation, soundManager, uiManager);
  const narrativeObserver = new NarrativeObserver();
  const dialogueDirector = new DialogueDirector(soundManager.voice, {
    onPresentationChanged: (presentation) => uiManager.updateCommsPresentation(presentation),
    onTranscriptChanged: () => uiManager.refreshCommsLogIfOpen(),
    onObjectiveUnlocked: (lore) => uiManager.showPickupNotification(`★ OBJECTIVE: ${lore.title}`),
    onObjectivesChanged: (objectives) => uiManager.updateQuestTracker(objectives),
    onConversationCompleted: (conversationId) => {
      if (conversationId === 'scene_01_first_steps') {
        simulation.unlockStage1EnemySpawning('opening_dialogue_completed');
      } else if (conversationId === 'event_03a_major_earthquake') {
        dialogueDirector.notifySignal(
          'fourth_enhancement_revelation',
          {
            originStage: simulation.state.stageNumber || 1,
            triggerId: 'fourth_enhancement_revelation',
            facts: {}
          },
          simulation.state
        );
      } else if (conversationId === 'event_05_tower_restoration_refreeze') {
        dialogueDirector.notifySignal(
          'boss_defeated_aftermath',
          {
            originStage: simulation.state.stageNumber || 1,
            triggerId: 'boss_defeated_aftermath',
            facts: {}
          },
          simulation.state
        );
        dialogueDirector.notifySignal(
          'stage_leaving',
          {
            originStage: simulation.state.stageNumber || 1,
            triggerId: 'stage_leaving',
            facts: {}
          },
          simulation.state
        );
      }
    },
    onConversationLeadIn: (conversationId) => {
      if (conversationId === 'event_02_first_earthquake') {
        app.triggerEarthquake('moderate');
      } else if (conversationId === 'event_03a_major_earthquake') {
        app.triggerEarthquake('major');
      }
    }
  });

  app.setNarrativeSystems(narrativeObserver, dialogueDirector);
  simulation.setEssentialDialogueBusyChecker(() =>
    dialogueDirector.isEssentialStage1DepartureDialogueBusy()
  );
  (window as any).__app = app;
  (window as any).__sim = simulation;
  (window as any).__ui = uiManager;
  (window as any).__soundManager = soundManager;
  (window as any).__dialogue = dialogueDirector;
  (window as any).__narrativeObserver = narrativeObserver;
  (window as any).gameApp = app;

  uiManager.setDialogueController({
    getConversationSummaries: () => dialogueDirector.getConversationSummaries(),
    forcePlayConversation: (id, heroOverride) =>
      dialogueDirector.forcePlayConversation(id, simulation.state, heroOverride),
    triggerDevSignal: (triggerId) => {
      dialogueDirector.notifySignal(
        triggerId,
        {
          originStage: simulation.state.stageNumber || 1,
          triggerId,
          facts: { devSimulated: true }
        },
        simulation.state
      );
    },
    forceStop: () => dialogueDirector.forceStop(),
    reloadManifest: (clearBuffers) => dialogueDirector.reloadManifest(clearBuffers),
    resetSavePersistence: () => dialogueDirector.resetSavePersistence(),
    getTranscript: () => dialogueDirector.getTranscript(),
    getUnlockedCodexLore: () => dialogueDirector.getUnlockedCodexLore(),
    getActiveRunObjectives: () => dialogueDirector.getActiveRunObjectives(),
    getPresentationState: () => dialogueDirector.getPresentationState(),
    getDebugInfo: () => dialogueDirector.getDebugInfo(),
    isCustomTestMapActive: () =>
      Boolean((simulation.state.terrain.isCustomTestMap || app.isTestMapActive) && !simulation.state.terrain.allowTestMapNarrative)
  });

  dialogueDirector
    .initialize()
    .then(() => {
      uiManager.refreshDevDialogueTester();
    })
    .catch((err) => {
      console.warn('[Narrative] Dialogue initialization failed:', err);
    });

  document.addEventListener('visibilitychange', () => {
    dialogueDirector.setTabHidden(document.hidden);
  });

  // Apply saved settings across ThreeApp, SoundManager, DialogueDirector and Simulation
  const applySettings = (settings: GameSettings) => {
    app.setInvertCameraPan(settings.invertCameraPan);
    app.setInvertCameraPitch(settings.invertCameraPitch);
    app.setMouseSensitivity(settings.mouseSensitivity);
    if (settings.use3DCommander !== undefined) {
      app.setUse3DCommander(settings.use3DCommander);
    }
    app.setGraphicsQuality(settings.graphicsQuality || 'medium');
    soundManager.setMuted(settings.isMuted);
    soundManager.setMasterVolume(settings.masterVolume);
    soundManager.setVoiceVolume(settings.voiceVolume ?? 0.95);
    dialogueDirector.setSubtitlesEnabled(settings.subtitlesEnabled !== false);
    simulation.state.player.autoCastPrimary = settings.autoCastPrimary;
    simulation.state.player.autoCastSecondary = settings.autoCastSecondary;
  };

  uiManager.onSettingsChangedCallback = applySettings;
  uiManager.onExitToMenuCallback = () => {
    app.resetRegionalFreeze();
    dialogueDirector.endRun('menu');
  };
  applySettings(uiManager.settings);

  uiManager.onHeroSelectedCallback = (heroId) => {
    app.selectHero(heroId);
  };
  app.selectHero(uiManager.selectedHeroId);

  uiManager.onToggleMuteCallback = () => soundManager.toggleMute();
  uiManager.onToggleCameraPanCallback = () => app.toggleInvertCameraPan();
  uiManager.onLoadTestMapCallback = async (file, scaleMode) => {
    const res = await app.loadTestMap(file, scaleMode);
    uiManager.updateActiveMapStatus(res.fileName, true);
    return `${res.fileName} (${res.triangleCount.toLocaleString()} tris)`;
  };
  uiManager.onResetDefaultMapCallback = async () => {
    const res = await app.loadDefaultStage1Map('auto');
    uiManager.updateActiveMapStatus(res.fileName, false);
    return `${res.fileName} (${res.triangleCount.toLocaleString()} tris)`;
  };

  let defaultMapPromise: Promise<void> | null = null;
  const ensureDefaultMapLoaded = (): Promise<void> => {
    if (app.isTestMapActive) return Promise.resolve();
    if (!defaultMapPromise) {
      defaultMapPromise = app
        .loadDefaultStage1Map('auto')
        .then(() => {
          uiManager.updateActiveMapStatus(app.activeMapFileName, false);
        })
        .catch((err) => {
          console.error('[Main] Failed to load default Blenderrr.glb map:', err);
          defaultMapPromise = null;
          uiManager.showPickupNotification(err?.message || 'Failed to load Blenderrr.glb');
          throw err;
        });
    }
    return defaultMapPromise;
  };
  document.getElementById('btn-enter-selection')?.addEventListener('click', () => {
    void ensureDefaultMapLoaded();
  });

  uiManager.setCallbacks(
    async () => {
      await ensureDefaultMapLoaded();
      // Start run - begin simulation cleanly at 00:00 [VERY EASY]
      window.focus();
      app.startRun();
    },
    async () => {
      await ensureDefaultMapLoaded();
      // Restart run & lock mouse aim
      window.focus();
      app.restartRun();
    }
  );

  const devToolkitPromise = import('./dev/DevToolkit')
    .then(({ DevToolkit }) => {
      const devToolkit = new DevToolkit(app, uiManager, ensureDefaultMapLoaded);
      (window as any).__devToolkit = devToolkit;
      return devToolkit;
    })
    .catch((err) => {
      console.warn('[DevToolkit] Failed to initialize developer mode:', err);
      return null;
    });

  uiManager.onOpenDeveloperModeCallback = async () => {
    const devToolkit = await devToolkitPromise;
    await devToolkit?.openDashboard();
  };
});
