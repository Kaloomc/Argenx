const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireRevolut, fusionner, normaliser } = require('./csv');
const { CATEGORIES, HORS_DEPENSES, classer } = require('./categories');
const analyses = require('./analyses');
const notion = require('./notion');
const operationsDemo = require('./demo');

const app = express();
app.set('trust proxy', 1); // derrière le proxy inversé du NAS
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Mot de passe (obligatoire pour être joignable depuis le réseau) ----------
// Sans APP_PASSWORD, le serveur n'écoute que sur 127.0.0.1 (cet ordinateur seulement).
// Avec, l'API demande de se connecter une fois ; un cookie garde la session un an.
const MOT_DE_PASSE = process.env.APP_PASSWORD;
const jeton = MOT_DE_PASSE && crypto.createHmac('sha256', MOT_DE_PASSE).update('argenx').digest('hex');
const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/connexion', async (req, res) => {
  if (!MOT_DE_PASSE) return res.json({ ok: true });
  const essai = String(req.body?.motDePasse ?? '');
  if (!egal(crypto.createHmac('sha256', essai).update('argenx').digest('hex'), jeton)) {
    await new Promise((r) => setTimeout(r, 1000)); // freine les essais en série
    return res.status(401).json({ erreur: 'Mot de passe incorrect' });
  }
  res.setHeader('Set-Cookie', `argenx=${jeton}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!MOT_DE_PASSE || req.path === '/etat') return next();
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)argenx=([a-f0-9]+)/)?.[1] || '';
  if (egal(cookie, jeton)) return next();
  res.status(401).json({ erreur: 'Connexion nécessaire' });
});

// --- Données : fichiers JSON dans data/ (ignoré par Git) ----------------------
const DOSSIER = path.join(__dirname, 'data');

function lire(nom) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DOSSIER, nom), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err; // fichier abîmé : on s'arrête plutôt que de l'écraser
  }
}

function ecrire(nom, valeur) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const f = path.join(DOSSIER, nom);
  fs.writeFileSync(f + '.tmp', JSON.stringify(valeur, null, 1));
  fs.renameSync(f + '.tmp', f); // remplacement d'un coup : jamais de fichier à moitié écrit
}

const BUDGETS_DEMO = { Courses: 170, 'Restos & fast-food': 50, Transport: 40, Shopping: 60, Loisirs: 40 };

let operations = lire('operations.json');
const reglages = lire('reglages.json') ?? { regles: [], budgets: {} };
if (!operations) {
  // Premier lancement sans Notion : opérations d'exemple fictives pour voir les graphiques.
  operations = notion.actif ? [] : operationsDemo().map((o) => ({ ...o, demo: true }));
  if (operations.length) reglages.budgets = { ...BUDGETS_DEMO, ...reglages.budgets };
}

// Classe tout ce que l'utilisateur n'a pas corrigé à la main (règles à jour à chaque démarrage).
function reclasser() {
  let changees = 0;
  for (const o of operations) {
    if (o.manuel) continue;
    const c = classer(o, reglages.regles);
    if (c !== o.categorie) changees++;
    o.categorie = c;
  }
  return changees;
}

const sauverOperations = () => ecrire('operations.json', operations);
const sauverReglages = () => ecrire('reglages.json', reglages);
reclasser();
sauverOperations();
sauverReglages();

// --- Outils -----------------------------------------------------------------
const MOIS = /^\d{4}-\d{2}$/;
const erreur = (message) => Object.assign(new Error(message), { status: 400 });
const verifier = (ok, message) => {
  if (!ok) throw erreur(message);
};
const derniersMois = () => [...new Set(operations.map(analyses.moisDe))].sort().reverse();
const moisDemande = (v) => (MOIS.test(v || '') ? v : derniersMois()[0] || new Date().toISOString().slice(0, 7));
// Ce qui part vers Notion : les totaux par catégorie, sans les opérations d'exemple.
const lignesNotion = (mois) => analyses.resumeMois(operations.filter((o) => !o.demo), mois, reglages.budgets).categories;

// --- État --------------------------------------------------------------------
app.get('/api/etat', (req, res) => {
  res.json({
    mode: notion.actif ? 'notion' : 'demo',
    motDePasse: !!MOT_DE_PASSE,
    exemple: operations.some((o) => o.demo),
    notion: notion.etat,
    categories: CATEGORIES,
    depenses: CATEGORIES.filter((c) => !HORS_DEPENSES.includes(c)),
  });
});

// --- Import du CSV Revolut ----------------------------------------------------
// Le navigateur envoie le fichier tel quel (quel que soit son type : Windows annonce parfois un .csv comme Excel).
app.post('/api/import', express.text({ type: () => true, limit: '20mb' }), (req, res) => {
  const lu = lireRevolut(typeof req.body === 'string' ? req.body : '');
  const exempleEfface = lu.operations.length > 0 && operations.some((o) => o.demo);
  if (exempleEfface) operations = operations.filter((o) => !o.demo);
  for (const o of lu.operations) o.categorie = classer(o, reglages.regles);
  const r = fusionner(operations, lu.operations);
  operations = r.operations;
  sauverOperations();
  const mois = [...new Set(r.ajout.map(analyses.moisDe))].sort();
  if (notion.actif && mois.length) notion.synchroniser(mois, lignesNotion);
  res.json({ ajoutees: r.ajout.length, doublons: r.doublons, ignorees: lu.ignorees, exempleEfface, mois: mois.at(-1) || null });
});

app.delete('/api/exemple', (req, res) => {
  operations = operations.filter((o) => !o.demo);
  sauverOperations();
  res.json({ ok: true });
});

// --- Opérations et règles ------------------------------------------------------
app.get('/api/operations', (req, res) => {
  const mois = moisDemande(req.query.mois);
  res.json(operations
    .filter((o) => analyses.moisDe(o) === mois)
    .map(({ id, date, description, montant, categorie, manuel }) => ({ id, date, description, montant, categorie, manuel: !!manuel })));
});

app.patch('/api/operations/:id', (req, res) => {
  const op = operations.find((o) => o.id === req.params.id);
  verifier(op, 'Opération introuvable');
  verifier(CATEGORIES.includes(req.body?.categorie), 'Catégorie inconnue');
  op.categorie = req.body.categorie;
  op.manuel = true;
  sauverOperations();
  res.json({ ok: true });
});

app.get('/api/reglages', (req, res) => {
  res.json(reglages);
});

// Nouvelle règle : s'applique aux opérations passées (sauf celles corrigées à la main) et futures.
app.post('/api/regles', (req, res) => {
  const motCle = String(req.body?.motCle ?? '').trim().slice(0, 60);
  const { categorie } = req.body ?? {};
  verifier(normaliser(motCle).length >= 2, 'Mot-clé trop court');
  verifier(CATEGORIES.includes(categorie), 'Catégorie inconnue');
  reglages.regles = [{ motCle, categorie }, ...reglages.regles.filter((r) => normaliser(r.motCle) !== normaliser(motCle))];
  const changees = reclasser();
  sauverReglages();
  sauverOperations();
  res.json({ changees });
});

app.delete('/api/regles', (req, res) => {
  const motCle = normaliser(req.query.motCle);
  reglages.regles = reglages.regles.filter((r) => normaliser(r.motCle) !== motCle);
  const changees = reclasser();
  sauverReglages();
  sauverOperations();
  res.json({ changees });
});

app.put('/api/budgets', (req, res) => {
  const budgets = req.body?.budgets ?? {};
  verifier(typeof budgets === 'object', 'Budgets invalides');
  const propres = {};
  for (const [c, v] of Object.entries(budgets)) {
    verifier(CATEGORIES.includes(c) && !HORS_DEPENSES.includes(c), `Catégorie inconnue : ${c}`);
    if (v === null || v === '' || v === 0) continue;
    verifier(Number.isFinite(v) && v > 0 && v <= 100000, `Budget invalide pour ${c}`);
    propres[c] = Math.round(v * 100) / 100;
  }
  reglages.budgets = propres;
  sauverReglages();
  res.json(reglages);
});

// --- Tableau de bord et analyses -----------------------------------------------
app.get('/api/tableau', (req, res) => {
  const mois = moisDemande(req.query.mois);
  res.json({
    mois,
    moisDispo: derniersMois(),
    ...analyses.resumeMois(operations, mois, reglages.budgets),
    evolution: analyses.evolution(operations, mois),
    top: analyses.topCommercants(operations, mois),
    comparaison: analyses.comparaison(operations, mois),
    inhabituelles: analyses.inhabituelles(operations, mois),
    abonnements: analyses.abonnements(operations),
  });
});

// --- Notion ----------------------------------------------------------------------
app.post('/api/notion', (req, res) => {
  verifier(notion.actif, 'Notion n’est pas configuré (mode démo).');
  const mois = req.body?.mois;
  verifier(mois === 'tous' || MOIS.test(mois || ''), 'Mois invalide');
  const liste = mois === 'tous' ? [...new Set(operations.filter((o) => !o.demo).map(analyses.moisDe))] : [mois];
  notion.synchroniser(liste, lignesNotion);
  res.json(notion.etat);
});

// --- Erreurs -----------------------------------------------------------------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = status === 413 ? 'Fichier trop gros (20 Mo au maximum).' : status >= 500 ? 'Erreur du serveur' : err.message;
  res.status(status).json({ erreur: message });
});

const PORT = Number(process.env.PORT) || 3012;
const pret = () => console.log(`Argenx sur http://localhost:${PORT} (Notion ${notion.actif ? 'activé' : 'non configuré : mode démo'})`);
if (MOT_DE_PASSE) app.listen(PORT, pret);
else {
  console.warn('APP_PASSWORD manquant : Argenx n’écoute que sur 127.0.0.1, il est injoignable depuis le réseau.');
  app.listen(PORT, '127.0.0.1', pret);
}
