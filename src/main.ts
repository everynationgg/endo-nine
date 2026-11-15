import { Simulation } from './sim/Simulation';
import { ThreeApp } from './render/ThreeApp';
import { UIManager, GameSettings } from './ui/UIManager';
import { SoundManager } from './render/SoundManager';
import { NarrativeObserver } from './narrative/NarrativeObserver';
import { DialogueDirector } from './narrative/DialogueDirector';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('game-container') || document.body;
  const soundManager = new SoundManager();
  const uiManager = new UIManager();
  const simulation = new Simulation();

  const app = new ThreeApp(container, simulation, soundManager, uiManager);
  const narrativeObserver = new NarrativeObserver();
  const dialogueDirector = new DialogueDirector(soundManager.voice, {
    onPresentationChanged: (presentation) => uiManager.updateCommsPresentation(presentation),
    onTranscriptChanged: () => uiManager.refreshCommsLogIfOpen()
  });

  app.setNarrativeSystems(narrativeObserver, dialogueDirector);
  (window as any).__app = app;
  (window as any).__sim = simulation;
  (window as any).__ui = uiManager;
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
    soundManager.setMuted(settings.isMuted);
    soundManager.setMasterVolume(settings.masterVolume);
    soundManager.setVoiceVolume(settings.voiceVolume ?? 0.95);
    dialogueDirector.setSubtitlesEnabled(settings.subtitlesEnabled !== false);
    simulation.state.player.autoCastPrimary = settings.autoCastPrimary;
    simulation.state.player.autoCastSecondary = settings.autoCastSecondary;
  };

  uiManager.onSettingsChangedCallback = applySettings;
  uiManager.onExitToMenuCallback = () => {
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
    return `${res.fileName} (${res.triangleCount.toLocaleString()} tris)`;
  };
  uiManager.onQuickLoadSketchupCallback = async (scaleMode) => {
    const res = await app.loadTestMapUrl('/assets/models/Untitled.glb', 'Untitled.glb', scaleMode);
    return `${res.fileName} (${res.triangleCount.toLocaleString()} tris)`;
  };
  uiManager.onClearTestMapCallback = () => {
    app.clearTestMap();
  };

  uiManager.setCallbacks(
    () => {
      // Start run - begin simulation cleanly at 00:00 [VERY EASY]
      window.focus();
      app.startRun();
    },
    () => {
      // Restart run & lock mouse aim
      window.focus();
      app.restartRun();
    }
  );
});
