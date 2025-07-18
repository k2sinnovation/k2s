// routes/answer.js

const express = require('express');
const router = express.Router();
const { processAnswer } = require('../controllers/answerController');

// Route POST pour l'analyse (intermédiaire ou finale)
router.post('/', processAnswer);

module.exports = router;
