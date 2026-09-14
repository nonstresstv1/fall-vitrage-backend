const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
}

async function me(req, res) {
  res.json({ user: req.user });
}

// Permet à n'importe quel utilisateur connecté (admin ou employé) de
// changer son propre email et/ou mot de passe, en confirmant son mot
// de passe actuel. Utile notamment pour que l'admin rende son compte
// privé (email/mot de passe connus de lui seul) après la mise en place.
async function changeCredentials(req, res) {
  const { current_password, new_email, new_password } = req.body;

  if (!current_password) {
    return res.status(400).json({ error: 'Mot de passe actuel requis.' });
  }
  if (!new_email && !new_password) {
    return res.status(400).json({ error: 'Rien à modifier.' });
  }
  if (new_password && new_password.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (new_email) {
      const cleanEmail = new_email.toLowerCase().trim();
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [cleanEmail, user.id]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Cet email est déjà utilisé par un autre compte.' });
      }
      updates.push(`email = $${idx++}`);
      values.push(cleanEmail);
    }

    if (new_password) {
      const hash = await bcrypt.hash(new_password, 10);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    values.push(user.id);
    const updateResult = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, full_name, email, role`,
      values
    );

    const updatedUser = updateResult.rows[0];

    // Nouveau token, puisque l'email a pu changer (le token le contient)
    const token = jwt.sign(
      { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, full_name: updatedUser.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ user: updatedUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du compte.' });
  }
}

module.exports = { login, me, changeCredentials, forgotPassword, resetPassword };

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Étape 1 : la personne demande un lien de réinitialisation.
// Application locale de magasin : on s'appuie sur l'écran (pas d'email).
// On répond toujours le même message générique, qu'un compte existe ou
// non avec cet email, pour ne pas révéler quels emails sont enregistrés.
async function forgotPassword(req, res) {
  const { email } = req.body;
  const genericMessage = 'Si un compte existe avec cet email, un lien de réinitialisation vient de lui être généré.';

  if (!email) {
    return res.status(400).json({ error: 'Email requis.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase().trim()]);
    const user = result.rows[0];

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expires = new Date(Date.now() + 60 * 60 * 1000); // valable 1 heure

      await pool.query(
        'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
        [tokenHash, expires, user.id]
      );

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
      const resetLink = `${frontendUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

      console.log(`[forgotPassword] Lien de réinitialisation pour ${user.email} :`);
      console.log(resetLink);

      return res.json({
        message: 'Voici votre lien de réinitialisation (gardez-le secret, il expire dans 1 heure).',
        reset_link: resetLink
      });
    }

    res.json({ message: genericMessage });
  } catch (err) {
    console.error('[forgotPassword] Erreur :', err.message);
    res.status(500).json({ error: 'Erreur lors de la demande de réinitialisation.' });
  }
}

// Étape 2 : la personne clique le lien reçu et choisit un nouveau mot de passe.
async function resetPassword(req, res) {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ error: 'Lien invalide.' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
    const tokenHash = hashToken(token);
    const result = await pool.query(
      'SELECT * FROM users WHERE reset_token_hash = $1 AND reset_token_expires > NOW()',
      [tokenHash]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Ce lien est invalide ou a expiré. Refaites une demande.' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, user.id]
    );

    res.json({ message: 'Mot de passe mis à jour. Vous pouvez vous connecter.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe.' });
  }
}
