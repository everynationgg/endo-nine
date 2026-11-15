const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173/';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function captureOrbitalStrikeScreenshots() {
  const userDataDir = path.resolve('scratch/chrome_profile_' + Date.now());
  const port = 9255;

  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1280,720',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    URL
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
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

    // Click DEPLOY VANGUARD -> INITIATE DROP to enter the game
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const btnEnter = document.getElementById('btn-enter-selection');
          if (btnEnter) btnEnter.click();
          setTimeout(() => {
            const btnStart = document.getElementById('btn-start-run');
            if (btnStart) btnStart.click();
          }, 350);
        })()
      `
    });
    await sleep(2200);

    // Walk Commander south into open plains for 1.8s
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 's', code: 'KeyS' }));
        }, 1800);
      `
    });
    await sleep(2100);

    console.log('1. Casting Orbital Strike to capture Phase 1 Target Lock...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', bubbles: true }));
      `
    });

    // Wait for the very first frame after cast when target lock has spawned (cd ~ 10.9)
    await sendCmd('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const check = () => {
            const cd = window.__sim?.state?.player?.ultimateCooldownRemaining ?? 11;
            if (cd < 10.98 && cd > 10.75) {
              resolve(cd);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      `
    });

    const shotTargetLock = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufTargetLock = Buffer.from(shotTargetLock.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_target_lock.png', bufTargetLock);
    console.log('Saved Phase 1 Target Lock screenshot.');

    // Wait for the first strike to finish and settle
    await sleep(2500);

    console.log('2. Resetting cooldown and casting again for peak Beam Impact screenshot...');
    await sendCmd('Runtime.evaluate', {
      expression: `
        if (window.__sim) {
          window.__sim.state.player.ultimateCooldownRemaining = 0;
        }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', bubbles: true }));
      `
    });

    // Strike impact occurs at strikeDelay = 0.40s. Wait until simulation time is right at peak beam (0.42s - 0.48s elapsed, cd <= 10.58)
    await sendCmd('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const check = () => {
            const cd = window.__sim?.state?.player?.ultimateCooldownRemaining ?? 11;
            if (cd <= 10.56 && cd > 9.8) {
              resolve(cd);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      `
    });

    const shotBeamImpact = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufBeamImpact = Buffer.from(shotBeamImpact.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_beam_impact.png', bufBeamImpact);
    console.log('Saved Phase 2 & 3 Beam Impact screenshot.');

    // Wait until simulation time reaches Phase 4 (Aftermath scorch crater & lava veins, right after beam ends: cd ~ 10.15 - 10.25)
    await sendCmd('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const check = () => {
            const cd = window.__sim?.state?.player?.ultimateCooldownRemaining ?? 11;
            if (cd <= 10.25 && cd > 9.8) {
              resolve(cd);
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
      `
    });

    const shotAftermath = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufAftermath = Buffer.from(shotAftermath.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_aftermath.png', bufAftermath);
    console.log('Saved Phase 4 Aftermath screenshot.');

    // Build side-by-side Target Lock + Ground Aftermath composite image
    const leftImg = await sharp(bufTargetLock).resize(640, 360).toBuffer();
    const rightImg = await sharp(bufAftermath).resize(640, 360).toBuffer();
    await sharp({
      create: {
        width: 1280,
        height: 360,
        channels: 4,
        background: { r: 10, g: 14, b: 22, alpha: 1 }
      }
    })
      .composite([
        { input: leftImg, left: 0, top: 0 },
        { input: rightImg, left: 640, top: 0 }
      ])
      .png()
      .toFile('scratch/orbital_strike_target_and_aftermath.png');

    console.log('Saved all Orbital Strike VFX screenshots to scratch/!');

    const brain = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82';
    ['orbital_strike_beam_impact.png', 'orbital_strike_target_and_aftermath.png', 'orbital_strike_target_lock.png', 'orbital_strike_aftermath.png'].forEach(f => {
      fs.copyFileSync(path.resolve('scratch', f), path.join(brain, f));
    });
    console.log('Copied all screenshots to brain dir!');
    ws.close();
  } finally {
    chrome.kill();
  }
}

captureOrbitalStrikeScreenshots().catch(err => {
  console.error(err);
  process.exit(1);
});
