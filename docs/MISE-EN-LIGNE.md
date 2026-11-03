# Mise en ligne pas à pas

But : Argenx disponible sur **https://teranga-nas.synology.me:8445**, installé sur l'écran d'accueil du téléphone.
Même recette que Gorgée (8443) et Repax (8444), avec le port **3012** côté NAS et **8445** côté Internet.

---

## 1. Le code sur GitHub

Le conteneur récupère le code depuis https://github.com/Kaloomc/Argenx à chaque démarrage. Le dépôt est **public** : il ne contient ni mot de passe, ni jeton, ni opération bancaire (le dossier `data/` est ignoré par Git).

---

## 2. Préparer Notion (facultatif, sinon mode démo)

1. Va sur https://www.notion.so/profile/integrations → **Nouvelle intégration**.
   - Nom : `Argenx`, espace de travail : le tien, type : **Interne**.
   - Copie le **jeton secret** (il commence par `ntn_`). C'est `NOTION_TOKEN`. Ne le mets jamais dans le code ni sur GitHub.
2. Dans Notion, crée une page vide **« Argent »** (ou utilise une page de ton système).
3. Sur cette page : menu **•••** en haut à droite → **Connexions** → ajoute **Argenx**. Sans ça, l'appli ne voit pas la page.
4. Copie le lien de la page (**•••** → **Copier le lien**) : c'est `NOTION_PAGE_ID` (le lien complet marche).

Au premier envoi, l'appli crée la base **« Résumé mensuel »** dans cette page : une ligne par mois et par catégorie (Mois, Catégorie, Montant, Nombre d'opérations, Budget). **Le détail des opérations ne part jamais vers Notion.**

---

## 3. Créer le projet dans Container Manager

1. **File Station** → dossier `docker` → crée un dossier **`argenx`**, puis **dedans** un dossier vide **`app`**.
   Il faut les **deux** : sans `/docker/argenx/app`, le démarrage échoue avec `Bind mount failed: ... /app does not exist` (Synology ne le crée pas tout seul).
2. **Container Manager** → **Projet** → **Créer** :
   - Nom du projet : `argenx`
   - Chemin : `/docker/argenx`
   - Source : **Créer un fichier docker-compose.yml**
3. Colle le contenu de [`docker-compose.yml`](../docker-compose.yml) et remplis :
   - `APP_PASSWORD=` un mot de passe à toi — **obligatoire** : sans lui, l'appli refuse d'écouter sur le réseau (ce sont tes comptes !)
   - `CLE_INTERNE=` la clé partagée avec Repax et Agendix (voir la section « Relier Argenx à Repax » plus bas ; vide = pas de lien)
   - `REPAX_URL=http://192.168.1.45:3011` (déjà rempli : l'adresse de Repax sur le réseau de la maison)
   - `NOTION_TOKEN=ntn_...` (ou vide pour le mode démo)
   - `NOTION_PAGE_ID=https://www.notion.so/...`
4. **Suivant** → (pas besoin de Web Station) → **Terminé**. Le projet démarre.
5. Vérifie : **Conteneur** → `argenx` → **Journal**. Tu dois voir à la fin :
   `Argenx sur http://localhost:3012 (Notion activé)`
   Si tu vois `APP_PASSWORD manquant`, le mot de passe n'est pas rempli.
   Le premier démarrage prend 1 à 2 minutes.

Test sur le réseau de la maison : http://192.168.1.45:3012

Tes opérations sont dans `/docker/argenx/app/data/operations.json`. Pense à inclure `/docker/argenx` dans tes sauvegardes du NAS (Hyper Backup).

---

## 4. Proxy inversé HTTPS (port 8445)

**Panneau de configuration** → **Portail de connexion** → **Avancé** → **Proxy inversé** → **Créer** :

| | Source | Destination |
|---|---|---|
| Protocole | HTTPS | HTTP |
| Nom d'hôte | `teranga-nas.synology.me` | `localhost` |
| Port | `8445` | `3012` |

Nom de la règle : `argenx`. Coche **Activer HSTS** si tu veux (comme pour Gorgée et Repax).

---

## 5. Certificat

**Panneau de configuration** → **Sécurité** → **Certificat** → **Paramètres** :
pour le service **`teranga-nas.synology.me:8445`** (la règle du proxy), choisis le certificat **teranga-nas.synology.me** → **OK**.

---

## 6. Ouvrir le port sur la Freebox

1. Va sur http://mafreebox.freebox.fr → **Paramètres de la Freebox** → **Mode avancé** → **Gestion des ports**.
2. **Ajouter une redirection** :
   - IP de destination : `192.168.1.45`
   - Redirection active : oui
   - IP source : toutes
   - Protocole : **TCP**
   - Port de début / fin : `8445`
   - Port de destination : `8445`
3. **Sauvegarder**.

Si le **pare-feu DSM** est activé (**Panneau de configuration** → **Sécurité** → **Pare-feu**), autorise aussi le port TCP **8445**.

Test depuis le téléphone **en 4G (Wi-Fi coupé)** : https://teranga-nas.synology.me:8445 → l'écran de connexion s'affiche.

---

## 7. Mettre l'appli sur l'écran d'accueil

### iPhone (avec Safari, obligatoirement)
1. Ouvre https://teranga-nas.synology.me:8445 dans **Safari** et connecte-toi.
2. Bouton **Partager** (carré avec une flèche vers le haut).
3. **Sur l'écran d'accueil** → nom : `Argenx` → **Ajouter**.

### Android (avec Chrome)
1. Ouvre https://teranga-nas.synology.me:8445 dans **Chrome** et connecte-toi.
2. Menu **⋮** → **Installer l'application** (ou **Ajouter à l'écran d'accueil**) → **Installer**.

L'icône indigo « Argenx » apparaît ; l'appli s'ouvre en plein écran, sans la barre du navigateur.

---

## 8. Mettre à jour l'appli

1. Pousse les changements sur GitHub (`git push`).
2. **Container Manager** → **Projet** → `argenx` → **Action** → **Redémarrer**.
Au redémarrage, le conteneur récupère la dernière version. Tes opérations (`data/`) sont conservées.

Pour changer le mot de passe ou un jeton : **Projet** → `argenx` → **Arrêter** → **Modifier** le YAML → **Enregistrer** → **Démarrer**.

---

## 9. Relier Argenx à Repax (budget courses)

Repax (repas) et Argenx (argent) se parlent sur le réseau de la maison, avec une **clé partagée** :

- Repax lit dans Argenx tes **vraies dépenses de courses** (catégorie Courses), à la place de la saisie à la main ;
- Argenx lit dans Repax les **courses prévues sur les 7 prochains jours** et affiche, dans 📊 Mois, une carte « 🛒 Courses » : prévu, dépensé ce mois-ci, et fin de mois estimée (dépensé + reste à acheter).

1. Prends la clé déjà créée pour Agendix (sinon, crée-en une dans un terminal) :

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. **Container Manager** → **Projet** → `argenx` → **Arrêter** → **Modifier** le YAML :
   - `CLE_INTERNE=` **la même clé** que dans Repax et Agendix
   - `REPAX_URL=http://192.168.1.45:3011`

   → **Enregistrer** → **Démarrer**. Fais pareil côté Repax (sa clé `CLE_INTERNE` et `ARGENX_URL=http://192.168.1.45:3012`).

3. Vérification depuis un ordinateur de la maison (remplace `TA_CLE`) :

   ```bash
   curl -H "X-Cle-Interne: TA_CLE" "http://192.168.1.45:3012/api/courses-reelles?du=2026-11-01&au=2026-11-30"
   ```

   Réponse attendue : `{"total":…,"operations":[…]}`. Avec une mauvaise clé : `Clé interne refusée`.

Si Repax est arrêté ou mal relié, Argenx n'affiche simplement pas la carte Courses : le reste marche normalement.
Les opérations d'exemple (mode démo) ne sont jamais envoyées à Repax.

---

## Dépannage

| Problème | Piste |
|---|---|
| `Bind mount failed` | Le dossier `/docker/argenx/app` n'existe pas (étape 3.1) |
| Journal : `APP_PASSWORD manquant` | Remplis `APP_PASSWORD` dans le YAML (étape 3.3) |
| Réglages : `Notion : Could not find block` | La page n'est pas connectée à l'intégration (étape 2.3), ou `NOTION_PAGE_ID` est faux |
| `Notion : API token is invalid` | `NOTION_TOKEN` mal copié |
| La page ne s'ouvre pas depuis la 4G | Redirection Freebox (étape 6) ou pare-feu DSM |
| Avertissement de certificat | Étape 5 : le certificat n'est pas associé au port 8445 |
| `fatal: detected dubious ownership` | La ligne `safe.directory` manque dans la commande du YAML |
| Pas de carte « 🛒 Courses » dans 📊 Mois | `CLE_INTERNE` différente entre Argenx et Repax, `REPAX_URL` vide, ou Repax arrêté |
| Repax ne voit pas les dépenses de courses | Même chose côté Repax (`CLE_INTERNE`, `ARGENX_URL`), ou les achats ne sont pas dans la catégorie Courses |
