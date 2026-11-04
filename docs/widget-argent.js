// Widget iPhone pour Argenx, avec l'appli gratuite Scriptable (https://scriptable.app).
// Installation : voir « Widget iPhone » dans le README.
// 1. Sur le serveur, mets un long jeton aléatoire dans WIDGET_TOKEN (YAML du NAS, 16 caractères au minimum), puis redémarre.
// 2. Dans Scriptable, crée un script, colle ce fichier, renseigne BASE_URL et TOKEN ci-dessous.
// Le jeton ne donne que la lecture de quelques chiffres. Ne le partage pas ; pour le révoquer, change WIDGET_TOKEN.
const BASE_URL = 'https://teranga-nas.synology.me:8445';
const TOKEN = 'COLLE-ICI-TON-WIDGET_TOKEN';

const euros = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const COULEUR = { ok: Color.green(), warn: Color.orange(), over: Color.red() };

async function charger() {
  const req = new Request(`${BASE_URL}/api/widget/argent`);
  req.headers = { Authorization: `Bearer ${TOKEN}` };
  const d = await req.loadJSON();
  if (req.response.statusCode !== 200) throw new Error(`erreur ${req.response.statusCode}`);
  return d;
}

function texte(w, contenu, taille, gras, couleur) {
  const t = w.addText(contenu);
  t.font = gras ? Font.boldSystemFont(taille) : Font.systemFont(taille);
  if (couleur) t.textColor = couleur;
  return t;
}

const w = new ListWidget();
w.url = BASE_URL; // un appui ouvre Argenx
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
const taille = config.widgetFamily || 'small';
try {
  const d = await charger();
  const couleur = COULEUR[d.status];
  if (taille === 'accessoryInline') {
    texte(w, `Argenx ${euros(d.remainingWeek)} cette semaine`, 12);
  } else if (taille === 'accessoryCircular') {
    texte(w, euros(d.remainingWeek), 14, true);
  } else if (taille === 'accessoryRectangular') {
    texte(w, `Semaine : ${euros(d.remainingWeek)}`, 14, true);
    texte(w, `Mois : ${euros(d.remainingMonth)} · ${euros(d.perDay)}/j`, 12);
  } else {
    texte(w, 'Cette semaine', 12);
    texte(w, euros(d.remainingWeek), taille === 'small' ? 30 : 38, true, couleur);
    texte(w, `sur ${euros(d.weekAllowance)} · ${d.daysLeftWeek} j restants`, 11);
    w.addSpacer(6);
    texte(w, `Mois : ${euros(d.remainingMonth)} · environ ${euros(d.perDay)} par jour`, 12);
    if (d.toRestore > 0 && d.restored < d.toRestore) texte(w, `Épargne à remettre : ${euros(d.restored)} / ${euros(d.toRestore)}`, 11);
    if (taille === 'large') texte(w, `Disponible ${euros(d.available)} (enveloppe ${euros(d.envelope)}) · dépensé ${euros(d.spentMonth)}`, 11);
    if (!d.updatedAt && taille !== 'small') texte(w, 'Pas encore de données.', 11);
  }
} catch (e) {
  texte(w, `Argenx : ${e.message}`, 12);
}
if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
