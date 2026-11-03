// Calculs du tableau de bord et des analyses. Décrit les dépenses, sans conseil financier.
const { normaliser, arrondi } = require('./csv');
const { CATEGORIES, HORS_DEPENSES } = require('./categories');

const moisDe = (op) => op.date.slice(0, 7);
const estDepense = (op) => !HORS_DEPENSES.includes(op.categorie);
const jours = (a, b) => (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5;
const ajouterJours = (iso, n) => new Date(Date.parse(iso.slice(0, 10)) + n * 864e5).toISOString().slice(0, 10);

// "2026-01" + (-1) → "2025-12"
function decaler(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const mediane = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Totaux d'un mois par catégorie. Montant positif : dépensé (net des remboursements),
// mis de côté pour l'Épargne, reçu pour les Revenus.
function resumeMois(ops, mois, budgets = {}) {
  const parCat = new Map();
  for (const o of ops) {
    if (moisDe(o) !== mois) continue;
    const c = parCat.get(o.categorie) || { montant: 0, nb: 0 };
    c.montant += o.categorie === 'Revenus' ? o.montant : -o.montant;
    c.nb++;
    parCat.set(o.categorie, c);
  }
  const categories = CATEGORIES
    .filter((c) => parCat.has(c) || budgets[c])
    .map((c) => ({ categorie: c, montant: arrondi(parCat.get(c)?.montant ?? 0), nb: parCat.get(c)?.nb ?? 0, budget: budgets[c] ?? null }));
  const total = (filtre) => arrondi(categories.filter(filtre).reduce((s, c) => s + c.montant, 0));
  return {
    categories,
    entrees: total((c) => c.categorie === 'Revenus'),
    sorties: total((c) => !HORS_DEPENSES.includes(c.categorie)),
    epargne: total((c) => c.categorie === 'Épargne'),
  };
}

function evolution(ops, mois, n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const m = decaler(mois, i - n + 1);
    const { entrees, sorties } = resumeMois(ops, m);
    return { mois: m, entrees, sorties };
  });
}

// Plus grosses dépenses par commerçant (sans les virements à des proches ni les retraits).
function topCommercants(ops, mois, n = 10) {
  const parNom = new Map();
  for (const o of ops) {
    if (moisDe(o) !== mois || !estDepense(o) || ['Proches', 'Retraits'].includes(o.categorie)) continue;
    const k = normaliser(o.description);
    const c = parNom.get(k) || { nom: o.description, categorie: o.categorie, montant: 0, nb: 0 };
    c.montant -= o.montant;
    c.nb++;
    parNom.set(k, c);
  }
  return [...parNom.values()]
    .filter((c) => c.montant > 0)
    .sort((a, b) => b.montant - a.montant)
    .slice(0, n)
    .map((c) => ({ ...c, montant: arrondi(c.montant) }));
}

function comparaison(ops, mois) {
  const ce = resumeMois(ops, mois).categories;
  const avant = resumeMois(ops, decaler(mois, -1)).categories;
  const montant = (liste, c) => liste.find((x) => x.categorie === c)?.montant ?? 0;
  return CATEGORIES
    .filter((c) => !HORS_DEPENSES.includes(c))
    .map((c) => ({ categorie: c, ceMois: montant(ce, c), avant: montant(avant, c) }))
    .filter((c) => c.ceMois || c.avant)
    .map((c) => ({ ...c, ecart: arrondi(c.ceMois - c.avant) }))
    .sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));
}

// Dépenses du mois à plus de 3 fois la médiane de leur catégorie (sur tout l'historique,
// à partir de 5 dépenses connues dans la catégorie).
function inhabituelles(ops, mois) {
  const parCat = new Map();
  for (const o of ops) if (o.montant < 0 && estDepense(o)) parCat.set(o.categorie, [...(parCat.get(o.categorie) || []), -o.montant]);
  const medianes = new Map([...parCat].filter(([, xs]) => xs.length >= 5).map(([c, xs]) => [c, mediane(xs)]));
  return ops
    .filter((o) => moisDe(o) === mois && o.montant < 0 && medianes.has(o.categorie) && -o.montant > 3 * medianes.get(o.categorie))
    .map((o) => ({ date: o.date.slice(0, 10), description: o.description, categorie: o.categorie, montant: -o.montant, mediane: arrondi(medianes.get(o.categorie)) }))
    .sort((a, b) => b.montant - a.montant);
}

// Abonnements : même commerçant, montant à ±10 %, tous les 25 à 35 jours, au moins 2 fois.
function abonnements(ops) {
  const groupes = new Map();
  for (const o of ops) {
    if (o.montant >= 0 || !estDepense(o) || o.categorie === 'Retraits') continue;
    const k = normaliser(o.description);
    groupes.set(k, [...(groupes.get(k) || []), o]);
  }
  const derniere = ops.reduce((m, o) => (o.date > m ? o.date : m), '');
  const res = [];
  for (const liste of groupes.values()) {
    liste.sort((a, b) => a.date.localeCompare(b.date));
    // Plus longue suite de paiements réguliers. ponytail: O(n²) par commerçant, suffisant pour quelques milliers d'opérations
    let suite = [];
    for (let i = 0; i < liste.length; i++) {
      const s = [liste[i]];
      for (let j = i + 1; j < liste.length; j++) {
        const ecart = jours(s.at(-1).date, liste[j].date);
        if (ecart > 35) break;
        if (ecart >= 25 && Math.abs(liste[j].montant - s.at(-1).montant) <= 0.1 * Math.abs(s.at(-1).montant)) s.push(liste[j]);
      }
      if (s.length > suite.length) suite = s;
    }
    if (suite.length < 2) continue;
    // Un commerçant où l'on va souvent (supermarché…) tombe parfois sur deux montants proches à un mois d'écart :
    // on écarte le cas où la suite régulière noie dans beaucoup d'autres achats au même endroit.
    const pendant = liste.filter((o) => o.date >= suite[0].date && o.date <= suite.at(-1).date).length;
    if (pendant > suite.length * 1.5) continue;
    const dernier = suite.at(-1);
    const intervalle = Math.round(jours(suite[0].date, dernier.date) / (suite.length - 1));
    res.push({
      cle: normaliser(dernier.description),
      nom: dernier.description,
      categorie: dernier.categorie,
      montant: -dernier.montant,
      fois: suite.length,
      dernier: dernier.date.slice(0, 10),
      prochain: ajouterJours(dernier.date, intervalle),
      coutAnnuel: arrondi(-dernier.montant * 12),
      actif: jours(dernier.date, derniere) <= 40,
    });
  }
  return res.sort((a, b) => b.actif - a.actif || b.coutAnnuel - a.coutAnnuel);
}

// Achats remboursés : une somme reçue (remboursement du commerçant, virement d'un proche…) égale, au centime près,
// à un achat des 30 jours d'avant. Les deux s'annulent : ils ne comptent ni en dépense ni en entrée.
// Renvoie une Map id → id de l'opération jumelle.
function remboursements(ops) {
  const paires = new Map();
  const libre = (o) => !paires.has(o.id) && !o.pasRembourse && o.categorie !== 'Épargne';
  const tri = [...ops].sort((a, b) => a.date.localeCompare(b.date));
  // ponytail: O(n²), suffisant pour quelques milliers d'opérations
  for (const r of tri) {
    if (r.montant <= 0 || r.type === 'topup' || !libre(r)) continue;
    const achats = tri.filter((a) => a.montant < 0 && libre(a) && Math.abs(a.montant + r.montant) < 0.005 && a.date <= r.date && jours(a.date, r.date) <= 30);
    if (!achats.length) continue;
    // Même commerçant d'abord, sinon l'achat le plus récent.
    const a = achats.find((x) => normaliser(x.description) === normaliser(r.description)) || achats.at(-1);
    paires.set(r.id, a.id);
    paires.set(a.id, r.id);
  }
  return paires;
}

// Où en est le budget total du mois. jusquau : date ("2026-11-15") jusqu'où les opérations sont connues.
// Projection : dépensé + (dépenses courantes par jour × jours restants) + abonnements pas encore passés ce mois-ci.
// En début de mois, le rythme constaté sur quelques jours est mélangé avec celui des 3 mois précédents.
function rythme(ops, mois, budget, jusquau, abos) {
  const { sorties } = resumeMois(ops, mois);
  const joursDans = (mm) => { const [a, m] = mm.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
  const nbJours = joursDans(mois);
  const moisConnu = jusquau.slice(0, 7);
  const enCours = moisConnu === mois;
  const ecoules = enCours ? Number(jusquau.slice(8, 10)) : mois < moisConnu ? nbJours : 0;
  const actifs = abos.filter((x) => x.actif);
  const aVenir = enCours
    ? actifs.filter((x) => x.dernier.slice(0, 7) < mois && x.prochain.slice(0, 7) <= mois).sort((x, y) => x.prochain.localeCompare(y.prochain))
    : [];
  const totalAVenir = arrondi(aVenir.reduce((s, x) => s + x.montant, 0));
  // Dépenses courantes d'un mois : sans les abonnements, qui ne se répètent pas dans le mois.
  const cles = new Set(actifs.map((x) => x.cle));
  const courantes = (mm) => resumeMois(ops, mm).sorties -
    ops.filter((o) => moisDe(o) === mm && o.montant < 0 && cles.has(normaliser(o.description))).reduce((s, o) => s - o.montant, 0);
  const connus = new Set(ops.map(moisDe));
  const avant = [1, 2, 3].map((n) => decaler(mois, -n)).filter((mm) => connus.has(mm));
  const habituel = avant.length ? avant.reduce((s, mm) => s + Math.max(0, courantes(mm)) / joursDans(mm), 0) / avant.length : 0;
  const poids = avant.length ? 7 : 0; // l'habitude compte comme 7 jours observés
  const parJourConstate = ecoules + poids ? (Math.max(0, courantes(mois)) + habituel * poids) / (ecoules + poids) : 0;
  const reste = budget ? arrondi(budget - sorties) : null;
  return {
    budget, depense: sorties, reste, enCours, jusquau,
    joursRestants: nbJours - ecoules,
    aVenir: aVenir.map(({ nom, montant, prochain }) => ({ nom, montant, prochain })),
    totalAVenir,
    projection: arrondi(sorties + parJourConstate * (nbJours - ecoules) + totalAVenir),
    parJour: budget && enCours && nbJours > ecoules ? arrondi(Math.max(0, reste - totalAVenir) / (nbJours - ecoules)) : null,
    abonnementsParMois: arrondi(actifs.reduce((s, x) => s + x.montant, 0)),
  };
}

module.exports = { moisDe, decaler, resumeMois, evolution, topCommercants, comparaison, inhabituelles, abonnements, remboursements, rythme };
