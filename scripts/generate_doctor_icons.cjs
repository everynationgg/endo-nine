const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'public', 'assets', 'doctor');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const icons = [
  {
    name: 'skill_medical_pulse.png',
    svg: `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#064e3b"/>
          <stop offset="100%" stop-color="#022c22"/>
        </radialGradient>
        <linearGradient id="needle" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6ee7b7"/>
          <stop offset="100%" stop-color="#10b981"/>
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="16" fill="url(#bg)" stroke="#10b981" stroke-width="3"/>
      <path d="M56 28 h16 v28 h28 v16 h-28 v28 h-16 v-28 h-28 v-16 h28 z" fill="#047857" opacity="0.4"/>
      <polygon points="64,18 72,48 64,44 56,48" fill="#a7f3d0"/>
      <polygon points="38,36 50,62 42,60 36,66" fill="url(#needle)"/>
      <polygon points="90,36 92,66 86,60 78,62" fill="url(#needle)"/>
      <circle cx="64" cy="82" r="14" fill="none" stroke="#34d399" stroke-width="3" stroke-dasharray="4,4"/>
      <circle cx="64" cy="82" r="6" fill="#a7f3d0"/>
    </svg>`
  },
  {
    name: 'skill_sedative_dose.png',
    svg: `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </radialGradient>
        <linearGradient id="fluid" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="50%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#c084fc"/>
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="16" fill="url(#bg2)" stroke="#818cf8" stroke-width="3"/>
      <g transform="rotate(-45 64 64)">
        <rect x="60" y="14" width="8" height="20" rx="2" fill="#94a3b8"/>
        <rect x="52" y="14" width="24" height="4" rx="1" fill="#cbd5e1"/>
        <rect x="54" y="34" width="20" height="54" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="2"/>
        <rect x="57" y="46" width="14" height="38" rx="2" fill="url(#fluid)"/>
        <line x1="54" y1="52" x2="60" y2="52" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="54" y1="62" x2="60" y2="62" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="54" y1="72" x2="60" y2="72" stroke="#ffffff" stroke-width="1.5"/>
        <polygon points="58,88 70,88 64,100" fill="#cbd5e1"/>
        <line x1="64" y1="100" x2="64" y2="120" stroke="#f8fafc" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="64" cy="122" r="3" fill="#38bdf8"/>
      </g>
    </svg>`
  },
  {
    name: 'skill_recovery_field.png',
    svg: `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg3" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#065f46"/>
          <stop offset="100%" stop-color="#022c22"/>
        </radialGradient>
      </defs>
      <rect width="128" height="128" rx="16" fill="url(#bg3)" stroke="#34d399" stroke-width="3"/>
      <circle cx="64" cy="64" r="48" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="6,4" opacity="0.6"/>
      <circle cx="64" cy="64" r="36" fill="none" stroke="#34d399" stroke-width="2.5"/>
      <circle cx="64" cy="64" r="24" fill="#047857" fill-opacity="0.4" stroke="#6ee7b7" stroke-width="2"/>
      <path d="M58 40 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12 z" fill="#ecfdf5" stroke="#10b981" stroke-width="1.5"/>
      <path d="M64 22 L56 30 L72 30 Z" fill="#6ee7b7"/>
      <circle cx="34" cy="44" r="3" fill="#a7f3d0"/>
      <circle cx="94" cy="44" r="3" fill="#a7f3d0"/>
      <circle cx="36" cy="84" r="3" fill="#a7f3d0"/>
      <circle cx="92" cy="84" r="3" fill="#a7f3d0"/>
    </svg>`
  },
  {
    name: 'skill_emergency_protocol.png',
    svg: `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg4" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#064e3b"/>
          <stop offset="70%" stop-color="#022c22"/>
          <stop offset="100%" stop-color="#020617"/>
        </radialGradient>
      </defs>
      <rect width="128" height="128" rx="16" fill="url(#bg4)" stroke="#fbbf24" stroke-width="3"/>
      <polygon points="64,18 102,38 102,90 64,110 26,90 26,38" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="8,4"/>
      <circle cx="64" cy="64" r="32" fill="none" stroke="#10b981" stroke-width="3"/>
      <circle cx="64" cy="64" r="22" fill="#047857" opacity="0.7"/>
      <path d="M57 36 h14 v14 h14 v14 h-14 v14 h-14 v-14 h-14 v-14 h14 z" fill="#fef08a" stroke="#f59e0b" stroke-width="2"/>
      <line x1="64" y1="8" x2="64" y2="18" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
      <line x1="64" y1="110" x2="64" y2="120" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
      <line x1="8" y1="64" x2="18" y2="64" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
      <line x1="110" y1="64" x2="120" y2="64" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  }
];

async function run() {
  for (const ic of icons) {
    const dest = path.join(outDir, ic.name);
    await sharp(Buffer.from(ic.svg)).png().toFile(dest);
    console.log(`Generated: ${ic.name}`);
  }
  console.log('All Doctor skill icons created successfully!');
}

run().catch(console.error);

