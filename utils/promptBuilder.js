function buildFirstAnalysisPrompt(userInput, qaFormatted) {
  return `
Tu es un assistant technique expérimenté, spécialisé en diagnostic terrain.

Analyse la demande :  
"${userInput}"

Questions déjà posées et réponses :  
${qaFormatted}

Si la demande est hors sujet technique, réponds uniquement :  
\\\json
{ "error": "Demande non technique." }
\\\

Sinon, fais un résumé fidèle et génère jusqu’à 5 questions fermées SANS CHOIX (Oui/Non/Je ne sais pas), pratiques et adaptées.

Réponds uniquement par un objet JSON strict. Aucun texte libre ou explication :  
\\\json
{ "resume": "...", "questions": ["...", "...", ...] }
\\\
`.trim();
}

function buildSecondAnalysisPrompt(resume, previousQA, diagnosticPrecedent = "", analyseIndex = 1, userInput = "") {
  const qaFormatted = previousQA
    .map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`)
    .join('\n\n');

  const causeStart = analyseIndex === 1 ? 1 : 5;

  const finalResume = resume && resume.trim().length > 0 ? resume : userInput;

  return `
Tu es un technicien expérimenté qui analyse des problèmes techniques.  
L’équipement fonctionnait avant correctement, sauf info contraire.

Résumé de la demande utilisateur : "${finalResume}"

Règles :

- Base-toi sur manuels, codes défaut, documents constructeur et expérience terrain.  
- Commence par la cause officielle liée au code défaut, puis propose 3 autres causes probables.  
- Classe les causes de la plus probable à la moins probable.  
- Prends en compte environnement, apparition, codes erreur, conditions au moment du défaut.  
- Considère causes globales si plusieurs éléments sont affectés.  
- Pense aux causes indirectes (environnement, câblage, communication…).  
- Interprète les termes mal nommés par l’utilisateur.  
- Identifie les paramètres constructeur spécifiques à corriger.  
- Ne donne aucune explication, répond uniquement par un objet JSON strict.

${diagnosticPrecedent ? `Diagnostic précédent :\n${diagnosticPrecedent}\n` : ""}

Questions et réponses précédentes :  
${qaFormatted}

Propose jusqu’à 4 causes probables avec vérifications concrètes et actions terrain :
Réponds uniquement par un objet JSON strict :

\\\json
{
  "causes": [
    { "cause": " ${causeStart} : ...", "verification": "..." },
    { "cause": " ${causeStart + 1} : ...", "verification": "..." },
    { "cause": " ${causeStart + 2} : ...", "verification": "..." },
    { "cause": "${causeStart + 3} : ...", "verification": "..." }
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

