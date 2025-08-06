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

  const causeStart = analyseIndex === 1 ? 1 : 5;

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
- Analyse attentivement la demande et les échanges précédents pour générer des causes plausibles et cohérentes.  
- Ne génère jamais de causes hors sujet ou inventées. Si l’information est insuffisante, indique-le clairement dans la cause la plus probable.  
- Ne donne aucune explication, répond uniquement par un objet JSON strict.

${diagnosticPrecedent ? `Diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Questions et réponses précédentes :  
${qaFormatted}

Propose jusqu’à 4 causes probables avec vérifications concrètes et actions terrain :
Réponds uniquement par un objet JSON strict :

{
  "causes": [
    { "cause": " ${causeStart + 1} : ...", "verification": "..." }, "Action": "..." }
    { "cause": " ${causeStart + 2} : ...", "verification": "..." }, "Action": "..." }
    { "cause": " ${causeStart + 3} : ...", "verification": "..." }, "Action": "..." }
    { "cause": "${causeStart + 4} : ...", "verification": "..." } "Action": "..." }
  ],
  "message": "Si vous n'avez pas trouvé de solution, lancez une nouvelle analyse."
}
\\\
`.trim();
}


module.exports = {
  buildFirstAnalysisPrompt,
  buildSecondAnalysisPrompt
};

