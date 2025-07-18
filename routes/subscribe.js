const express = require("express");
const router = express.Router();
const User = require("../models/user");

router.post("/upgrade", async (req, res) => {
  const { user_id, new_level } = req.body;
  const validLevels = ["basic", "premium", "elite"];

  if (!validLevels.includes(new_level)) {
    return res.status(400).json({ error: "Niveau d'abonnement invalide." });
  }

  try {
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé." });
    }

    user.subscription_level = new_level;
    await user.save();

    res.json({ message: `Abonnement mis à jour en ${new_level}` });
  } catch (err) {
    console.error("Erreur upgrade abonnement :", err);
    res.status(500).json({ error: "Erreur serveur lors de la mise à jour." });
  }
});

module.exports = router;
