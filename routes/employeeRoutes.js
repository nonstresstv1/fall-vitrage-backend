const express = require('express');
const router = express.Router();
const { list, create, toggleActive } = require('../controllers/employeeController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin'));

router.get('/', list);
router.post('/', create);
router.patch('/:id/toggle', toggleActive);

module.exports = router;
