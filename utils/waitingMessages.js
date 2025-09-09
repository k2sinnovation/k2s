// waitingMessages.js

// Tableau de messages d'attente
const messages = [
"Très bien, je vous détaille chaque point de manière simple.",
    "Super, je vous explique tout de manière claire et fluide.",
    "Je passe en revue chaque point pour que ma réponse soit exacte.",
    "Parfait, je vous présente les éléments principaux étape par étape.",
    "Je vous guide à travers chaque détail important.",
    "Allons-y, je vous montre comment tout s’articule ensemble.",
    "Je vous explique les points clés de manière simple et compréhensible.",
    "Très bien, je vous détaille les informations essentielles.",
    "Je vous montre comment chaque élément s’intègre dans l’ensemble.",
    "Parfait, je vous présente chaque point pour que tout soit clair.",
    "Je vous détaille les aspects principaux sans rien omettre.",
    "Super, je vous accompagne à travers toutes les informations importantes.",
    "Je vous explique chaque point de manière structurée.",
    "Très bien, je vous guide pas à pas pour tout rendre clair.",
    "Je vous montre comment les différents points se combinent.",
    "Parfait, je vous présente les informations principales de façon concise.",
    "Je détaille chaque élément pour que tout soit bien compris.",
    "Super, je vous explique les étapes clés de manière claire.",
    "Je vous montre comment tout se met en place naturellement.",
    "Très bien, je vous détaille les points essentiels de façon simple.",
    "Je vous guide à travers chaque aspect pour que rien ne soit confus.",
    "Parfait, je vous explique chaque point avec précision.",
    "Je vous montre comment chaque partie se relie aux autres.",
    "Super, je vous détaille les informations importantes étape par étape.",
    "Je vous explique les éléments principaux de façon fluide.",
    "Très bien, je vous présente chaque point pour que tout soit cohérent.",
    "Je vous guide dans la compréhension de chaque détail.",
    "Parfait, je vous explique les points clés pour que rien ne manque.",
    "Je vous détaille les étapes importantes de manière claire.",
    "Super, je vous montre comment tout s’organise logiquement.",
    "Je vous explique chaque élément de façon simple et précise.",
    "Très bien, je vous guide à travers les points essentiels.",
    "Je vous détaille chaque aspect pour que tout soit compréhensible.",
    "Parfait, je vous montre comment chaque point s’intègre correctement.",
    "Je vous explique les informations principales de manière fluide.",
    "Super, je vous détaille chaque point important de façon claire.",
    "Je vous guide à travers toutes les étapes pour tout rendre clair.",
    "Très bien, je vous explique comment chaque élément se combine.",
    "Je vous détaille les points essentiels pour que tout soit logique.",
    "Parfait, je vous montre comment tout se structure ensemble.",
    "Je vous explique chaque point de façon concise et compréhensible.",
    "Super, je vous détaille les informations importantes pour tout comprendre.",
    "Je vous guide à travers chaque détail pour que rien ne soit oublié.",
    "Très bien, je vous montre comment chaque partie s’articule avec les autres.",
    "Je vous explique les points clés de manière simple et structurée.",
    "Parfait, je vous détaille chaque élément afin que tout soit clair.",
    "Je vous guide pas à pas à travers les informations essentielles.",
    "Super, je vous montre comment chaque point se relie aux autres.",
    "Je vous explique chaque aspect de façon fluide et compréhensible.",
    "Très bien, je vous détaille les informations principales étape par étape.",
    "Je vous guide pour que chaque point soit clair et précis."
];

// Fonction pour récupérer un message aléatoire
function getRandomWaitingMessage() {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

module.exports = { getRandomWaitingMessage };
