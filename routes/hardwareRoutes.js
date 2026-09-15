const express = require('express');
const router = express.Router();
const { list, getById, create, update, remove } = require('../controllers/hardwareController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', list);
router.get('/:id', getById);
router.post('/', requireRole('admin'), create);
router.put('/:id', requireRole('admin'), update);
router.delete('/:id', requireRole('admin'), remove);

module.exports = router;
