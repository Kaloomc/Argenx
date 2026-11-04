// --- Outils ------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const euros = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
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
  return `<div class="barre"><div style="width:${pc}%" class="${valeur > max ? 'depasse' : ''}"></div></div>`;
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
  analyses: () => chargerTableau(),
  operations: () => chargerOperations(),
  importer: () => Promise.all([chargerEtat(), chargerBanque()]),
  reglages: () => chargerReglages(),
};

function afficherOnglet() {
  const id = location.hash.slice(1) || 'accueil';
  document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.hash === '#' + id));
  $('#choix-mois').hidden = !['mois', 'analyses', 'operations'].includes(id) || !mois;
  $('#ajouter').hidden = !['accueil', 'operations'].includes(id);
  CHARGER[id]?.().catch((err) => console.error(err));
}
addEventListener('hashchange', afficherOnglet);

$('#choix-mois').addEventListener('change', (e) => {
  mois = e.target.value;
  afficherOnglet();
});

async function chargerEtat() {
  etat = await api('/api/etat');
  $('#mode').hidden = etat.mode !== 'demo';
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

// --- Accueil : enveloppes ------------------------------------------------------
const memoire = {
  lire: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  ecrire: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let vue = memoire.lire('argenx-vue') === 'mois' ? 'mois' : 'semaine';
const ETAT_TEXTE = { vert: 'ça tient', orange: 'attention', rouge: 'dépassé' };
const ETAT_ICONE = { orange: '⚠️', rouge: '⛔' };

document.querySelectorAll('.bascule button').forEach((b) => b.addEventListener('click', () => {
  vue = b.dataset.vue;
  memoire.ecrire('argenx-vue', vue);
  chargerAccueil();
}));

async function chargerAccueil() {
  document.querySelectorAll('.bascule button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vue === vue)));
  afficherAccueil(await api(`/api/accueil?vue=${vue}`));
}

// La barre montre ce qui reste : pleine au début, vide quand l'enveloppe est épuisée.
const barreReste = (reste, budget, fine) =>
  `<div class="barre ${fine ? 'fine' : ''}"><div style="width:${budget > 0 ? Math.max(0, Math.min(100, (reste / budget) * 100)) : 0}%"></div></div>`;

function afficherAccueil(a) {
  const periode = a.vue === 'mois' ? 'ce mois-ci' : 'cette semaine';
  $('#resume-accueil').innerHTML = `
    <small>Il te reste ${periode}</small>
    <strong class="enorme ${a.reste < 0 ? 'rouge' : ''}">${euros(a.reste)}</strong>
    <small>${a.joursRestants} jour${a.joursRestants > 1 ? 's' : ''} restant${a.joursRestants > 1 ? 's' : ''} · environ ${euros(a.parJour)} par jour</small>`;
  $('#alertes').innerHTML = a.alertes.slice(0, 3).map((x) => `<li class="${x.etat}">${ETAT_ICONE[x.etat]} ${esc(x.texte)}</li>`).join('');
  $('#liste-enveloppes').innerHTML = a.enveloppes.map((e) => `
    <div class="carte enveloppe etat-${e.etat}">
      <div class="haut"><span class="nom">${esc(e.nom)}${e.mensuelle && a.vue === 'semaine' ? ' <small>ce mois-ci</small>' : ''}</span>
        <strong class="reste">${euros(e.reste)}</strong></div>
      ${barreReste(e.reste, e.budget)}
      <div class="bas"><span>${euros(e.depense)} dépensés sur ${euros(e.budget)}</span><span>${ETAT_TEXTE[e.etat]}</span></div>
      ${e.plafond ? `
        <div class="plafond etat-${e.plafond.etat}">
          <div class="haut"><span>dont ${esc(e.plafond.nom)} <small>ce mois-ci</small></span><strong class="reste">${euros(e.plafond.reste)}</strong></div>
          ${barreReste(e.plafond.reste, e.plafond.budget, true)}
          <div class="bas"><span>${euros(e.plafond.depense)} sur ${euros(e.plafond.budget)}</span><span>${ETAT_TEXTE[e.plafond.etat]}</span></div>
        </div>` : ''}
    </div>`).join('');
  const r = a.revenus;
  $('#revenus-mois').innerHTML = `
    <h3>Ce mois-ci</h3>
    <div class="chiffres">
      <div><small>Revenus sûrs reçus</small><strong>${euros(r.surs)}</strong><small>sur ${euros(r.attendus)} attendus</small></div>
      <div><small>Entrées variables</small><strong>${euros(r.variables)}</strong><small>pas dans le budget</small></div>
      <div><small>À récupérer</small><strong class="${r.aRecuperer ? 'orange' : ''}">${euros(r.aRecuperer)}</strong><small>${r.avances} avance${r.avances > 1 ? 's' : ''}</small></div>
    </div>
    ${r.sourcesConfigurees ? '' : '<p class="aide">Pour reconnaître tes revenus sûrs : dans 📋 Dépenses, appuie sur un virement de tes parents → « ★ Revenu sûr ».</p>'}`;
  const hier = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
  $('#fraicheur').textContent = a.jusquau < hier
    ? `Dépenses connues jusqu'au ${jourCourt(a.jusquau)}. Importe ton relevé Revolut (onglet ⬆️) pour être à jour.`
    : '';
}

// --- Tableau de bord ---------------------------------------------------------
async function chargerTableau() {
  tableau = await api(`/api/tableau${mois ? `?mois=${mois}` : ''}`);
  mois = tableau.mois;
  const choix = $('#choix-mois');
  const liste = tableau.moisDispo.includes(mois) ? tableau.moisDispo : [mois, ...tableau.moisDispo];
  choix.innerHTML = liste.map((m) => `<option value="${m}" ${m === mois ? 'selected' : ''}>${nomMois(m)}</option>`).join('');
  choix.hidden = !['mois', 'analyses', 'operations'].includes(location.hash.slice(1) || 'accueil');
  dessiner();
  afficherAnalyses();
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
    <h3>🛒 Courses</h3>
    <div class="ligne-budget">
      <div><small>Prévu (7 prochains jours)</small><strong>${euros(p.total)}</strong></div>
      <div><small>Dépensé ce mois-ci</small><strong>${euros(c.depense)}</strong></div>
    </div>
    <p>${p.repas} repas prévus dans Repax, dont <strong>${euros(p.resteAAcheter)}</strong> encore à acheter.</p>
    <p>Fin du mois estimée : <strong>${euros(c.finDeMois)}</strong> de courses (dépensé + reste à acheter)${c.budget
      ? ` : ${c.finDeMois <= c.budget ? `<span class="vert">dans ton budget Courses de ${euros(c.budget)} ✔</span>` : `<span class="rouge">${euros(c.finDeMois - c.budget)} au-dessus de ton budget Courses ⚠</span>`}`
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
  afficherBudget();

  if (!window.Chart) {
    $('#liste-categories').innerHTML = '<li class="vide">Graphiques indisponibles sans connexion Internet.</li>';
    return;
  }
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
    options: { maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: infobulle } },
  });
  // Le détail en liste (lisible sans les couleurs)
  $('#liste-categories').innerHTML = depenses.length
    ? depenses.map((c) => `<li><span class="pastille" style="background:${couleur(c.categorie)}"></span><span class="nom">${esc(c.categorie)} <small>${c.nb} op.</small></span><span class="cout">${euros(c.montant)}</span></li>`).join('')
    : '<li class="vide">Aucune dépense ce mois-ci.</li>';

  const barres = { borderRadius: 4, maxBarThickness: 28, borderSkipped: false };
  graphe('g-entrees', {
    type: 'bar',
    data: { labels: ['Entrées', 'Dépenses'], datasets: [{ data: [t.entrees, t.sorties], backgroundColor: [css('--serie-1'), css('--serie-2')], ...barres }] },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: infobulle },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => euros(v).replace(',00', '') } }, y: { grid: { display: false } } },
    },
  });

  graphe('g-evolution', {
    type: 'bar',
    data: {
      labels: t.evolution.map((e) => new Date(e.mois + '-15T12:00:00').toLocaleDateString('fr-FR', { month: 'short' })),
      datasets: [
        { label: 'Entrées', data: t.evolution.map((e) => e.entrees), backgroundColor: css('--serie-1'), ...barres },
        { label: 'Dépenses', data: t.evolution.map((e) => e.sorties), backgroundColor: css('--serie-2'), ...barres },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: infobulle },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 6 } }, y: { beginAtZero: true, ticks: { callback: (v) => euros(v).replace(',00', '') } } },
    },
  });

  $('#top').innerHTML = t.top.length
    ? t.top.map((c) => `<li><span class="nom">${esc(c.nom)} <small>${esc(c.categorie)} · ${c.nb} fois</small></span><span class="cout">${euros(c.montant)}</span></li>`).join('')
    : '<li class="vide">Rien ce mois-ci.</li>';
}
// Carte « Budget du mois » : ce qui reste, par jour, et où mène le rythme actuel.
function afficherBudget() {
  const r = tableau.rythme;
  const el = $('#budget-mois');
  if (!r.budget) {
    el.innerHTML = '<p class="vide">Fixe ton budget du mois dans ⚙️ Réglages pour savoir combien il te reste.</p>';
    return;
  }
  const lignes = [`
    <div class="ligne-budget">
      <div><small>Reste à dépenser</small><strong class="gros ${r.reste < 0 ? 'rouge' : ''}">${euros(r.reste)}</strong></div>
      <small>${euros(r.depense)} dépensés sur ${euros(r.budget)}</small>
    </div>${barre(r.depense, r.budget)}`];
  const aVenir = r.aVenir.map((a) => `${esc(a.nom)} ${euros(a.montant)} vers le ${Number(a.prochain.slice(8, 10))}`).join(', ');
  if (r.enCours && r.reste < 0) {
    lignes.push(`<p class="rouge">Budget dépassé de ${euros(-r.reste)}, et il reste ${r.joursRestants} jours.</p>`);
  } else if (r.enCours) {
    lignes.push(`<p>Il reste <strong>${r.joursRestants} jours</strong> : environ <strong>${euros(r.parJour)} par jour</strong>${r.totalAVenir ? `, une fois payés les abonnements à venir (${aVenir})` : ''}.</p>`);
    const ecart = Math.round((r.budget - r.projection) * 100) / 100;
    lignes.push(`<p>À ce rythme, environ <strong>${euros(r.projection)}</strong> dépensés à la fin du mois : ${ecart >= 0 ? `<span class="vert">${euros(ecart)} sous ton budget ✔</span>` : `<span class="rouge">${euros(-ecart)} au-dessus ⚠</span>`}.</p>`);
  } else if (r.joursRestants === 0) {
    lignes.push(r.reste >= 0
      ? `<p class="vert">Mois terminé : ${euros(r.reste)} sous ton budget ✔</p>`
      : `<p class="rouge">Mois terminé : ${euros(-r.reste)} au-dessus de ton budget ⚠</p>`);
  }
  if (r.enCours && (Date.now() - Date.parse(r.jusquau + 'T23:59:59')) / 864e5 > 3) {
    lignes.push(`<p class="aide">Opérations connues jusqu'au ${jourCourt(r.jusquau)} : importe un relevé récent pour être à jour.</p>`);
  }
  if (tableau.rembourses) lignes.push(`<p class="aide">↔ ${tableau.rembourses} achat(s) remboursé(s) ce mois-ci, retirés des totaux.</p>`);
  el.innerHTML = lignes.join('');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => tableau && dessiner());

// --- Analyses ----------------------------------------------------------------
function afficherAnalyses() {
  const t = tableau;
  const avecBudget = t.categories.filter((c) => c.budget);
  $('#budgets').innerHTML = avecBudget.length
    ? `<ul class="liste">${avecBudget.map((c) => `
        <li><span class="nom">${esc(c.categorie)}</span>
          <span class="cout ${c.montant > c.budget ? 'rouge' : ''}">${euros(c.montant)} <small>/ ${euros(c.budget)}</small></span>
          ${barre(c.montant, c.budget)}</li>`).join('')}</ul>`
    : '<p class="vide">Aucun budget pour l’instant : fixe-les dans ⚙️ Réglages.</p>';

  const actifs = t.abonnements.filter((a) => a.actif);
  $('#abonnements').innerHTML = t.abonnements.length
    ? `<p><strong>${euros(actifs.reduce((s, a) => s + a.coutAnnuel, 0))}</strong> par an pour ${actifs.length} abonnement(s) en cours.</p>
       <ul class="liste">${t.abonnements.map((a) => `
        <li ${a.actif ? '' : 'class="vide"'}><span class="nom">${esc(a.nom)}
          <small>${a.fois} paiements · dernier le ${jourCourt(a.dernier)}${a.actif ? '' : ' · plus vu depuis'}</small></span>
          <span class="cout">${euros(a.montant)}<small>/mois · ${euros(a.coutAnnuel)}/an</small></span>
          <button class="petit secondaire" style="width:auto" data-pas-abonnement="${esc(a.cle)}" data-nom="${esc(a.nom)}">Pas un abonnement</button></li>`).join('')}</ul>`
    : '<p class="vide">Aucun abonnement repéré (il faut au moins 2 paiements à environ un mois d’écart).</p>';

  $('#comparaison').innerHTML = t.comparaison.length
    ? `<p class="aide">${nomMois(t.mois)} comparé au mois d’avant.</p><ul class="liste">${t.comparaison.map((c) => `
        <li><span class="nom">${esc(c.categorie)} <small>${euros(c.avant)} → ${euros(c.ceMois)}</small></span>
          <span class="cout ${c.ecart > 0 ? 'rouge' : c.ecart < 0 ? 'vert' : ''}">${c.ecart > 0 ? '▲ +' : c.ecart < 0 ? '▼ ' : ''}${euros(c.ecart)}</span></li>`).join('')}</ul>`
    : '<p class="vide">Pas de dépenses sur ces deux mois.</p>';

  $('#inhabituelles').innerHTML = t.inhabituelles.length
    ? `<ul class="liste">${t.inhabituelles.map((o) => `
        <li><span class="nom">${esc(o.description)} <small>${jourCourt(o.date)} · ${esc(o.categorie)}, d’habitude ${euros(o.mediane)}</small></span>
          <span class="cout">${euros(o.montant)}</span></li>`).join('')}</ul>`
    : '<p class="vide">Rien d’inhabituel ce mois-ci (plus de 3 fois la dépense habituelle de la catégorie).</p>';
}

$('#abonnements').addEventListener('click', async (e) => {
  const { pasAbonnement: cle, nom } = e.target.dataset;
  if (!cle) return;
  await api('/api/pas-abonnements', { method: 'POST', body: { cle, nom } }).catch((err) => alert(err.message));
  chargerTableau();
});

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
    o.provisoire && '<span class="badge-op orange">⏳ en attente</span>',
    o.aRembourser > 0 && (o.recu >= o.aRembourser
      ? `<span class="badge-op vert">✓ remboursé ${euros(o.recu)}</span>`
      : `<span class="badge-op orange">💸 à rembourser ${o.recu ? `${euros(o.recu)} / ` : ''}${euros(o.aRembourser)}</span>`),
    o.revenuSur && '<span class="badge-op vert">★ revenu sûr</span>',
    ...(o.affectations || []).map((a) => `<span class="badge-op">↔ rembourse « ${esc(a.description)} » ${euros(a.montant)}</span>`),
    o.montant > 0 && o.categorie === 'Revenus' && !o.revenuSur && !o.affectations?.length && !o.rembourse && '<span class="badge-op">entrée variable</span>',
    o.manuel && !o.manuelle && '<span class="badge-op">corrigée</span>',
  ].filter(Boolean).join('');
  const lien = r
    ? `<span class="rembourse"><span>↔ ${o.montant < 0 ? 'remboursé par' : 'rembourse'} « ${esc(r.description)} » le ${jourCourt(r.date)} : ne compte pas</span>
       <button class="petit secondaire" style="width:auto" data-pas-rembourse="${esc(o.id)}">Pas un remboursement</button></span>`
    : '';
  return `<li class="op ${r || o.categorie === 'Ne compte pas' ? 'annulee' : ''}" data-id="${esc(o.id)}">
    <span class="fond fond-droite" aria-hidden="true">${o.montant > 0 ? '↔ Remboursement' : '💸 À rembourser'}</span>
    <span class="fond fond-gauche" aria-hidden="true">Catégorie 🏷️</span>
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
    alert(`${euros(r.montant)} rapprochés.${r.reste > 0 ? ` Il reste ${euros(r.reste)} à récupérer sur cette dépense.` : ' Dépense entièrement remboursée ✔'}`);
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
  $('#basculer-rembourser').textContent = o.aRembourser ? '✓ À rembourser (retirer)' : '💸 À rembourser';
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
      : `✔ Connecté. Dernière récupération : <strong>${b.derniere ? date(b.derniere) : 'en cours…'}</strong>${b.solde != null ? ` · solde ${euros(b.solde)}` : ''}.<br>
         Accès valable jusqu’au ${b.validJusqua ? new Date(b.validJusqua).toLocaleDateString('fr-FR') : '?'}.`;
  if (b.erreur) $('#etat-banque').innerHTML += `<br><span class="rouge">${esc(b.erreur)}</span>`;
  $('#connecter-banque').hidden = !b.configuree || (b.connectee && !b.erreur);
  $('#connecter-banque').textContent = b.connectee ? '🔗 Reconnecter Revolut' : '🔗 Connecter Revolut';
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
    dire($('#carte-banque'), `✔ ${r.ajoutees} nouvelle(s) opération(s)${r.enAttente ? `, ${r.enAttente} en attente` : ''}${r.remplacees ? `, ${r.remplacees} saisie(s) remplacée(s)` : ''}.`);
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
    dire(f, `✔ ${r.ajoutees} opération(s) ajoutée(s), ${r.doublons} déjà connue(s).` +
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
    dire(f, `✔ Sauvegarde du ${r.date} restaurée : ${r.operations} opérations.`);
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
// Réglages des enveloppes : montants, plafond, revenus sûrs, et quelle catégorie va où.
let enveloppesReglees = [];
function afficherReglagesEnveloppes(r) {
  enveloppesReglees = r.enveloppes;
  $('#champs-enveloppes').innerHTML = r.enveloppes.map((e) => {
    const cle = e.parSemaine !== undefined ? 'parSemaine' : 'parMois';
    return `<label>${esc(e.nom)} <small>€/${cle === 'parSemaine' ? 'semaine' : 'mois'}</small>
        <input data-enveloppe="${esc(e.id)}" data-cle="${cle}" type="number" min="0" max="10000" step="1" inputmode="decimal" value="${e[cle]}" required>
      </label>${e.plafond ? `<label>${esc(e.plafond.nom)} <small>€/mois, compté dans ${esc(e.nom)}</small>
        <input data-plafond="${esc(e.id)}" type="number" min="0" max="10000" step="1" inputmode="decimal" value="${e.plafond.parMois}" required>
      </label>` : ''}`;
  }).join('');
  $('#revenus-surs').value = r.revenusSurs;
  $('#carte-categories').innerHTML = etat.depenses.filter((c) => c !== 'Ne compte pas').map((c) => `
    <label>${esc(c)}
      <select data-categorie="${esc(c)}">
        ${r.enveloppes.map((e) => `<option value="${esc(e.id)}" ${e.categories.includes(c) ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}
        <option value="" ${r.enveloppes.some((e) => e.categories.includes(c)) ? '' : 'selected'}>Aucune enveloppe</option>
      </select>
    </label>`).join('');
  bilanEnveloppes();
}

// Budget prévu sur un mois moyen comparé aux revenus sûrs.
function bilanEnveloppes() {
  const total = [...document.querySelectorAll('#champs-enveloppes [data-enveloppe]')]
    .reduce((s, i) => s + (Number(i.value) || 0) * (i.dataset.cle === 'parSemaine' ? 52 / 12 : 1), 0);
  const revenus = Number($('#revenus-surs').value) || 0;
  const ecart = revenus - total;
  $('#bilan-enveloppes').innerHTML = `Budget prévu : <strong>${euros(total)}</strong> par mois pour ${euros(revenus)} de revenus sûrs →
    ${ecart >= 0 ? `<span class="vert">${euros(ecart)} de marge</span>` : `<span class="rouge">il manque ${euros(-ecart)} par mois</span>`}.`;
}
$('#form-enveloppes').addEventListener('input', bilanEnveloppes);

$('#form-enveloppes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const choix = [...f.querySelectorAll('[data-categorie]')];
  const enveloppes = enveloppesReglees.map((x) => {
    const champ = f.querySelector(`[data-enveloppe="${x.id}"]`);
    const plafond = f.querySelector(`[data-plafond="${x.id}"]`);
    return {
      id: x.id,
      [champ.dataset.cle]: Number(champ.value),
      categories: choix.filter((s) => s.value === x.id).map((s) => s.dataset.categorie),
      ...(plafond && { plafond: { parMois: Number(plafond.value) } }),
    };
  });
  try {
    const r = await api('/api/enveloppes', { method: 'PUT', body: { enveloppes, revenusSurs: Number($('#revenus-surs').value) } });
    enveloppesReglees = r.enveloppes;
    dire(f, 'Enveloppes enregistrées ✔');
  } catch (err) {
    dire(f, err.message);
  }
});

async function chargerReglages() {
  const [r] = await Promise.all([api('/api/reglages'), chargerEtat()]);
  $('#budget-mensuel').value = r.budgetMensuel ?? '';
  $('#champs-budgets').innerHTML = etat.depenses.map((c) => `
    <label>${esc(c)}
      <input name="${esc(c)}" type="number" min="0" max="100000" step="1" inputmode="decimal" placeholder="—" value="${r.budgets[c] ?? ''}">
    </label>`).join('');
  afficherReglagesEnveloppes(r);
  $('#liste-sources').innerHTML = r.sourcesRevenus.length
    ? r.sourcesRevenus.map((s) => `<li><span class="nom">★ « ${esc(s.motCle)} »</span>
        <button class="petit secondaire" style="width:auto" data-retirer-source="${esc(s.motCle)}">Retirer</button></li>`).join('')
    : '<li class="vide">Aucun. Dans 📋 Dépenses, appuie sur un virement de tes parents → « ★ Revenu sûr ».</li>';
  $('#liste-regles').innerHTML = r.regles.length
    ? r.regles.map((g) => `<li><span class="nom">« ${esc(g.motCle)} » → ${esc(g.categorie)}</span>
        <button class="petit secondaire" style="width:auto" data-supprimer="${esc(g.motCle)}">Supprimer</button></li>`).join('')
    : '<li class="vide">Aucune règle. Corrige une opération dans 📋 Opérations pour en créer une.</li>';
  $('#liste-pas-abonnements').innerHTML = r.pasAbonnements.length
    ? r.pasAbonnements.map((p) => `<li><span class="nom">${esc(p.nom)}</span>
        <button class="petit secondaire" style="width:auto" data-remettre="${esc(p.cle)}">Remettre</button></li>`).join('')
    : '<li class="vide">Aucun. Dans 🔍 Analyses, « Pas un abonnement » retire un commerçant de la liste.</li>';
  afficherNotion();
}

$('#form-budgets').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const budgets = Object.fromEntries([...f.querySelectorAll('#champs-budgets input')].map((i) => [i.name, i.value === '' ? null : Number(i.value)]));
  const mensuel = $('#budget-mensuel').value === '' ? null : Number($('#budget-mensuel').value);
  try {
    await api('/api/budgets', { method: 'PUT', body: { budgets, mensuel } });
    dire(f, 'Budgets enregistrés ✔');
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

$('#liste-pas-abonnements').addEventListener('click', async (e) => {
  const cle = e.target.dataset.remettre;
  if (!cle) return;
  await api(`/api/pas-abonnements?cle=${encodeURIComponent(cle)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
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

// --- Démarrage ---------------------------------------------------------------
chargerEtat().catch(() => {}).finally(afficherOnglet);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
