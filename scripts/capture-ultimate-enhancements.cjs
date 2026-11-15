const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173/';
const BRAIN_DIR = 'C:\\Users\\yoggn\\.gemini\\antigravity\\brain\\4542810e-1e49-4a7e-a79b-951bef007a82';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function captureUltimateEnhancements() {
  const port = 9334;

  console.log('Launching headless Chrome...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,720',
    '--mute-audio',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    URL
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(350);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const tabs = await res.json();
        const page = tabs.find(t => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome DevTools');

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function sendCmd(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const listener = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', listener);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.addEventListener('message', listener);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCmd('Page.enable');
    await sendCmd('Runtime.enable');
    await sleep(2500);

    console.log('Starting game run...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const btnEnter = document.getElementById('btn-enter-selection');
          if (btnEnter) btnEnter.click();
          setTimeout(() => {
            const btnStart = document.getElementById('btn-start-run');
            if (btnStart) btnStart.click();
          }, 300);
        })()
      `
    });
    await sleep(2500);

    // Walk forward ('w') for 1.4s to emerge into the open sunlit valley meadow
    console.log('Moving player forward into the open valley...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
          setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
          }, 1400);
        })()
      `
    });
    await sleep(2000);

    // Clean up interaction prompts and obstacles from view
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          sim.state.worldEvents.forEach(e => e.radius = 0);
          sim.state.pods.forEach(pod => pod.radius = 0);
          sim.state.itemDrops = [];
          if (window.__app?.obstacleGroup) {
            window.__app.obstacleGroup.visible = false;
          }
          const promptEl = document.getElementById('interaction-prompt');
          if (promptEl) promptEl.style.display = 'none';
        })()
      `
    });
    await sleep(400);

    // Setup helper to spawn crawler enemies cleanly in the valley around a center point
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.__spawnRingEnemies = function(center, count = 8, radius = 175) {
          const sim = window.__sim;
          const enemies = [];
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2;
            const ex = center.x + Math.cos(ang) * radius;
            const ey = center.y + Math.sin(ang) * radius;
            const elev = sim.state.terrain.getElevation(ex, ey).height;
            enemies.push({
              id: 'ring_victim_' + i,
              type: 'crawler',
              pos: { x: ex, y: ey },
              velocity: { x: 0, y: 0 },
              z: elev,
              groundZ: elev,
              health: 1200,
              maxHealth: 1200,
              speed: 0,
              touchDamage: 0,
              attackCooldown: 99,
              attackCooldownRemaining: 99,
              attackRange: 0,
              isElite: false,
              isBoss: false,
              currencyReward: 10,
              xpReward: 10,
              radius: 20,
              isSpawning: false,
              spawnProgress: 1,
              spawnDuration: 1,
              isAlerted: true,
              wanderDir: { x: 0, y: 0 },
              wanderTimer: 99
            });
          }
          return enemies;
        };
      `
    });

    // ========================================================================
    // 1. CAPTURE ENHANCEMENT A: ORBITAL STRIKE — SINGULARITY (BLACK HOLE)
    // ========================================================================
    console.log('1. Capturing Orbital Strike — Singularity (Black Hole)...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.autoCastPrimary = false;
          p.autoCastSecondary = false;
          p.skillEnhancements = { ultimate: 'singularity' };
          p.equippedSkills.ultimate = {
            ...p.equippedSkills.ultimate,
            name: 'Orbital Strike — Singularity',
            description: 'Gravitational singularity after orbital impact'
          };
          sim.state.orbitalStrikes = [];
          sim.state.itemDrops = [];
          sim.state.enemies = window.__spawnRingEnemies(p.pos, 8, 185);

          p.ultimateCooldownRemaining = 0;
          sim.fireOrbitalJudgment(p.pos);
        })()
      `
    });

    // Wait 650ms (0.40s strikeDelay + 250ms into active singularity formation)
    await sleep(650);
    const shotSingularity = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const singPath = 'scratch/ultimate_singularity.png';
    fs.writeFileSync(singPath, Buffer.from(shotSingularity.data, 'base64'));
    console.log(`Saved ${singPath}`);

    // Wait for singularity to finish
    await sleep(3400);

    // ========================================================================
    // 2. CAPTURE ENHANCEMENT B: ORBITAL STRIKE — CONVERGENCE BARRAGE (5-STRIKE)
    // ========================================================================
    console.log('2. Capturing Orbital Strike — Convergence Barrage (5-Strike)...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.autoCastPrimary = false;
          p.autoCastSecondary = false;
          p.skillEnhancements = { ultimate: 'convergence_barrage' };
          p.equippedSkills.ultimate = {
            ...p.equippedSkills.ultimate,
            name: 'Orbital Strike — Convergence Barrage',
            description: 'Five simultaneous orbital beams converging inward'
          };
          sim.state.orbitalStrikes = [];
          sim.state.itemDrops = [];
          sim.state.enemies = window.__spawnRingEnemies(p.pos, 8, 175);

          p.ultimateCooldownRemaining = 0;
          sim.fireOrbitalJudgment(p.pos);
        })()
      `
    });

    // Wait 620ms (0.40s simultaneous 5-beam impact + 220ms into inward spiral convergence)
    await sleep(620);
    const shotConvergence = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const convPath = 'scratch/ultimate_convergence_barrage.png';
    fs.writeFileSync(convPath, Buffer.from(shotConvergence.data, 'base64'));
    console.log(`Saved ${convPath}`);

    // Wait for convergence to finish
    await sleep(1800);

    // ========================================================================
    // 3. CAPTURE ENHANCEMENT C: ORBITAL STRIKE — CRYOGENIC IMPACT (FREEZING FIELD)
    // ========================================================================
    console.log('3. Capturing Orbital Strike — Cryogenic Impact (Freezing Field)...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.autoCastPrimary = false;
          p.autoCastSecondary = false;
          p.skillEnhancements = { ultimate: 'cryogenic_impact' };
          p.equippedSkills.ultimate = {
            ...p.equippedSkills.ultimate,
            name: 'Orbital Strike — Cryogenic Impact',
            description: 'Freezing field with crystalline ice spikes'
          };
          sim.state.orbitalStrikes = [];
          sim.state.itemDrops = [];
          sim.state.enemies = window.__spawnRingEnemies(p.pos, 8, 165);

          p.ultimateCooldownRemaining = 0;
          sim.fireOrbitalJudgment(p.pos);
        })()
      `
    });

    // Wait 750ms (0.40s strikeDelay + 350ms into active crystalline freezing field)
    await sleep(750);
    const shotCryo = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const cryoPath = 'scratch/ultimate_cryogenic_impact.png';
    fs.writeFileSync(cryoPath, Buffer.from(shotCryo.data, 'base64'));
    console.log(`Saved ${cryoPath}`);

    // Copy screenshots to brain directory
    console.log('Copying screenshots to brain artifact directory...');
    const files = [
      'ultimate_singularity.png',
      'ultimate_convergence_barrage.png',
      'ultimate_cryogenic_impact.png'
    ];
    for (const file of files) {
      const src = path.join('scratch', file);
      const dest = path.join(BRAIN_DIR, file);
      fs.copyFileSync(src, dest);
      console.log(`  -> Copied to ${dest}`);
    }

    console.log('All 3 Ultimate Enhancement screenshots captured and verified successfully!');
  } finally {
    try {
      chrome.kill('SIGINT');
    } catch {}
  }
}

captureUltimateEnhancements().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
