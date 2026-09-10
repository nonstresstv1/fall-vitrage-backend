const express = require('express');
const router = express.Router();
const { list, updatePrice } = require('../controllers/glassController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, list);
router.put('/:id/price', authenticate, requireRole('admin'), updatePrice);

module.exports = router;
