// Classement des opérations par règles simples (pas d'IA).
const { normaliser } = require('./csv');

const CATEGORIES = [
  'Courses', 'Restos & fast-food', 'Transport', 'Logement', 'Abonnements', 'Shopping', 'Loisirs',
  'Santé', 'Études', 'Proches', 'Retraits', 'Revenus', 'Épargne', 'Autres', 'Ne compte pas',
];
// Catégories qui ne comptent pas comme des dépenses.
// « Ne compte pas » : choisie à la main pour ce qui ne doit apparaître nulle part (virement entre tes comptes…).
const HORS_DEPENSES = ['Revenus', 'Épargne', 'Ne compte pas'];

// Mots-clés du commerçant, comparés en mots entiers, sans accents ni majuscules.
// L'ordre compte : « uber eats » passe avant « uber », « amazon prime » avant « amazon ».
const MOTS_CLES = [
  ['Restos & fast-food', [
    'uber eats', 'ubereats', 'deliveroo', 'just eat', 'mcdonald', 'mcdonalds', 'mcdonald s', 'mc donald', 'mc donalds',
    'burger king', 'kfc', 'quick', 'subway', 'five guys', 'o tacos', 'otacos', 'starbucks', 'dominos', 'domino s',
    'pizza hut', 'brioche doree', 'columbus', 'izly', 'restaurant', 'sushi', 'kebab', 'boulangerie',
  ]],
  ['Abonnements', [
    'netflix', 'spotify', 'deezer', 'disney', 'disney plus', 'canal', 'amazon prime', 'prime video', 'apple com bill',
    'icloud', 'google one', 'youtube premium', 'free mobile', 'sfr', 'orange', 'bouygues', 'sosh', 'red by sfr',
    'chatgpt', 'openai', 'adobe', 'crunchyroll', 'audible', 'notion',
  ]],
  ['Courses', [
    'super u', 'hyper u', 'u express', 'marche u', 'systeme u', 'magasin u', 'lidl', 'carrefour', 'leclerc', 'e leclerc', 'auchan',
    'intermarche', 'monoprix', 'franprix', 'casino', 'aldi', 'picard', 'biocoop', 'naturalia', 'netto', 'spar', 'cora',
    'grand frais', 'g20', 'leader price', 'match', 'colruyt',
  ]],
  ['Transport', [
    'sncf', 'ouigo', 'tgv', 'ratp', 'navigo', 'ilevia', 'uber', 'bolt', 'heetch', 'blablacar', 'flixbus', 'tcl', 'tisseo',
    'lime', 'dott', 'tier', 'total', 'totalenergies', 'esso', 'shell', 'bp', 'avia', 'vinci', 'sanef', 'aprr',
    'indigo', 'transavia', 'easyjet', 'ryanair', 'air france', 'parking',
  ]],
  ['Logement', [
    'loyer', 'crous', 'edf', 'engie', 'veolia', 'ekwateur', 'foncia', 'nexity', 'studapart', 'freebox', 'assurance habitation',
  ]],
  ['Shopping', [
    'amazon', 'amzn', 'fnac', 'darty', 'boulanger', 'zara', 'h m', 'primark', 'uniqlo', 'decathlon', 'ikea', 'action',
    'vinted', 'shein', 'temu', 'aliexpress', 'zalando', 'sephora', 'kiabi', 'celio', 'jules', 'leroy merlin', 'cdiscount',
  ]],
  ['Loisirs', [
    'cinema', 'ugc', 'pathe', 'gaumont', 'mk2', 'steam', 'epic games', 'playstation', 'xbox', 'nintendo', 'ticketmaster',
    'billetreduc', 'bowling', 'basic fit', 'fitness park', 'musee', 'concert', 'bar',
  ]],
  ['Santé', [
    'pharmacie', 'pharma', 'doctolib', 'medecin', 'docteur', 'dentiste', 'hopital', 'opticien', 'mutuelle',
    'laboratoire', 'kine', 'ameli',
  ]],
  ['Études', [
    'universite', 'cvec', 'gibert', 'librairie', 'udemy', 'coursera', 'openclassrooms', 'ecole', 'campus', 'bibliotheque',
    'papeterie', 'bureau vallee', 'cours',
  ]],
  ['Proches', ['lydia', 'paylib', 'wero', 'sumeria']],
  ['Retraits', ['atm', 'cash withdrawal', 'retrait', 'distributeur', 'dab']],
].map(([categorie, mots]) => [categorie, mots.map(normaliser)]);

// Virements vers les coffres, pockets ou arrondis Revolut.
const EPARGNE = ['savings', 'coffre', 'coffres', 'pocket', 'pockets', 'epargne', 'vault', 'vaults', 'round up', 'arrondi', 'arrondis', 'tirelire'];

// « mot » apparaît en mot entier dans le texte normalisé (mots séparés par une seule espace).
const contient = (texte, mot) => mot && ` ${texte} `.includes(` ${mot} `);

// regles : règles de l'utilisateur [{ motCle, categorie }], prioritaires sur tout le reste.
function classer(op, regles = []) {
  const texte = normaliser(op.description);
  const perso = regles.find((r) => contient(texte, normaliser(r.motCle)));
  if (perso) return perso.categorie;
  if (op.type !== 'card' && EPARGNE.some((m) => contient(texte, m))) return 'Épargne';
  if (op.type === 'atm') return 'Retraits';
  if (op.type === 'topup') return 'Revenus';
  // Un remboursement garde la catégorie du commerçant : il vient en déduction de ses dépenses.
  if (op.montant > 0 && op.type !== 'refund') return 'Revenus';
  for (const [categorie, mots] of MOTS_CLES) if (mots.some((m) => contient(texte, m))) return categorie;
  if (op.montant > 0) return 'Revenus';
  return op.type === 'transfer' ? 'Proches' : 'Autres';
}

module.exports = { CATEGORIES, HORS_DEPENSES, classer, contient };
