// utils/promptBuilder.js

function buildFirstAnalysisPrompt(description) {
  return `
Tu es un expert en diagnostic technique. Analyse la description suivante du problème : 
"""${description}"""

1. Commence par générer un résumé synthétique du problème en commençant par : /résumé :
2. Ensuite, pose 5 questions fermées pertinentes (réponses : Oui / Non / Je ne sais pas) permettant de mieux cerner le problème.
3. Structure ta réponse au format JSON comme ci-dessous :

{
  "resume": "/résumé : ...",
  "questions": [
    "Votre appareil démarre-t-il correctement ?",
    ...
  ]
}
  `;
}

function buildRetryPrompt(step, resume, questions, answers, diagnostics, additionalInfo) {
  const stepTitle = step === 2 ? "deuxième" : "troisième";
  return `
Tu es un assistant technique intelligent. Voici l'historique des analyses précédentes :

Résumé : ${resume}
Questions/Réponses : ${questions.map((q, i) => `Q${i+1}: ${q} → ${answers[i]}`).join('\n')}
Causes proposées : ${diagnostics.map((d, i) => `Cause ${i+1}: ${d.cause} | Vérification : ${d.verification}`).join('\n')}

L'utilisateur ajoute les précisions suivantes :
"${additionalInfo}"

Maintenant, propose 5 **nouvelles** questions fermées (Oui / Non / Je ne sais pas), **sans répéter** celles déjà posées.

Réponds au format :
{
  "questions": [
    "Est-ce que le voyant X clignote au démarrage ?",
    ...
  ]
}
  `;
}

function buildDiagnosisPrompt(resume, questions, answers) {
  return `
Tu es un expert en dépannage. Voici une demande avec questions/réponses utilisateur :

Résumé : ${resume}
Q/R :
${questions.map((q, i) => `Q${i+1}: ${q} → ${answers[i]}`).join('\n')}

À partir de cela, propose 4 causes probables (sans redondance) et pour chaque cause, une méthode de vérification terrain.

Réponds toujours au format JSON comme ci-dessous :

{
  "diagnostics": [
    {
      "cause": "Batterie déchargée",
      "verification": "Mesurer la tension avec un multimètre"
    },
    ...
  ],
  "message": "Si aucune cause ne résout le problème, vous pouvez relancer une deuxième analyse."
}
  `;
}

module.exports = {
  buildFirstAnalysisPrompt,
  buildRetryPrompt,
  buildDiagnosisPrompt
};
