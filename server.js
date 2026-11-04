const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireRevolut, fusionner, normaliser, arrondi } = require('./csv');
const { CATEGORIES, HORS_DEPENSES, classer, contient } = require('./categories');
const analyses = require('./analyses');
const notion = require('./notion');
const operationsDemo = require('./demo');
const enveloppes = require('./enveloppes');
const { versOperation } = require('./banque');

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

// Retour de chez Revolut : sans cookie (sur iPhone, il arrive souvent dans Safari et non dans l'appli installée).
// Protégé par le « state » à usage unique créé au départ ; le code reçu ne sert qu'avec la clé secrète du serveur.
app.get('/api/banque/retour', (req, res, next) => retourBanque(req, res).catch(next));

app.use('/api', (req, res, next) => {
  if (!MOT_DE_PASSE || req.path === '/etat') return next();
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)argenx=([a-f0-9]+)/)?.[1] || '';
  if (egal(cookie, jeton)) return next();
  res.status(401).json({ erreur: 'Connexion nécessaire' });
});

// --- Données : fichiers JSON dans data/ (ignoré par Git) ----------------------
const DOSSIER = process.env.DOSSIER_DONNEES || path.join(__dirname, 'data'); // autre dossier : pour les tests
const banque = require('./banque')(DOSSIER);

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
// Basic-Fit est remboursé par le virement « salle » : il ne compte dans aucune enveloppe (règle supprimable dans ⚙️ Réglages).
const REGLE_SALLE = { motCle: 'Basic-Fit', categorie: 'Ne compte pas' };
const REGLAGES_DEFAUT = () => ({
  version: 2,
  regles: [{ ...REGLE_SALLE }], budgets: {}, budgetMensuel: 400, pasAbonnements: [], sourcesRevenus: [],
  enveloppes: structuredClone(enveloppes.ENVELOPPES_DEFAUT),
  revenusSurs: 460, // revenus fiables par mois (parents 400 €, mère 60 €) : la base du budget
});
const enregistres = lire('reglages.json');
const reglages = { ...REGLAGES_DEFAUT(), ...enregistres };
// Réglages enregistrés avant la version 2 : nouvelles valeurs par défaut, une seule fois, sans écraser ce que tu as changé.
if (enregistres && (enregistres.version ?? 1) < 2) {
  if (reglages.enveloppes.find((e) => e.id === 'fixes')?.parMois === 150) reglages.enveloppes = structuredClone(enveloppes.ENVELOPPES_DEFAUT);
  if (reglages.revenusSurs === 495) reglages.revenusSurs = 460;
  if (!reglages.regles.some((r) => normaliser(r.motCle) === normaliser(REGLE_SALLE.motCle))) reglages.regles.push({ ...REGLE_SALLE });
  reglages.version = 2;
}
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
// Les opérations qui comptent dans les totaux : sans les achats remboursés ni « Ne compte pas »,
// et en dépense nette (avances remboursées à la main déduites, sans compter le remboursement comme une entrée).
const comptees = () => analyses.nettes(operations.filter((o) => !o.rembourse && o.categorie !== 'Ne compte pas'));

// « À rembourser » : montant attendu (true des anciennes données = la dépense entière), et ce qui est déjà revenu.
const attendu = (o) => (o.aRembourser === true ? -o.montant : Number(o.aRembourser) || 0);
const recuPour = (id) => arrondi(operations.reduce((s, o) => s + (o.affectations || []).filter((a) => a.id === id).reduce((t, a) => t + a.montant, 0), 0));
const resteARecuperer = (o) => (o.rembourse ? 0 : Math.max(0, arrondi(attendu(o) - recuPour(o.id))));
const affecte = (o) => arrondi((o.affectations || []).reduce((s, a) => s + a.montant, 0));
// Revenu sûr : la description contient un des mots-clés de ⚙️ Réglages → Revenus sûrs.
const estRevenuSur = (o) => o.montant > 0 && reglages.sourcesRevenus.some((s) => contient(normaliser(o.description), normaliser(s.motCle)));
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
  const remplacees = remplacerSaisies(r.ajout);
  reclasser();
  sauverOperations();
  const mois = [...new Set([...r.ajout, ...remplacees].map(analyses.moisDe))].sort();
  if (notion.actif && mois.length) notion.synchroniser(mois, lignesNotion, coursesNotion);
  res.json({ ajoutees: r.ajout.length, doublons: r.doublons, remplacees: remplacees.length, ignorees: lu.ignorees, exempleEfface, mois: mois.at(-1) || null });
});

// Une dépense saisie à la main est remplacée par la ligne du relevé : même montant, à 3 jours près.
// La ligne du relevé garde la catégorie choisie et la marque « à rembourser ». Renvoie les saisies retirées.
function remplacerSaisies(nouvelles) {
  const retirees = [];
  for (const b of nouvelles) {
    const m = operations.find((o) => o.manuelle && Math.abs(o.montant - b.montant) < 0.005 &&
      Math.abs(Date.parse(o.date.slice(0, 10)) - Date.parse(b.date.slice(0, 10))) <= 3 * 864e5);
    if (!m) continue;
    if (m.manuel) Object.assign(b, { categorie: m.categorie, manuel: true });
    if (m.aRembourser) b.aRembourser = m.aRembourser;
    // Les remboursements déjà rapprochés de la saisie passent sur la vraie ligne.
    for (const o of operations) for (const a of o.affectations || []) if (a.id === m.id) a.id = b.id;
    operations = operations.filter((o) => o !== m);
    retirees.push(m);
  }
  return retirees;
}

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
  Object.assign(reglages, REGLAGES_DEFAUT(), s.reglages);
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
    .map((o) => {
      const { id, date, description, montant, categorie, manuel, manuelle, rembourse } = o;
      const j = rembourse && parId.get(rembourse);
      return {
        id, date, description, montant, categorie, manuel: !!manuel, manuelle: !!manuelle, provisoire: !!o.provisoire,
        enveloppe: reglages.enveloppes.find((e) => e.categories.includes(categorie))?.nom ?? null,
        rembourse: j ? { date: j.date, description: j.description, montant: j.montant } : null,
        // Dépense avancée pour quelqu'un : montant attendu, déjà reçu.
        ...(montant < 0 && { aRembourser: attendu(o), recu: recuPour(id) }),
        // Somme reçue : revenu sûr, ou remboursement de quelles dépenses.
        ...(montant > 0 && {
          revenuSur: estRevenuSur(o),
          affectations: (o.affectations || []).map((a) => ({ montant: a.montant, description: parId.get(a.id)?.description ?? '?' })),
        }),
      };
    }));
});

// Dépenses « à rembourser » pas encore entièrement remboursées (toutes périodes), pour le rapprochement.
app.get('/api/a-rembourser', (req, res) => {
  res.json(operations
    .filter((o) => o.montant < 0 && attendu(o) > 0 && resteARecuperer(o) > 0)
    .map((o) => ({ id: o.id, date: o.date, description: o.description, montant: o.montant, attendu: attendu(o), reste: resteARecuperer(o) })));
});

// Rapprocher une somme reçue (:id) d'une dépense « à rembourser ». montant facultatif : par défaut, tout ce qui peut l'être.
app.post('/api/operations/:id/rapprocher', (req, res) => {
  const recu = operations.find((o) => o.id === req.params.id);
  const dep = operations.find((o) => o.id === req.body?.depense);
  verifier(recu?.montant > 0, 'Ce n’est pas une somme reçue');
  verifier(dep?.montant < 0 && attendu(dep) > 0, 'Cette dépense n’est pas marquée « à rembourser »');
  const max = Math.min(arrondi(recu.montant - affecte(recu)), resteARecuperer(dep));
  const montant = req.body?.montant === undefined ? max : req.body.montant;
  verifier(Number.isFinite(montant) && montant > 0 && montant <= max + 0.005, `Montant possible : jusqu'à ${max.toFixed(2).replace('.', ',')} €`);
  recu.affectations = [...(recu.affectations || []), { id: dep.id, montant: arrondi(montant) }];
  reclasser();
  sauverOperations();
  if (notion.actif) notion.synchroniser([...new Set([analyses.moisDe(recu), analyses.moisDe(dep)])], lignesNotion, coursesNotion);
  res.json({ montant: arrondi(montant), reste: resteARecuperer(dep) });
});

// Annuler les rapprochements d'une somme reçue.
app.delete('/api/operations/:id/rapprocher', (req, res) => {
  const recu = operations.find((o) => o.id === req.params.id);
  verifier(recu, 'Opération introuvable');
  const mois = new Set([analyses.moisDe(recu), ...(recu.affectations || []).map((a) => operations.find((o) => o.id === a.id)).filter(Boolean).map(analyses.moisDe)]);
  delete recu.affectations;
  reclasser();
  sauverOperations();
  if (notion.actif) notion.synchroniser([...mois], lignesNotion, coursesNotion);
  res.json({ ok: true });
});

// Revenus sûrs : mots-clés des virements qui arrivent à coup sûr (parents…). Le reste est « entrée variable ».
app.post('/api/sources-revenus', (req, res) => {
  const motCle = String(req.body?.motCle ?? '').trim().slice(0, 60);
  verifier(normaliser(motCle).length >= 2, 'Mot-clé trop court');
  reglages.sourcesRevenus = [...reglages.sourcesRevenus.filter((s) => normaliser(s.motCle) !== normaliser(motCle)), { motCle }];
  sauverReglages();
  res.json(reglages.sourcesRevenus);
});

app.delete('/api/sources-revenus', (req, res) => {
  const motCle = normaliser(req.query.motCle);
  reglages.sourcesRevenus = reglages.sourcesRevenus.filter((s) => normaliser(s.motCle) !== motCle);
  sauverReglages();
  res.json(reglages.sourcesRevenus);
});

// Ajout rapide d'une dépense (avant que le relevé ne l'apporte). montant en positif.
app.post('/api/operations', (req, res) => {
  const { montant, categorie, date } = req.body ?? {};
  const description = String(req.body?.description ?? '').trim().slice(0, 100);
  verifier(Number.isFinite(montant) && montant > 0 && montant <= 10000, 'Montant invalide');
  verifier(description, 'Indique le commerçant');
  verifier(categorie === undefined || CATEGORIES.includes(categorie), 'Catégorie inconnue');
  verifier(date === undefined || /^\d{4}-\d{2}-\d{2}$/.test(date), 'Date invalide');
  const heure = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  const op = {
    id: 'm-' + crypto.randomUUID(), date: `${date || aujourdhui()} ${heure}`, description, montant: -arrondi(montant),
    solde: null, type: 'card', manuelle: true, ...(categorie && { categorie, manuel: true }),
  };
  operations = [op, ...operations].sort((a, b) => b.date.localeCompare(a.date));
  reclasser();
  sauverOperations();
  if (notion.actif) notion.synchroniser([analyses.moisDe(op)], lignesNotion, coursesNotion);
  res.json({ id: op.id, categorie: op.categorie });
});

// Seule une saisie à la main peut être supprimée (les lignes du relevé reviendraient au prochain import).
app.delete('/api/operations/:id', (req, res) => {
  const op = operations.find((o) => o.id === req.params.id);
  verifier(op?.manuelle, 'Seule une dépense ajoutée à la main peut être supprimée');
  operations = operations.filter((o) => o !== op);
  for (const o of operations) if (o.affectations) o.affectations = o.affectations.filter((a) => a.id !== op.id);
  reclasser();
  sauverOperations();
  if (notion.actif) notion.synchroniser([analyses.moisDe(op)], lignesNotion, coursesNotion);
  res.json({ ok: true });
});

// Commerçants déjà vus (les plus fréquents d'abord), pour l'auto-complétion de l'ajout rapide.
app.get('/api/commercants', (req, res) => {
  const vus = new Map();
  for (const o of operations) { // plus récente d'abord : on garde le libellé et la catégorie les plus récents
    if (o.montant >= 0) continue;
    const k = normaliser(o.description);
    const c = vus.get(k) || { nom: o.description, categorie: o.categorie, fois: 0 };
    c.fois++;
    vus.set(k, c);
  }
  res.json([...vus.values()].sort((a, b) => b.fois - a.fois).slice(0, 300));
});

// Catégorie suggérée pour un commerçant : celle de sa dernière dépense, sinon les règles.
app.get('/api/suggestion', (req, res) => {
  const description = String(req.query.description ?? '').slice(0, 100);
  const k = normaliser(description);
  const deja = k && operations.find((o) => o.montant < 0 && normaliser(o.description) === k);
  res.json({ categorie: deja?.categorie ?? classer({ description, montant: -1, type: 'card' }, reglages.regles) });
});

app.patch('/api/operations/:id', (req, res) => {
  const op = operations.find((o) => o.id === req.params.id);
  verifier(op, 'Opération introuvable');
  if (req.body?.aRembourser !== undefined) {
    // « À rembourser » : avance faite pour quelqu'un, à rapprocher plus tard du virement reçu.
    // true = la dépense entière, un nombre = la part attendue, false = plus rien à récupérer.
    const v = req.body.aRembourser;
    verifier(op.montant < 0, 'Seule une dépense peut être « à rembourser »');
    verifier(typeof v === 'boolean' || (Number.isFinite(v) && v >= 0 && v <= -op.montant + 0.005), 'Montant à récupérer invalide');
    if (v === false || v === 0) delete op.aRembourser;
    else op.aRembourser = v === true ? arrondi(-op.montant) : arrondi(v);
  } else if (req.body?.pasRembourse) {
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

// --- Connexion automatique à Revolut (Enable Banking) -----------------------------------
// data/banque.json : session ouverte chez Enable Banking, comptes suivis, dernière récupération, solde.
const lien = { sessionId: null, comptes: [], validJusqua: null, derniere: null, solde: null, erreur: null, ...lire('banque.json') };
const sauverLien = () => ecrire('banque.json', lien);
const etatsBanque = new Map(); // state → heure limite (15 min), à usage unique
let recuperationEnCours = false;
const adresseRetour = (req) => process.env.ENABLE_BANKING_RETOUR || `${req.protocol}://${req.get('host')}/api/banque/retour`;

app.get('/api/banque', (req, res) => {
  res.json({
    configuree: banque.configuree(), connectee: !!lien.sessionId, retour: adresseRetour(req),
    validJusqua: lien.validJusqua, derniere: lien.derniere, solde: lien.solde, erreur: lien.erreur, enCours: recuperationEnCours,
  });
});

app.post('/api/banque/connexion', async (req, res) => {
  verifier(banque.configuree(), 'Enable Banking n’est pas réglé : il manque ENABLE_BANKING_APP_ID ou le fichier de clé (voir docs/MISE-EN-LIGNE.md).');
  const { url, state } = await banque.demarrer(adresseRetour(req));
  etatsBanque.set(state, Date.now() + 15 * 60e3);
  res.json({ url });
});

async function retourBanque(req, res) {
  const page = (titre, texte) => res.type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Argenx</title>
    <body style="font:18px/1.5 system-ui;padding:24px;max-width:520px;margin:auto;background:#121214;color:#f0efec">
    <h1>${titre}</h1><p>${texte}</p><p><a style="color:#8c9eff" href="/#importer">Retour à Argenx</a></p></body></html>`);
  const { code, state, error } = req.query;
  const limite = etatsBanque.get(state);
  etatsBanque.delete(state);
  if (error || !code) return page('Connexion annulée', 'Revolut n’a pas donné l’accès. Tu peux réessayer depuis Argenx → Importer.');
  if (!limite || limite < Date.now()) return page('Lien expiré', 'Relance « Connecter Revolut » depuis Argenx → Importer.');
  Object.assign(lien, await banque.terminer(String(code)), { erreur: null });
  sauverLien();
  recupererBanque().catch(() => {}); // première récupération tout de suite
  page('Revolut connecté ✔', 'Tes opérations arrivent dans Argenx (quelques secondes). Tu peux fermer cette page.');
}

app.post('/api/banque/recuperer', async (req, res) => {
  verifier(lien.sessionId, 'Revolut n’est pas connecté.');
  const r = await recupererBanque();
  verifier(r, lien.erreur || 'Récupération déjà en cours.');
  res.json(r);
});

// Récupère les opérations des comptes suivis et les range comme un import de CSV
// (doublons écartés, saisies à la main remplacées). Les paiements en attente sont remplacés à chaque fois.
async function recupererBanque() {
  if (!lien.sessionId || !banque.configuree() || recuperationEnCours) return null;
  recuperationEnCours = true;
  try {
    // 10 jours de recouvrement (opérations comptabilisées en retard) ; 90 jours la première fois.
    const depuis = new Date(lien.derniere ? Date.parse(lien.derniere) - 10 * 864e5 : Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const recues = [];
    for (const uid of lien.comptes) recues.push(...(await banque.transactions(uid, depuis)).map(versOperation).filter(Boolean));
    const exemple = recues.length > 0 && operations.some((o) => o.demo);
    operations = operations.filter((o) => !(o.source === 'banque' && o.provisoire) && !(exemple && o.demo));
    // Déjà venues par un CSV : même jour, même montant (et même solde quand les deux le donnent).
    const prises = new Set();
    const neuves = recues.filter((n) => {
      if (operations.some((o) => o.id === n.id)) return true; // doublon exact : fusionner l'écarte
      const csv = operations.find((o) => !o.source && !o.manuelle && !prises.has(o) && o.date.slice(0, 10) === n.date.slice(0, 10) &&
        Math.abs(o.montant - n.montant) < 0.005 && (o.solde == null || n.solde == null || Math.abs(o.solde - n.solde) < 0.005));
      if (!csv) return true;
      prises.add(csv);
      return false;
    });
    const r = fusionner(operations, neuves);
    operations = r.operations;
    const remplacees = remplacerSaisies(r.ajout);
    reclasser();
    sauverOperations();
    const mois = [...new Set([...r.ajout, ...remplacees].filter((o) => !o.provisoire).map(analyses.moisDe))].sort();
    if (notion.actif && mois.length) notion.synchroniser(mois, lignesNotion, coursesNotion);
    lien.solde = await banque.solde(lien.comptes[0]).catch(() => lien.solde);
    Object.assign(lien, { derniere: new Date().toISOString(), erreur: null });
    return { ajoutees: r.ajout.filter((o) => !o.provisoire).length, enAttente: r.ajout.filter((o) => o.provisoire).length, remplacees: remplacees.length, solde: lien.solde };
  } catch (err) {
    console.error('Revolut :', err.message);
    lien.erreur = [401, 403].includes(err.statut) || /expired|consent/i.test(err.message)
      ? 'L’autorisation Revolut a expiré : touche « Connecter Revolut » dans l’onglet Importer.'
      : err.message;
    return null;
  } finally {
    recuperationEnCours = false;
    sauverLien();
  }
}

// --- Accueil : enveloppes ----------------------------------------------------------
app.get('/api/accueil', (req, res) => {
  const vue = req.query.vue === 'mois' ? 'mois' : 'semaine';
  const ops = comptees();
  // Ce mois-ci : revenus sûrs reçus, entrées variables (jamais comptées comme acquises), avances à récupérer.
  const m = enveloppes.periode(aujourdhui(), 'mois');
  const recus = ops.filter((o) => o.categorie === 'Revenus' && o.montant > 0 && o.date.slice(0, 10) >= m.debut && o.date.slice(0, 10) <= m.fin);
  const somme = (l) => arrondi(l.reduce((s, o) => s + o.montant, 0));
  const avances = operations.filter((o) => o.montant < 0 && resteARecuperer(o) > 0);
  res.json({
    ...enveloppes.calculer(ops, reglages.enveloppes, aujourdhui(), vue),
    jusquau: jusquau(),
    revenus: {
      surs: somme(recus.filter(estRevenuSur)),
      attendus: reglages.revenusSurs,
      variables: somme(recus.filter((o) => !estRevenuSur(o))),
      aRecuperer: arrondi(avances.reduce((s, o) => s + resteARecuperer(o), 0)),
      avances: avances.length,
      sourcesConfigurees: reglages.sourcesRevenus.length > 0,
    },
  });
});

// Montants et catégories des enveloppes, plafond Uber Eats, revenus fiables.
app.put('/api/enveloppes', (req, res) => {
  const recues = req.body?.enveloppes;
  const revenusSurs = req.body?.revenusSurs;
  const montant = (v) => Number.isFinite(v) && v >= 0 && v <= 10000;
  verifier(Array.isArray(recues) && montant(revenusSurs), 'Réglages invalides');
  const depenses = CATEGORIES.filter((c) => !HORS_DEPENSES.includes(c));
  const vues = new Set();
  const nouvelles = reglages.enveloppes.map((e) => {
    const r = recues.find((x) => x?.id === e.id);
    verifier(r, `Enveloppe manquante : ${e.nom}`);
    const cle = e.parSemaine !== undefined ? 'parSemaine' : 'parMois';
    verifier(montant(r[cle]), `Montant invalide pour ${e.nom}`);
    verifier(Array.isArray(r.categories) && r.categories.every((c) => depenses.includes(c) && !vues.has(c) && vues.add(c)), `Catégories invalides pour ${e.nom}`);
    const n = { ...e, [cle]: arrondi(r[cle]), categories: r.categories };
    if (e.plafond) {
      verifier(montant(r.plafond?.parMois), `Plafond invalide pour ${e.plafond.nom}`);
      n.plafond = { ...e.plafond, parMois: arrondi(r.plafond.parMois) };
    }
    return n;
  });
  reglages.enveloppes = nouvelles;
  reglages.revenusSurs = arrondi(revenusSurs);
  sauverReglages();
  res.json({ enveloppes: nouvelles, revenusSurs: reglages.revenusSurs, budgetMensuel: enveloppes.budgetMensuel(nouvelles) });
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
  // Revolut : une récupération peu après le démarrage, puis toutes les 6 heures (4 par jour, la limite habituelle sans toi).
  setTimeout(recupererBanque, 15e3);
  setInterval(recupererBanque, 6 * 3600e3);
  if (MOT_DE_PASSE) app.listen(PORT, pret);
  else {
    console.warn('APP_PASSWORD manquant : Argenx n’écoute que sur 127.0.0.1, il est injoignable depuis le réseau.');
    app.listen(PORT, '127.0.0.1', pret);
  }
}
