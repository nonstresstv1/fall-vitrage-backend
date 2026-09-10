const express = require('express');
const router = express.Router();
const { addPayment, listByOrder } = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/', addPayment);
router.get('/order/:orderId', listByOrder);

module.exports = router;
