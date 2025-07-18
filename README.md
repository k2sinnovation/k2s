K2S Diagnostic Server
Serveur Node.js pour l'application d'assistance au diagnostic technique K2S.IQ.

🔧 Technologies
Node.js + Express
MongoDB (via Mongoose)
OpenAI (GPT-4o et GPT-4o-mini)
Flutter (client mobile)
Axios, dotenv (en local), cors (à ajouter si besoin)
Stockage local Hive côté Flutter

🧠 Fonctionnalités
Analyse intelligente des demandes techniques : diagnostic et aide au choix technique dans un seul prompt
Interaction avec OpenAI pour génération de questions et hypothèses
Cycle d’analyse complet : demande → 5 questions → réponses → 4 hypothèses de diagnostic/choix
Gestion des quotas d’utilisation :
Basic : 3 analyses/jour (limite côté Hive)
Premium : 10 analyses/jour
Elite : accès illimité
Système d’abonnement avec gestion du niveau (basic, premium, elite)
Stockage des prompts sous forme de fichiers .txt dans le dossier /prompts
Données utilisateurs stockées localement sur mobile via Hive
Communication sécurisée avec MongoDB hébergé (ex. MongoDB Atlas ou autre)

📁 Structure des dossiers
bash
Copier
Modifier
/controllers
  ├── analyzeController.js    # Logique métier analyse de diagnostic
  ├── answerController.js     # Gestion des réponses utilisateur
  └── openaiService.js        # Appels API OpenAI

/models
  └── userModel.js            # Modèle Mongoose utilisateur

/prompts                     # Prompts utilisés (fichiers .txt)

/routes
  ├── analyze.js              # Route analyse (POST)
/answer.js                   # Route réponse (POST)
/subscribe.js                # Route abonnement

/utils
  └── promptHelper.js         # Chargement des prompts depuis fichiers

.gitignore
README.md
index.js                     # Point d'entrée serveur
package.json
⚙️ Installation & déploiement
Cloner le repo

Installer les dépendances :
bash
Copier
Modifier
npm install
Configurer les variables d’environnement sur Render (ou localement) :

OPENAI_API_KEY

MONGO_URI

Déployer sur Render ou autre plateforme Node.js

Assurer la connexion entre Flutter (mobile) et ce serveur

🔒 Sécurité & bonnes pratiques
Stockage sécurisé des clés API dans variables d’environnement (Render)
Validation des entrées utilisateurs côté serveur et client
Limitation des quotas et filtres côté client (Hive) et serveur (MongoDB)
Possibilité d’extension future vers vérification des quotas côté serveur

🛠️ Notes
Le résumé Mistral a été retiré, tout se base désormais sur un prompt unique avec OpenAI
Pour les diagnostics complexes, possibilité de choisir entre modèles GPT-4o-mini (rapide/économique) ou GPT-4o (qualité supérieure)
Les données utilisateur sont majoritairement stockées côté client (Hive) pour rapidité et confidentialité

