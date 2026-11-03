// Opérations d'exemple, entièrement fictives (mode démo) : 6 mois de vie étudiante pour voir les graphiques.
// Elles disparaissent au premier vrai import.
const { cle, arrondi } = require('./csv');

module.exports = function operationsDemo(aujourdhui = new Date()) {
  let graine = 42;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const choisir = (liste) => liste[Math.floor(hasard() * liste.length)];
  const entre = (min, max) => arrondi(min + hasard() * (max - min));

  const brutes = [];
  // Les 6 derniers mois complets.
  for (let k = 6; k >= 1; k--) {
    const debut = new Date(Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth() - k, 1));
    const jour = (j) => `${debut.toISOString().slice(0, 8)}${String(j).padStart(2, '0')} ${String(8 + Math.floor(hasard() * 12)).padStart(2, '0')}:${String(Math.floor(hasard() * 60)).padStart(2, '0')}:00`;
    const op = (j, description, montant, type = 'card') => brutes.push({ date: jour(j), description, montant, type });

    op(1, 'Payment from CAF', 180, 'transfer');
    op(2, 'Payment from Job Etudiant SARL', entre(560, 680), 'transfer');
    op(3, 'To EUR Savings', -100, 'transfer');
    op(5, 'Crous Loyer', -310, 'transfer');
    op(8, 'Netflix.com', -13.49);
    op(12, 'Spotify', -11.12);
    op(15, 'Free Mobile', -19.99);
    op(20, 'Basic-Fit', -29.99);
    op(14, 'Cash at Distributeur', -40, 'atm');
    if (k % 2) op(10, 'Top-Up by *4821', 100, 'topup');
    for (const j of [4, 11, 18, 25]) op(j, choisir(['Lidl', 'Lidl', 'Super U', 'Carrefour City']), -entre(22, 58));
    for (let n = 0; n < 4; n++) op(1 + Math.floor(hasard() * 28), choisir(["McDonald's", 'Deliveroo', 'Izly', 'Burger King', 'Starbucks']), -entre(4, 22));
    for (let n = 0; n < 3; n++) op(1 + Math.floor(hasard() * 28), choisir(['RATP', 'Uber', 'SNCF', 'Lime']), -entre(2, 35));
    op(1 + Math.floor(hasard() * 28), choisir(['Amazon', 'Zara', 'Vinted', 'Decathlon']), -entre(12, 55));
    op(1 + Math.floor(hasard() * 28), choisir(['Amazon', 'Primark', 'Fnac']), -entre(10, 45));
    op(1 + Math.floor(hasard() * 28), choisir(['UGC Cine Cite', 'Steam', 'Bowling Star']), -entre(8, 25));
    if (hasard() < 0.5) op(1 + Math.floor(hasard() * 28), 'Pharmacie du Centre', -entre(6, 24));
    if (hasard() < 0.6) op(1 + Math.floor(hasard() * 28), 'To Lea Martin', -entre(10, 30), 'transfer');
    if (k === 6) op(9, 'Gibert Joseph', -64.9);
    if (k === 2) op(17, 'Darty', -449.99); // dépense inhabituelle
  }

  brutes.sort((a, b) => a.date.localeCompare(b.date));
  let solde = 850;
  return brutes.map((o) => {
    solde = arrondi(solde + o.montant);
    const op = { ...o, montant: arrondi(o.montant), solde };
    return { id: cle(op), ...op };
  });
};
