#!/usr/bin/env node
// Génère les PNG de l'appli (icônes, apple-touch-icon, favicon) à partir de public/icons/icon.svg et favicon.svg.
// Outil de développement : il n'est pas utilisé par l'appli ni par l'image Docker, et n'ajoute aucune dépendance npm.
// Il pilote un Chrome « headless » déjà installé : variable CHROME, ou Chromium de Playwright, ou chromium/google-chrome du système.
//   node scripts/export-icones.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ICONES = path.join(__dirname, '..', 'public', 'icons');

function chercherChrome() {
  const candidats = [process.env.CHROME];
  const playwright = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(playwright)) {
    for (const d of fs.readdirSync(playwright)) {
      const sous = path.join(playwright, d);
      for (const e of fs.readdirSync(sous)) candidats.push(path.join(sous, e, 'chrome-headless-shell'), path.join(sous, e, 'chrome'));
    }
  }
  candidats.push('/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  const trouve = candidats.find((c) => c && fs.existsSync(c));
  if (!trouve) throw new Error('Aucun Chrome/Chromium trouvé : indique-le avec CHROME=/chemin/vers/chrome');
  return trouve;
}

// rond : coins arrondis et transparents (icône « any »). Sinon carré plein, pour apple-touch-icon et « maskable » (le système pose son masque).
const CIBLES = [
  { fichier: 'icon-512.png', svg: 'icon.svg', taille: 512, rond: true },
  { fichier: 'icon-192.png', svg: 'icon.svg', taille: 192, rond: true },
  { fichier: 'icon-maskable-512.png', svg: 'icon.svg', taille: 512, rond: false },
  { fichier: 'apple-touch-icon.png', svg: 'icon.svg', taille: 180, rond: false },
  { fichier: 'favicon-48.png', svg: 'favicon.svg', taille: 48, rond: false },
];

const chrome = chercherChrome();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'argenx-icones-'));
try {
  for (const c of CIBLES) {
    const svg = fs.readFileSync(path.join(ICONES, c.svg), 'utf8');
    const html = path.join(dossier, c.fichier + '.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
      .i{width:${c.taille}px;height:${c.taille}px;overflow:hidden;${c.rond ? 'border-radius:22%;' : ''}}.i svg{display:block;width:100%;height:100%}</style>
      <div class="i">${svg}</div>`);
    const sortie = path.join(ICONES, c.fichier);
    execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', `--window-size=${c.taille},${c.taille}`, `--screenshot=${sortie}`, 'file://' + html], { stdio: 'ignore' });
    console.log('écrit', path.relative(process.cwd(), sortie));
  }
} finally {
  fs.rmSync(dossier, { recursive: true, force: true });
}
