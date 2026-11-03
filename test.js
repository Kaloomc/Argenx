// Vérifications rapides : npm test (toutes les données sont fictives)
const test = require('node:test');
const assert = require('node:assert');
const { lireRevolut, fusionner } = require('./csv');
const { classer } = require('./categories');
const { resumeMois, abonnements, inhabituelles } = require('./analyses');
const operationsDemo = require('./demo');

const CSV_EN = [
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
  'CARD_PAYMENT,Current,2026-01-05 12:30:00,2026-01-06 09:00:00,Lidl,-23.40,0.00,EUR,COMPLETED,476.60',
  'CARD_PAYMENT,Current,2026-01-06 20:15:00,2026-01-07 09:00:00,"Restaurant ""Chez Toto"", Paris",-30.00,0.50,EUR,COMPLETED,446.10',
  'CARD_PAYMENT,Current,2026-01-07 10:00:00,,Netflix.com,-13.49,0.00,EUR,PENDING,',
  'EXCHANGE,Current,2026-01-08 10:00:00,2026-01-08 10:00:00,Exchanged to USD,-50.00,0.00,EUR,COMPLETED,396.10',
  'TRANSFER,Current,2026-01-09 10:00:00,2026-01-09 10:00:00,To EUR Savings,-100.00,0.00,EUR,COMPLETED,296.10',
  'TRANSFER,Savings,2026-01-09 10:00:00,2026-01-09 10:00:00,From EUR Current,100.00,0.00,EUR,COMPLETED,100.00',
  'ATM,Current,2026-01-10 10:00:00,2026-01-10 10:00:00,Cash at Distributeur,-40.00,1.00,EUR,COMPLETED,255.10',
  'TOPUP,Current,2026-01-11 10:00:00,2026-01-11 10:00:00,Top-Up by *1234,200.00,0.00,EUR,COMPLETED,455.10',
].join('\r\n');

const CSV_FR = [
  '﻿Type;Produit;Date de début;Date de fin;Description;Montant;Frais;Devise;État;Solde',
  'Paiement par carte;Actuel;05/01/2026 12:30;06/01/2026 09:00;Super U;"-23,40";"0,00";EUR;TERMINÉ;"1 476,60"',
  'Paiement par carte;Actuel;06/01/2026 20:15;07/01/2026 09:00;"Uber Eats; livraison";"-18,90";"0,00";EUR;Terminé;"1 457,70"',
  'Paiement par carte;Actuel;07/01/2026 08:00;;SNCF;"-45,00";"0,00";EUR;EN ATTENTE;',
].join('\n');

test('lecture du CSV Revolut en anglais (guillemets, frais, états, changes, coffres)', () => {
  const { operations, ignorees } = lireRevolut(CSV_EN);
  assert.deepStrictEqual(operations.map((o) => o.description), [
    'Lidl', 'Restaurant "Chez Toto", Paris', 'To EUR Savings', 'Cash at Distributeur', 'Top-Up by *1234',
  ]);
  assert.strictEqual(operations[1].montant, -30.5); // Montant − Frais
  assert.strictEqual(operations[3].montant, -41);
  assert.strictEqual(operations[0].date, '2026-01-05 12:30:00');
  assert.deepStrictEqual(ignorees, { nonTerminees: 1, changes: 1, coffres: 1, autreDevise: 0, illisibles: 0 });
});

test('lecture du CSV Revolut en français (point-virgule, virgule décimale, accents)', () => {
  const { operations, ignorees } = lireRevolut(CSV_FR);
  assert.strictEqual(operations.length, 2);
  assert.deepStrictEqual(operations[0], { ...operations[0], date: '2026-01-05 12:30:00', description: 'Super U', montant: -23.4, solde: 1476.6, type: 'card' });
  assert.strictEqual(operations[1].description, 'Uber Eats; livraison');
  assert.strictEqual(ignorees.nonTerminees, 1);
});

test('colonnes non reconnues : message qui liste les colonnes trouvées', () => {
  assert.throws(() => lireRevolut('Date,Libellé,Débit\n2026-01-01,Lidl,10'), /Colonnes trouvées : « Date », « Libellé », « Débit »/);
});

test('réimport d’une période qui chevauche : pas de doublons', () => {
  const a = lireRevolut(CSV_EN).operations;
  const b = lireRevolut(CSV_EN.split('\r\n').slice(0, 3).join('\n') + '\nCARD_PAYMENT,Current,2026-01-12 10:00:00,,Spotify,-11.12,0,EUR,COMPLETED,444.00').operations;
  const r1 = fusionner([], a);
  const r2 = fusionner(r1.operations, b);
  assert.strictEqual(r2.doublons, 2);
  assert.deepStrictEqual(r2.ajout.map((o) => o.description), ['Spotify']);
  assert.strictEqual(r2.operations.length, a.length + 1);
});

test('classement par règles', () => {
  const cas = [
    [{ description: 'Lidl', montant: -20, type: 'card' }, 'Courses'],
    [{ description: 'SUPER U PARIS 15', montant: -20, type: 'card' }, 'Courses'],
    [{ description: 'Uber Eats', montant: -20, type: 'card' }, 'Restos & fast-food'],
    [{ description: 'Uber *Trip', montant: -12, type: 'card' }, 'Transport'],
    [{ description: "McDonald's", montant: -9, type: 'card' }, 'Restos & fast-food'],
    [{ description: 'Netflix.com', montant: -13.49, type: 'card' }, 'Abonnements'],
    [{ description: 'Amazon Prime', montant: -6.99, type: 'card' }, 'Abonnements'],
    [{ description: 'Amazon', montant: -30, type: 'card' }, 'Shopping'],
    [{ description: 'Amazon', montant: 30, type: 'refund' }, 'Shopping'], // remboursement : vient en déduction
    [{ description: 'Pharmacie du Centre', montant: -8, type: 'card' }, 'Santé'],
    [{ description: 'Cash at Distributeur', montant: -40, type: 'atm' }, 'Retraits'],
    [{ description: 'Top-Up by *1234', montant: 100, type: 'topup' }, 'Revenus'],
    [{ description: 'Payment from Lidl GmbH', montant: 900, type: 'transfer' }, 'Revenus'],
    [{ description: 'To Lea Martin', montant: -20, type: 'transfer' }, 'Proches'],
    [{ description: 'To EUR Savings', montant: -100, type: 'transfer' }, 'Épargne'],
    [{ description: 'Vers Coffre Vacances', montant: -50, type: 'transfer' }, 'Épargne'],
    [{ description: 'Boutique inconnue', montant: -5, type: 'card' }, 'Autres'],
  ];
  for (const [op, attendu] of cas) assert.strictEqual(classer(op), attendu, op.description);
  // Règle de l'utilisateur, prioritaire
  assert.strictEqual(classer({ description: 'To Lea Martin', montant: -400, type: 'transfer' }, [{ motCle: 'lea martin', categorie: 'Logement' }]), 'Logement');
});

test('l’épargne ne compte pas comme une dépense', () => {
  const ops = lireRevolut(CSV_EN).operations.map((o) => ({ ...o, categorie: classer(o) }));
  const r = resumeMois(ops, '2026-01');
  assert.strictEqual(r.epargne, 100);
  assert.strictEqual(r.sorties, 23.4 + 30.5 + 41);
  assert.strictEqual(r.entrees, 200);
});

test('détection des abonnements', () => {
  const op = (date, description, montant, categorie = 'Abonnements') => ({ date: date + ' 10:00:00', description, montant, categorie });
  const ops = [
    op('2026-01-08', 'Netflix.com', -13.49), op('2026-02-08', 'Netflix.com', -13.49), op('2026-03-09', 'Netflix.com', -13.99),
    op('2026-01-15', 'Salle de sport', -30), op('2026-03-15', 'Salle de sport', -30), // 2 mois d'écart : non
    op('2026-01-20', 'Appli X', -5), op('2026-02-20', 'Appli X', -9), // montant trop différent : non
    op('2026-01-25', 'To EUR Savings', -100, 'Épargne'), op('2026-02-25', 'To EUR Savings', -100, 'Épargne'), // épargne : non
  ];
  // Supermarché toutes les semaines : deux montants proches à un mois d'écart ne font pas un abonnement.
  for (let i = 0; i < 12; i++) ops.push(op(`2026-0${1 + Math.floor(i / 4)}-${String(3 + (i % 4) * 7).padStart(2, '0')}`, 'Lidl', -(20 + (i % 3) * 0.5), 'Courses'));
  const a = abonnements(ops);
  assert.deepStrictEqual(a.map((x) => x.nom), ['Netflix.com']);
  assert.strictEqual(a[0].fois, 3);
  assert.strictEqual(a[0].coutAnnuel, 167.88);
  assert.strictEqual(a[0].actif, true);
});

test('données de démo : abonnements et dépense inhabituelle repérés', () => {
  const ops = operationsDemo(new Date(2026, 10, 3)).map((o) => ({ ...o, categorie: classer(o) }));
  const noms = abonnements(ops).map((x) => x.nom);
  for (const n of ['Netflix.com', 'Spotify', 'Free Mobile', 'Basic-Fit']) assert.ok(noms.includes(n), n);
  assert.ok(!noms.some((n) => ['Lidl', 'Cash at Distributeur'].includes(n)), noms.join(', '));
  assert.ok(inhabituelles(ops, '2026-09').some((x) => x.description === 'Darty'));
});
