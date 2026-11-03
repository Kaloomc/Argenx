const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireRevolut, fusionner, normaliser, arrondi } = require('./csv');
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
// Les autres applis (Repax, Agendix) ne passent pas par ici : tout se partage par la page Notion commune.
const MOT_DE_PASSE = process.env.APP_PASSWORD;
const signer = (s) => crypto.createHmac('sha256', s).update('argenx').digest('hex');
const jeton = MOT_DE_PASSE && signer(MOT_DE_PASSE);
const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/connexion', async (req, res) => {
  if (!MOT_DE_PASSE) return res.json({ ok: true });
  const essai = String(req.body?.motDePasse ?? '');
  if (!egal(signer(essai), jeton)) {
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
const DOSSIER = process.env.DOSSIER_DONNEES || path.join(__dirname, 'data'); // autre dossier : pour les tests

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

const BUDGETS_DEMO = { Courses: 130, 'Restos & fast-food': 50, Transport: 35, Shopping: 50, Loisirs: 30 };

let operations = lire('operations.json');
const reglages = { regles: [], budgets: {}, budgetMensuel: 400, pasAbonnements: [], ...lire('reglages.json') };
if (!operations) {
  // Premier lancement sans Notion : opérations d'exemple fictives pour voir les graphiques.
  operations = notion.actif ? [] : operationsDemo().map((o) => ({ ...o, demo: true }));
  if (operations.length) reglages.budgets = { ...BUDGETS_DEMO, ...reglages.budgets };
}
operations.sort((a, b) => b.date.localeCompare(a.date)); // toujours la plus récente d'abord

// Classe tout ce que l'utilisateur n'a pas corrigé à la main (règles à jour à chaque démarrage),
// puis repère les achats remboursés.
function reclasser() {
  let changees = 0;
  for (const o of operations) {
    if (o.manuel) continue;
    const c = classer(o, reglages.regles);
    if (c !== o.categorie) changees++;
    o.categorie = c;
  }
  const paires = analyses.remboursements(operations);
  for (const o of operations) {
    if (paires.has(o.id)) o.rembourse = paires.get(o.id);
    else delete o.rembourse;
  }
  return changees;
}
// Les opérations qui comptent dans les totaux : sans les achats remboursés ni « Ne compte pas ».
const comptees = () => operations.filter((o) => !o.rembourse && o.categorie !== 'Ne compte pas');
const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // "2026-11-03", heure de Paris (TZ)

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
const reelles = () => comptees().filter((o) => !o.demo);
const lignesNotion = (mois) => analyses.resumeMois(reelles(), mois, reglages.budgets).categories;
// Et le détail de la catégorie Courses, pour Repax (base « Courses payées »).
const coursesNotion = (mois) => analyses.coursesDuMois(reelles(), mois);
// Jusqu'où les opérations sont connues : date de la plus récente (les opérations sont triées, plus récente d'abord).
const jusquau = () => [operations[0]?.date.slice(0, 10) || aujourdhui(), aujourdhui()].sort()[0];

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
  const r = fusionner(operations, lu.operations);
  operations = r.operations;
  reclasser();
  sauverOperations();
  const mois = [...new Set(r.ajout.map(analyses.moisDe))].sort();
  if (notion.actif && mois.length) notion.synchroniser(mois, lignesNotion, coursesNotion);
  res.json({ ajoutees: r.ajout.length, doublons: r.doublons, ignorees: lu.ignorees, exempleEfface, mois: mois.at(-1) || null });
});

app.delete('/api/exemple', (req, res) => {
  operations = operations.filter((o) => !o.demo);
  sauverOperations();
  res.json({ ok: true });
});

// --- Sauvegarde ------------------------------------------------------------------
// Tout ce qui n'est que sur le NAS (opérations, règles, corrections à la main), dans un seul fichier.
app.get('/api/sauvegarde', (req, res) => {
  const reelles = operations.filter((o) => !o.demo);
  res.attachment(`argenx-${aujourdhui()}.json`).json({ argenx: 1, date: aujourdhui(), operations: reelles, reglages });
});

// Restaurer une sauvegarde : remplace toutes les opérations et les réglages.
// Envoyée comme texte brut : elle peut dépasser la limite de 100 ko du JSON habituel.
app.post('/api/restaurer', express.text({ type: () => true, limit: '50mb' }), (req, res) => {
  let s;
  try {
    s = JSON.parse(req.body);
  } catch {
    throw erreur('Ce fichier n’est pas une sauvegarde Argenx.');
  }
  verifier(s?.argenx === 1 && Array.isArray(s.operations) && s.reglages && typeof s.reglages === 'object', 'Ce fichier n’est pas une sauvegarde Argenx.');
  verifier(s.operations.every((o) => o && typeof o.id === 'string' && typeof o.date === 'string' && Number.isFinite(o.montant)), 'Sauvegarde abîmée : opération illisible.');
  operations = s.operations.sort((a, b) => b.date.localeCompare(a.date));
  for (const k of Object.keys(reglages)) delete reglages[k];
  Object.assign(reglages, { regles: [], budgets: {}, budgetMensuel: 400, pasAbonnements: [] }, s.reglages);
  reclasser();
  sauverOperations();
  sauverReglages();
  res.json({ operations: operations.length, date: s.date });
});

// --- Opérations et règles ------------------------------------------------------
app.get('/api/operations', (req, res) => {
  const mois = moisDemande(req.query.mois);
  const parId = new Map(operations.map((o) => [o.id, o]));
  res.json(operations
    .filter((o) => analyses.moisDe(o) === mois)
    .map(({ id, date, description, montant, categorie, manuel, rembourse }) => {
      const j = rembourse && parId.get(rembourse);
      return { id, date, description, montant, categorie, manuel: !!manuel, rembourse: j ? { date: j.date, description: j.description, montant: j.montant } : null };
    }));
});

app.patch('/api/operations/:id', (req, res) => {
  const op = operations.find((o) => o.id === req.params.id);
  verifier(op, 'Opération introuvable');
  if (req.body?.pasRembourse) {
    // « Ce n'est pas un remboursement » : les deux opérations comptent de nouveau normalement.
    const jumelle = operations.find((o) => o.id === op.rembourse);
    for (const o of [op, jumelle]) if (o) o.pasRembourse = true;
  } else {
    verifier(CATEGORIES.includes(req.body?.categorie), 'Catégorie inconnue');
    op.categorie = req.body.categorie;
    op.manuel = true;
  }
  reclasser();
  sauverOperations();
  // Le mois change de totaux (et peut-être de courses payées) : Notion suit.
  if (notion.actif && !op.demo) notion.synchroniser([analyses.moisDe(op)], lignesNotion, coursesNotion);
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
  const mensuel = req.body?.mensuel ?? null;
  verifier(typeof budgets === 'object', 'Budgets invalides');
  verifier(mensuel === null || (Number.isFinite(mensuel) && mensuel >= 0 && mensuel <= 100000), 'Budget du mois invalide');
  const propres = {};
  for (const [c, v] of Object.entries(budgets)) {
    verifier(CATEGORIES.includes(c) && !HORS_DEPENSES.includes(c), `Catégorie inconnue : ${c}`);
    if (v === null || v === '' || v === 0) continue;
    verifier(Number.isFinite(v) && v > 0 && v <= 100000, `Budget invalide pour ${c}`);
    propres[c] = Math.round(v * 100) / 100;
  }
  reglages.budgets = propres;
  reglages.budgetMensuel = mensuel ? Math.round(mensuel * 100) / 100 : null;
  sauverReglages();
  res.json(reglages);
});

// « Pas un abonnement » : ce commerçant ne sera plus proposé comme abonnement (cle = nom normalisé).
app.post('/api/pas-abonnements', (req, res) => {
  const cle = normaliser(req.body?.cle).slice(0, 200);
  const nom = String(req.body?.nom ?? cle).slice(0, 200);
  verifier(cle, 'Abonnement inconnu');
  reglages.pasAbonnements = [...reglages.pasAbonnements.filter((p) => p.cle !== cle), { cle, nom }];
  sauverReglages();
  res.json({ ok: true });
});

app.delete('/api/pas-abonnements', (req, res) => {
  const cle = normaliser(req.query.cle);
  reglages.pasAbonnements = reglages.pasAbonnements.filter((p) => p.cle !== cle);
  sauverReglages();
  res.json({ ok: true });
});

// --- Tableau de bord et analyses -----------------------------------------------
app.get('/api/tableau', (req, res) => {
  const mois = moisDemande(req.query.mois);
  const ops = comptees();
  const abonnements = analyses.abonnements(ops).filter((a) => !reglages.pasAbonnements.some((p) => p.cle === a.cle));
  res.json({
    mois,
    moisDispo: derniersMois(),
    ...analyses.resumeMois(ops, mois, reglages.budgets),
    rythme: analyses.rythme(ops, mois, reglages.budgetMensuel, jusquau(), abonnements),
    rembourses: operations.filter((o) => o.rembourse && o.montant < 0 && analyses.moisDe(o) === mois).length,
    evolution: analyses.evolution(ops, mois),
    top: analyses.topCommercants(ops, mois),
    comparaison: analyses.comparaison(ops, mois),
    inhabituelles: analyses.inhabituelles(ops, mois),
    abonnements,
  });
});

// --- Liens avec Repax, par la page Notion commune ---------------------------------------
// Prévision de Repax (courses à venir), lue dans ses bases Notion. null sans Notion ou sans Repax dans la page.
async function previsionRepax() {
  if (!notion.actif) return null;
  try {
    const [courses, planning] = await Promise.all([notion.lireBase('Liste de courses'), notion.lireBase('Planning des repas')]);
    return courses && planning ? analyses.previsionRepax(courses, planning, aujourdhui()) : null;
  } catch (err) {
    console.error('Repax (Notion) :', err.message);
    return null;
  }
}

// Courses prévues par Repax comparées aux courses déjà payées ce mois-ci. {} si Repax n'est pas dans la page Notion.
app.get('/api/courses-prevues', async (req, res) => {
  const p = await previsionRepax();
  if (!p) return res.json({});
  const mois = aujourdhui().slice(0, 7);
  const depense = analyses.resumeMois(reelles(), mois).categories.find((c) => c.categorie === 'Courses')?.montant ?? 0;
  res.json({
    prevision: { du: p.du, au: p.au, total: p.total, resteAAcheter: p.resteAAcheter, repas: p.repas },
    mois,
    depense,
    finDeMois: arrondi(depense + p.resteAAcheter),
    budget: reglages.budgets.Courses ?? null,
  });
});

// --- Notion ----------------------------------------------------------------------
app.post('/api/notion', (req, res) => {
  verifier(notion.actif, 'Notion n’est pas configuré (mode démo).');
  const mois = req.body?.mois;
  verifier(mois === 'tous' || MOIS.test(mois || ''), 'Mois invalide');
  const liste = mois === 'tous' ? [...new Set(operations.filter((o) => !o.demo).map(analyses.moisDe))] : [mois];
  notion.synchroniser(liste, lignesNotion, coursesNotion);
  res.json(notion.etat);
});

// --- Erreurs -----------------------------------------------------------------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = status === 413 ? 'Fichier trop gros (20 Mo au maximum).' : status >= 500 ? 'Erreur du serveur' : err.message;
  res.status(status).json({ erreur: message });
});

module.exports = app; // pour les tests

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3012;
  const pret = () => console.log(`Argenx sur http://localhost:${PORT} (Notion ${notion.actif ? 'activé' : 'non configuré : mode démo'})`);
  if (MOT_DE_PASSE) app.listen(PORT, pret);
  else {
    console.warn('APP_PASSWORD manquant : Argenx n’écoute que sur 127.0.0.1, il est injoignable depuis le réseau.');
    app.listen(PORT, '127.0.0.1', pret);
  }
}
