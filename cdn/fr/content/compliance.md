# CloudCDN — Conformité et confidentialité

## Traitement des données

### Quelles données CloudCDN traite-t-il ?
CloudCDN diffuse des fichiers statiques (images, icônes, polices). Il ne traite, ne stocke ni ne transmet de données personnelles d'utilisateurs. Le seul flux de données est le suivant :
1. Un navigateur demande l'URL d'un fichier statique.
2. Le edge Cloudflare sert le fichier mis en cache.
3. Des journaux HTTP standards sont générés (IP, horodatage, URL, user-agent).

### Où les données sont-elles stockées ?
- **Fichiers sources :** dépôt GitHub (hébergé aux États-Unis par GitHub/Microsoft).
- **Cache edge :** les plus de 300 PoP mondiaux de Cloudflare. Des copies mises en cache sont distribuées dans le monde entier pour la performance.
- **Données du Concierge IA :** les conversations ne sont pas stockées. Le widget de chat utilise uniquement un état de session en mémoire — aucune journalisation côté serveur des requêtes utilisateur.
- **Compteurs de limitation de débit :** stockés dans Cloudflare Workers KV (compteurs agrégés uniquement, aucune donnée personnelle).

## Conformité au RGPD

### Statut
CloudCDN est conforme au RGPD. Nous utilisons Cloudflare comme fournisseur d'infrastructure, qui maintient sa conformité RGPD grâce à :
- la certification au cadre transatlantique de protection des données UE-États-Unis (EU-US Data Privacy Framework) ;
- les clauses contractuelles types (CCT) pour les transferts internationaux de données ;
- des accords de traitement des données disponibles sur demande.

### Minimisation des données
- Aucun cookie n'est défini par CloudCDN.
- Aucun suivi d'utilisateur ni pixel d'analyse.
- Aucune donnée personnelle n'est collectée, stockée ni traitée.
- Les journaux d'accès HTTP sont gérés par Cloudflare selon sa politique de confidentialité.

### Droits des personnes concernées
Comme CloudCDN ne collecte pas de données personnelles, il n'y a pas de données personnelles à consulter, corriger ou supprimer. Si vous pensez que vos données personnelles ont été incluses par inadvertance dans un actif (par exemple, une photo), contactez support@cloudcdn.pro pour leur suppression.

### DPA (accord de traitement des données)
Les clients Enterprise peuvent demander un DPA formel. Contactez sales@cloudcdn.pro.

## CCPA / CPRA (Californie)
CloudCDN ne vend, ne partage ni n'utilise d'informations personnelles à des fins de publicité ciblée. Aucun mécanisme d'opt-out n'est requis, car aucune donnée personnelle n'est collectée.

## SOC 2 / ISO 27001
CloudCDN s'appuie sur l'infrastructure de Cloudflare, qui maintient :
- la certification SOC 2 Type II ;
- la certification ISO 27001 ;
- la conformité PCI DSS de niveau 1.
Ces certifications couvrent l'infrastructure de diffusion edge utilisée par CloudCDN.

## Mesures de sécurité
- **Chiffrement en transit :** TLS 1.3 sur toutes les connexions.
- **Protection DDoS :** mitigation DDoS automatique de Cloudflare sur tous les plans.
- **WAF :** le pare-feu applicatif web Cloudflare est actif sur tous les endpoints.
- **Mitigation des bots :** Cloudflare Bot Management protège contre le scraping et les abus.
- **Commits signés :** toutes les modifications d'actifs nécessitent une vérification cryptographique.
- **Protection des branches :** les force pushes et les réécritures d'historique sont bloqués.
- **Gestion des secrets :** les jetons API sont stockés comme GitHub Secrets chiffrés, jamais dans le code.

## Intégrité des actifs
Chaque actif servi par CloudCDN est traçable jusqu'à un commit Git signé. Cela fournit :
- **Provenance :** chaque modification de fichier est liée à un contributeur vérifié.
- **Piste d'audit :** historique Git complet avec vérification des commits signés.
- **Détection de falsification :** toute modification non autorisée brise la chaîne de signatures.

## Usage acceptable
CloudCDN est uniquement destiné à la diffusion d'actifs statiques. Les usages interdits incluent :
- L'hébergement de logiciels malveillants ou de contenus d'hameçonnage.
- La diffusion vidéo en continu ou la distribution de fichiers volumineux (plus de 25 Mo).
- Le stockage de données personnelles, d'identifiants ou d'informations sensibles dans les actifs.
- L'utilisation du service pour contourner les conditions d'autres services.

Les violations entraînent la suspension du compte avec un préavis de 24 heures (sauf pour les contenus illégaux, qui sont supprimés immédiatement).

## Réponse aux incidents
- Les incidents de sécurité sont signalés dans les 72 heures conformément aux exigences du RGPD.
- Contactez security@cloudcdn.pro pour signaler des vulnérabilités.
- Les clients Enterprise reçoivent une notification directe via leur canal Slack dédié.

## Contact
- **Demandes de confidentialité :** privacy@cloudcdn.pro
- **Signalements de sécurité :** security@cloudcdn.pro
- **Demandes de DPA :** sales@cloudcdn.pro
