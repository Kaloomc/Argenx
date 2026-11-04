// Vérifications rapides : npm test (toutes les données sont fictives)
const test = require('node:test');
const assert = require('node:assert');
const { lireRevolut, fusionner, cle } = require('./csv');
const { classer } = require('./categories');
const { resumeMois, abonnements, inhabituelles, remboursements, rythme } = require('./analyses');
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

test('achats remboursés : ils s’annulent', () => {
  const op = (id, date, description, montant, type = 'card') => ({ id, date: date + ' 10:00:00', description, montant, type, categorie: classer({ description, montant, type }) });
  const ops = [
    op('a', '2026-10-06', 'IKEA', -89.99), op('b', '2026-10-09', 'IKEA', 89.99, 'refund'), // remboursé par le magasin
    op('c', '2026-10-20', 'SNCF', -64.5), op('d', '2026-10-22', 'Payment from Maman', 64.5, 'transfer'), // remboursé par un proche
    op('e', '2026-10-01', 'Payment from Papa', 400, 'transfer'), // argent du mois : rien à annuler
    op('f', '2026-10-02', 'Lidl', -30), op('g', '2026-12-01', 'Payment from Lea', 30, 'transfer'), // 2 mois plus tard : non
    op('h', '2026-10-03', 'Top-Up by *1234', 25, 'topup'), op('i', '2026-10-01', 'Amazon', -25), // une recharge n'est pas un remboursement
  ];
  const paires = remboursements(ops);
  assert.deepStrictEqual(Object.fromEntries(paires), { a: 'b', b: 'a', c: 'd', d: 'c' });
  const restantes = ops.filter((o) => !paires.has(o.id));
  const r = resumeMois(restantes, '2026-10');
  assert.strictEqual(r.sorties, 55); // Lidl + Amazon, sans IKEA ni SNCF
  assert.strictEqual(r.entrees, 425); // Papa + recharge, sans le remboursement de Maman
  // « Ce n'est pas un remboursement »
  assert.strictEqual(remboursements(ops.map((o) => (['c', 'd'].includes(o.id) ? { ...o, pasRembourse: true } : o))).has('c'), false);
});

test('budget du mois : reste, rythme et abonnements à venir', () => {
  const op = (date, description, montant, categorie) => ({ date: date + ' 10:00:00', description, montant, categorie });
  const ops = [
    op('2026-10-08', 'Netflix.com', -8, 'Abonnements'), op('2026-11-01', 'Payment from Papa', 400, 'Revenus'),
    op('2026-11-02', 'Lidl', -60, 'Courses'), op('2026-11-10', 'Izly', -40, 'Restos & fast-food'),
    op('2026-09-08', 'Netflix.com', -8, 'Abonnements'),
    op('2026-09-15', 'Lidl', -300, 'Courses'), op('2026-10-15', 'Super U', -310, 'Courses'), // habitude : 10 €/jour
  ];
  const r = rythme(ops, '2026-11', 400, '2026-11-10', abonnements(ops));
  assert.strictEqual(r.depense, 100);
  assert.strictEqual(r.reste, 300);
  assert.strictEqual(r.joursRestants, 20);
  assert.deepStrictEqual(r.aVenir.map((x) => x.nom), ['Netflix.com']); // pas encore passé en novembre
  assert.strictEqual(r.parJour, 14.6); // (300 − 8) / 20
  assert.strictEqual(r.projection, 308); // 100 + 10 €/jour × 20 + 8 (même rythme que d'habitude)
  // Mois terminé
  const fini = rythme(ops, '2026-10', 400, '2026-11-10', abonnements(ops));
  assert.strictEqual(fini.enCours, false);
  assert.strictEqual(fini.projection, 318);
});

test('données de démo : abonnements, remboursements et dépense inhabituelle repérés', () => {
  const ops = operationsDemo(new Date(2026, 10, 3)).map((o) => ({ ...o, categorie: classer(o) }));
  const noms = abonnements(ops).map((x) => x.nom);
  for (const n of ['Netflix.com', 'Spotify', 'Free Mobile']) assert.ok(noms.includes(n), n);
  assert.ok(!noms.some((n) => ['Lidl', 'Cash at Distributeur', 'Payment from Papa'].includes(n)), noms.join(', '));
  assert.strictEqual(remboursements(ops).size, 4);
  assert.ok(inhabituelles(ops, '2026-08').some((x) => x.description === 'Fnac'));
});

test('« Ne compte pas » : jamais dans les dépenses ni les entrées, jamais pris pour un remboursement', () => {
  const op = (id, date, description, montant, categorie) => ({ id, date: date + ' 10:00:00', description, montant, categorie, type: 'transfer' });
  const ops = [
    op('a', '2026-10-02', 'Lidl', -30, 'Courses'),
    op('b', '2026-10-05', 'To Compte Joint', -200, 'Ne compte pas'),
    op('c', '2026-10-06', 'Payment from Compte Joint', 200, 'Ne compte pas'),
  ];
  const r = resumeMois(ops, '2026-10');
  assert.strictEqual(r.sorties, 30);
  assert.strictEqual(r.entrees, 0);
  assert.strictEqual(remboursements(ops).size, 0);
});

test('liens avec Repax par Notion : courses payées et prévision', () => {
  const { coursesDuMois, previsionRepax } = require('./analyses');
  const ops = [
    { date: '2026-10-09 10:00:00', description: 'Super U', montant: -31.1, categorie: 'Courses' },
    { date: '2026-10-02 10:00:00', description: 'Lidl', montant: -23.4, categorie: 'Courses' },
    { date: '2026-10-10 10:00:00', description: 'Netflix.com', montant: -7.99, categorie: 'Abonnements' },
    { date: '2026-11-01 10:00:00', description: 'Monoprix', montant: -5, categorie: 'Courses' },
  ];
  assert.deepStrictEqual(coursesDuMois(ops, '2026-10'), [
    { date: '2026-10-02', libelle: 'Lidl', montant: 23.4 },
    { date: '2026-10-09', libelle: 'Super U', montant: 31.1 },
  ]);

  // Lignes telles que lues dans les bases Notion de Repax.
  const courses = [{ 'Coût estimé': 12.5, Acheté: true }, { 'Coût estimé': 30, Acheté: false }, { 'Coût estimé': null, Acheté: false }];
  const planning = [
    { Date: '2026-11-02', Restes: false }, // passé
    { Date: '2026-11-03', Restes: false }, { Date: '2026-11-04', Restes: true }, { Date: '2026-11-09', Restes: false },
  ];
  assert.deepStrictEqual(previsionRepax(courses, planning, '2026-11-03'), { du: '2026-11-03', au: '2026-11-09', total: 42.5, resteAAcheter: 30, repas: 2 });
  assert.deepStrictEqual(previsionRepax([], [], '2026-11-03'), { du: '2026-11-03', au: '2026-11-03', total: 0, resteAAcheter: 0, repas: 0 });
});

test('accès : mot de passe seulement, plus de clé interne', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { once } = require('events');

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'argenx-test-'));
  Object.assign(process.env, { DOSSIER_DONNEES: dossier, APP_PASSWORD: 'mdp-test', CLE_INTERNE: 'cle-test' });
  delete process.env.NOTION_TOKEN;
  const serveur = require('./server').listen(0);
  await once(serveur, 'listening');
  t.after(() => {
    serveur.close();
    fs.rmSync(dossier, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const get = (chemin, entetes = {}) => fetch(base + chemin, { headers: entetes });

  assert.strictEqual((await get('/api/tableau')).status, 401);
  assert.strictEqual((await get('/api/tableau', { 'X-Cle-Interne': 'cle-test' })).status, 401); // l'ancienne clé n'ouvre plus rien
  const connexion = await fetch(base + '/api/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: 'mdp-test' }) });
  const cookie = connexion.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await get('/api/tableau', { Cookie: cookie })).status, 200);
  assert.strictEqual((await get('/api/courses-reelles?du=2026-10-01&au=2026-10-31', { Cookie: cookie })).status, 404);
  assert.deepStrictEqual(await (await get('/api/courses-prevues', { Cookie: cookie })).json(), {}); // sans Notion : pas de carte

  // Sauvegarde puis restauration : on retrouve les mêmes opérations et réglages.
  const envoyer = (chemin, corps) => fetch(base + chemin, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: corps });
  assert.strictEqual((await envoyer('/api/import', CSV_EN)).status, 200);
  const sauvegarde = await get('/api/sauvegarde', { Cookie: cookie });
  assert.match(sauvegarde.headers.get('content-disposition'), /attachment; filename="?argenx-\d{4}-\d{2}-\d{2}\.json/);
  const texte = await sauvegarde.text();
  const s = JSON.parse(texte);
  assert.ok(s.operations.length > 0 && s.operations.every((o) => !o.demo));
  assert.strictEqual((await envoyer('/api/restaurer', '{"pas":"une sauvegarde"}')).status, 400);
  const r = await (await envoyer('/api/restaurer', texte)).json();
  assert.strictEqual(r.operations, s.operations.length);
  assert.deepStrictEqual(JSON.parse(await (await get('/api/sauvegarde', { Cookie: cookie })).text()).operations, s.operations);
});

test('mots-clés : « Dr Martens » n’est pas une dépense de santé', () => {
  assert.notStrictEqual(classer({ description: 'Dr Martens', montant: -120, type: 'card' }), 'Santé');
  assert.strictEqual(classer({ description: 'Pharmacie du Centre', montant: -8, type: 'card' }), 'Santé');
});

test('enveloppes : reste de la semaine, plafond Uber Eats, états et alertes', () => {
  const { ENVELOPPES_DEFAUT, periode, calculer, budgetMensuel } = require('./enveloppes');
  assert.deepStrictEqual(periode('2026-11-04', 'semaine'), { debut: '2026-11-02', fin: '2026-11-08' }); // mercredi → lundi..dimanche
  assert.deepStrictEqual(periode('2026-11-02', 'semaine'), { debut: '2026-11-02', fin: '2026-11-08' });
  assert.deepStrictEqual(periode('2026-11-08', 'semaine'), { debut: '2026-11-02', fin: '2026-11-08' });
  assert.deepStrictEqual(periode('2026-11-04', 'mois'), { debut: '2026-11-01', fin: '2026-11-30' });

  const op = (date, description, montant, categorie) => ({ date: date + ' 12:00:00', description, montant, categorie });
  const ops = [
    op('2026-11-01', 'Uber Eats', -24, 'Restos & fast-food'), // dimanche : semaine d'avant, mais même mois
    op('2026-11-02', 'Auchan', -20, 'Courses'),
    op('2026-11-03', 'Auchan', -15, 'Courses'),
    op('2026-11-03', 'KFC', -12, 'Restos & fast-food'),
    op('2026-11-03', 'Remboursement Auchan', 5, 'Courses'), // vient en déduction
    op('2026-11-04', 'Zara', -20, 'Shopping'),
    op('2026-11-04', 'Free Mobile', -10, 'Abonnements'),
    op('2026-11-04', 'Payment from Papa', 400, 'Revenus'), // jamais dans une enveloppe
  ];
  const s = calculer(ops, ENVELOPPES_DEFAUT, '2026-11-04', 'semaine');
  const e = Object.fromEntries(s.enveloppes.map((x) => [x.id, x]));
  assert.strictEqual(e.courses.depense, 30);
  assert.strictEqual(e.courses.reste, 12);
  assert.strictEqual(e.courses.etat, 'orange'); // 71 % utilisés après 3 jours sur 7 : trop vite
  assert.strictEqual(e.resto.depense, 12); // l'Uber Eats de dimanche est sur la semaine d'avant
  assert.strictEqual(e.resto.etat, 'vert');
  assert.deepStrictEqual(e.resto.plafond, { nom: 'Uber Eats', budget: 26, depense: 24, reste: 2, etat: 'orange' }); // sur le mois
  assert.strictEqual(e.libres.etat, 'rouge'); // 20 € pour 9 €
  assert.strictEqual(e.fixes.mensuelle, true);
  assert.strictEqual(e.fixes.depense, 10);
  // Le chiffre principal ne compte que les enveloppes de la semaine.
  assert.strictEqual(s.budget, 101);
  assert.strictEqual(s.reste, 101 - 30 - 12 - 20);
  assert.strictEqual(s.joursRestants, 5);
  assert.strictEqual(s.alertes[0].etat, 'rouge');
  assert.ok(s.alertes.some((a) => a.texte.startsWith('Uber Eats : 92 % utilisés')), JSON.stringify(s.alertes));

  const m = calculer(ops, ENVELOPPES_DEFAUT, '2026-11-04', 'mois');
  const em = Object.fromEntries(m.enveloppes.map((x) => [x.id, x]));
  assert.strictEqual(em.courses.budget, 180); // 42 € × 30 jours / 7
  assert.strictEqual(em.resto.depense, 36);
  assert.strictEqual(m.budget, 454.86); // 180 + 214,29 + 38,57 + 22
  assert.strictEqual(budgetMensuel(ENVELOPPES_DEFAUT), 459.67); // 182 + 216,67 + 39 + 22 : tient dans 460 €
});

test('enveloppes : plafond à 0 € sans dépense = pas d’alerte', () => {
  const { ENVELOPPES_DEFAUT, calculer } = require('./enveloppes');
  const config = structuredClone(ENVELOPPES_DEFAUT);
  config[1].plafond.parMois = 0;
  const s = calculer([], config, '2026-11-04', 'semaine');
  assert.strictEqual(s.enveloppes[1].plafond.etat, 'vert');
  assert.deepStrictEqual(s.alertes, []);
  const u = calculer([{ date: '2026-11-03 20:00:00', description: 'Uber Eats', montant: -20, categorie: 'Restos & fast-food' }], config, '2026-11-04', 'semaine');
  assert.strictEqual(u.enveloppes[1].plafond.etat, 'rouge');
});

test('ajout rapide : saisie à la main, « à rembourser », remplacée par la ligne du relevé', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { once } = require('events');
  if (!process.env.DOSSIER_DONNEES) {
    Object.assign(process.env, { DOSSIER_DONNEES: fs.mkdtempSync(path.join(os.tmpdir(), 'argenx-test-')), APP_PASSWORD: 'mdp-test' });
    delete process.env.NOTION_TOKEN;
  }
  const serveur = require('./server').listen(0); // même serveur que le test d'accès s'il a déjà tourné
  await once(serveur, 'listening');
  t.after(() => {
    serveur.close();
    fs.rmSync(process.env.DOSSIER_DONNEES, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const connexion = await fetch(base + '/api/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: process.env.APP_PASSWORD }) });
  const Cookie = connexion.headers.get('set-cookie').split(';')[0];
  const appel = async (methode, chemin, corps, type = 'application/json') => {
    const r = await fetch(base + chemin, { method: methode, headers: { Cookie, 'Content-Type': type }, body: corps && (type === 'application/json' ? JSON.stringify(corps) : corps) });
    return { status: r.status, json: await r.json() };
  };

  // Catégorie suggérée : règles pour un commerçant inconnu.
  assert.strictEqual((await appel('GET', '/api/suggestion?description=Auchan')).json.categorie, 'Courses');
  assert.strictEqual((await appel('POST', '/api/operations', { montant: 0, description: 'Auchan' })).status, 400);
  assert.strictEqual((await appel('POST', '/api/operations', { montant: 12, description: '' })).status, 400);

  // Saisie d'un kebab payé pour un ami, catégorie choisie à la main.
  const ajout = await appel('POST', '/api/operations', { montant: 18.5, description: 'Gur Kebab', categorie: 'Restos & fast-food', date: '2026-10-20' });
  assert.strictEqual(ajout.status, 200);
  const id = ajout.json.id;
  assert.strictEqual((await appel('PATCH', `/api/operations/${id}`, { aRembourser: true })).status, 200);
  let liste = (await appel('GET', '/api/operations?mois=2026-10')).json;
  let saisie = liste.find((o) => o.id === id);
  assert.deepStrictEqual([saisie.montant, saisie.manuelle, saisie.aRembourser, saisie.enveloppe], [-18.5, true, 18.5, 'Resto & fast-food']);
  assert.ok((await appel('GET', '/api/commercants')).json.some((c) => c.nom === 'Gur Kebab' && c.categorie === 'Restos & fast-food'));
  assert.strictEqual((await appel('GET', '/api/suggestion?description=gur%20kebab')).json.categorie, 'Restos & fast-food');

  // Le relevé arrive 2 jours plus tard avec le même montant : la saisie est remplacée, sans doublon.
  const csv = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
    'CARD_PAYMENT,Current,2026-10-22 21:10:00,2026-10-23 09:00:00,GUR KEBAB LILLE,-18.50,0.00,EUR,COMPLETED,120.00\n';
  const imp = await appel('POST', '/api/import', csv, 'text/plain');
  assert.strictEqual(imp.json.remplacees, 1);
  liste = (await appel('GET', '/api/operations?mois=2026-10')).json;
  assert.ok(!liste.some((o) => o.id === id));
  const ligne = liste.find((o) => o.description === 'GUR KEBAB LILLE');
  assert.deepStrictEqual([ligne.manuelle, ligne.aRembourser, ligne.categorie, ligne.manuel], [false, 18.5, 'Restos & fast-food', true]);

  // Seule une saisie à la main se supprime.
  assert.strictEqual((await appel('DELETE', `/api/operations/${ligne.id}`)).status, 400);
  const autre = (await appel('POST', '/api/operations', { montant: 4, description: 'Boulangerie' })).json;
  assert.strictEqual(autre.categorie, 'Restos & fast-food'); // pas choisie : classée par les règles (boulangerie)
  assert.strictEqual((await appel('DELETE', `/api/operations/${autre.id}`)).status, 200);
});

test('dépense nette : avance remboursée en partie, virement de remboursement pas compté comme entrée', () => {
  const { nettes } = require('./analyses');
  const ops = [
    { id: 'd', date: '2026-11-03 20:00:00', description: 'Le Bistrot', montant: -40, categorie: 'Restos & fast-food' },
    { id: 'r', date: '2026-11-04 10:00:00', description: 'Payment from Lea', montant: 25, categorie: 'Revenus', affectations: [{ id: 'd', montant: 20 }] },
    { id: 'p', date: '2026-11-04 11:00:00', description: 'Payment from Paul', montant: 15, categorie: 'Revenus', affectations: [{ id: 'd', montant: 15 }] },
  ];
  const n = Object.fromEntries(nettes(ops).map((o) => [o.id, o.montant]));
  assert.deepStrictEqual(n, { d: -5, r: 5 }); // Paul a tout remboursé : son virement disparaît
  assert.strictEqual(ops[0].montant, -40); // les opérations d'origine ne bougent pas
});

test('rapprochement : à rembourser, virement reçu, revenus sûrs et entrées variables', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { once } = require('events');
  if (!process.env.DOSSIER_DONNEES) {
    Object.assign(process.env, { DOSSIER_DONNEES: fs.mkdtempSync(path.join(os.tmpdir(), 'argenx-test-')), APP_PASSWORD: 'mdp-test' });
    delete process.env.NOTION_TOKEN;
  }
  const serveur = require('./server').listen(0);
  await once(serveur, 'listening');
  t.after(() => {
    serveur.close();
    fs.rmSync(process.env.DOSSIER_DONNEES, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const connexion = await fetch(base + '/api/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: process.env.APP_PASSWORD }) });
  const Cookie = connexion.headers.get('set-cookie').split(';')[0];
  const appel = async (methode, chemin, corps, type = 'application/json') => {
    const r = await fetch(base + chemin, { method: methode, headers: { Cookie, 'Content-Type': type }, body: corps && (type === 'application/json' ? JSON.stringify(corps) : corps) });
    return { status: r.status, json: await r.json() };
  };

  const auj = new Date().toLocaleDateString('sv-SE');
  const csv = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
    `TRANSFER,Current,${auj} 08:00:00,${auj} 08:00:00,Payment from Papa Dupont,400.00,0.00,EUR,COMPLETED,900.00\n` +
    `CARD_PAYMENT,Current,${auj} 12:00:00,${auj} 12:00:00,Le Bistrot,-40.00,0.00,EUR,COMPLETED,860.00\n` +
    `TRANSFER,Current,${auj} 13:00:00,${auj} 13:00:00,Payment from Lea Martin,25.00,0.00,EUR,COMPLETED,885.00\n`;
  assert.strictEqual((await appel('POST', '/api/import', csv, 'text/plain')).status, 200);
  const ops = async () => (await appel('GET', `/api/operations?mois=${auj.slice(0, 7)}`)).json;
  const trouve = async (d) => (await ops()).find((o) => o.description === d);
  const bistrot = await trouve('Le Bistrot');
  const lea = await trouve('Payment from Lea Martin');
  await appel('PATCH', `/api/operations/${bistrot.id}`, { categorie: 'Restos & fast-food' });
  const resto = async () => (await appel('GET', '/api/accueil?vue=mois')).json.enveloppes.find((e) => e.id === 'resto').depense;
  const revenus = async () => (await appel('GET', '/api/accueil')).json.revenus;
  const resto0 = await resto();
  const avant = await revenus();

  // J'avance 40 € ; on me doit 20 €.
  assert.strictEqual((await appel('PATCH', `/api/operations/${bistrot.id}`, { aRembourser: 50 })).status, 400); // plus que la dépense
  assert.strictEqual((await appel('PATCH', `/api/operations/${bistrot.id}`, { aRembourser: 20 })).status, 200);
  assert.strictEqual((await appel('PATCH', `/api/operations/${lea.id}`, { aRembourser: true })).status, 400); // une entrée n'est pas une avance
  const ouvertes = (await appel('GET', '/api/a-rembourser')).json;
  assert.deepStrictEqual(ouvertes.find((o) => o.id === bistrot.id), { id: bistrot.id, date: bistrot.date, description: 'Le Bistrot', montant: -40, attendu: 20, reste: 20 });
  assert.strictEqual((await revenus()).aRecuperer, arrondi2(avant.aRecuperer + 20));

  // Léa m'envoie 25 € : 20 € remboursent le resto, 5 € restent une entrée variable.
  const r = await appel('POST', `/api/operations/${lea.id}/rapprocher`, { depense: bistrot.id });
  assert.deepStrictEqual(r.json, { montant: 20, reste: 0 });
  assert.strictEqual((await appel('POST', `/api/operations/${lea.id}/rapprocher`, { depense: bistrot.id })).status, 400); // déjà tout reçu
  assert.strictEqual(await resto(), arrondi2(resto0 - 20)); // dépense nette
  const apres = await revenus();
  assert.strictEqual(apres.aRecuperer, avant.aRecuperer);
  assert.strictEqual(apres.variables, arrondi2(avant.variables - 20)); // le remboursement n'est pas une entrée
  assert.deepStrictEqual((await trouve('Payment from Lea Martin')).affectations, [{ montant: 20, description: 'Le Bistrot' }]);
  assert.strictEqual((await trouve('Le Bistrot')).recu, 20);

  // Les parents : revenu sûr.
  assert.strictEqual(apres.surs, 0);
  await appel('POST', '/api/sources-revenus', { motCle: 'Papa Dupont' });
  const surs = await revenus();
  assert.deepStrictEqual([surs.surs, surs.variables, surs.sourcesConfigurees], [400, arrondi2(apres.variables - 400), true]);

  // Annuler le rapprochement : tout revient comme avant.
  await appel('DELETE', `/api/operations/${lea.id}/rapprocher`);
  assert.strictEqual(await resto(), resto0);
  await appel('DELETE', '/api/sources-revenus?motCle=papa%20dupont');
  assert.strictEqual((await revenus()).surs, 0);
});

function arrondi2(x) { return Math.round(x * 100) / 100; }

test('Revolut par Enable Banking : jeton signé et lecture des opérations', () => {
  const crypto = require('crypto');
  const { jeton, versOperation } = require('./banque');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const j = jeton('app-123', privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const [h, b, sig] = j.split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'RS256', kid: 'app-123' });
  const corps = JSON.parse(Buffer.from(b, 'base64url'));
  assert.deepStrictEqual([corps.iss, corps.aud, corps.exp - corps.iat], ['enablebanking.com', 'api.enablebanking.com', 3600]);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(sig, 'base64url')));

  const carte = versOperation({ entry_reference: 'A1', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '12.40', currency: 'EUR' },
    booking_date: '2026-11-03', transaction_date: '2026-11-02', creditor: { name: 'AUCHAN' }, balance_after_transaction: { amount: '87.60', currency: 'EUR' } });
  assert.deepStrictEqual(carte, { id: 'eb-A1', date: '2026-11-02 12:00:00', description: 'AUCHAN', montant: -12.4, solde: 87.6, type: 'card', source: 'banque' });
  const recu = versOperation({ transaction_id: 'T9', status: 'PDNG', credit_debit_indicator: 'CRDT', transaction_amount: { amount: '25', currency: 'EUR' },
    booking_date: '2026-11-04', debtor: { name: 'Lea Martin' }, debtor_account: { iban: 'FR7600000000000000000000000' } });
  assert.deepStrictEqual([recu.montant, recu.description, recu.type, recu.provisoire], [25, 'Lea Martin', 'transfer', true]);
  const pocket = versOperation({ status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '50', currency: 'EUR' }, booking_date: '2026-11-04', remittance_information: ['To pocket EUR Vacances'] });
  assert.strictEqual(pocket.type, 'transfer'); // pour être classé en Épargne
  assert.strictEqual(classer(pocket), 'Épargne');
  assert.strictEqual(versOperation({ status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '9', currency: 'USD' }, booking_date: '2026-11-04' }), null);
  assert.strictEqual(versOperation({ status: 'RJCT', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '9', currency: 'EUR' }, booking_date: '2026-11-04' }), null);
});

test('Revolut par Enable Banking : connexion, retour, récupération sans doublon avec le CSV', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const { once } = require('events');
  if (!process.env.DOSSIER_DONNEES) {
    Object.assign(process.env, { DOSSIER_DONNEES: fs.mkdtempSync(path.join(os.tmpdir(), 'argenx-test-')), APP_PASSWORD: 'mdp-test' });
    delete process.env.NOTION_TOKEN;
  }
  fs.mkdirSync(process.env.DOSSIER_DONNEES, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(process.env.DOSSIER_DONNEES, 'enablebanking.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  process.env.ENABLE_BANKING_APP_ID = 'app-test';

  // Faux Enable Banking ; le reste (le serveur Argenx local) passe par le vrai fetch.
  const vraiFetch = global.fetch;
  const appels = [];
  const EB = 'https://api.enablebanking.com';
  global.fetch = async (url, o = {}) => {
    if (!String(url).startsWith(EB)) return vraiFetch(url, o);
    const chemin = String(url).slice(EB.length);
    appels.push(`${o.method} ${chemin.split('?')[0]}`);
    assert.match(o.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const corps = o.body && JSON.parse(o.body);
    const transactions = [
      { entry_reference: 'R1', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '30.00', currency: 'EUR' }, booking_date: '2026-09-02', creditor: { name: 'LIDL' }, balance_after_transaction: { amount: '470.00', currency: 'EUR' } },
      { entry_reference: 'R2', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '9.90', currency: 'EUR' }, booking_date: '2026-09-03', creditor: { name: 'KFC LILLE' } },
      { status: 'PDNG', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '4.20', currency: 'EUR' }, booking_date: '2026-09-04', creditor: { name: 'Boulangerie' } },
    ];
    let rep = null;
    if (chemin.startsWith('/aspsps')) rep = { aspsps: [{ name: 'Revolut', country: 'FR', maximum_consent_validity: 15552000 }] };
    else if (chemin === '/auth') rep = { url: `https://revolut.example/autoriser?state=${corps.state}`, authorization_id: 'x' };
    else if (chemin === '/sessions') rep = { session_id: 'sess-1', accounts: [{ uid: 'cpt-eur', currency: 'EUR' }, { uid: 'cpt-usd', currency: 'USD' }], access: { valid_until: '2027-05-03T00:00:00Z' } };
    else if (chemin.includes('/transactions')) rep = { transactions, continuation_key: null };
    else if (chemin.includes('/balances')) rep = { balances: [{ balance_type: 'CLAV', balance_amount: { amount: '455.90', currency: 'EUR' } }] };
    return { ok: !!rep, status: rep ? 200 : 404, json: async () => rep || { message: 'inconnu' } };
  };
  const serveur = require('./server').listen(0);
  await once(serveur, 'listening');
  t.after(() => {
    global.fetch = vraiFetch;
    delete process.env.ENABLE_BANKING_APP_ID;
    serveur.close();
    fs.rmSync(process.env.DOSSIER_DONNEES, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const connexion = await fetch(base + '/api/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motDePasse: process.env.APP_PASSWORD }) });
  const Cookie = connexion.headers.get('set-cookie').split(';')[0];
  const appel = async (methode, chemin, corps, type = 'application/json') => {
    const r = await fetch(base + chemin, { method: methode, headers: { Cookie, 'Content-Type': type }, body: corps && (type === 'application/json' ? JSON.stringify(corps) : corps) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  // Le Lidl est déjà venu par un CSV (même jour, même montant, même solde) : pas de doublon.
  const csv = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
    'CARD_PAYMENT,Current,2026-09-02 18:30:00,2026-09-03 09:00:00,Lidl,-30.00,0.00,EUR,COMPLETED,470.00\n';
  await appel('POST', '/api/import', csv, 'text/plain');
  // Une saisie à la main du KFC : remplacée par la vraie ligne.
  await appel('POST', '/api/operations', { montant: 9.9, description: 'KFC', date: '2026-09-03' });

  assert.strictEqual((await appel('GET', '/api/banque')).json.connectee, false);
  const { url } = (await appel('POST', '/api/banque/connexion')).json;
  const state = new URL(url).searchParams.get('state');
  assert.match(await (await fetch(`${base}/api/banque/retour?code=c&state=mauvais`)).text(), /expiré/); // sans effet
  assert.strictEqual((await appel('GET', '/api/banque')).json.connectee, false);
  const retour = await fetch(`${base}/api/banque/retour?code=code-ok&state=${state}`); // sans cookie, comme depuis Safari
  assert.match(await retour.text(), /Revolut connecté/);
  assert.match(await (await fetch(`${base}/api/banque/retour?code=code-ok&state=${state}`)).text(), /expiré/); // usage unique

  // Attendre la première récupération lancée par le retour, puis en relancer une : rien ne double.
  for (let i = 0; i < 100 && !(await appel('GET', '/api/banque')).json.derniere; i++) await new Promise((r) => setTimeout(r, 20));
  const r2 = (await appel('POST', '/api/banque/recuperer')).json;
  assert.deepStrictEqual([r2.ajoutees, r2.enAttente, r2.solde], [0, 1, 455.9]); // seule l'opération en attente revient (remplacée)
  const sept = (await appel('GET', '/api/operations?mois=2026-09')).json;
  assert.strictEqual(sept.filter((o) => o.montant === -30).length, 1);
  assert.deepStrictEqual(sept.filter((o) => o.montant === -9.9).map((o) => [o.description, o.manuelle]), [['KFC LILLE', false]]);
  assert.strictEqual(sept.filter((o) => o.description === 'Boulangerie').length, 1);
  const etat = (await appel('GET', '/api/banque')).json;
  assert.deepStrictEqual([etat.connectee, etat.validJusqua, etat.solde, etat.erreur], [true, '2027-05-03T00:00:00Z', 455.9, null]);
  assert.ok(!appels.some((a) => a.includes('cpt-usd'))); // le compte en dollars n'est pas suivi
});
