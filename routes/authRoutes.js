const express = require('express');
const router = express.Router();
const { login, me, changeCredentials, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', authenticate, me);
router.patch('/me', authenticate, changeCredentials);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
