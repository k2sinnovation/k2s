const express = require('express');
const router = express.Router();
const { retryFinalDiagnosis } = require('../controllers/retryController');

router.post('/', retryFinalDiagnosis);

module.exports = router;

