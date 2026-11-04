# Argenx

Appli web pour téléphone (PWA installable) qui range tes dépenses à partir des **relevés CSV de Revolut** :

1. **enveloppes de la semaine** (écran d'accueil) : il te reste combien cette semaine en courses, resto, achats libres, avec un plafond Uber Eats et les fixes du mois ;
1. **budget du mois** (onglet Insights, 400 € par défaut) : ce qu'il reste, combien ça fait par jour, où tu finiras le mois à ce rythme, abonnements encore à payer ;
2. **achats remboursés repérés tout seuls** (meuble remboursé par le magasin, billet remboursé par un proche) : ils ne comptent pas ;
3. **import** du relevé (export en anglais ou en français), sans doublons même si les périodes se chevauchent ;
4. **classement automatique** par règles (Courses, Transport, Abonnements…), que tu corriges en un geste ;
5. **tableau de bord du mois** : dépenses par catégorie, entrées et dépenses, 12 derniers mois, top 10 des commerçants ;
6. **analyses** : abonnements repérés et leur coût annuel, comparaison avec le mois précédent, dépenses inhabituelles, budget par catégorie ;
7. **résumé mensuel dans Notion** (totaux par catégorie) et **courses payées** (détail de la seule catégorie Courses, pour Repax) ;
8. **courses prévues par Repax**, lues dans la même page Notion.

Pas d'IA : tout est fait par règles simples, expliquées plus bas. Les analyses décrivent tes dépenses ; ce ne sont pas des conseils financiers.

## Exporter le relevé depuis l'appli Revolut

1. Ouvre l'appli Revolut, onglet **Accueil**, sur ton compte en **euros**.
2. Touche **•••** (Plus) sous le solde → **Relevé** (ou **Documents** → **Relevé de compte**).
3. Choisis le format **Excel** (c'est un fichier **CSV**), puis la **période** (par exemple les 3 derniers mois).
4. **Générer** → enregistre le fichier ou envoie-le-toi.
5. Dans Argenx : onglet **⬆️ Importer** → choisis le fichier → **Importer**.

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
Argenx lit « Liste de courses » et « Planning des repas » de Repax pour la carte « 🛒 Courses ». Le détail des autres catégories ne part jamais vers Notion.

Le dossier `data/` n'est jamais envoyé sur GitHub. Les jetons et mots de passe sont seulement dans les variables d'environnement.

**Sauvegarde** : ⚙️ Réglages → « Télécharger une sauvegarde » (un fichier `.json` avec opérations, règles et corrections). Pour la remettre : ⬆️ Importer, choisir ce fichier (remplace tout). Sur le NAS, une tâche Hyper Backup du dossier `/docker` couvre aussi ces fichiers.

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
Quand tu changes la catégorie d'une opération (onglet 📋 Opérations), l'appli propose d'en faire une **règle** qui reclasse les opérations passées et futures (sauf celles que tu as corrigées à la main).

## Les enveloppes (écran d'accueil)

L'accueil répond à « il me reste combien cette semaine ? ». Chaque enveloppe regroupe des catégories :

| Enveloppe | Par défaut | Catégories |
|---|---|---|
| Courses | 42 €/semaine | Courses |
| Resto & fast-food | 50 €/semaine, **dont Uber Eats 26 €/mois** (Uber Eats, Deliveroo, Just Eat) | Restos & fast-food |
| Achats libres | 9 €/semaine | Shopping, Loisirs, Transport, Santé, Études, Logement, Retraits, Proches, Autres |
| Abonnements | 22 €/mois (Claude) | Abonnements |

Total ≈ 460 €/mois (alimentation ≈ 400 € + achats libres 60 € dont l'abonnement), pour 460 € de revenus sûrs (parents 400 €, mère 60 €).
Basic-Fit est remboursé par le virement « salle » : une règle le met en **Ne compte pas** (supprimable dans ⚙️ Réglages → Mes règles).

- La semaine va du lundi au dimanche. La bascule **Semaine / Mois** montre les mêmes enveloppes sur le mois (42 €/semaine → 180 € en novembre).
- Le grand chiffre = ce qui reste dans les enveloppes de la semaine (les abonnements, au mois, n'y entrent pas).
- Trois couleurs seulement : **vert** ça tient ; **orange** 80 % utilisés, ou nettement plus vite que le temps (par exemple 60 % dépensés alors que 30 % de la semaine est passée) ; **rouge** dépassé.
- Tout se règle dans ⚙️ Réglages : montants, plafond Uber Eats, revenus sûrs (460 € par défaut) et quelle catégorie va dans quelle enveloppe. L'appli affiche si le budget prévu dépasse les revenus sûrs.

## Le budget du mois (onglet Insights)

Fixe dans ⚙️ Réglages ce que tu peux dépenser par mois (400 € par défaut). L'épargne ne compte pas comme une dépense.
En haut de l'onglet 📊 Mois :

- **reste à dépenser** = budget − dépenses du mois ;
- **par jour** = (reste − abonnements pas encore payés ce mois-ci) ÷ jours restants ;
- **à ce rythme** = dépensé + dépenses courantes par jour × jours restants + abonnements à venir. En début de mois, quand il n'y a que quelques jours de données, le rythme est mélangé avec celui des 3 mois précédents.

Le « jour connu » est la date de ta dernière opération importée : importe un relevé récent pour que les calculs soient à jour.

## Corriger à la main

- **Ne compte pas** : catégorie à choisir dans 📋 Opérations pour une opération qui ne doit apparaître nulle part (virement entre tes propres comptes, avance pour quelqu'un…). Elle est barrée et sortie du budget, des graphiques et des analyses. Comme pour les autres catégories, l'appli propose d'en faire une règle.
- **Pas un abonnement** : bouton sous chaque abonnement repéré, dans 🔍 Analyses. Le commerçant ne sera plus proposé ; tu peux le remettre dans ⚙️ Réglages.

## Les remboursements

Une somme reçue **égale au centime près** à un achat des **30 jours d'avant** l'annule : les deux opérations sont barrées et ne comptent ni en dépense ni en entrée. Ça marche pour un remboursement du magasin comme pour un virement d'un proche. Les recharges (top-up) et l'épargne ne sont jamais prises pour des remboursements.
Erreur ? Bouton **« Pas un remboursement »** sous l'opération.
Remboursé **en partie** (par exemple un ami qui te rend sa moitié) : mets la somme reçue dans la même catégorie que l'achat, elle vient en déduction.

## Les analyses

- **Abonnements** : même commerçant, montant à ±10 %, tous les 25 à 35 jours, au moins 2 fois. Coût annuel = dernier montant × 12. Un supermarché où tu vas souvent n'est pas compté.
- **Dépenses inhabituelles** : plus de 3 fois la dépense habituelle (médiane) de la catégorie, dès qu'elle compte au moins 5 dépenses.
- **Budgets** : à fixer par catégorie dans ⚙️ Réglages ; la barre passe au rouge en cas de dépassement.

## Limites connues

- Seulement les opérations en **euros** ; un relevé par compte Revolut en euros.
- Les mots-clés couvrent les commerçants courants en France ; les autres tombent dans « Autres » jusqu'à ce que tu crées une règle.
- Pas encore de connexion automatique à la banque : l'import se fait à la main (la connexion via Open Banking, par exemple Enable Banking, est prévue plus tard).
- Les graphiques viennent de cdnjs : sans Internet, les chiffres s'affichent mais pas les graphiques.
