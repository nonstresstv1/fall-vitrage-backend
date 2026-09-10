const express = require('express');
const router = express.Router();
const { createAndDownload, listByOrder, listAll } = require('../controllers/invoiceController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', listAll);
router.get('/order/:orderId', listByOrder);
router.get('/order/:orderId/pdf', createAndDownload);

module.exports = router;
