# K2S Diagnostic Server

Serveur Node.js pour l'application de diagnostic technique K2S.IQ.

## 🔧 Technologies
- Node.js + Express
- MongoDB (via Mongoose)
- OpenAI (GPT-4o)
- Mistral local (via LM Studio)
- Flutter (client mobile)
- Axios, dotenv, cors

## 🧠 Fonctionnalité
- Analyse automatique de demandes techniques (diagnostics ou choix techniques)
- Résumé automatique avec Mistral
- Génération de questions avec OpenAI
- Diagnostic final après réponse
- Gestion de quotas (3 par jour en basic, 10 en premium, illimité en elite)
- Système d’abonnement via compte Google
- Stockage des prompts en base + fichiers texte
- Stockage local des données utilisateurs dans Hive (côté Flutter)

## 📁 Structure des dossiers
