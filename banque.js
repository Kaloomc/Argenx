// Connexion automatique à Revolut par l'Open Banking, via Enable Banking (https://enablebanking.com/docs/api/reference/).
// ENABLE_BANKING_APP_ID : identifiant de l'application (panneau de contrôle Enable Banking)
// ENABLE_BANKING_CLE    : fichier de la clé secrète .pem (par défaut data/enablebanking.pem, jamais sur GitHub)
// La clé ne quitte pas le serveur. Tes identifiants Revolut ne passent jamais par Argenx : tu valides chez Revolut.
const crypto = require('crypto');
const fs = require('fs');
const { arrondi } = require('./csv');

const API = 'https://api.enablebanking.com';

// Jeton signé avec la clé secrète (RS256), valable une heure.
function jeton(appId, cle) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const corps = `${b64({ typ: 'JWT', alg: 'RS256', kid: appId })}.${b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 })}`;
  return `${corps}.${crypto.sign('RSA-SHA256', Buffer.from(corps), cle).toString('base64url')}`;
}

// Une opération Enable Banking → une opération Argenx (même forme que celles du CSV). null si on l'ignore.
function versOperation(t) {
  if ((t.transaction_amount?.currency || 'EUR') !== 'EUR' || !['BOOK', 'PDNG'].includes(t.status)) return null;
  const debit = t.credit_debit_indicator === 'DBIT';
  const montant = arrondi((debit ? -1 : 1) * Math.abs(Number(t.transaction_amount?.amount)));
  const date = t.transaction_date || t.booking_date || t.value_date;
  if (!montant || !date) return null;
  const libre = (t.remittance_information || []).join(' ').trim();
  const description = ((debit ? t.creditor?.name : t.debtor?.name) || libre || t.bank_transaction_code?.description || '(sans description)').slice(0, 200);
  // Un virement a un compte en face (ou parle de Pocket / coffre) ; le reste est un paiement par carte.
  const virement = !!(t.creditor_account || t.debtor_account) || /pocket|coffre|savings|epargne|vault/i.test(`${description} ${libre}`);
  const ref = t.entry_reference || t.transaction_id ||
    crypto.createHash('sha1').update(JSON.stringify([date, montant, description, libre])).digest('hex').slice(0, 16);
  const solde = t.balance_after_transaction?.amount;
  return {
    id: `eb-${ref}`, date: `${date.slice(0, 10)} 12:00:00`, description, montant,
    solde: solde === undefined ? null : Number(solde), type: virement ? 'transfer' : 'card', source: 'banque',
    ...(t.status === 'PDNG' && { provisoire: true }),
  };
}

// Configuration lue à chaque appel (l'appli peut être réglée sans redémarrer les tests).
const config = (dossier) => ({
  appId: process.env.ENABLE_BANKING_APP_ID,
  fichierCle: process.env.ENABLE_BANKING_CLE || `${dossier}/enablebanking.pem`,
});

module.exports = function banque(dossier) {
  const configuree = () => {
    const c = config(dossier);
    return !!c.appId && fs.existsSync(c.fichierCle);
  };

  async function api(methode, chemin, corps) {
    const c = config(dossier);
    const r = await fetch(API + chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton(c.appId, fs.readFileSync(c.fichierCle, 'utf8'))}`, 'Content-Type': 'application/json' },
      body: corps && JSON.stringify(corps),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`Enable Banking : ${data.message || data.error || r.status}`), { statut: r.status });
    return data;
  }

  // Étape 1 : adresse de la page Revolut où tu valides l'accès.
  async function demarrer(retour) {
    const { aspsps = [] } = await api('GET', '/aspsps?country=FR');
    const revolut = aspsps.find((a) => /revolut/i.test(a.name));
    if (!revolut) throw new Error('Revolut introuvable chez Enable Banking pour la France.');
    const duree = Math.min(revolut.maximum_consent_validity || 90 * 86400, 180 * 86400); // en secondes
    const state = crypto.randomUUID();
    const r = await api('POST', '/auth', {
      access: { valid_until: new Date(Date.now() + duree * 1000).toISOString() },
      aspsp: { name: revolut.name, country: revolut.country },
      state, redirect_url: retour, psu_type: 'personal',
    });
    return { url: r.url, state };
  }

  // Étape 2 : de retour de chez Revolut, on ouvre la session. Comptes en euros, sans les coffres.
  async function terminer(code) {
    const s = await api('POST', '/sessions', { code });
    const comptes = (s.accounts || []).filter((a) => (a.currency || 'EUR') === 'EUR' && a.cash_account_type !== 'SVGS');
    if (!comptes.length) throw new Error('Aucun compte en euros trouvé chez Revolut.');
    return { sessionId: s.session_id, comptes: comptes.map((a) => a.uid), validJusqua: s.access?.valid_until ?? null };
  }

  async function transactions(uid, depuis) {
    const out = [];
    let suite;
    do {
      const q = new URLSearchParams({ date_from: depuis, ...(suite && { continuation_key: suite }) });
      const r = await api('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`);
      out.push(...(r.transactions || []));
      suite = r.continuation_key;
    } while (suite);
    return out;
  }

  async function solde(uid) {
    const { balances = [] } = await api('GET', `/accounts/${encodeURIComponent(uid)}/balances`);
    const b = balances.find((x) => ['CLAV', 'ITAV', 'XPCD', 'ITBD', 'CLBD'].includes(x.balance_type)) || balances[0];
    return b ? Number(b.balance_amount.amount) : null;
  }

  return { configuree, demarrer, terminer, transactions, solde };
};

module.exports.versOperation = versOperation;
module.exports.jeton = jeton;
