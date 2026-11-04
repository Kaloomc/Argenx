// Liens avec Notion (API officielle, https://developers.notion.com).
// NOTION_TOKEN   : jeton de l'intégration Notion (reste sur le serveur)
// NOTION_PAGE_ID : page Notion commune à Repax, Agendix et Argenx.
// Argenx y range « Résumé mensuel » (totaux par mois et par catégorie) et « Courses payées »
// (le détail de la seule catégorie Courses, lu par Repax), et y lit les bases de Repax pour la prévision des courses.
// Le détail des autres opérations ne part jamais vers Notion.
const VERSION = '2022-06-28';
const RESUME = 'Résumé mensuel';
const COURSES = 'Courses payées';
const COLONNES = {
  [RESUME]: {
    Mois: { title: {} },
    Catégorie: { select: {} },
    Montant: { number: { format: 'euro' } },
    "Nombre d'opérations": { number: {} },
    Budget: { number: { format: 'euro' } },
  },
  [COURSES]: {
    Libellé: { title: {} },
    Date: { date: {} },
    Montant: { number: { format: 'euro' } },
  },
};

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

// Trouve une base de la page par son titre. Une base d'Argenx est créée si elle manque ;
// une base d'une autre appli (Repax) absente donne null.
async function trouverBase(titre) {
  if (!pageId) throw new Error('NOTION_PAGE_ID manquant : indique la page Notion commune.');
  let curseur;
  do {
    const r = await api('GET', `/blocks/${pageId}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
    const b = r.results.find((x) => x.type === 'child_database' && x.child_database.title === titre);
    if (b) return b.id;
    curseur = r.next_cursor;
  } while (curseur);
  if (!COLONNES[titre]) return null;
  const db = await api('POST', '/databases', {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ text: { content: titre } }],
    properties: COLONNES[titre],
  });
  return db.id;
}
// Identifiants gardés en mémoire ; une base absente ou en erreur sera recherchée de nouveau la fois suivante.
const bases = {};
const getBase = (titre) => (bases[titre] ??= trouverBase(titre).then((id) => {
  if (!id) delete bases[titre];
  return id;
}, (err) => {
  delete bases[titre];
  throw err;
}));

// Toutes les pages d'une base (avec un filtre Notion facultatif).
async function pages(id, filter) {
  const out = [];
  let curseur;
  do {
    const r = await api('POST', `/databases/${id}/query`, { page_size: 100, ...(filter && { filter }), ...(curseur && { start_cursor: curseur }) });
    out.push(...r.results);
    curseur = r.next_cursor;
  } while (curseur);
  return out;
}

const valeur = (p) => ({
  title: () => p.title.map((t) => t.plain_text).join(''),
  rich_text: () => p.rich_text.map((t) => t.plain_text).join(''),
  number: () => p.number,
  select: () => p.select?.name ?? null,
  date: () => p.date?.start ?? null,
  checkbox: () => p.checkbox,
}[p?.type]?.() ?? null);

// Lignes d'une base d'une autre appli (Repax), en { nom de colonne: valeur }. null si la base n'existe pas.
async function lireBase(titre) {
  const id = await getBase(titre);
  if (!id) return null;
  return (await pages(id)).map((p) => Object.fromEntries(Object.entries(p.properties).map(([nom, v]) => [nom, valeur(v)])));
}

// Remplace les lignes d'un mois : une par catégorie.
async function envoyerMois(mois, lignes) {
  const id = await getBase(RESUME);
  const existantes = new Map();
  for (const p of await pages(id, { property: 'Mois', title: { equals: mois } })) {
    existantes.set(p.properties['Catégorie']?.select?.name, p.id);
  }

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

// Met les courses payées d'un mois à jour : garde celles qui y sont déjà, ajoute les nouvelles, retire les autres.
async function envoyerCourses(mois, lignes) {
  const id = await getBase(COURSES);
  const [a, m] = mois.split('-').map(Number);
  const suivant = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10); // 1er du mois suivant
  const cle = (date, libelle, montant) => `${date}|${libelle}|${montant}`;
  const existantes = new Map(); // clé → ids des pages
  const filtre = { and: [
    { property: 'Date', date: { on_or_after: `${mois}-01` } },
    { property: 'Date', date: { before: suivant } },
  ] };
  for (const p of await pages(id, filtre)) {
    const k = cle(valeur(p.properties.Date), valeur(p.properties['Libellé']), valeur(p.properties.Montant));
    existantes.set(k, [...(existantes.get(k) || []), p.id]);
  }
  for (const l of lignes) {
    const deja = existantes.get(cle(l.date, l.libelle, l.montant));
    if (deja?.length) {
      deja.pop();
      continue;
    }
    await api('POST', '/pages', {
      parent: { database_id: id },
      properties: {
        Libellé: { title: [{ text: { content: l.libelle.slice(0, 2000) } }] },
        Date: { date: { start: l.date } },
        Montant: { number: l.montant },
      },
    });
  }
  for (const ids of existantes.values()) for (const pid of ids) await api('PATCH', `/pages/${pid}`, { archived: true });
}

// Rafraîchissement à la demande : oublie les identifiants de bases gardés en mémoire (pour retrouver une base
// recréée ou renommée) puis relit les bases des autres applis. Renvoie { titre: nombre de lignes, ou null si la base est absente }.
// Rien n'est écrit dans Notion ici, et le cache se reconstitue tout seul pendant la lecture.
const BASES_LUES = ['Liste de courses', 'Planning des repas', 'Présence']; // Repax, Repax, Agendix
async function rafraichir() {
  const lignes = {};
  for (const titre of BASES_LUES) {
    delete bases[titre];
    lignes[titre] = (await lireBase(titre))?.length ?? null;
  }
  return lignes;
}

// Envoi en tâche de fond. lignesDe(mois) et coursesDe(mois) sont appelées au moment de l'envoi, avec les données à jour.
const etat = { enCours: false, fait: 0, fin: null, erreur: null };
const enAttente = new Set();
async function synchroniser(listeMois, lignesDe, coursesDe) {
  listeMois.forEach((m) => enAttente.add(m));
  if (etat.enCours) return;
  Object.assign(etat, { enCours: true, fait: 0, erreur: null });
  try {
    while (enAttente.size) {
      const m = [...enAttente].sort()[0];
      enAttente.delete(m);
      await envoyerMois(m, lignesDe(m));
      await envoyerCourses(m, coursesDe(m));
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

module.exports = { actif: !!token, etat, synchroniser, lireBase, rafraichir };
