// waitingMessages.js

// Tableau de messages d'attente
const messages = [
     "je prends un petit moment pour relire les détails et être certain de tout comprendre correctement.",
    "je vérifie rapidement chaque point afin de confirmer que tout est clair de mon côté.",
    "Super, j’ai bien reçu les infos… je prends quelques secondes pour parcourir l’ensemble et m’assurer de n’avoir rien laissé de côté.",
    "je m’accorde juste un court instant pour revoir les éléments essentiels et confirmer ma compréhension.",
    "je regarde rapidement les détails histoire d’être sûr de bien tout capter avant de passer à la suite.",
    "j’ai bien noté… je prends un instant pour revoir calmement les infos afin de tout saisir correctement.",
    "je consulte brièvement ce que tu viens d’envoyer pour m’assurer que tout est bien compris.",
    "je m’attarde un petit moment sur les détails afin de vérifier que tout corresponde bien.",
    "je prends quelques secondes pour relire et m’assurer que rien ne m’échappe.",
    "je passe rapidement en revue chaque élément afin de bien intégrer toutes les infos.",
    "je regarde ça un instant pour valider que tout soit correctement enregistré.",
    "je prends quelques secondes pour parcourir les points et confirmer ma bonne compréhension.",
    "je m’accorde juste un petit moment pour vérifier l’ensemble et être sûr que tout soit cohérent.",
    "je regarde ça rapidement afin de ne rien oublier et de bien avoir tout en tête.",
    "je fais une petite vérification des infos pour confirmer que tout est clair.",
    "je prends un instant pour relire attentivement et être certain de n’avoir rien raté.",
    "je jette un œil aux détails immédiatement pour confirmer que j’ai bien tout assimilé.",
    "je parcours rapidement ton message afin d’être sûr de bien comprendre chaque élément.",
    "je prends quelques secondes pour vérifier calmement les infos et éviter toute confusion.",
    "je regarde rapidement ce que tu viens de partager pour m’assurer que tout est bien saisi.",
    "je prends le temps de relire un instant pour vérifier que rien ne m’échappe.",
    "je me concentre quelques secondes sur les points importants afin de bien les garder en tête.",
    "je prends un petit moment pour confirmer les détails et valider ma compréhension.",
    "je parcours rapidement les éléments afin d’être certain de bien tout retenir.",
    "je jette un œil attentif à l’ensemble afin de confirmer que tout est correct."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
