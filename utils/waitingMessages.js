// waitingMessages.js

// Tableau de messages d'attente
const messages = [
    "Très bien, je note tout ça et je m’en occupe de suite...",
    "Compris, je vais analyser cela avant de revenir vers vous...",
    "Parfait, je prends en compte et je prépare une réponse adaptée...",
    "Merci, je vérifie les détails et je vous informe rapidement...",
    "Bien reçu, je traite l’information et je reviens avec des solutions...",
    "Je comprends, je réfléchis à la meilleure manière d’agir...",
    "Très bien, je note vos points et je fais le nécessaire...",
    "Merci pour vos précisions, je m’assure que tout soit pris en compte...",
    "Parfait, je regarde ça attentivement et je vous tiens informé...",
    "Bien reçu, je traite votre demande et je vous réponds dans un instant..."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
