# Argenx

Appli web pour téléphone (PWA installable) qui range tes dépenses à partir des **relevés CSV de Revolut** :

1. **import** du relevé (export en anglais ou en français), sans doublons même si les périodes se chevauchent ;
2. **classement automatique** par règles (Courses, Transport, Abonnements…), que tu corriges en un geste ;
3. **tableau de bord du mois** : dépenses par catégorie, entrées et dépenses, 12 derniers mois, top 10 des commerçants ;
4. **analyses** : abonnements repérés et leur coût annuel, comparaison avec le mois précédent, dépenses inhabituelles, budget par catégorie ;
5. **résumé mensuel dans Notion** (totaux par catégorie seulement).

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

Le dossier `data/` n'est jamais envoyé sur GitHub. Les jetons et mots de passe sont seulement dans les variables d'environnement.

## Les règles de lecture du CSV

- Colonnes reconnues en anglais (`Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`) ou en français (`Type, Produit, Date de début, Date de fin, Description, Montant, Frais, Devise, État, Solde`), séparées par des virgules ou des points-virgules. Si elles ne sont pas reconnues, l'appli affiche celles qu'elle a trouvées.
- Montant d'une opération = **Montant − Frais**.
- Ignorées : les opérations **non terminées**, les **changes** de devise, les opérations dans une autre devise que l'euro, et les lignes du produit « Épargne / Savings » (le virement vers le coffre, côté compte courant, suffit).
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

## Les analyses

- **Abonnements** : même commerçant, montant à ±10 %, tous les 25 à 35 jours, au moins 2 fois. Coût annuel = dernier montant × 12. Un supermarché où tu vas souvent n'est pas compté.
- **Dépenses inhabituelles** : plus de 3 fois la dépense habituelle (médiane) de la catégorie, dès qu'elle compte au moins 5 dépenses.
- **Budgets** : à fixer par catégorie dans ⚙️ Réglages ; la barre passe au rouge en cas de dépassement.

## Limites connues

- Seulement les opérations en **euros** ; un relevé par compte Revolut en euros.
- Les mots-clés couvrent les commerçants courants en France ; les autres tombent dans « Autres » jusqu'à ce que tu crées une règle.
- Pas encore de connexion automatique à la banque : l'import se fait à la main (la connexion via Open Banking, par exemple Enable Banking, est prévue plus tard).
- Les graphiques viennent de cdnjs : sans Internet, les chiffres s'affichent mais pas les graphiques.
