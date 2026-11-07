# Mes courses (PWA)

Liste de courses alimentaires et ménagères : rayons dans l'ordre du magasin, filtre par supermarché, articles habituels en un tap, scan de code-barres, partage en direct entre appareils.

## Mise en ligne (comme « Mes outils »)
1. Nouveau dépôt GitHub (ex. `mes-courses`), tous les fichiers à la racine, Settings > Pages > branche `main`, dossier `/ (root)`.
2. Ouvrir l'adresse dans Chrome, puis menu ⋮ > Installer l'application.

## Synchro Firebase (projet `badges06` déjà utilisé, forfait Spark)
1. Console Firebase > Firestore > Règles : remplacer par le contenu de `firestore.rules` (il garde les règles de « Mes Badges » et ajoute `lists`, y compris la synchro des rayons), puis Publier.
2. Réglages > « Créer une liste partagée » : un code s'affiche. « Copier le lien d'invitation » et l'envoyer aux autres téléphones.
3. Hors ligne, tout reste utilisable et se synchronise au retour du réseau.

## Relais Cloudflare (facultatif)
Coller `worker.js` dans un Worker gratuit, puis Réglages > adresse du relais. Sans relais, l'appli interroge Open Food Facts directement.
Le scan utilise la caméra (Chrome Android) ; ailleurs, l'appli demande de saisir le numéro du code-barres.

Mise à jour du code : changer `V` dans `sw.js`.

## Si « synchro impossible » s'affiche
Touchez l'état en haut de l'écran : l'appli indique le code d'erreur. Le plus fréquent est `permission-denied` : publier le contenu de `firestore.rules` dans Firestore > Règles (un `firebase deploy` depuis le dossier Mes Badges remet les anciennes règles).
