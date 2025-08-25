// waitingMessages.js

// Tableau de messages d'attente
const messages = [
    "Parfait, j’ai bien pris en compte ta demande, je m’en occupe tranquillement juste derrière.",
    "Super, c’est noté de mon côté, je prends le temps de m’en charger correctement.",
    "Merci, je garde tout ça en tête et je fais le nécessaire rapidement.",
    "Bien reçu, je m’assure que ce soit pris en compte comme il faut.",
    "Top, j’ai ce qu’il me faut, je m’en occupe dans la foulée.",
    "D’accord, je prends ça en note et je fais en sorte de le gérer.",
    "Parfait, merci pour l’info, je traite ça juste après sans souci.",
    "Super, je note tout ça et je m’en occupe directement.",
    "Merci, j’ai bien enregistré ta demande, je m’en charge ensuite.",
    "Nickel, c’est pris en compte, je fais le nécessaire derrière.",
    "Très bien, je prends ça en compte et je m’y penche rapidement.",
    "Parfait, j’ai tout noté, je gère ça dès que possible.",
    "Merci, je garde ça sous la main et je m’en occupe à la suite.",
    "Bien reçu, je prends le temps de m’en occuper correctement.",
    "Top, j’ai noté l’essentiel, je m’en occupe juste après.",
    "Compris, je prends ça en charge et je fais avancer les choses.",
    "Super, merci pour la précision, je gère ça directement après.",
    "Parfait, j’ai bien tout enregistré, je m’en occupe ensuite.",
    "Très bien, je prends note et je fais le nécessaire derrière.",
    "Merci, j’ai bien ce qu’il faut, je m’occupe du reste.",
    "Nickel, je garde ça en tête et je m’y attèle juste après.",
    "Super, je prends ça en note et je m’en occupe tranquillement.",
    "Parfait, merci beaucoup, je m’occupe de ça dans la foulée.",
    "Bien reçu, je traite ça ensuite sans problème.",
    "Merci, j’ai bien noté, je m’en occupe dans la continuité."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
