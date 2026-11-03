// Opérations d'exemple, entièrement fictives (mode démo) : un étudiant avec 400 € par mois, sur 6 mois
// plus le mois en cours jusqu'à aujourd'hui. Elles disparaissent au premier vrai import.
const { cle, arrondi } = require('./csv');

module.exports = function operationsDemo(aujourdhui = new Date()) {
  let graine = 42;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const choisir = (liste) => liste[Math.floor(hasard() * liste.length)];
  const entre = (min, max) => arrondi(min + hasard() * (max - min));
  const jourAuHasard = () => 1 + Math.floor(hasard() * 28);

  const brutes = [];
  for (let k = 6; k >= 0; k--) {
    const debut = new Date(Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth() - k, 1));
    // Mois en cours : seulement jusqu'à aujourd'hui.
    const dernierJour = k === 0 ? aujourdhui.getDate() : 31;
    const jour = (j) => `${debut.toISOString().slice(0, 8)}${String(j).padStart(2, '0')} ${String(8 + Math.floor(hasard() * 12)).padStart(2, '0')}:${String(Math.floor(hasard() * 60)).padStart(2, '0')}:00`;
    const op = (j, description, montant, type = 'card') => j <= dernierJour && brutes.push({ date: jour(j), description, montant, type });

    op(1, 'Payment from Papa', 400, 'transfer');
    op(2, 'To EUR Savings', -20, 'transfer');
    op(8, 'Netflix.com', -7.99);
    op(12, 'Spotify', -6.99);
    op(15, 'Free Mobile', -9.99);
    op(14, 'Cash at Distributeur', -20, 'atm');
    for (const j of [4, 11, 18, 25]) op(j, choisir(['Lidl', 'Lidl', 'Super U', 'Carrefour City']), -entre(18, 38));
    for (let n = 0; n < 4; n++) op(jourAuHasard(), choisir(["McDonald's", 'Izly', 'Izly', 'Burger King', 'Starbucks']), -entre(3.3, 12));
    for (let n = 0; n < 3; n++) op(jourAuHasard(), choisir(['RATP', 'SNCF', 'Lime', 'Uber']), -entre(2, 15));
    op(jourAuHasard(), choisir(['Amazon', 'Zara', 'Vinted', 'Decathlon']), -entre(10, 35));
    op(jourAuHasard(), choisir(['Amazon', 'Primark', 'Fnac']), -entre(8, 25));
    op(jourAuHasard(), choisir(['UGC Cine Cite', 'Steam', 'Bowling Star']), -entre(7, 15));
    if (hasard() < 0.5) op(jourAuHasard(), 'Pharmacie du Centre', -entre(5, 15));
    if (hasard() < 0.6) op(jourAuHasard(), 'To Lea Martin', -entre(5, 15), 'transfer');
    if (k === 6) op(9, 'Gibert Joseph', -34.9);
    if (k === 3) op(17, 'Fnac', -129.99); // dépense inhabituelle
    if (k === 1) {
      // Achat remboursé par le magasin, et achat remboursé par un proche : ni l'un ni l'autre ne compte.
      op(6, 'IKEA', -89.99);
      op(9, 'IKEA', 89.99, 'refund');
      op(20, 'SNCF', -64.5);
      op(22, 'Payment from Maman', 64.5, 'transfer');
    }
  }

  brutes.sort((a, b) => a.date.localeCompare(b.date));
  let solde = 300;
  return brutes.map((o) => {
    solde = arrondi(solde + o.montant);
    const op = { ...o, montant: arrondi(o.montant), solde };
    return { id: cle(op), ...op };
  });
};
