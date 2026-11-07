// Calculs du tableau de bord et des analyses. Décrit les dépenses, sans conseil financier.
const { normaliser, arrondi } = require('./csv');
const { CATEGORIES, HORS_DEPENSES, enseigne } = require('./categories');

const moisDe = (op) => op.date.slice(0, 7);
const estDepense = (op) => !HORS_DEPENSES.includes(op.categorie);
const jours = (a, b) => (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5;

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

// Plus grosses dépenses par commerçant (sans les virements à des proches ni les retraits).
function topCommercants(ops, mois, n = 10) {
  const parNom = new Map();
  for (const o of ops) {
    if (moisDe(o) !== mois || !estDepense(o) || ['Proches', 'Retraits'].includes(o.categorie)) continue;
    const { nom, cle: k } = enseigne(o.description);
    const c = parNom.get(k) || { nom, categorie: o.categorie, montant: 0, nb: 0 };
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

// Achats remboursés : une somme reçue (remboursement du commerçant, virement d'un proche…) égale, au centime près,
// à un achat des 30 jours d'avant. Les deux s'annulent : ils ne comptent ni en dépense ni en entrée.
// Renvoie une Map id → id de l'opération jumelle.
function remboursements(ops) {
  const paires = new Map();
  // Un virement déjà rapproché à la main (affectations) n'est pas réutilisé ici.
  const libre = (o) => !paires.has(o.id) && !o.pasRembourse && !o.affectations?.length && !['Épargne', 'Ne compte pas'].includes(o.categorie);
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

// Dépense nette : une avance remboursée (en tout ou en partie) ne compte que pour ce qui reste à ta charge,
// et le virement qui la rembourse ne compte pas comme une entrée. Les virements portent leurs rapprochements :
// affectations = [{ id de la dépense, montant }]. Renvoie des copies, les opérations ne sont pas modifiées.
function nettes(ops) {
  const recu = new Map();
  for (const o of ops) for (const a of o.affectations || []) recu.set(a.id, (recu.get(a.id) || 0) + a.montant);
  return ops
    .map((o) => {
      const delta = (recu.get(o.id) || 0) - (o.affectations || []).reduce((s, a) => s + a.montant, 0);
      return delta ? { ...o, montant: arrondi(o.montant + delta) } : o;
    })
    .filter((o) => o.montant !== 0);
}

// Où en est le budget du mois, calculé sur le mois seulement (aucun mois précédent n'entre dans les chiffres).
// budget : ce qui est disponible à dépenser dans le mois (null si non réglé).
// jusquau : date ("2026-11-15") jusqu'où les opérations sont connues.
// Projection : rythme constaté depuis le début du mois, donnée seulement à partir de 7 jours (avant, trop incertaine).
function rythme(ops, mois, budget, jusquau) {
  const { sorties } = resumeMois(ops, mois);
  const [a, m] = mois.split('-').map(Number);
  const nbJours = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const moisConnu = jusquau.slice(0, 7);
  const enCours = moisConnu === mois;
  const ecoules = enCours ? Number(jusquau.slice(8, 10)) : mois < moisConnu ? nbJours : 0;
  const restants = nbJours - ecoules;
  const reste = budget == null ? null : arrondi(budget - sorties);
  return {
    budget, depense: sorties, reste, enCours, jusquau, nbJours, ecoules,
    joursRestants: restants,
    projection: ecoules >= 7 || !enCours ? arrondi(sorties + (ecoules ? sorties / ecoules : 0) * restants) : null,
    parJour: reste != null && enCours && restants > 0 ? arrondi(Math.max(0, reste) / restants) : null,
  };
}

// Épargne à reconstituer ce mois-ci. objectif : { montant, mois } ou null.
// Remis = ce qui a été mis de côté dans le mois (virements vers un coffre, net des retraits depuis un coffre).
function epargneAReconstituer(ops, mois, objectif) {
  if (!objectif || objectif.mois !== mois || !(objectif.montant > 0)) return null;
  const remis = Math.min(objectif.montant, Math.max(0, resumeMois(ops, mois).epargne));
  return { objectif: objectif.montant, remis: arrondi(remis), restant: arrondi(objectif.montant - remis), atteint: remis >= objectif.montant };
}

// Phrases « à surveiller » (3 au maximum), fondées sur le mois en cours seulement. r : résultat de rythme().
function phrases(categories, r) {
  const euro = (x) => `${Math.round(x)} €`;
  const partMois = r.enCours ? r.ecoules / r.nbJours : 1;
  const sorties = [];
  if (r.reste != null && r.reste < 0) sorties.push({ etat: 'rouge', texte: `Budget du mois dépassé de ${euro(-r.reste)}` });
  for (const c of categories) {
    if (!c.budget) continue;
    const part = c.montant / c.budget;
    if (part > 1) sorties.push({ etat: 'rouge', texte: `${c.categorie} : ${euro(c.montant - c.budget)} au-dessus du budget (${euro(c.budget)})` });
    else if (part >= 0.8) sorties.push({ etat: 'orange', texte: `${c.categorie} : ${Math.round(part * 100)} % du budget, il reste ${euro(c.budget - c.montant)}` });
    else if (r.enCours && part > partMois + 0.15) {
      sorties.push({ etat: 'orange', texte: `${c.categorie} : ${Math.round(part * 100)} % du budget au ${r.ecoules}${r.ecoules === 1 ? 'er' : 'e'} jour du mois` });
    }
  }
  return sorties.sort((x, y) => (y.etat === 'rouge') - (x.etat === 'rouge')).slice(0, 3);
}

// --- Liens avec Repax, par la page Notion commune ----------------------------------
// Ce qu'Argenx range dans la base « Courses payées » pour Repax : les dépenses de courses d'un mois, montants en positif.
const coursesDuMois = (ops, mois) => ops
  .filter((o) => o.categorie === 'Courses' && moisDe(o) === mois)
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((o) => ({ date: o.date.slice(0, 10), libelle: o.description, montant: arrondi(-o.montant) }));

// Courses prévues par Repax, d'après ses bases Notion (lignes { nom de colonne: valeur }) :
// « Liste de courses » (Coût estimé, Acheté) et « Planning des repas » (Date, Restes).
function previsionRepax(courses, planning, jour) {
  const aVenir = planning.filter((p) => p.Date && p.Date >= jour);
  const dates = aVenir.map((p) => p.Date).sort();
  const cout = (l) => arrondi(l.reduce((s, c) => s + (Number(c['Coût estimé']) || 0), 0));
  return {
    du: dates[0] ?? jour,
    au: dates.at(-1) ?? jour,
    total: cout(courses),
    resteAAcheter: cout(courses.filter((c) => !c['Acheté'])),
    repas: aVenir.filter((p) => !p.Restes).length,
  };
}

module.exports = {
  moisDe, resumeMois, topCommercants, remboursements, rythme, epargneAReconstituer, phrases,
  coursesDuMois, previsionRepax, nettes,
};
