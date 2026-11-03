# Mise en ligne pas à pas

But : Argenx disponible sur **https://teranga-nas.synology.me:8445**, installé sur l'écran d'accueil du téléphone.
Même recette que Gorgée (8443) et Repax (8444), avec le port **3012** côté NAS et **8445** côté Internet.

---

## 1. Le code sur GitHub

Le conteneur récupère le code depuis https://github.com/Kaloomc/Argenx à chaque démarrage. Le dépôt est **public** : il ne contient ni mot de passe, ni jeton, ni opération bancaire (le dossier `data/` est ignoré par Git).

---

## 2. Notion : la page commune avec Repax et Agendix (facultatif, sinon mode démo)

Repax, Agendix et Argenx partagent **la même page Notion** : reprends **le jeton (`NOTION_TOKEN`) et la page (`NOTION_PAGE_ID`) de Repax**, copiés depuis le YAML du projet `gestion-repas`.

Au premier envoi, Argenx crée dans cette page :
- **« Résumé mensuel »** : une ligne par mois et par catégorie (Mois, Catégorie, Montant, Nombre d'opérations, Budget) ;
- **« Courses payées »** : le détail de la **seule catégorie Courses** (Libellé, Date, Montant), que Repax lit pour son budget.

**Le détail des autres opérations ne part jamais vers Notion.**

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
   - `NOTION_TOKEN=` le même que Repax (ou vide pour le mode démo)
   - `NOTION_PAGE_ID=` le même que Repax
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

## 9. Relier Argenx à Repax par Notion (budget courses)

Repax (repas) et Argenx (argent) ne se parlent pas directement : tout passe par la page Notion commune (étape 2).

- Argenx range tes **vraies dépenses de courses** (catégorie Courses) dans la base « Courses payées » : Repax les compte dans son budget, à la place de la saisie à la main. Elles partent à chaque import, à chaque correction de catégorie, et avec le bouton « Envoyer vers Notion » des Réglages (après une nouvelle règle, renvoie les mois concernés).
- Argenx lit les bases « Liste de courses » et « Planning des repas » de Repax et affiche, dans 📊 Mois, une carte « 🛒 Courses » : prévu, dépensé ce mois-ci, et fin de mois estimée (dépensé + reste à acheter).

Il suffit que les deux projets aient **le même `NOTION_TOKEN` et le même `NOTION_PAGE_ID`**.
Si les bases de Repax ne sont pas dans la page, Argenx n'affiche simplement pas la carte Courses : le reste marche normalement.
Les opérations d'exemple (mode démo) ne partent jamais vers Notion.

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
| Pas de carte « 🛒 Courses » dans 📊 Mois | `NOTION_PAGE_ID` différent entre Argenx et Repax, ou Repax pas encore lancé avec Notion |
| Repax ne voit pas les dépenses de courses | Même page Notion ? Achats bien dans la catégorie Courses ? Sinon, Réglages → « Envoyer vers Notion » |
