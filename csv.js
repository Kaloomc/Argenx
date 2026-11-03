// Lecture des relevés CSV exportés depuis l'appli Revolut (en anglais ou en français).
const crypto = require('crypto');

// Minuscules, sans accents, ponctuation remplacée par des espaces.
// Sert à comparer les noms de colonnes, les types d'opération et les mots-clés.
const normaliser = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const arrondi = (x) => Math.round(x * 100) / 100;

// Découpe un texte CSV en lignes de cellules.
// Gère les cellules entre guillemets (avec virgules, "" ou retours à la ligne dedans).
function lireCsv(texte, sep = ',') {
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') cellule += texte[i++];
      else if (c === '"') guillemets = false;
      else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) {
      ligne.push(cellule);
      cellule = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(cellule);
      lignes.push(ligne);
      ligne = [];
      cellule = '';
    } else cellule += c;
  }
  ligne.push(cellule);
  lignes.push(ligne);
  return lignes.filter((l) => l.some((c) => c.trim()));
}

// Noms de colonnes acceptés (déjà normalisés), export anglais et français.
const COLONNES = {
  type: ['type'],
  produit: ['product', 'produit'],
  debut: ['started date', 'date de debut'],
  fin: ['completed date', 'date de fin'],
  description: ['description'],
  montant: ['amount', 'montant'],
  frais: ['fee', 'fees', 'frais'],
  devise: ['currency', 'devise'],
  etat: ['state', 'etat', 'statut'],
  solde: ['balance', 'solde'],
};

const TERMINE = ['completed', 'termine', 'terminee', 'effectue', 'effectuee'];

// Types d'opération ramenés à un code court. Les autres gardent leur nom normalisé.
const TYPES = {
  card: ['card payment', 'paiement par carte', 'paiement carte'],
  exchange: ['exchange', 'change', 'echange', 'conversion'],
  atm: ['atm', 'retrait', 'retrait d especes', 'distributeur'],
  topup: ['topup', 'top up', 'recharge', 'rechargement'],
  transfer: ['transfer', 'virement'],
  refund: ['refund', 'card refund', 'remboursement', 'remboursement carte'],
};
const codeType = (t) => {
  const n = normaliser(t);
  return Object.keys(TYPES).find((k) => TYPES[k].includes(n)) || n;
};

// Mouvements internes des coffres : le virement côté compte courant suffit.
const PRODUIT_EPARGNE = /savings|epargne|coffre|pocket/;

// "1 234,56" / "-12.50" / "1,234.56" → nombre
function nombre(s) {
  let t = String(s ?? '').replace(/[\s  €]/g, '');
  if (t.includes(',') && t.includes('.')) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else t = t.replace(',', '.');
  const n = Number(t);
  return t && Number.isFinite(n) ? n : null;
}

// "2024-01-15 10:23:45" ou "15/01/2024 10:23" → "2024-01-15 10:23:45"
function dateIso(s) {
  const t = String(s ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} ${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  return null;
}

// Identifiant d'une opération : la même ligne réimportée donne le même identifiant (doublon).
const cle = ({ date, description, montant, solde }) =>
  crypto.createHash('sha1').update([date, normaliser(description), montant.toFixed(2), solde ?? ''].join('|')).digest('hex').slice(0, 16);

const erreur = (message) => Object.assign(new Error(message), { status: 400 });

function lireRevolut(texte) {
  texte = String(texte ?? '').replace(/^﻿/, '');
  const entete = texte.split(/\r?\n/, 1)[0];
  const sep = (entete.match(/;/g) || []).length > (entete.match(/,/g) || []).length ? ';' : ',';
  const [titres = [], ...lignes] = lireCsv(texte, sep);
  if (!titres.length) throw erreur('Le fichier est vide.');

  const noms = titres.map(normaliser);
  const col = Object.fromEntries(Object.entries(COLONNES).map(([k, alias]) => [k, noms.findIndex((n) => alias.includes(n))]));
  if ((col.debut < 0 && col.fin < 0) || col.description < 0 || col.montant < 0) {
    throw erreur(
      `Colonnes non reconnues. Colonnes trouvées : ${titres.map((t) => `« ${t.trim()} »`).join(', ')}. ` +
      'Il faut au moins une date (Started Date ou Date de début), Description et Amount (ou Montant).'
    );
  }

  const ignorees = { nonTerminees: 0, changes: 0, coffres: 0, autreDevise: 0, illisibles: 0 };
  const operations = [];
  for (const l of lignes) {
    const v = (k) => (col[k] >= 0 ? (l[col[k]] ?? '').trim() : '');
    if (col.etat >= 0 && !TERMINE.includes(normaliser(v('etat')))) { ignorees.nonTerminees++; continue; }
    const type = codeType(v('type'));
    if (type === 'exchange') { ignorees.changes++; continue; }
    if (PRODUIT_EPARGNE.test(normaliser(v('produit')))) { ignorees.coffres++; continue; }
    if ((v('devise').toUpperCase() || 'EUR') !== 'EUR') { ignorees.autreDevise++; continue; }
    const date = dateIso(v('debut') || v('fin'));
    const montant = nombre(v('montant'));
    if (!date || montant === null) { ignorees.illisibles++; continue; }
    const op = {
      date,
      description: v('description').slice(0, 200) || '(sans description)',
      montant: arrondi(montant - (nombre(v('frais')) ?? 0)),
      solde: nombre(v('solde')),
      type,
    };
    operations.push({ id: cle(op), ...op });
  }
  return { operations, ignorees };
}

// Ajoute les nouvelles opérations aux anciennes, sans les doublons.
function fusionner(anciennes, nouvelles) {
  const vues = new Set(anciennes.map((o) => o.id));
  const ajout = nouvelles.filter((o) => !vues.has(o.id) && vues.add(o.id));
  return {
    operations: [...anciennes, ...ajout].sort((a, b) => b.date.localeCompare(a.date)),
    ajout,
    doublons: nouvelles.length - ajout.length,
  };
}

module.exports = { lireCsv, lireRevolut, fusionner, normaliser, nombre, dateIso, cle, arrondi };
