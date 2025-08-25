// waitingMessages.js

// Tableau de messages d'attente
const messages = [
     "Parfait, j’ai bien noté ton message… je prends un petit moment pour relire les détails et être certain de tout comprendre correctement.",
    "Très bien, merci pour ton retour… je vérifie rapidement chaque point afin de confirmer que tout est clair de mon côté.",
    "Super, j’ai bien reçu les infos… je prends quelques secondes pour parcourir l’ensemble et m’assurer de n’avoir rien laissé de côté.",
    "Nickel, c’est enregistré… je m’accorde juste un court instant pour revoir les éléments essentiels et confirmer ma compréhension.",
    "Compris, merci… je regarde rapidement les détails histoire d’être sûr de bien tout capter avant de passer à la suite.",
    "Merci beaucoup, j’ai bien noté… je prends un instant pour revoir calmement les infos afin de tout saisir correctement.",
    "Entendu, c’est clair… je consulte brièvement ce que tu viens d’envoyer pour m’assurer que tout est bien compris.",
    "Reçu, impeccable… je m’attarde un petit moment sur les détails afin de vérifier que tout corresponde bien.",
    "Top, j’ai bien vu ton message… je prends quelques secondes pour relire et m’assurer que rien ne m’échappe.",
    "C’est noté, merci… je passe rapidement en revue chaque élément afin de bien intégrer toutes les infos.",
    "Bien compris, parfait… je regarde ça un instant pour valider que tout soit correctement enregistré.",
    "Très clair, merci à toi… je prends quelques secondes pour parcourir les points et confirmer ma bonne compréhension.",
    "Super, impeccable… je m’accorde juste un petit moment pour vérifier l’ensemble et être sûr que tout soit cohérent.",
    "Parfait, merci beaucoup… je regarde ça rapidement afin de ne rien oublier et de bien avoir tout en tête.",
    "Nickel, reçu sans souci… je fais une petite vérification des infos pour confirmer que tout est clair.",
    "Entendu, merci… je prends un instant pour relire attentivement et être certain de n’avoir rien raté.",
    "Bien reçu, parfait… je jette un œil aux détails immédiatement pour confirmer que j’ai bien tout assimilé.",
    "Très bien, merci à toi… je parcours rapidement ton message afin d’être sûr de bien comprendre chaque élément.",
    "Compris, c’est clair… je prends quelques secondes pour vérifier calmement les infos et éviter toute confusion.",
    "Top, merci… je regarde rapidement ce que tu viens de partager pour m’assurer que tout est bien saisi.",
    "C’est enregistré, parfait… je prends le temps de relire un instant pour vérifier que rien ne m’échappe.",
    "Super clair, merci… je me concentre quelques secondes sur les points importants afin de bien les garder en tête.",
    "Reçu sans problème… je prends un petit moment pour confirmer les détails et valider ma compréhension.",
    "Parfait, impeccable… je parcours rapidement les éléments afin d’être certain de bien tout retenir.",
    "Très bien, merci pour ton partage… je jette un œil attentif à l’ensemble afin de confirmer que tout est correct."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
