const openaiService = require("../controllers/openaiService");
const User = require("../models/usermodel");

exports.answer = async (req, res) => {
  try {
    const { user_id, answers, history } = req.body; 
    // answers : tableau des réponses utilisateur aux 5 questions
    // history : historique complet pour analyse approfondie (optionnel)

    // 1. Vérifie et incrémente quota
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

    // Reset quota journalier si nécessaire
    const today = new Date().toISOString().slice(0, 10);
    if (user.last_analysis_date !== today) {
      user.analysis_count = 0;
      user.last_analysis_date = today;
    }

    if (user.analysis_count >= 3 && user.subscription_level === "basic") {
      return res.status(403).json({ message: "Quota dépassé, passez en premium" });
    }

    user.analysis_count += 1;
    await user.save();

    // 2. Prépare prompt final à envoyer à OpenAI
    let prompt = "Tu es un expert en diagnostic technique. Voici les réponses de l'utilisateur :\n";
    answers.forEach((answer, i) => {
      prompt += `Q${i + 1}: ${answer}\n`;
    });
    if (history) {
      prompt += `\nHistorique complet : ${history}\n`;
    }

    // 3. Appelle OpenAI pour générer diagnostic
    const diagnostic = await openaiService.askOpenAI(prompt, "");

    // 4. Envoie la réponse au client
    res.json({ diagnostic });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
