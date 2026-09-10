const express = require('express');
const router = express.Router();
const { get, update } = require('../controllers/settingsController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, get);
router.put('/', authenticate, requireRole('admin'), update);

module.exports = router;
