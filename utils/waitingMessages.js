// waitingMessages.js

// Tableau de messages d'attente
const messages = [
     "Super, merci pour les infos, j’ai bien noté tout ce que tu viens de partager... je prends le temps de m’en occuper tranquillement juste derrière.",
    "Parfait, j’ai bien reçu ta demande et je la garde en tête dès maintenant... je vais m’en charger doucement et m’assurer que tout soit clair.",
    "Nickel, c’est bien noté, je prends ça en compte sans rien oublier... et je m’occupe du reste avec attention pour que tout soit en ordre.",
    "Très bien, j’ai enregistré tout ça, je me penche dessus dans la foulée... et je fais en sorte que ce soit géré correctement du début à la fin.",
    "Merci beaucoup pour la précision, je garde ça sous la main dès à présent... et je prends le temps de gérer les détails comme il faut derrière.",
    "Top, j’ai bien tout compris et je note ça dans mon coin... je m’en occupe tranquillement ensuite pour que tu n’aies pas à y repenser.",
    "D’accord, je prends note de ta demande complète, c’est bien enregistré... je vais m’en occuper ensuite et veiller à ce que tout se passe bien.",
    "Parfait, merci pour ces éléments, je note attentivement chaque détail... et je me charge du suivi en douceur pour que tout avance correctement.",
    "Nickel, j’ai bien ce qu’il faut, je le garde en mémoire tout de suite... je vais traiter ça calmement pour que rien ne soit laissé de côté.",
    "Super, j’ai pris le temps de noter l’essentiel de ton message... je gère ça ensuite et je veille à ce que tout soit parfaitement réglé.",
    "Très bien, j’ai reçu toutes les infos, je les garde précieusement... je m’assure ensuite de faire le nécessaire pour que tout soit impeccable.",
    "Merci, j’ai bien noté ce que tu viens de dire, aucun souci... je m’en occupe ensuite et je vérifie que chaque point soit bien respecté.",
    "Parfait, je note attentivement ta demande et je la garde en tête... je prends le temps de la traiter tranquillement dans la foulée.",
    "Nickel, c’est bien enregistré, je prends tout en compte dès maintenant... et je fais en sorte que tout soit suivi correctement derrière.",
    "Super, j’ai gardé chaque détail que tu viens de partager... je vais m’y atteler ensuite pour être sûr que tout avance sans problème.",
    "Très bien, j’ai tout ce qu’il me faut et je garde ça avec moi... je prends le temps de le gérer proprement et sans précipitation.",
    "Merci pour ton message, je le note attentivement et je le garde... je prends en main le reste ensuite pour que tout se déroule bien.",
    "Parfait, c’est bien reçu, je garde les infos au chaud tout de suite... je vais m’en occuper calmement pour que tout soit nickel derrière.",
    "Nickel, j’ai noté ta demande complète et je garde ça en tête... je prends soin de gérer la suite pour que tu sois tranquille.",
    "Super, j’ai bien enregistré ce que tu viens d’indiquer... je prends le temps de regarder ça ensuite pour être sûr de ne rien manquer.",
    "Très bien, j’ai pris note de tous les détails importants... je m’occupe du reste ensuite en vérifiant que tout soit parfaitement clair.",
    "Merci beaucoup, j’ai ce qu’il me faut et je le garde de côté... je prends le temps de tout gérer ensuite pour que ce soit bien fait.",
    "Parfait, j’ai noté ton message et je garde les infos précieusement... je vais ensuite m’en occuper calmement, sans rien laisser de côté.",
    "Nickel, je prends tout ça en note et je l’ai bien enregistré... je traite la suite ensuite pour que tout reste fluide et correct.",
    "Super, j’ai tout ce qu’il faut et j’ai bien noté ton point... je m’assure de gérer ça ensuite en douceur et avec attention."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
