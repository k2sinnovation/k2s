// routes/answer.js

const express = require("express");
const router = express.Router();
const { processAnswer } = require("../controllers/answerController");

// POST /api/answer
router.post("/", processAnswer);

module.exports = router;
