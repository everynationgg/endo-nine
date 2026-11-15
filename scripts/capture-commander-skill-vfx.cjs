const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173/';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function captureCommanderSkillVFX() {
  const port = 9333;

  console.log('Launching Chrome...');
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

    // Walk forward ('w') for 1.3s to emerge into the open valley
    console.log('Moving player forward into the open valley...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
          setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
          }, 1300);
        })()
      `
    });
    await sleep(1800);

    // Setup helper to spawn crawler enemies cleanly in the valley
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.__spawnTestEnemy = function(id, pos, health = 800) {
          const sim = window.__sim;
          const elev = sim.state.terrain.getElevation(pos.x, pos.y).height;
          return {
            id: id,
            type: 'crawler',
            pos: { x: pos.x, y: pos.y },
            velocity: { x: 0, y: 0 },
            z: elev,
            groundZ: elev,
            health: health,
            maxHealth: health,
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
          };
        };
      `
    });

    // ========================================================================
    // 1. CAPTURE LMB: GOLD BLASTER BOLT IN FLIGHT + MUZZLE FLASH
    // ========================================================================
    console.log('1. Capturing LMB Gold Blaster Bolt in flight...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.primaryCooldownRemaining = 0;
          p.autoCastPrimary = false;
          p.autoCastSecondary = false;
          sim.state.projectiles = [];

          const targetPos = { x: p.pos.x + 160, y: p.pos.y - 40 };
          sim.state.enemies = [window.__spawnTestEnemy('target_lmb', targetPos, 800)];

          p.facing = 'right';
          sim.firePrimaryPulse(targetPos, p.z + 26);
        })()
      `
    });

    await sleep(130);
    const shotLmb = await sendCmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/commander_lmb_blaster_bolt.png', Buffer.from(shotLmb.data, 'base64'));
    console.log('Saved scratch/commander_lmb_blaster_bolt.png');

    await sleep(600);

    // ========================================================================
    // 2. CAPTURE RMB: TWIN CONVERGING GOLDEN ENERGY SLASHES
    // ========================================================================
    console.log('2. Capturing RMB Twin Converging Slashes...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.secondaryCooldownRemaining = 0;
          sim.state.projectiles = [];

          const center = { x: p.pos.x + 190, y: p.pos.y - 30 };
          sim.state.enemies = [
            window.__spawnTestEnemy('rmb_0', { x: center.x, y: center.y }),
            window.__spawnTestEnemy('rmb_1', { x: center.x - 28, y: center.y - 25 }),
            window.__spawnTestEnemy('rmb_2', { x: center.x - 28, y: center.y + 25 }),
            window.__spawnTestEnemy('rmb_3', { x: center.x + 25, y: center.y - 18 }),
            window.__spawnTestEnemy('rmb_4', { x: center.x + 25, y: center.y + 18 })
          ];

          p.facing = 'right';
          sim.fireExplosiveBomb(center, p.z + 16);
        })()
      `
    });

    await sleep(150);
    const shotRmb = await sendCmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/commander_rmb_twin_slashes.png', Buffer.from(shotRmb.data, 'base64'));
    console.log('Saved scratch/commander_rmb_twin_slashes.png');

    await sleep(600);

    // ========================================================================
    // 3. CAPTURE DASH: KINETIC MOTION STREAKS & COLLISION IMPACT
    // ========================================================================
    console.log('3. Capturing Dash Kinetic Collision Impact...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.__sim;
          const p = sim.state.player;
          p.utilityCooldownRemaining = 0;
          p.isDashing = false;
          p.dashDurationTimer = 0;
          p.dashShockwaveTriggered = false;
          sim.state.projectiles = [];

          const impactPos = { x: p.pos.x + 28, y: p.pos.y - 14 };
          sim.state.enemies = [
            window.__spawnTestEnemy('dash_0', { x: impactPos.x, y: impactPos.y }),
            window.__spawnTestEnemy('dash_1', { x: impactPos.x + 20, y: impactPos.y - 20 }),
            window.__spawnTestEnemy('dash_2', { x: impactPos.x + 20, y: impactPos.y + 20 })
          ];

          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
          setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
          }, 350);
        })()
      `
    });

    // Wait until collision impact triggers (around 120ms)
    await sleep(125);
    const shotDash = await sendCmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/commander_dash_kinetic_impact.png', Buffer.from(shotDash.data, 'base64'));
    console.log('Saved scratch/commander_dash_kinetic_impact.png');

    // Copy all 3 screenshots to the brain artifacts directory
    const brainDir = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82';
    ['commander_lmb_blaster_bolt.png', 'commander_rmb_twin_slashes.png', 'commander_dash_kinetic_impact.png'].forEach(f => {
      fs.copyFileSync(path.resolve('scratch', f), path.join(brainDir, f));
      console.log(`Copied ${f} to artifacts directory!`);
    });

    ws.close();
  } finally {
    chrome.kill();
  }
}

captureCommanderSkillVFX().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
