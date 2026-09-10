const express = require('express');
const router = express.Router();
const { create, list, getById, updateStatus, setArchived, remove } = require('../controllers/orderController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.post('/', create);
router.get('/', list);
router.get('/:id', getById);
router.patch('/:id/status', updateStatus);
router.patch('/:id/archive', requireRole('admin'), setArchived);
router.delete('/:id', requireRole('admin'), remove);

module.exports = router;
