const openaiService = require("./openaiService");
const Prompt = require("../promts/prompt");

exports.analyze = async (req, res) => {
  const { user_id, text } = req.body;

  // Étape 1 – filtrage avec Mistral local
  const filtre = await mistralService.filter(text);
  if (filtre.toLowerCase().includes("rejeté")) {
    return res.status(400).json({ status: "rejeté", message: "Demande non technique." });
  }

  // Étape 2 – récupération du prompt
  const promptDoc = await Prompt.findOne({ id: "prompt_diagnostic" });
  const questions = await openaiService.askOpenAI(promptDoc.prompt_text, text);

  res.json({ status: "ok", questions });
};
