// Enveloppes : des groupes de catégories, pour ranger la liste des dépenses (modifiables dans Réglages).
// Elles n'ont pas de montant : ce qu'il reste à dépenser se calcule sur le mois (voir resteDuMois dans server.js).
const ENVELOPPES_DEFAUT = [
  { id: 'courses', nom: 'Courses', categories: ['Courses'] },
  { id: 'resto', nom: 'Resto & fast-food', categories: ['Restos & fast-food'] },
  { id: 'libres', nom: 'Achats libres', categories: ['Shopping', 'Loisirs', 'Transport', 'Santé', 'Études', 'Logement', 'Retraits', 'Proches', 'Autres'] },
  { id: 'fixes', nom: 'Abonnements', categories: ['Abonnements'] },
];

const plusJours = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Semaine du lundi au dimanche, ou mois civil, qui contient le jour donné ("2026-11-04").
function periode(jour, vue) {
  if (vue === 'mois') {
    const [a, m] = jour.split('-').map(Number);
    return { debut: jour.slice(0, 8) + '01', fin: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
  }
  const debut = plusJours(jour, -((new Date(jour + 'T12:00:00Z').getUTCDay() + 6) % 7));
  return { debut, fin: plusJours(debut, 6) };
}

module.exports = { ENVELOPPES_DEFAUT, periode };
