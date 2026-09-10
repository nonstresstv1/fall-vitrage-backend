const express = require('express');
const router = express.Router();
const { stats, summary } = require('../controllers/dashboardController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/stats', authenticate, requireRole('admin'), stats);
router.get('/summary', authenticate, requireRole('employe', 'admin'), summary);

module.exports = router;
