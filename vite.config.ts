import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_STAGE_IDS = new Set(['stage1']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateStagePayload(config: any): string | null {
  if (!config || typeof config !== 'object') return 'Config must be an object.';
  if (config.schemaVersion !== 1) return 'Unsupported schemaVersion.';
  if (typeof config.stageId !== 'string' || !ALLOWED_STAGE_IDS.has(config.stageId)) {
    return 'Invalid or unsupported stageId.';
  }
  if (!config.profiles || typeof config.profiles !== 'object') {
    return 'Config must contain a profiles object.';
  }
  for (const [profileKey, profile] of Object.entries<any>(config.profiles)) {
    if (!profile || typeof profile !== 'object') return `Invalid profile "${profileKey}".`;
    if (!profile.playerSpawn || !isFiniteNumber(profile.playerSpawn.x) || !isFiniteNumber(profile.playerSpawn.y)) {
      return `Invalid playerSpawn in "${profileKey}".`;
    }
    if (!profile.bossSpawn || !isFiniteNumber(profile.bossSpawn.x) || !isFiniteNumber(profile.bossSpawn.y)) {
      return `Invalid bossSpawn in "${profileKey}".`;
    }
    if (!profile.teleporter || !isFiniteNumber(profile.teleporter.x) || !isFiniteNumber(profile.teleporter.y)) {
      return `Invalid teleporter in "${profileKey}".`;
    }
    for (const listKey of ['worldEvents', 'pods', 'obstacles', 'enemySpawnRegions']) {
      if (profile[listKey] !== undefined && !Array.isArray(profile[listKey])) {
        return `"${listKey}" in "${profileKey}" must be an array.`;
      }
      for (const item of profile[listKey] || []) {
        if (!item || typeof item.id !== 'string' || !item.id.trim()) {
          return `Every entry in "${listKey}" must have a non-empty string id.`;
        }
        if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) {
          return `Entry "${item.id}" in "${listKey}" has invalid coordinates.`;
        }
      }
    }
  }
  return null;
}

function stageConfigDevPlugin(): Plugin {
  return {
    name: 'endo-nine-dev-stage-config',
    apply: 'serve',
    configureServer(server) {
      const stagesDir = path.resolve(process.cwd(), 'public', 'stages');
      const backupsDir = path.join(stagesDir, '.backups');

      server.middlewares.use('/__dev/stage-config', (req, res, next) => {
        const reqUrl = new URL(req.url || '/', 'http://localhost');
        const pathname = reqUrl.pathname;

        const sendJson = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET' && pathname === '/load') {
          const stageId = reqUrl.searchParams.get('stageId') || '';
          if (!ALLOWED_STAGE_IDS.has(stageId)) {
            return sendJson(400, { ok: false, error: 'Unsupported stageId.' });
          }
          const targetPath = path.join(stagesDir, `${stageId}.config.json`);
          if (!fs.existsSync(targetPath)) {
            return sendJson(404, { ok: false, error: 'Stage config file not found.' });
          }
          try {
            const raw = fs.readFileSync(targetPath, 'utf8');
            const parsed = JSON.parse(raw);
            return sendJson(200, { ok: true, config: parsed });
          } catch (err: any) {
            return sendJson(500, { ok: false, error: err?.message || 'Failed to read stage config.' });
          }
        }

        if (req.method === 'POST' && pathname === '/save') {
          let body = '';
          let tooLarge = false;
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) {
              tooLarge = true;
              req.destroy();
            }
          });
          req.on('end', () => {
            if (tooLarge) {
              return sendJson(413, { ok: false, error: 'Payload too large.' });
            }
            try {
              const parsedBody = JSON.parse(body);
              const stageId = parsedBody?.stageId;
              const config = parsedBody?.config;
              if (typeof stageId !== 'string' || !ALLOWED_STAGE_IDS.has(stageId)) {
                return sendJson(400, { ok: false, error: 'Invalid or unsupported stageId.' });
              }
              if (config?.stageId !== stageId) {
                return sendJson(400, { ok: false, error: 'Config stageId mismatch.' });
              }
              const validationErr = validateStagePayload(config);
              if (validationErr) {
                return sendJson(400, { ok: false, error: validationErr });
              }

              fs.mkdirSync(stagesDir, { recursive: true });
              fs.mkdirSync(backupsDir, { recursive: true });

              const targetPath = path.join(stagesDir, `${stageId}.config.json`);
              let backupRelPath: string | null = null;

              if (fs.existsSync(targetPath)) {
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupName = `${stageId}.config.${stamp}.json`;
                const backupPath = path.join(backupsDir, backupName);
                fs.copyFileSync(targetPath, backupPath);
                backupRelPath = `public/stages/.backups/${backupName}`;

                // Keep at most 25 recent backups per stage
                const existing = fs
                  .readdirSync(backupsDir)
                  .filter((f) => f.startsWith(`${stageId}.config.`) && f.endsWith('.json'))
                  .sort();
                while (existing.length > 25) {
                  const oldest = existing.shift();
                  if (oldest) {
                    try {
                      fs.unlinkSync(path.join(backupsDir, oldest));
                    } catch {
                      // Ignore cleanup error
                    }
                  }
                }
              }

              const serialized = JSON.stringify(config, null, 2) + '\n';
              const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
              fs.writeFileSync(tmpPath, serialized, 'utf8');
              fs.renameSync(tmpPath, targetPath);

              return sendJson(200, {
                ok: true,
                path: `public/stages/${stageId}.config.json`,
                backupPath: backupRelPath,
                savedAt: new Date().toISOString()
              });
            } catch (err: any) {
              return sendJson(500, { ok: false, error: err?.message || 'Failed to save stage config.' });
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [stageConfigDevPlugin()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // Skip non-source folders so the dev server doesn't track thousands of test/build files
      ignored: [
        '**/scratch/**',
        '**/dist/**',
        '**/docs/**',
        '**/scripts/**',
        '**/public/stages/.backups/**',
        '**/public/stages/*.tmp'
      ]
    }
  },
  build: {
    target: 'esnext'
  }
});
