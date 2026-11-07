# Argenx

Appli web pour téléphone (PWA installable) qui range tes dépenses à partir des **relevés CSV de Revolut** :

1. **reste à dépenser du mois** (haut de l'accueil) : enveloppe du mois (400 €) − épargne à remettre (117 € en novembre 2026) − dépenses du mois, avec le montant par jour et le suivi « Épargne à reconstituer ». Calculé sur le mois en cours seulement, jamais sur les mois précédents ;
2. **achats remboursés repérés tout seuls** (meuble remboursé par le magasin, billet remboursé par un proche) : ils ne comptent pas ;
3. **import** du relevé (export en anglais ou en français), sans doublons même si les périodes se chevauchent ;
4. **classement automatique** par règles (Courses, Transport, Abonnements…), que tu corriges en un geste ;
5. **tableau de bord du mois** : dépenses par catégorie (avec le budget en repère), entrées et dépenses, top 10 des commerçants (Utile, Super U… regroupés) ;
7. **résumé mensuel dans Notion** (totaux par catégorie) et **courses payées** (détail de la seule catégorie Courses, pour Repax) ;
8. **courses prévues par Repax**, lues dans la même page Notion.

Pas d'IA : tout est fait par règles simples, expliquées plus bas. Les analyses décrivent tes dépenses ; ce ne sont pas des conseils financiers.

## Revolut en automatique (sans CSV)

Par l'Open Banking, via [Enable Banking](https://enablebanking.com) (gratuit pour relier ses propres comptes) : onglet **Importer** → **Connecter Revolut** → tu valides dans l'appli Revolut. Ensuite, Argenx récupère tes opérations tout seul 4 fois par jour (et sur le bouton « Récupérer maintenant »), avec le solde réel. Les paiements en attente apparaissent « en attente » et sont mis à jour à chaque récupération ; les opérations déjà importées par CSV et tes saisies du bouton + ne sont pas doublées. L'accès dure jusqu'à 180 jours, puis il faut reconnecter. Réglage : [docs/MISE-EN-LIGNE.md](docs/MISE-EN-LIGNE.md), section 10.

## Exporter le relevé depuis l'appli Revolut

1. Ouvre l'appli Revolut, onglet **Accueil**, sur ton compte en **euros**.
2. Touche **•••** (Plus) sous le solde → **Relevé** (ou **Documents** → **Relevé de compte**).
3. Choisis le format **Excel** (c'est un fichier **CSV**), puis la **période** (par exemple les 3 derniers mois).
4. **Générer** → enregistre le fichier ou envoie-le-toi.
5. Dans Argenx : onglet **Importer** → choisis le fichier → **Importer**.

Les menus de Revolut changent de temps en temps : cherche « Relevé » / « Statement » et le format Excel/CSV.
Tu peux réimporter une période qui recouvre la précédente : les opérations déjà connues sont ignorées.

## Lancer en local

Il faut Node.js 20 ou plus récent.

```bash
npm install
```

```bash
npm start
```

Puis ouvrir http://localhost:3012. Tests : `npm test`.

Sans `APP_PASSWORD`, le serveur n'écoute que sur cet ordinateur (127.0.0.1). Pour le mettre sur le NAS : [docs/MISE-EN-LIGNE.md](docs/MISE-EN-LIGNE.md).

## Mode démo

Sans Notion configuré, l'appli démarre avec **6 mois d'opérations d'exemple entièrement fictives** pour voir les graphiques. Elles sont effacées dès le premier vrai import (ou avec le bouton « Effacer les opérations d'exemple »).

## Où sont les données

| Quoi | Où |
|---|---|
| Toutes les opérations | `data/operations.json`, sur le serveur (le NAS) |
| Tes règles et budgets | `data/reglages.json` |
| Totaux par mois et par catégorie | Notion, base « Résumé mensuel » |
| Dépenses de la catégorie Courses (date, commerçant, montant) | Notion, base « Courses payées » (lue par Repax) |

Argenx partage **la même page Notion** que Repax et Agendix (même `NOTION_TOKEN`, même `NOTION_PAGE_ID`) : les applis ne se parlent pas directement, elles lisent les bases des autres.
Argenx lit « Liste de courses » et « Planning des repas » de Repax pour la carte « Courses ». Le détail des autres catégories ne part jamais vers Notion.

Le dossier `data/` n'est jamais envoyé sur GitHub. Les jetons et mots de passe sont seulement dans les variables d'environnement.

**Sauvegarde** : Réglages → « Télécharger une sauvegarde » (un fichier `.json` avec opérations, règles et corrections). Pour la remettre : Importer, choisir ce fichier (remplace tout). Sur le NAS, une tâche Hyper Backup du dossier `/docker` couvre aussi ces fichiers.

## Les règles de lecture du CSV

- Colonnes reconnues en anglais (`Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`) ou en français (`Type, Produit, Date de début, Date de fin, Description, Montant, Frais, Devise, État, Solde`), séparées par des virgules ou des points-virgules. Si elles ne sont pas reconnues, l'appli affiche celles qu'elle a trouvées.
- Montant d'une opération = **Montant − Frais**.
- Ignorées : les opérations **non terminées** (en attente, renvoyées), les lignes à 0 € (« Closing transaction »), les **changes** de devise, les opérations dans une autre devise que l'euro, et les lignes des produits « Épargne », « Dépôt » ou « Savings » (le virement vers le coffre, côté compte courant, suffit).
- Doublon = même date et heure, même description, même montant, même solde.

## Comment les opérations sont classées

Dans l'ordre :

1. **tes règles** (créées quand tu corriges une opération) ;
2. virement vers un **coffre / pocket / épargne** → **Épargne** (ne compte pas comme une dépense) ;
3. retrait au distributeur → **Retraits** ; recharge (top-up) → **Revenus** ;
4. argent qui arrive (sauf remboursement) → **Revenus** ;
5. **mots-clés du commerçant** (Super U, Lidl → Courses ; SNCF, Uber → Transport ; Netflix, Spotify → Abonnements ; McDonald's, Deliveroo → Restos…), liste dans `categories.js` ;
6. sinon, virement à quelqu'un → **Proches**, le reste → **Autres**.

Un remboursement garde la catégorie du commerçant et vient en déduction de ses dépenses.
Quand tu changes la catégorie d'une opération (onglet Opérations), l'appli propose d'en faire une **règle** qui reclasse les opérations passées et futures (sauf celles que tu as corrigées à la main).

## Les enveloppes (regroupement des dépenses)

Une enveloppe regroupe des catégories, sans montant : la liste **Dépenses** range chaque jour par enveloppe (avec le total du groupe), et l'accueil montre le **reste à dépenser du mois**.

| Enveloppe | Catégories |
|---|---|
| Courses | Courses |
| Resto & fast-food | Restos & fast-food |
| Achats libres | Shopping, Loisirs, Transport, Santé, Études, Logement, Retraits, Proches, Autres |
| Abonnements | Abonnements |

Basic-Fit est remboursé par le virement « salle » : une règle le met en **Ne compte pas** (supprimable dans Réglages → Mes règles).
Dans Réglages, tu choisis aussi quelle catégorie va dans quelle enveloppe.

## Ajouter une dépense et la liste des dépenses

- **Bouton +** (accueil et Dépenses) : montant, commerçant (auto-complétion sur ceux déjà vus), catégorie suggérée (celle de sa dernière dépense, sinon les règles), date du jour. Les enveloppes sont à jour tout de suite.
- Quand le relevé Revolut arrive, la saisie est **remplacée** par la vraie ligne si le montant est identique, à 3 jours près. La ligne garde la catégorie choisie et la marque « à rembourser ». Pas de doublon.
- **Dépenses** : par jour, puis par enveloppe (avec le total du groupe).
  - glisser vers la **gauche** : changer de catégorie (l'appli propose d'en faire une règle) ;
  - glisser vers la **droite** : marquer « à rembourser » (ou l'enlever) ;
  - un **appui** : les mêmes actions, et « Supprimer » pour une dépense ajoutée à la main (les lignes du relevé ne se suppriment pas : elles reviendraient au prochain import).

## Avances, remboursements et revenus sûrs

- **Avance pour quelqu'un** : glisse la dépense à droite (« à rembourser », la dépense entière). Un appui permet de changer la part à récupérer (par exemple 20 € sur un resto à 40 €).
- **Le virement arrive** : glisse-le à droite (« c'est un remboursement ») et choisis la dépense. Seul ce qui manque est rapproché ; le surplus reste une entrée variable. Plusieurs virements peuvent rembourser une même dépense.
- Partout (reste à dépenser, Insights, Notion), on compte la **dépense nette** : 40 € avancés − 20 € rendus = 20 €. Le virement de remboursement ne compte **pas** comme une entrée.
- Un remboursement exact (même montant, à moins de 30 jours) s'annule toujours tout seul, sans rien faire.
- **Revenus sûrs** : appuie sur un virement de tes parents → « Revenu sûr (toujours) » (mot-clé = l'expéditeur). La liste se gère dans Réglages → Revenus sûrs. Tout autre argent reçu est une **entrée variable**, jamais comptée comme acquise (simple repère, sans effet sur les chiffres).
- Dans Dépenses, chaque ligne porte son badge : « à rembourser », « revenu sûr », « entrée variable ».

## Le reste à dépenser du mois (accueil)

Fixe dans Réglages l'**enveloppe du mois** (400 € par défaut) et, si besoin, l'**épargne à reconstituer** (montant et mois). Les revenus et l'épargne ne comptent jamais comme des dépenses.

- **disponible** = enveloppe − ce qu'il reste à remettre en épargne ce mois-là, soit objectif − déjà mis de côté (400 − 117 = 283 € au départ ; après 30 € versés, 400 − 87 = 313 €) ;
- **reste à dépenser** = disponible − dépenses du mois ;
- **par jour** = reste ÷ jours restants, aujourd'hui compris (accueil et widget comptent pareil) ;
- **à ce rythme** = dépensé + (dépensé ÷ jours écoulés) × jours restants, donné à partir du 7e jour du mois seulement. Aucun mois précédent n'entre dans ces chiffres.
- **Épargne à reconstituer** : la barre avance avec tes virements vers un coffre Revolut ce mois-ci (catégorie Épargne, net des retraits depuis un coffre) et disparaît quand le montant est atteint. Chaque euro versé libère un euro de disponible (les dépenses ne comptent pas l'épargne) : après 30 € versés, le reste à dépenser monte de 30 €.
- **Budgets par catégorie** (Réglages) : un bouton propose 140 € Courses, 40 € Restos, 30 € Transport, 30 € Loisirs, 43 € Autres (283 € en tout). Rien n'est appliqué sans enregistrement ; l'appli avertit si la somme dépasse le disponible.
- Jusqu'à 3 phrases « à surveiller » (budget d'une catégorie à 80 %, dépassé, ou consommé plus vite que le mois).

Le « jour connu » est la date de ta dernière opération importée : importe un relevé récent pour que les calculs soient à jour.

## Widget iPhone (facultatif)

Un widget [Scriptable](https://scriptable.app) (appli gratuite) affiche ce qu'il reste cette semaine et ce mois-ci, et l'épargne à reconstituer. Il lit `GET /api/widget/argent` : lecture seule, calculé depuis les données de l'appli (jamais depuis Notion), sans libellés d'opérations ni noms de magasins, `Cache-Control: no-store`.

1. **Jeton** : choisis un long jeton aléatoire (16 caractères au minimum), par exemple le résultat de `openssl rand -hex 24`, et mets-le dans `WIDGET_TOKEN` (YAML du NAS, puis redémarrage). Vide ou trop court = widget désactivé. Pour le révoquer, change-le.
2. Dans **Scriptable**, crée un script, colle le contenu de [docs/widget-argent.js](docs/widget-argent.js) et renseigne `BASE_URL` (l'adresse HTTPS d'Argenx) et `TOKEN` en haut.
3. Lance le script une fois dans Scriptable pour voir l'aperçu.
4. Écran d'accueil : appui long → **+** → **Scriptable** → choisis le script. Petite, moyenne ou grande taille ; accessoires de l'écran verrouillé (cercle, rectangle, ligne). Un appui sur le widget ouvre Argenx.

La réponse (dates `AAAA-MM-JJ`, fuseau de Paris, `updatedAt` en ISO 8601 ; `null` tant qu'il n'y a aucune opération) :
`updatedAt, month, envelope, toRestore, restored, available, spentMonth, remainingMonth, daysLeftMonth, perDay, weekAllowance, spentWeek, remainingWeek, daysLeftWeek, status`.
- `available` = `envelope` − max(0, `toRestore` − `restored`) ; `restored` = ce qui a été mis de côté ce mois-ci (virements vers un coffre, net des retraits depuis un coffre), plafonné à `toRestore`. Même calcul que la carte « Reste à dépenser » de l'accueil.
- `daysLeftMonth` et `daysLeftWeek` comptent aujourd'hui. `weekAllowance` = `available` ÷ jours du mois × 7, à l'euro près ; la semaine va du lundi au dimanche.
- `status` : `ok` s'il reste plus de 35 % de l'allocation de la semaine, `warn` entre 0 et 35 %, `over` si elle est dépassée.
- Réponses : `401` sans jeton ou avec un mauvais jeton (sans corps), `404` si le widget est désactivé, `409` si l'enveloppe du mois n'est pas réglée, `429` au-delà de 60 requêtes par heure.

## Corriger à la main

- **Ne compte pas** : catégorie à choisir dans Opérations pour une opération qui ne doit apparaître nulle part (virement entre tes propres comptes, avance pour quelqu'un…). Elle est barrée et sortie du budget, des graphiques et des analyses. Comme pour les autres catégories, l'appli propose d'en faire une règle.

## Les remboursements

Une somme reçue **égale au centime près** à un achat des **30 jours d'avant** l'annule : les deux opérations sont barrées et ne comptent ni en dépense ni en entrée. Ça marche pour un remboursement du magasin comme pour un virement d'un proche. Les recharges (top-up) et l'épargne ne sont jamais prises pour des remboursements.
Erreur ? Bouton **« Pas un remboursement »** sous l'opération.
Remboursé **en partie** (par exemple un ami qui te rend sa moitié) : mets la somme reçue dans la même catégorie que l'achat, elle vient en déduction.

## Budgets par catégorie

À fixer dans Réglages (le bouton « Remplir avec la proposition » donne un point de départ de 283 €). Dans Insights, la liste des catégories montre le budget en repère, et la barre passe au rouge en cas de dépassement.

## Limites connues

- Seulement les opérations en **euros** ; un relevé par compte Revolut en euros.
- Les mots-clés couvrent les commerçants courants en France ; les autres tombent dans « Autres » jusqu'à ce que tu crées une règle.
- La connexion automatique (Enable Banking) dure 180 jours au plus ; l'import CSV reste le secours.
- Les graphiques viennent de cdnjs : sans Internet, les chiffres s'affichent mais pas les graphiques.
