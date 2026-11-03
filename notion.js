// Envoi du résumé mensuel vers Notion (API officielle, https://developers.notion.com).
// NOTION_TOKEN   : jeton de l'intégration Notion (reste sur le serveur)
// NOTION_PAGE_ID : page Notion qui accueille la base « Résumé mensuel » (créée au premier envoi).
// Seuls les totaux par mois et par catégorie partent vers Notion, jamais le détail des opérations.
const VERSION = '2022-06-28';
const TITRE = 'Résumé mensuel';

const token = process.env.NOTION_TOKEN;
// Accepte l'identifiant seul ou le lien complet de la page.
const pageId = (process.env.NOTION_PAGE_ID || '').match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Notion accepte environ 3 requêtes par seconde : on les espace de 340 ms.
let prochain = 0;
const tour = () => {
  const t = Math.max(Date.now(), prochain);
  prochain = t + 340;
  return pause(t - Date.now());
};

async function api(method, chemin, body) {
  for (let essai = 0; ; essai++) {
    await tour();
    const res = await fetch('https://api.notion.com/v1' + chemin, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && essai < 4) {
      await pause((Number(res.headers.get('retry-after')) || 1) * 1000);
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion : ${data.message}`);
    return data;
  }
}

// Trouve la base dans la page, ou la crée.
let base;
async function trouverBase() {
  if (!pageId) throw new Error('NOTION_PAGE_ID manquant : indique la page Notion qui accueille le résumé.');
  let curseur;
  do {
    const r = await api('GET', `/blocks/${pageId}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
    const b = r.results.find((x) => x.type === 'child_database' && x.child_database.title === TITRE);
    if (b) return b.id;
    curseur = r.next_cursor;
  } while (curseur);
  const db = await api('POST', '/databases', {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ text: { content: TITRE } }],
    properties: {
      Mois: { title: {} },
      Catégorie: { select: {} },
      Montant: { number: { format: 'euro' } },
      "Nombre d'opérations": { number: {} },
      Budget: { number: { format: 'euro' } },
    },
  });
  return db.id;
}
const getBase = () => (base ??= trouverBase().catch((err) => { base = null; throw err; }));

// Remplace les lignes d'un mois : une par catégorie.
async function envoyerMois(mois, lignes) {
  const id = await getBase();
  const existantes = new Map();
  let curseur;
  do {
    const r = await api('POST', `/databases/${id}/query`, {
      filter: { property: 'Mois', title: { equals: mois } },
      page_size: 100,
      ...(curseur && { start_cursor: curseur }),
    });
    for (const p of r.results) existantes.set(p.properties['Catégorie']?.select?.name, p.id);
    curseur = r.next_cursor;
  } while (curseur);

  for (const l of lignes) {
    const properties = {
      Mois: { title: [{ text: { content: mois } }] },
      Catégorie: { select: { name: l.categorie } },
      Montant: { number: l.montant },
      "Nombre d'opérations": { number: l.nb },
      Budget: { number: l.budget },
    };
    const pid = existantes.get(l.categorie);
    if (pid) await api('PATCH', `/pages/${pid}`, { properties });
    else await api('POST', '/pages', { parent: { database_id: id }, properties });
    existantes.delete(l.categorie);
  }
  // Catégorie qui n'a plus d'opérations ce mois-ci (après une correction) : on retire sa ligne.
  for (const pid of existantes.values()) await api('PATCH', `/pages/${pid}`, { archived: true });
}

// Envoi en tâche de fond. lignesDe(mois) est appelée au moment de l'envoi, avec les données à jour.
const etat = { enCours: false, fait: 0, fin: null, erreur: null };
const enAttente = new Set();
async function synchroniser(listeMois, lignesDe) {
  listeMois.forEach((m) => enAttente.add(m));
  if (etat.enCours) return;
  Object.assign(etat, { enCours: true, fait: 0, erreur: null });
  try {
    while (enAttente.size) {
      const m = [...enAttente].sort()[0];
      enAttente.delete(m);
      await envoyerMois(m, lignesDe(m));
      etat.fait++;
    }
    etat.fin = new Date().toISOString();
  } catch (err) {
    console.error(err);
    etat.erreur = err.message;
    enAttente.clear();
  }
  etat.enCours = false;
}

module.exports = { actif: !!token, etat, synchroniser };
