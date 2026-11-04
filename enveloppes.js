// Enveloppes de dépenses : ce qu'il reste cette semaine (ou ce mois-ci), et si le rythme tient.
// Une enveloppe regroupe des catégories ; elle a un montant par semaine (parSemaine) ou par mois (parMois).
const { normaliser, arrondi } = require('./csv');
const { contient } = require('./categories');

// Réglages de départ (modifiables dans ⚙️ Réglages) : alimentation 400 €/mois, achats libres 60 €, fixes 150 €.
const ENVELOPPES_DEFAUT = [
  { id: 'courses', nom: 'Courses', parSemaine: 42, categories: ['Courses'] },
  {
    id: 'resto', nom: 'Resto & fast-food', parSemaine: 50, categories: ['Restos & fast-food'],
    // Sous-plafond compté dans l'enveloppe resto, sur le mois.
    plafond: { nom: 'Uber Eats', parMois: 26, motsCles: ['uber eats', 'ubereats', 'deliveroo', 'just eat'] },
  },
  { id: 'libres', nom: 'Achats libres', parSemaine: 15, categories: ['Shopping', 'Loisirs', 'Autres', 'Santé', 'Études', 'Retraits', 'Proches'] },
  { id: 'fixes', nom: 'Fixes', parMois: 150, categories: ['Logement', 'Abonnements', 'Transport'] },
];

const SEMAINES_PAR_MOIS = 52 / 12;
const plusJours = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const nbJours = (debut, fin) => Math.round((Date.parse(fin) - Date.parse(debut)) / 864e5) + 1;

// Semaine du lundi au dimanche, ou mois civil, qui contient le jour donné ("2026-11-04").
function periode(jour, vue) {
  if (vue === 'mois') {
    const [a, m] = jour.split('-').map(Number);
    return { debut: jour.slice(0, 8) + '01', fin: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
  }
  const debut = plusJours(jour, -((new Date(jour + 'T12:00:00Z').getUTCDay() + 6) % 7));
  return { debut, fin: plusJours(debut, 6) };
}

// Trois états seulement. Orange : 80 % utilisés, ou nettement plus vite que le temps qui passe.
function etat(depense, budget, ecoule) {
  if (!budget) return depense > 0 ? 'rouge' : 'vert';
  const part = depense / budget;
  if (part > 1) return 'rouge';
  if (part >= 0.8 || part > ecoule + 0.15) return 'orange';
  return 'vert';
}

const pourcent = (x) => `${Math.round(x * 100)} %`;

function alerte(nom, x, ecoule, periodeTexte) {
  if (x.etat === 'rouge') return { etat: 'rouge', texte: `${nom} : dépassé de ${(-x.reste).toFixed(2).replace('.', ',')} €` };
  if (x.etat !== 'orange') return null;
  const part = x.budget ? x.depense / x.budget : 1;
  return part >= 0.8
    ? { etat: 'orange', texte: `${nom} : ${pourcent(part)} utilisés, plus que ${x.reste.toFixed(2).replace('.', ',')} € ${periodeTexte}` }
    : { etat: 'orange', texte: `${nom} : rythme trop rapide (${pourcent(part)} utilisés, ${pourcent(ecoule)} ${periodeTexte === 'ce mois-ci' ? 'du mois' : 'de la semaine'} passés)` };
}

// ops : opérations qui comptent (sans remboursés ni « Ne compte pas »), montants négatifs = dépenses.
function calculer(ops, enveloppes, jour, vue = 'semaine') {
  const p = periode(jour, vue);
  const m = periode(jour, 'mois');
  const ecoulePart = (q) => nbJours(q.debut, jour) / nbJours(q.debut, q.fin);
  const depense = (filtre, q) => arrondi(ops
    .filter((o) => o.date.slice(0, 10) >= q.debut && o.date.slice(0, 10) <= q.fin && filtre(o))
    .reduce((s, o) => s - o.montant, 0));

  const liste = enveloppes.map((e) => {
    // Une enveloppe au mois (les fixes) se lit toujours sur le mois, même dans la vue semaine.
    const mensuelle = !e.parSemaine;
    const q = mensuelle || vue === 'mois' ? m : p;
    const budget = arrondi(mensuelle ? e.parMois : vue === 'mois' ? e.parSemaine * nbJours(m.debut, m.fin) / 7 : e.parSemaine);
    const dep = depense((o) => e.categories.includes(o.categorie), q);
    const r = { id: e.id, nom: e.nom, mensuelle, budget, depense: dep, reste: arrondi(budget - dep), etat: etat(dep, budget, ecoulePart(q)) };
    if (e.plafond) {
      const mots = e.plafond.motsCles.map(normaliser);
      const d = depense((o) => mots.some((x) => contient(normaliser(o.description), x)), m);
      const b = e.plafond.parMois;
      r.plafond = { nom: e.plafond.nom, budget: b, depense: d, reste: arrondi(b - d), etat: d > b ? 'rouge' : b && d >= 0.8 * b ? 'orange' : 'vert' };
    }
    return r;
  });

  const principales = liste.filter((e) => vue === 'mois' || !e.mensuelle);
  const total = (k) => arrondi(principales.reduce((s, e) => s + e[k], 0));
  const joursRestants = nbJours(jour, p.fin);
  const texte = (e) => (e.mensuelle || vue === 'mois' ? 'ce mois-ci' : 'cette semaine');
  const alertes = liste.flatMap((e) => [
    alerte(e.nom, e, ecoulePart(e.mensuelle || vue === 'mois' ? m : p), texte(e)),
    e.plafond && alerte(e.plafond.nom, e.plafond, ecoulePart(m), 'ce mois-ci'),
  ]).filter(Boolean).sort((a, b) => (b.etat === 'rouge') - (a.etat === 'rouge'));

  return {
    vue, jour, ...p, joursRestants,
    budget: total('budget'), depense: total('depense'), reste: total('reste'),
    parJour: arrondi(Math.max(0, total('reste')) / joursRestants),
    enveloppes: liste,
    alertes,
  };
}

// Budget prévu sur un mois moyen (une semaine = 52/12 par mois).
const budgetMensuel = (enveloppes) => arrondi(enveloppes.reduce((s, e) => s + (e.parSemaine ? e.parSemaine * SEMAINES_PAR_MOIS : e.parMois), 0));

module.exports = { ENVELOPPES_DEFAUT, periode, calculer, budgetMensuel };
