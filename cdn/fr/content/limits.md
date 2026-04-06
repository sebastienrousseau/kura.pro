# CloudCDN — Limites et quotas

## Limites de fichiers
| Limite | Valeur |
|--------|--------|
| Taille maximale de fichier (diffusion CDN) | 25 Mo |
| Taille maximale de fichier (dépôt Git) | Pas de limite stricte (GitHub LFS disponible) |
| Formats d'image pris en charge | PNG, JPEG, WebP, AVIF, SVG, ICO |
| Formats vidéo pris en charge | MP4 (≤ 25 Mo) |
| Longueur maximale du nom de fichier | 255 caractères |
| Sensibilité à la casse des URL | Oui — les chemins sont sensibles à la casse |

## Limites de bande passante
| Palier | Bande passante mensuelle | Dépassement |
|--------|--------------------------|-------------|
| Gratuit | 10 Go | Le service est suspendu jusqu'au mois suivant |
| Pro | 100 Go | 0,05 $/Go |
| Enterprise | Illimité | Sans objet |

La bande passante est mesurée comme le nombre d'octets livrés depuis le edge jusqu'aux utilisateurs finaux. Les récupérations d'origine, les transferts CI/CD et les appels de l'API Concierge ne sont pas comptés.

## Limites de déploiement
| Limite | Valeur |
|--------|--------|
| Nombre maximum de fichiers par déploiement | 20 000 |
| Taille maximale du déploiement | Pas de plafond strict (téléversements incrémentaux) |
| Déploiements simultanés | 1 (mis en file d'attente en cas de chevauchement) |
| Fréquence de déploiement | Aucune limite (déclenché à chaque poussée vers `main`) |

## Limites de transformation d'images (Pro et supérieur)
| Limite | Pro | Enterprise |
|--------|-----|------------|
| Transformations par mois | 50 000 | Illimité |
| Dimensions maximales de sortie | 8192 × 8192 px | 8192 × 8192 px |
| Paramètre de qualité maximal | 100 | 100 |
| Rayon de flou maximal | 250 | 250 |
| Formats de sortie pris en charge | auto, webp, avif, png, jpeg | auto, webp, avif, png, jpeg |

## Limites d'API et de débit
| Endpoint | Limite |
|----------|--------|
| Diffusion d'actifs | Illimité (edge Cloudflare) |
| manifest.json | Illimité (cache edge de 5 min) |
| API de chat du Concierge | 1 000 requêtes/mois (tous paliers) |
| API de purge de cache (Pro et supérieur) | 1 000 purges/jour |

## Domaines personnalisés
| Palier | Domaines personnalisés |
|--------|------------------------|
| Gratuit | 0 |
| Pro | Jusqu'à 5 |
| Enterprise | Illimité (y compris les wildcards) |

## Stockage
Il n'y a pas de quota de stockage — vous pouvez pousser un nombre illimité de fichiers dans le dépôt. La limite pratique correspond aux recommandations de taille de dépôt de GitHub (idéalement moins de 5 Go, avec GitHub LFS pour les dépôts plus volumineux).

## Conversion automatique
| Limite | Valeur |
|--------|--------|
| Formats générés par téléversement | 2 (WebP + AVIF) |
| Conversions simultanées max. (CI) | Selon le runner GitHub Actions (2 cœurs CPU) |
| Délai d'expiration de la conversion | 6 heures (limite de GitHub Actions) |

## Concierge IA
| Limite | Valeur |
|--------|--------|
| Requêtes mensuelles | 1 000 |
| Requêtes par session (côté client) | 100 |
| Historique de conversation | Session en cours uniquement (non persistant) |
| Taille de la base de connaissances | 5 documents, environ 30 fragments |
| Jetons maximum par réponse | 512 |

## Que se passe-t-il aux limites
- **Bande passante dépassée (Gratuit) :** les actifs cessent d'être servis jusqu'au mois suivant. E-mail d'avertissement à 80 %.
- **Bande passante dépassée (Pro) :** le dépassement est facturé à 0,05 $/Go. Aucune interruption de service.
- **Limite du Concierge atteinte :** le widget de chat est désactivé pour le reste du mois.
- **Limite de transformations atteinte (Pro) :** les transformations renvoient le format original jusqu'au mois suivant.
- **Fichier trop volumineux :** les fichiers de plus de 25 Mo sont exclus du CDN mais restent dans Git.
