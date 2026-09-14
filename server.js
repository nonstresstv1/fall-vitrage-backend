require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const glassRoutes = require('./routes/glassRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Darou Salam Miroir API' });
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', glassRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/invoices', invoiceRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Darou Salam Miroir API démarrée sur le port ${PORT}`);
});
