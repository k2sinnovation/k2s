function buildFirstAnalysisPrompt(userInput, qaFormatted) {
  const formattedQA = qaFormatted && qaFormatted.trim() !== '' ? qaFormatted : "Aucune question précédente.";

  return `
Tu es un assistant technique expérimenté, spécialisé en diagnostic terrain.

Analyse la demande :  
"${userInput}"

Questions déjà posées et réponses :  
${formattedQA}

Si la demande est hors sujet technique, réponds uniquement :  
\\json
{ "error": "Demande non technique." }
\\

Sinon, fais un résumé fidèle et génère jusqu’à 5 questions fermées SANS CHOIX (Oui/Non/Je ne sais pas), pratiques et adaptées.

Réponds uniquement par un objet JSON strict. Aucun texte libre ou explication :  
\\json
{ "resume": "...", "questions": ["...", "...", ...] }
\\
`.trim();
}


function buildSecondAnalysisPrompt(resume, previousQA, diagnosticPrecedent = "", analyseIndex = 1) {
  const qaFormatted = previousQA.length > 0
    ? previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
    : "Aucune question/réponse précédente.";

  const causeStart = (analyseIndex - 1) * 4;

  const finalResume = resume && resume.trim().length > 0 ? resume : userInput;

  return `
Tu es un technicien expérimenté qui analyse des problèmes techniques.  
L’équipement fonctionnait avant correctement, sauf info contraire.

Résumé de la demande utilisateur : "${finalResume}"

Règles :

- Base-toi sur manuels, codes défaut, documents constructeur et expérience terrain.  
- Analyse toujours en priorité le message utilisateur. C’est l'observation terrain directe.
- Les 5 questions servent à valider ou invalider des hypothèses. Si une réponse est "Je ne sais pas", considère qu’elle est neutre.
- Classe les causes de la plus probable à la moins probable.  
- Prends en compte environnement, apparition, codes erreur, conditions au moment du défaut.  
- Considère causes globales si plusieurs éléments sont affectés.  
- Interprète les termes mal nommés par l’utilisateur.  
- Identifie les paramètres constructeur spécifiques à corriger.  
- Analyse attentivement la demande et les échanges précédents question reponse pour générer des causes plausibles et cohérentes.
- Chaque action doit proposer une manipulation concrète avec, si possible, une valeur indicative à tester (ex. temps, tension, fréquence, seuil, etc.), 
  même si la valeur exacte dépend du contexte. Cela permet au technicien de faire un essai terrain immédiatement.
- Inquite les précautions spécifique à prendre uniquement, en lien direct avec la cause et l'action à réaliser. Ne mentionne pas les régles de sécurité 
  générales ou basiques. Soit bref, claire et pertinent, sans exageration.
- Ne génère jamais de causes hors sujet ou inventées. Si l’information est insuffisante, indique-le clairement dans la cause la plus probable.  
- Ne donne aucune explication, répond uniquement par un objet JSON strict.

${diagnosticPrecedent ? `Diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Questions et réponses précédentes :  
${qaFormatted}

Si la demande est un diagnostic de panne, répondre selon cette structure : Propose jusqu’à 4 causes probables avec vérifications concrètes et actions terrain :
Réponds uniquement par un objet JSON strict :

{
  "causes": [
    { "cause": "Cause 1 : ...", "verification": "...","precaution": "...", "action": "..." },
    { "cause": "Cause 2 : ...", "verification": "...","precaution": "...", "action": "..." },
    { "cause": "Cause 3 : ...", "verification": "...","precaution": "...", "action": "..." },
    { "cause": "Cause 4 : ...", "verification": "...","precaution": "...", "action": "..." }
  ],
  "message": "Si vous n'avez pas trouvé de solution, lancez une nouvelle analyse."
}

Sinon, si c'est une demande de choix technique ou de dimensionnement, réponds en suivant ces consignes précises :

- Contexte de la demande : Résume brièvement la situation ou le besoin exprimé par l'utilisateur.
- Caractéristiques techniques fournies : Liste claire des données utiles (puissance, tension, débit, surface, température, etc.)
- Choix ou dimensionnement proposé : Donne le résultat avec justification (valeurs, normes, méthode utilisée).
- Vérifications / Sécurité / Normes : Vérifie la cohérence du choix avec les contraintes de sécurité ou normes applicables.
- Conclusion synthétique claire et directe : Résume le choix proposé en une phrase simple et exploitable.

Réponds uniquement par un objet JSON strict :

{
  "contexte": "...",
  "caracteristiques": "...",
  "choix_dimensionnement": "...",
  "securite": "...",
  "conclusion": "..."
}
\\
`.trim();
}

module.exports = {
  buildFirstAnalysisPrompt,
  buildSecondAnalysisPrompt
};
