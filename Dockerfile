# Utiliser une image Node.js officielle
FROM node:20-bullseye

# Installer les dépendances système nécessaires pour TTS et audio
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    libasound2 \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Créer le dossier de travail
WORKDIR /usr/src/app

# Copier les fichiers package.json et package-lock.json pour installer les dépendances
COPY package*.json ./

# Installer uniquement les dépendances de production
RUN npm install --production

# Copier tout le reste du projet
COPY . .

# Exposer le port utilisé par ton serveur
EXPOSE 3000

# Commande pour démarrer ton serveur
CMD ["node", "index.js"]
