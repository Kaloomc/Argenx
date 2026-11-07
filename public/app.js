// --- Outils ------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const euros = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const euros0 = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); // vues d'ensemble : à l'euro près
// Icône du sprite SVG d'index.html (couleur du texte).
const ico = (nom) => `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`;
const nomMois = (m, mois = 'long') => new Date(m + '-15T12:00:00').toLocaleDateString('fr-FR', { month: mois, year: 'numeric' });
const jourCourt = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.brut ? {} : { 'Content-Type': 'application/json' },
    body: options.brut ?? (options.body && JSON.stringify(options.body)),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/connexion')) location.hash = '#connexion';
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

const dire = (el, texte) => {
  (el.querySelector('.message') || el).textContent = texte;
};

const barre = (valeur, max) => {
  const pc = max > 0 ? Math.min(100, (valeur / max) * 100) : 100;
  return `<div class="barre" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-valuenow="${Math.round(valeur)}"><div style="width:${pc}%" class="${valeur > max ? 'depasse' : ''}"></div></div>`;
};

// --- Couleurs des graphiques -------------------------------------------------
// Chaque catégorie garde toujours la même couleur (palette validée pour le daltonisme, 7 teintes au maximum) ;
// les autres sont regroupées en gris dans « Autres dépenses ».
const COULEUR_CATEGORIE = { Courses: 1, 'Restos & fast-food': 2, Transport: 3, Logement: 4, Abonnements: 5, Shopping: 6, Loisirs: 7 };
const css = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
const couleur = (cat) => css(COULEUR_CATEGORIE[cat] ? `--serie-${COULEUR_CATEGORIE[cat]}` : '--serie-reste');

// --- Onglets -----------------------------------------------------------------
let etat = { categories: [], depenses: [] };
let mois = null; // "2026-10"
let tableau = null;

const CHARGER = {
  accueil: () => chargerAccueil(),
  mois: () => chargerTableau(),
  operations: () => chargerOperations(),
  importer: () => Promise.all([chargerEtat(), chargerBanque()]),
  reglages: () => chargerReglages(),
};

function afficherOnglet() {
  const demande = location.hash.slice(1);
  const id = document.getElementById(demande)?.closest('main') ? demande : 'accueil'; // lien ancien (#analyses…) : retour à l'accueil
  document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.hash === '#' + id));
  document.querySelectorAll('nav a').forEach((a) => (a.hash === '#' + id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#barre-outils').hidden = !['mois', 'operations'].includes(id) || !mois;
  $('#ajouter').hidden = !['accueil', 'operations'].includes(id);
  CHARGER[id]?.().then(() => statutErreur(false)).catch((err) => {
    console.error(err);
    if (err.message !== 'Connexion nécessaire') statutNotion(`Impossible de charger cet écran : ${err.message}`, true);
  });
}
addEventListener('hashchange', afficherOnglet);

$('#choix-mois').addEventListener('change', (e) => {
  mois = e.target.value;
  afficherOnglet();
});

async function chargerEtat() {
  etat = await api('/api/etat');
  $('#mode').hidden = etat.mode !== 'demo';
  $('#rafraichir-notion').hidden = etat.mode !== 'notion';
  $('#bandeau-exemple').hidden = !etat.exemple;
  $('#effacer-exemple').hidden = !etat.exemple;
}

// --- Connexion ---------------------------------------------------------------
$('#form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/connexion', { method: 'POST', body: { motDePasse: e.target.motDePasse.value } });
    location.hash = '#mois';
  } catch (err) {
    dire(e.target, err.message);
  }
});

// --- Reste à dépenser (mois en cours seulement) ---------------------------------
// Enveloppe du mois − épargne à remettre − dépenses du mois. Affiché sur l'accueil et dans Insights.
function htmlReste(r) {
  if (r.disponible == null) return '<p class="vide">Fixe l’enveloppe du mois dans Réglages pour savoir combien il te reste.</p>';
  const l = [`<div class="resume">
      <small>Reste à dépenser · ${nomMois(r.mois)}</small>
      <strong class="enorme ${r.reste < 0 ? 'rouge' : ''}">${euros0(r.reste)}</strong>
      <small>${euros0(r.depense)} dépensés sur ${euros0(r.disponible)} disponibles${r.aRemettre ? ` (${euros0(r.enveloppe)} − ${euros0(r.aRemettre)} d’épargne à remettre)` : ''}</small>
    </div>${barre(r.depense, r.disponible)}`];
  if (r.courant && r.reste < 0) {
    l.push(`<p class="rouge">Dépassé de ${euros0(-r.reste)}, et il reste ${r.joursRestants} jour${r.joursRestants > 1 ? 's' : ''}.</p>`);
  } else if (r.courant && r.parJour != null) {
    l.push(`<p>${r.joursRestants} jour${r.joursRestants > 1 ? 's' : ''} restant${r.joursRestants > 1 ? 's' : ''} : environ <strong>${euros0(r.parJour)} par jour</strong>.</p>`);
  }
  if (r.enCours && r.projection != null) {
    const ecart = Math.round(r.disponible - r.projection);
    l.push(`<p>À ce rythme, environ <strong>${euros0(r.projection)}</strong> en fin de mois : ${ecart >= 0 ? `<span class="vert">${ico('valide')} ${euros0(ecart)} sous le disponible</span>` : `<span class="rouge">${ico('alerte')} ${euros0(-ecart)} au-dessus</span>`}.</p>`);
  }
  if (r.epargne && !r.epargne.atteint) {
    l.push(`<div class="epargne"><div class="ligne-budget"><span>Épargne à reconstituer</span><strong>${euros0(r.epargne.remis)} / ${euros0(r.epargne.objectif)}</strong></div>${barre(r.epargne.remis, r.epargne.objectif)}</div>`);
  }
  if (r.budgets.depasse) l.push(`<p class="rouge">Tes budgets par catégorie (${euros0(r.budgets.total)}) dépassent les ${euros0(r.disponible)} disponibles : ajuste-les dans Réglages.</p>`);
  if (r.phrases.length) l.push(`<ul class="alertes">${r.phrases.map(htmlAlerte).join('')}</ul>`);
  return l.join('');
}

// --- Accueil : reste à dépenser du mois -------------------------------------------
const ETAT_ICONE = { orange: ico('alerte'), rouge: ico('stop') };
const htmlAlerte = (x) => `<li class="${x.etat}">${ETAT_ICONE[x.etat]}<span>${esc(x.texte)}</span></li>`;

async function chargerAccueil() {
  const a = await api('/api/accueil');
  $('#reste-mois').innerHTML = htmlReste(a.resteMois);
  const hier = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
  $('#fraicheur').textContent = a.jusquau < hier
    ? `Dépenses connues jusqu'au ${jourCourt(a.jusquau)}. Importe ton relevé Revolut (onglet Importer) pour être à jour.`
    : '';
}

// --- Tableau de bord ---------------------------------------------------------
async function chargerTableau() {
  tableau = await api(`/api/tableau${mois ? `?mois=${mois}` : ''}`);
  mois = tableau.mois;
  const choix = $('#choix-mois');
  const liste = tableau.moisDispo.includes(mois) ? tableau.moisDispo : [mois, ...tableau.moisDispo];
  choix.innerHTML = liste.map((m) => `<option value="${m}" ${m === mois ? 'selected' : ''}>${nomMois(m)}</option>`).join('');
  $('#barre-outils').hidden = !['mois', 'operations'].includes(location.hash.slice(1) || 'accueil');
  dessiner();
  afficherCoursesRepax(tableau.mois);
}

// Carte « Courses » : prévision de Repax (si l'appli est reliée), seulement pour le mois en cours.
async function afficherCoursesRepax(m) {
  const el = $('#courses-repax');
  const c = await api('/api/courses-prevues').catch(() => ({}));
  el.hidden = !c.prevision || c.mois !== m;
  if (el.hidden) return;
  const p = c.prevision;
  el.innerHTML = `
    <h3>${ico('panier')} Courses</h3>
    <div class="ligne-budget">
      <div><small>Prévu (7 prochains jours)</small><strong>${euros(p.total)}</strong></div>
      <div><small>Dépensé ce mois-ci</small><strong>${euros(c.depense)}</strong></div>
    </div>
    <p>${p.repas} repas prévus dans Repax, dont <strong>${euros(p.resteAAcheter)}</strong> encore à acheter.</p>
    <p>Fin du mois estimée : <strong>${euros(c.finDeMois)}</strong> de courses (dépensé + reste à acheter)${c.budget
      ? ` : ${c.finDeMois <= c.budget ? `<span class="vert">${ico('valide')} dans ton budget Courses de ${euros(c.budget)}</span>` : `<span class="rouge">${ico('alerte')} ${euros(c.finDeMois - c.budget)} au-dessus de ton budget Courses</span>`}`
      : ''}.</p>`;
}

const graphes = {};
function graphe(id, config) {
  graphes[id]?.destroy();
  graphes[id] = new Chart(document.getElementById(id), config);
}
const infobulle = { callbacks: { label: (c) => ` ${c.dataset.label || c.label} : ${euros(c.raw)}` } };

function dessiner() {
  const t = tableau;
  $('#chiffres').innerHTML = `
    <div><small>Entrées</small><strong>${euros(t.entrees)}</strong></div>
    <div><small>Dépenses</small><strong>${euros(t.sorties)}</strong></div>
    <div><small>Mis de côté</small><strong>${euros(t.epargne)}</strong></div>`;
  afficherNotes();

  if (!window.Chart) {
    $('#liste-categories').innerHTML = '<li class="vide">Graphiques indisponibles sans connexion Internet.</li>';
    return;
  }
  Chart.defaults.animation = matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 };
  Chart.defaults.color = css('--doux');
  Chart.defaults.borderColor = css('--grille');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const surface = css('--carte');

  // Camembert : les 7 catégories colorées + le reste regroupé
  const depenses = t.categories.filter((c) => etat.depenses.includes(c.categorie) && c.montant > 0).sort((a, b) => b.montant - a.montant);
  const parts = depenses.filter((c) => COULEUR_CATEGORIE[c.categorie]);
  const reste = depenses.filter((c) => !COULEUR_CATEGORIE[c.categorie]).reduce((s, c) => s + c.montant, 0);
  if (reste > 0) parts.push({ categorie: 'Autres dépenses', montant: Math.round(reste * 100) / 100 });
  graphe('g-categories', {
    type: 'doughnut',
    data: {
      labels: parts.map((c) => c.categorie),
      datasets: [{ data: parts.map((c) => c.montant), backgroundColor: parts.map((c) => couleur(c.categorie)), borderColor: surface, borderWidth: 2 }],
    },
    options: { maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: infobulle } }, // la liste dessous sert de légende
  });
  // Le détail en liste (lisible sans les couleurs)
  $('#liste-categories').innerHTML = depenses.length
    ? depenses.map((c) => `<li><span class="pastille" style="background:${couleur(c.categorie)}"></span><span class="nom">${esc(c.categorie)} <small>${c.nb} op.</small></span><span class="cout">${euros(c.montant)}${c.budget ? `<small> / ${euros0(c.budget)}${c.montant > c.budget ? ` · +${euros0(c.montant - c.budget)} au-dessus` : ''}</small>` : ''}</span>${c.budget ? barre(c.montant, c.budget) : ''}</li>`).join('')
    : '<li class="vide">Aucune dépense ce mois-ci.</li>';

  $('#top').innerHTML = t.top.length
    ? t.top.map((c) => `<li><span class="nom">${esc(c.nom)} <small>${esc(c.categorie)} · ${c.nb} fois</small></span><span class="cout">${euros(c.montant)}</span></li>`).join('')
    : '<li class="vide">Rien ce mois-ci.</li>';
}
// Notes sous le titre d'Insights : données pas à jour, achats remboursés retirés des totaux.
function afficherNotes() {
  const r = tableau.reste;
  const notes = [];
  if (r.enCours && (Date.now() - Date.parse(r.jusquau + 'T23:59:59')) / 864e5 > 3) {
    notes.push(`Opérations connues jusqu'au ${jourCourt(r.jusquau)} : importe un relevé récent pour être à jour.`);
  }
  if (tableau.rembourses) notes.push(`${ico('echange')} ${tableau.rembourses} achat(s) remboursé(s) ce mois-ci, retirés des totaux.`);
  $('#note-mois').innerHTML = notes.join('<br>');
  $('#note-mois').hidden = !notes.length;
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => tableau && dessiner());

// --- Dépenses : par jour, puis par enveloppe ------------------------------------
let operations = [];

async function chargerOperations() {
  if (!mois) await chargerTableau();
  operations = await api(`/api/operations?mois=${mois}`);
  afficherOperations();
}

const somme = (liste) => liste.reduce((s, o) => s + o.montant, 0);

function ligneOperation(o) {
  const r = o.rembourse;
  const badges = [
    o.manuelle && '<span class="badge-op">ajoutée à la main</span>',
    o.provisoire && `<span class="badge-op orange">${ico('horloge')} en attente</span>`,
    o.aRembourser > 0 && (o.recu >= o.aRembourser
      ? `<span class="badge-op vert">${ico('valide')} remboursé ${euros(o.recu)}</span>`
      : `<span class="badge-op orange">${ico('rembourser')} à rembourser ${o.recu ? `${euros(o.recu)} / ` : ''}${euros(o.aRembourser)}</span>`),
    o.revenuSur && `<span class="badge-op vert">${ico('etoile')} revenu sûr</span>`,
    ...(o.affectations || []).map((a) => `<span class="badge-op">${ico('echange')} rembourse « ${esc(a.description)} » ${euros(a.montant)}</span>`),
    o.montant > 0 && o.categorie === 'Revenus' && !o.revenuSur && !o.affectations?.length && !o.rembourse && '<span class="badge-op">entrée variable</span>',
    o.manuel && !o.manuelle && '<span class="badge-op">corrigée</span>',
  ].filter(Boolean).join('');
  const lien = r
    ? `<span class="rembourse"><span>${ico('echange')} ${o.montant < 0 ? 'remboursé par' : 'rembourse'} « ${esc(r.description)} » le ${jourCourt(r.date)} : ne compte pas</span>
       <button class="petit secondaire" style="width:auto" data-pas-rembourse="${esc(o.id)}">Pas un remboursement</button></span>`
    : '';
  return `<li class="op ${r || o.categorie === 'Ne compte pas' ? 'annulee' : ''}" data-id="${esc(o.id)}">
    <span class="fond fond-droite" aria-hidden="true">${o.montant > 0 ? `${ico('echange')} Remboursement` : `${ico('rembourser')} À rembourser`}</span>
    <span class="fond fond-gauche" aria-hidden="true">Catégorie ${ico('etiquette')}</span>
    <div class="contenu">
      <span class="nom">${esc(o.description)}<small>${esc(o.categorie)}</small></span>
      <span class="cout ${o.montant > 0 ? 'vert' : ''}">${o.montant > 0 ? '+' : ''}${euros(o.montant)}${o.recu ? `<small>net ${euros(o.montant + o.recu)}</small>` : ''}</span>
      ${badges ? `<span class="badges">${badges}</span>` : ''}${lien}
    </div></li>`;
}

function afficherOperations() {
  const q = $('#recherche').value.trim().toLowerCase();
  const liste = operations.filter((o) => !q || o.description.toLowerCase().includes(q));
  const jours = [...new Set(liste.map((o) => o.date.slice(0, 10)))];
  $('#liste-operations').innerHTML = jours.length
    ? jours.map((j) => {
        const duJour = liste.filter((o) => o.date.startsWith(j));
        const groupes = [...new Set(duJour.map((o) => o.enveloppe ?? 'Hors enveloppes'))];
        return `<li class="titre-jour">${jourCourt(j)}</li>` + groupes.map((g) => {
          const ops = duJour.filter((o) => (o.enveloppe ?? 'Hors enveloppes') === g);
          // Dépense nette : une avance remboursée ne compte que pour ce qui reste à ta charge.
          const depense = -ops.filter((o) => o.montant < 0 && !o.rembourse && o.categorie !== 'Ne compte pas')
            .reduce((s, o) => s + o.montant + (o.recu || 0), 0);
          return `<li class="titre-enveloppe"><span>${esc(g)}</span>${g !== 'Hors enveloppes' && depense ? `<span>${euros(depense)}</span>` : ''}</li>` +
            ops.map(ligneOperation).join('');
        }).join('');
      }).join('')
    : '<li class="vide">Aucune opération.</li>';
}
$('#recherche').addEventListener('input', afficherOperations);

// Glisser une opération : vers la gauche → changer de catégorie, vers la droite → « à rembourser ».
// Un simple appui ouvre les mêmes actions.
let glisse = null;
let finGlisse = 0;
const listeOps = $('#liste-operations');
listeOps.addEventListener('touchstart', (e) => {
  const li = e.target.closest('li.op');
  if (li && !e.target.closest('button')) glisse = { li, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, actif: false };
}, { passive: true });
listeOps.addEventListener('touchmove', (e) => {
  if (!glisse) return;
  const dx = e.touches[0].clientX - glisse.x;
  const dy = e.touches[0].clientY - glisse.y;
  if (!glisse.actif && Math.abs(dy) > Math.abs(dx)) { glisse = null; return; } // on fait défiler la liste
  glisse.actif = Math.abs(dx) > 8;
  glisse.dx = Math.max(-120, Math.min(120, dx));
  glisse.li.querySelector('.contenu').style.transform = `translateX(${glisse.dx}px)`;
  glisse.li.classList.toggle('vers-droite', glisse.dx > 0);
}, { passive: true });
listeOps.addEventListener('touchend', () => {
  if (!glisse) return;
  const { li, dx, actif } = glisse;
  glisse = null;
  li.querySelector('.contenu').style.transform = '';
  if (!actif) return;
  finGlisse = Date.now();
  if (dx <= -70) ouvrirActions(li.dataset.id, true);
  else if (dx >= 70) basculerARembourser(li.dataset.id);
});

// Glisser à droite une somme reçue = « c'est un remboursement » : choisir la dépense qu'elle rembourse.
async function ouvrirRapprochement(id) {
  opActive = operations.find((x) => x.id === id);
  const ouvertes = await api('/api/a-rembourser').catch(() => []);
  $('#titre-rapprocher').innerHTML = `${esc(opActive.description)} <span class="cout vert">+${euros(opActive.montant)}</span><small>rembourse quelle dépense ?</small>`;
  $('#liste-a-rembourser').innerHTML = ouvertes.length
    ? ouvertes.map((d) => `<button type="button" class="choix" data-depense="${esc(d.id)}">
        <span>${esc(d.description)} <small>${jourCourt(d.date)}</small></span><strong>reste ${euros(d.reste)}</strong></button>`).join('')
    : '<p class="vide">Aucune dépense « à rembourser ». Marque d’abord la dépense avancée (glisse-la vers la droite), puis reviens ici.</p>';
  $('#feuille-rapprocher').showModal();
}

$('#liste-a-rembourser').addEventListener('click', async (e) => {
  const depense = e.target.closest('[data-depense]')?.dataset.depense;
  if (!depense) return;
  $('#feuille-rapprocher').close();
  try {
    const r = await api(`/api/operations/${encodeURIComponent(opActive.id)}/rapprocher`, { method: 'POST', body: { depense } });
    alert(`${euros(r.montant)} rapprochés.${r.reste > 0 ? ` Il reste ${euros(r.reste)} à récupérer sur cette dépense.` : ' Dépense entièrement remboursée'}`);
  } catch (err) {
    alert(err.message);
  }
  chargerOperations();
});

listeOps.addEventListener('click', async (e) => {
  const pas = e.target.dataset.pasRembourse;
  if (pas) {
    await api(`/api/operations/${encodeURIComponent(pas)}`, { method: 'PATCH', body: { pasRembourse: true } }).catch((err) => alert(err.message));
    return chargerOperations();
  }
  const li = e.target.closest('li.op');
  if (li && Date.now() - finGlisse > 400) ouvrirActions(li.dataset.id);
});

async function basculerARembourser(id) {
  const o = operations.find((x) => x.id === id);
  if (!o) return;
  if (o.montant > 0) return ouvrirRapprochement(id);
  await api(`/api/operations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { aRembourser: !o.aRembourser } }).catch((err) => alert(err.message));
  chargerOperations();
}

// Feuille d'actions d'une opération : catégories en gros boutons, « à rembourser », supprimer (saisie à la main).
let opActive = null;
function ouvrirActions(id, categoriesSeules = false) {
  opActive = operations.find((x) => x.id === id);
  if (!opActive) return;
  const o = opActive;
  $('#titre-op').innerHTML = `${esc(o.description)} <span class="cout">${euros(o.montant)}</span><small>${jourCourt(o.date)}</small>`;
  $('#grille-categories').innerHTML = etat.categories.map((c) =>
    `<button type="button" class="choix ${c === o.categorie ? 'actif' : ''}" data-categorie="${esc(c)}">${esc(c)}</button>`).join('');
  const depense = o.montant < 0;
  $('#actions-op').hidden = categoriesSeules;
  $('#actions-depense').hidden = categoriesSeules || !depense;
  $('#actions-entree').hidden = categoriesSeules || depense;
  $('#basculer-rembourser').innerHTML = o.aRembourser ? `${ico('valide')} À rembourser (retirer)` : `${ico('rembourser')} À rembourser`;
  $('#part-rembourser').hidden = !o.aRembourser;
  $('#montant-rembourser').value = o.aRembourser ? String(o.aRembourser).replace('.', ',') : '';
  $('#annuler-rapprochement').hidden = !o.affectations?.length;
  $('#revenu-sur').hidden = !!o.revenuSur;
  $('#supprimer-op').hidden = !o.manuelle;
  $('#feuille-op').showModal();
}

// Part de la dépense que l'on doit te rendre (par défaut : tout).
$('#part-rembourser').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Number($('#montant-rembourser').value.replace(',', '.'));
  $('#feuille-op').close();
  await api(`/api/operations/${encodeURIComponent(opActive.id)}`, { method: 'PATCH', body: { aRembourser: v } }).catch((err) => alert(err.message));
  chargerOperations();
});

$('#est-remboursement').addEventListener('click', () => {
  $('#feuille-op').close();
  ouvrirRapprochement(opActive.id);
});

$('#annuler-rapprochement').addEventListener('click', async () => {
  $('#feuille-op').close();
  await api(`/api/operations/${encodeURIComponent(opActive.id)}/rapprocher`, { method: 'DELETE' }).catch((err) => alert(err.message));
  chargerOperations();
});

// Revenu sûr : tous les virements qui contiennent ce mot-clé (par exemple le nom de l'expéditeur).
$('#revenu-sur').addEventListener('click', async () => {
  $('#feuille-op').close();
  const motCle = prompt('Tous les virements qui contiennent ce mot-clé seront des revenus sûrs (garde par exemple juste le nom de l’expéditeur) :', opActive.description.replace(/^(payment from|virement de|de)\s+/i, ''));
  if (!motCle?.trim()) return;
  await api('/api/sources-revenus', { method: 'POST', body: { motCle } }).catch((err) => alert(err.message));
  chargerOperations();
});

$('#grille-categories').addEventListener('click', async (e) => {
  const categorie = e.target.dataset.categorie;
  const o = opActive;
  if (!categorie || !o) return;
  $('#feuille-op').close();
  if (categorie === o.categorie) return;
  try {
    await api(`/api/operations/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: { categorie } });
    const motCle = prompt(
      `Classer aussi en « ${categorie} » toutes les opérations qui contiennent ce mot-clé (passées et futures) ?\n` +
      'Raccourcis-le si besoin (par exemple juste le nom du commerçant), ou Annuler.',
      o.description
    );
    if (motCle?.trim()) {
      const r = await api('/api/regles', { method: 'POST', body: { motCle, categorie } });
      alert(`Règle créée. ${r.changees} autre(s) opération(s) reclassée(s).`);
    }
  } catch (err) {
    alert(err.message);
  }
  tableau = null;
  chargerOperations();
});

$('#basculer-rembourser').addEventListener('click', () => {
  $('#feuille-op').close();
  basculerARembourser(opActive.id);
});

$('#supprimer-op').addEventListener('click', async () => {
  $('#feuille-op').close();
  if (!confirm(`Supprimer « ${opActive.description} » (${euros(opActive.montant)}) ?`)) return;
  await api(`/api/operations/${encodeURIComponent(opActive.id)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  chargerOperations();
});

document.querySelectorAll('dialog [data-fermer]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// --- Ajout rapide -------------------------------------------------------------
// Montant, commerçant (auto-complétion), catégorie suggérée : « Ajouter ». La ligne du relevé la remplacera.
let commercants = [];
$('#ajouter').addEventListener('click', async () => {
  const f = $('#form-ajout');
  f.reset();
  dire(f, '');
  f.date.value = new Date().toLocaleDateString('sv-SE');
  f.categorie.innerHTML = etat.depenses.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#feuille-ajout').showModal();
  f.montant.focus();
  commercants = await api('/api/commercants').catch(() => []);
  $('#liste-commercants').innerHTML = commercants.map((c) => `<option value="${esc(c.nom)}"></option>`).join('');
});

let attenteSuggestion;
$('#form-ajout').description.addEventListener('input', (e) => {
  clearTimeout(attenteSuggestion);
  const description = e.target.value.trim();
  if (!description) return;
  attenteSuggestion = setTimeout(async () => {
    const { categorie } = await api(`/api/suggestion?description=${encodeURIComponent(description)}`).catch(() => ({}));
    if (categorie && etat.depenses.includes(categorie)) $('#form-ajout').categorie.value = categorie;
  }, 250);
});

$('#form-ajout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/operations', {
      method: 'POST',
      body: { montant: Number(f.montant.value.replace(',', '.')), description: f.description.value, categorie: f.categorie.value, date: f.date.value },
    });
    $('#feuille-ajout').close();
    tableau = null;
    afficherOnglet();
  } catch (err) {
    dire(f, err.message);
  }
});

// --- Revolut en automatique (Enable Banking) -----------------------------------
async function chargerBanque() {
  const b = await api('/api/banque');
  const date = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('#etat-banque').innerHTML = !b.configuree
    ? 'Pas encore réglé sur le serveur : il faut l’identifiant de l’application Enable Banking et la clé secrète (voir le guide de mise en ligne).'
    : !b.connectee
      ? 'Prêt. Touche « Connecter Revolut » : tu valides l’accès dans l’appli Revolut, puis tes opérations arrivent toutes seules, 4 fois par jour.'
      : `${ico('valide')} Connecté. Dernière récupération : <strong>${b.derniere ? date(b.derniere) : 'en cours…'}</strong>${b.solde != null ? ` · solde ${euros(b.solde)}` : ''}.<br>
         Accès valable jusqu’au ${b.validJusqua ? new Date(b.validJusqua).toLocaleDateString('fr-FR') : '?'}.`;
  if (b.erreur) $('#etat-banque').innerHTML += `<br><span class="rouge">${esc(b.erreur)}</span>`;
  $('#connecter-banque').hidden = !b.configuree || (b.connectee && !b.erreur);
  $('#connecter-banque').innerHTML = `${ico('lien')} ${b.connectee ? 'Reconnecter Revolut' : 'Connecter Revolut'}`;
  $('#recuperer-banque').hidden = !b.connectee;
}

$('#connecter-banque').addEventListener('click', async () => {
  try {
    const { url } = await api('/api/banque/connexion', { method: 'POST' });
    location.href = url; // page Revolut ; le retour arrive sur /api/banque/retour
  } catch (err) {
    dire($('#carte-banque'), err.message);
  }
});

$('#recuperer-banque').addEventListener('click', async () => {
  const b = $('#recuperer-banque');
  b.disabled = true;
  dire($('#carte-banque'), 'Récupération…');
  try {
    const r = await api('/api/banque/recuperer', { method: 'POST' });
    dire($('#carte-banque'), `${r.ajoutees} nouvelle(s) opération(s)${r.enAttente ? `, ${r.enAttente} en attente` : ''}${r.remplacees ? `, ${r.remplacees} saisie(s) remplacée(s)` : ''}.`);
    tableau = null;
  } catch (err) {
    dire($('#carte-banque'), err.message);
  }
  b.disabled = false;
  chargerBanque();
});

// --- Import ------------------------------------------------------------------
$('#form-import').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const fichier = f.fichier.files[0];
  if (!fichier) return;
  if (/\.json$/i.test(fichier.name)) return restaurer(f, fichier);
  f.querySelector('button').disabled = true;
  dire(f, 'Import en cours…');
  try {
    const r = await api('/api/import', { method: 'POST', brut: fichier });
    const i = r.ignorees;
    const details = [
      i.nonTerminees && `${i.nonTerminees} non terminée(s)`,
      i.changes && `${i.changes} change(s) de devise`,
      i.coffres && `${i.coffres} mouvement(s) internes aux coffres`,
      i.autreDevise && `${i.autreDevise} dans une autre devise que l’euro`,
      i.illisibles && `${i.illisibles} illisible(s)`,
    ].filter(Boolean);
    dire(f, `${r.ajoutees} opération(s) ajoutée(s), ${r.doublons} déjà connue(s).` +
      (details.length ? ` Ignorées : ${details.join(', ')}.` : '') +
      (r.exempleEfface ? ' Les opérations d’exemple ont été effacées.' : ''));
    if (r.mois) mois = r.mois;
    f.reset();
    chargerEtat();
  } catch (err) {
    dire(f, err.message);
  }
  f.querySelector('button').disabled = false;
});

async function restaurer(f, fichier) {
  if (!confirm('Restaurer cette sauvegarde ? Elle remplace toutes les opérations et tous les réglages actuels.')) return;
  dire(f, 'Restauration…');
  try {
    // En texte brut : le serveur ne limite pas sa taille comme pour le JSON habituel.
    const r = await api('/api/restaurer', { method: 'POST', brut: new Blob([await fichier.text()], { type: 'text/plain' }) });
    dire(f, `Sauvegarde du ${r.date} restaurée : ${r.operations} opérations.`);
    mois = null;
    f.reset();
    chargerEtat();
  } catch (err) {
    dire(f, err.message);
  }
}

$('#effacer-exemple').addEventListener('click', async () => {
  if (!confirm('Effacer toutes les opérations d’exemple ?')) return;
  await api('/api/exemple', { method: 'DELETE' });
  mois = null;
  chargerEtat();
});

// --- Réglages ----------------------------------------------------------------
// Réglages des enveloppes : quelle catégorie va dans quelle enveloppe (groupes de la liste des dépenses).
let enveloppesReglees = [];
function afficherReglagesEnveloppes(r) {
  enveloppesReglees = r.enveloppes;
  $('#carte-categories').innerHTML = etat.depenses.filter((c) => c !== 'Ne compte pas').map((c) => `
    <label>${esc(c)}
      <select data-categorie="${esc(c)}">
        ${r.enveloppes.map((e) => `<option value="${esc(e.id)}" ${e.categories.includes(c) ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}
        <option value="" ${r.enveloppes.some((e) => e.categories.includes(c)) ? '' : 'selected'}>Aucune enveloppe</option>
      </select>
    </label>`).join('');
}

$('#form-enveloppes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const choix = [...f.querySelectorAll('[data-categorie]')];
  const enveloppes = enveloppesReglees.map((x) => ({ id: x.id, categories: choix.filter((s) => s.value === x.id).map((s) => s.dataset.categorie) }));
  try {
    const r = await api('/api/enveloppes', { method: 'PUT', body: { enveloppes } });
    enveloppesReglees = r.enveloppes;
    dire(f, 'Enveloppes enregistrées.');
  } catch (err) {
    dire(f, err.message);
  }
});

// Budgets par catégorie comparés à ce qui est disponible ce mois-ci (enveloppe − épargne à remettre).
let reglagesChargees = null;
function bilanBudgets() {
  const r = reglagesChargees;
  if (!r) return;
  const total = [...document.querySelectorAll('#champs-budgets input')].reduce((s, i) => s + (Number(i.value) || 0), 0);
  const enveloppe = $('#budget-mensuel').value === '' ? null : Number($('#budget-mensuel').value);
  // Reste à remettre ce mois-ci = objectif − déjà mis de côté (jamais négatif).
  const aRemettre = $('#epargne-mois').value === r.mois ? Math.max(0, (Number($('#epargne-montant').value) || 0) - (r.epargneMise || 0)) : 0;
  if (enveloppe == null) { $('#bilan-budgets').textContent = `Total des budgets : ${euros0(total)}.`; return; }
  const dispo = enveloppe - aRemettre;
  const ecart = dispo - total;
  $('#bilan-budgets').innerHTML = `Total des budgets : <strong>${euros0(total)}</strong> pour ${euros0(dispo)} disponibles ce mois-ci →
    ${ecart >= 0 ? `<span class="vert">${euros0(ecart)} de marge</span>` : `<span class="rouge">${ico('alerte')} ${euros0(-ecart)} au-dessus du disponible</span>`}.`;
}
$('#form-budgets').addEventListener('input', bilanBudgets);
$('#form-epargne').addEventListener('input', bilanBudgets);

$('#proposer-budgets').addEventListener('click', () => {
  const p = reglagesChargees?.proposition;
  if (!p) return;
  document.querySelectorAll('#champs-budgets input').forEach((i) => { i.value = p.budgets[i.name] ?? ''; });
  bilanBudgets();
  dire($('#form-budgets'), `Proposition remplie (${euros0(p.total)}) : modifie ce que tu veux, puis enregistre.`);
});

$('#form-epargne').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/epargne', { method: 'PUT', body: { montant: Number($('#epargne-montant').value) || 0, mois: $('#epargne-mois').value || undefined } });
    dire(f, 'Enregistré.');
    tableau = null;
  } catch (err) {
    dire(f, err.message);
  }
});

async function chargerReglages() {
  const [r] = await Promise.all([api('/api/reglages'), chargerEtat()]);
  reglagesChargees = r;
  $('#epargne-montant').value = r.epargneAReconstituer?.montant ?? '';
  $('#epargne-mois').value = r.epargneAReconstituer?.mois ?? r.mois;
  $('#budget-mensuel').value = r.budgetMensuel ?? '';
  $('#champs-budgets').innerHTML = etat.depenses.map((c) => `
    <label>${esc(c)}
      <input name="${esc(c)}" type="number" min="0" max="100000" step="1" inputmode="decimal" placeholder="—" value="${r.budgets[c] ?? ''}">
    </label>`).join('');
  afficherReglagesEnveloppes(r);
  bilanBudgets();
  $('#liste-sources').innerHTML = r.sourcesRevenus.length
    ? r.sourcesRevenus.map((s) => `<li><span class="nom">${ico('etoile')} « ${esc(s.motCle)} »</span>
        <button class="petit secondaire" style="width:auto" data-retirer-source="${esc(s.motCle)}">Retirer</button></li>`).join('')
    : '<li class="vide">Aucun. Dans Dépenses, appuie sur un virement de tes parents → « Revenu sûr ».</li>';
  $('#liste-regles').innerHTML = r.regles.length
    ? r.regles.map((g) => `<li><span class="nom">« ${esc(g.motCle)} » → ${esc(g.categorie)}</span>
        <button class="petit secondaire" style="width:auto" data-supprimer="${esc(g.motCle)}">Supprimer</button></li>`).join('')
    : '<li class="vide">Aucune règle. Corrige une opération dans Dépenses pour en créer une.</li>';
  afficherNotion();
}

$('#form-budgets').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const budgets = Object.fromEntries([...f.querySelectorAll('#champs-budgets input')].map((i) => [i.name, i.value === '' ? null : Number(i.value)]));
  const mensuel = $('#budget-mensuel').value === '' ? null : Number($('#budget-mensuel').value);
  try {
    await api('/api/budgets', { method: 'PUT', body: { budgets, mensuel } });
    dire(f, 'Budgets enregistrés.');
  } catch (err) {
    dire(f, err.message);
  }
});

$('#liste-sources').addEventListener('click', async (e) => {
  const motCle = e.target.dataset.retirerSource;
  if (!motCle) return;
  await api(`/api/sources-revenus?motCle=${encodeURIComponent(motCle)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  chargerReglages();
});

$('#liste-regles').addEventListener('click', async (e) => {
  const motCle = e.target.dataset.supprimer;
  if (!motCle || !confirm(`Supprimer la règle « ${motCle} » ?`)) return;
  await api(`/api/regles?motCle=${encodeURIComponent(motCle)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  chargerReglages();
});

function afficherNotion() {
  const n = etat.notion;
  $('#aide-notion').textContent = etat.mode === 'notion'
    ? 'Envoie les totaux par catégorie du mois choisi dans « Résumé mensuel », et les dépenses de la catégorie Courses dans « Courses payées » (lues par Repax). Le détail des autres opérations ne part jamais. Chaque import et chaque correction envoient aussi les mois concernés.'
    : 'Notion n’est pas configuré (mode démo). Voir docs/MISE-EN-LIGNE.md pour l’activer.';
  $('#envoyer-notion').disabled = etat.mode !== 'notion' || n.enCours || !mois;
  $('#envoyer-notion').textContent = mois ? `Envoyer ${nomMois(mois)} vers Notion` : 'Envoyer vers Notion';
  $('#etat-notion').textContent = n.enCours ? `Envoi en cours… (${n.fait} mois envoyé(s))`
    : n.erreur ? `Erreur : ${n.erreur}`
    : n.fin ? `Dernier envoi : ${new Date(n.fin).toLocaleString('fr-FR')}` : '';
  if (n.enCours) setTimeout(() => chargerEtat().then(afficherNotion), 2000);
}

$('#envoyer-notion').addEventListener('click', async () => {
  try {
    etat.notion = await api('/api/notion', { method: 'POST', body: { mois } });
    afficherNotion();
  } catch (err) {
    $('#etat-notion').textContent = err.message;
  }
});

// --- Rafraîchir depuis Notion ----------------------------------------------------
// Relit les bases des autres applis (Repax, Agendix « Présence »), renvoie le mois en cours, puis recharge l'onglet affiché.
let rafraichissement = false;
let effacerStatut;
function statutNotion(texte, erreur = false) {
  const el = $('#statut-notion');
  clearTimeout(effacerStatut);
  el.hidden = !texte;
  el.textContent = texte;
  el.classList.toggle('erreur', erreur);
  if (texte && !erreur) effacerStatut = setTimeout(() => { el.hidden = true; }, 6000);
}

// Efface un message d'erreur de chargement quand un écran se charge enfin (les messages de succès s'effacent seuls).
function statutErreur() {
  if ($('#statut-notion').classList.contains('erreur')) statutNotion('');
}

$('#rafraichir-notion').addEventListener('click', async () => {
  if (rafraichissement) return;
  rafraichissement = true;
  const b = $('#rafraichir-notion');
  b.disabled = true;
  b.classList.add('charge');
  statutNotion('Notion : mise à jour en cours…');
  try {
    const { lues } = await api('/api/notion/rafraichir', { method: 'POST' });
    const n = (titre, mot) => (lues[titre] == null ? `${mot} : absent` : `${mot} : ${lues[titre]}`);
    statutNotion(`Notion à jour — ${n('Liste de courses', 'courses Repax')}, ${n('Planning des repas', 'repas')}, ${n('Présence', 'présence Agendix')}.`);
    tableau = null; // les chiffres affichés viennent de Notion en partie : on les relit
    afficherOnglet();
  } catch (err) {
    statutNotion(`Notion : ${err.message}`, true);
  }
  b.classList.remove('charge');
  b.disabled = false;
  rafraichissement = false;
});

// --- Démarrage ---------------------------------------------------------------
chargerEtat().catch(() => {}).finally(afficherOnglet);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
