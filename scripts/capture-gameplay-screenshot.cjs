const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_PATH = path.join(__dirname, '../scratch/ingame_ground_screenshot.png');
const PORT = 9222;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Launching headless Chrome with remote debugging on port', PORT);
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,720',
      '--mute-audio',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      'http://localhost:5173'
    ],
    { stdio: 'ignore' }
  );

  try {
    // Wait for Chrome to open debugging port
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        if (res.ok) {
          targets = await res.json();
          break;
        }
      } catch (e) {}
    }

    if (!targets || targets.length === 0) {
      throw new Error('Failed to connect to Chrome debugging target');
    }

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    console.log('Connecting to page WebSocket:', pageTarget.webSocketDebuggerUrl);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && callbacks.has(data.id)) {
        callbacks.get(data.id)(data);
        callbacks.delete(data.id);
      }
    };

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        callbacks.set(id, (res) => {
          if (res.error) reject(new Error(res.error.message));
          else resolve(res.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    console.log('Waiting for game page to load and initialize Three.js...');
    await sleep(2500);

    console.log('Starting game run (Deploy Vanguard -> Initiate Drop)...');
    await sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          const btnEnter = document.getElementById('btn-enter-selection');
          if (btnEnter) btnEnter.click();
          setTimeout(() => {
            const btnStart = document.getElementById('btn-start-run');
            if (btnStart) btnStart.click();
          }, 300);
        })();
      `
    });

    // Wait for 3D terrain and textures to render
    console.log('Waiting for terrain render loop to settle...');
    await sleep(2000);

    // Walk forward for 1.2s to emerge into the open valley
    console.log('Moving player forward into the open valley...');
    await sendCommand('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }));
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW' }));
        }, 1200);
      `
    });
    await sleep(1800);

    console.log('Capturing in-game gameplay screenshot...');
    const screenshotResult = await sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const buffer = Buffer.from(screenshotResult.data, 'base64');
    fs.writeFileSync(SCREENSHOT_PATH, buffer);
    console.log('Saved screenshot to:', SCREENSHOT_PATH);

    ws.close();
  } finally {
    chromeProcess.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
