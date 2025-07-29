function buildFirstAnalysisPrompt(userInput, qaFormatted) {
  return `
Tu es un assistant technique. Tu raisonnes comme un technicien expérimenté, basé sur des documents fiables (constructeurs, terrain, bases de données).

Demande utilisateur :
"${userInput}"

Questions déjà posées et réponses :
${qaFormatted}

Si la demande n'est pas un problème technique exploitable (panne, choix, dysfonctionnement...), réponds :
\\\json
{ "error": "Demande non reconnue comme problème technique terrain exploitable." }
\\\

Sinon, fournis :
1. Un résumé simple et fidèle du problème.
2. Jusqu’à 5 **nouvelles questions fermées** (oui/non/je ne sais pas) **sans redite**.

Réponds ainsi :
\\\json
{
  "resume": "...",
  "questions": ["...", "..."]
}
\\\
`.trim();
}

function buildSecondAnalysisPrompt(domaine, resume, previousQA, diagnosticPrecedent = "", analyseIndex = 2) {
  const qaFormatted = previousQA
    .map((item, idx) => `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`)
    .join('\n\n');

  const causeStart = analyseIndex === 1 ? 1 : 5;

  return `
Tu es un assistant technique. Tu raisonnes comme un technicien terrain expérimenté, à partir de sources fiables (constructeurs, retours terrain, documentation).

Résumé de la demande :
"${resume}"

${diagnosticPrecedent ? `Diagnostic précédent :\n${diagnosticPrecedent}` : ""}

Questions/réponses :
${qaFormatted}

Si un code défaut, un composant identifié, une référence ou un symptôme clair est présent, commence toujours par la **cause officielle ou connue**.

Propose ensuite jusqu’à 4 causes probables, claires et réalistes. Pour chaque cause, donne une vérification concrète, faisable sur le terrain (test, paramètre, mesure…).

Réponse attendue :

Cause ${causeStart} : [description] → Vérification : [paramètre/test/action]  
Cause ${causeStart + 1} : …  
Cause ${causeStart + 2} : …  
Cause ${causeStart + 3} : …

Ne propose pas d’hypothèse vague ou théorique.

Conclue toujours par :  
"Si vous n'avez pas trouvé de solution, lancez une nouvelle analyse."
`.trim();
}


function buildFinalAnalysisPrompt(domaine, fullHistory, diagnosticPrecedent, questionsReponses) {
  const qaFormatted = questionsReponses
    .map((item, idx) => `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`)
    .join('\n\n');

  return `
Tu es un assistant technique expérimenté, spécialisé dans les diagnostics concrets. Tu t’appuies sur des faits vérifiés et des documents fiables.

Historique :
${fullHistory}

Diagnostic précédent :
${diagnosticPrecedent}

Questions/réponses :
${qaFormatted}

Propose jusqu’à 4 causes probables (logiques, concrètes, réalistes). Pour chaque cause, indique une vérification précise : paramètre, mesure, test ou action terrain.

Réponse :

Cause 9 : [description] → Vérification : [action précise]  
Cause 10 : …  
Cause 11 : …  
Cause 12 : …

Pas de raisonnement vague ou hypothétique.

Conclue avec :
"Si vous n'avez toujours pas trouvé la solution, veuillez contacter le fabricant ou fournisseur."

Si analyseIndex = 4 ou plus, réponds uniquement :
\\\json
{ "error": "Limite d’analyses atteinte. Veuillez contacter un expert terrain pour aller plus loin." }
\\\
`.trim();
}

module.exports = {
  buildFirstAnalysisPrompt,
  buildSecondAnalysisPrompt,
  buildFinalAnalysisPrompt
};

