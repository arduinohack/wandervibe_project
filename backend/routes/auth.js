const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');  // For password hashing
const jwt = require('jsonwebtoken');
const redis = require('redis');  // Optional for blacklist
const User = require('../models/User');
const logger = require('../utils/logger');  // Added: Borrow exported logger from ../util/logger.js
const { authMiddleware } = require('../middleware/auth');  // Add this line for token verification
const { v4: uuidv4 } = require('uuid');  // For reset token

// POST /api/auth/login (Verifies email/password, returns token)
router.post('/login', async (req, res) => {
  // This initial request for login does not use middleware
  const userId = req.user?.id ?? 'User ID not in request';
  const { email, password } = req.body;
  logger.info('Login Request', {
    userId: userId,
    event: 'AuthLogin',
    context: { email: email }
  });
 
  // Validate required fields
  if (!email || !password) {
    logger.error('Missing required fields: email, password', {
      userId: userId,
      event: 'AuthLogin',
      context: { email: email, password: password }  // Sanitize sensitive data!
    });
    return res.status(400).json({ message: 'Missing required fields: email, password' });
  }

  try {
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      logger.error('User Not Found', {
        userId: userId,
        event: 'AuthLogin',
        context: { email: email }  // Sanitize sensitive data!
      });
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Verify password (compare hashed)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.error('Password mismatch - invalid credentials', {
        userId: userId,
        event: 'AuthLogin',
        context: { email: email }  // Sanitize sensitive data!
      });
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate token (payload with ID only—no password)
    const token = jwt.sign(
      { userId: user._id, role: user.role || 'Wanderer' },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: '1h' }
    );

    // Return token and user without password
    const userWithoutPassword = user.toObject();  // Convert to plain object
    delete userWithoutPassword.password;  // Hide password
    res.status(200).json({ token, user: userWithoutPassword });
    logger.info('Login successful', {
      userId: user._id,
      event: 'AuthLogin',
      context: { email: email }
    });
  } catch (error) {
      logger.error('Server error', {
        userId: userId,
        event: 'AuthLogin',
        context: { error: error }  // Sanitize sensitive data!
      });
      res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/register (Creates new user, hashes password, returns token)
router.post('/register', async (req, res) => {
  const userId = req.user?.id ?? 'User ID not in request';
  const { firstName, lastName, email, phoneNumber, password, address } = req.body;
  logger.info('Registration Request', {
    userId: userId,
    event: 'AuthRegister',
    context: { email: email }
  });

  // Validate required fields
  if (!firstName || !lastName || !email || !password) {
    logger.error('Missing required fields: firstName, lastName, email, password', {
      userId: userId,
      event: 'AuthRegister',
      context: { firstName: firstName, lastName: lastName, email: email, password: password }  // Sanitize sensitive data!
    });
    return res.status(400).json({ msg: 'Missing required fields: firstName, lastName, email, password' });
  }
  
  if (address && (!address.city || !address.country)) {
    logger.error('Invalid address - city and country required', {
      userId: userId,
      event: 'AuthRegister',
      context: { city: address.city, country: address.country }  // Sanitize sensitive data!
    });
    return res.status(400).json({ msg: 'Invalid address—city and country required' });
  }

  try {
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.info('User already exists with this email', {
        userId: userId,
        event: 'AuthRegister',
        context: { email: email }  // Sanitize sensitive data!
      });
      return res.status(400).json({ msg: 'User already exists with this email' });
    }

    // Hash password (salt rounds 12 for security)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user (UUID for _id)
    const userId = uuidv4();
    const newUser = new User({
      _id: userId,
      firstName,
      lastName,
      email,
      phoneNumber,
      password: hashedPassword,  // Store hashed only
      address: address || undefined, // Use if provided
      notificationPreferences: { email: true, sms: false }  // Default
    });
    logger.info('Saving new user', {
      userId: userId,
      event: 'AuthRegister',
      context: { email: email }
    });
    await newUser.save();

    // Generate JWT token (no password in payload)
    const payload = { id: userId };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

    logger.info('Generated new token and sent to newly registered user', {
      userId: userId,
      event: 'AuthRegister',
      context: { token: token }
    });
    res.status(201).json({ msg: 'User registered successfully!', token });
  } catch (err) {
      logger.error('Server error', {
        userId: userId,
        event: 'AuthPWReset',
        context: { error: err }  // Sanitize sensitive data!
      });
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/auth/forgot-password (Sends reset email with token)
router.post('/forgot-password', async (req, res) => {
  const userId = req.user?.id ?? 'User ID not in request';
  const { email } = req.body;

  if (!email) {
    logger.error('Missing email', {
      userId: userId,
      event: 'AuthForgotPWRequest',
      context: { email: email }
    });
    return res.status(400).json({ msg: 'Missing email' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      logger.error('User Not Found', {
        userId: userId,
        event: 'AuthForgotPWRequest',
        context: { email: email }  // Sanitize sensitive data!
      });
      // Security: Don't reveal if email exists
      return res.json({ msg: 'If the email exists, a reset link has been sent' });
    }

    // Generate reset token (UUID) and expiry (1h)
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);  // 1 hour from now

    // Save to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    logger.info('Saving PW Reset Token for user', {
      userId: userId,
      event: 'AuthForgotPWRequest',
      context: { email: email }
    });
    await user.save();

    // Send email with reset link (using SendGrid)
    const resetUrl = `http://localhost:3000/reset-password?token=${resetToken}&email=${email}`;  // Frontend link
    const msg = {
      to: email,
      from: 'noreply@wandervibe.com',  // Your verified sender
      subject: 'Password Reset Request',
      text: `Click to reset your password: ${resetUrl}\nThis link expires in 1 hour.`,
      html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Expires in 1 hour.</p>`
    };
    logger.info('Requesting SendGrid password reset email to user', {
      userId: userId,
      event: 'AuthForgotPWRequest',
      context: { email: email }
    });
    await sgMail.send(msg);

    res.json({ msg: 'If the email exists, a reset link has been sent' });
  } catch (err) {
      logger.error('Server error', {
        userId: userId,
        event: 'AuthForgotPWRequest',
        context: { error: err }  // Sanitize sensitive data!
      });
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/auth/reset-password (Resets password with token)
router.post('/reset-password', async (req, res) => {
  const userId = req.user?.id ?? 'User ID not in request';
  const { token, email, newPassword } = req.body;

  if (!token || !email || !newPassword) {
    logger.error('Missing token, email or new password', {
      userId: userId,
      event: 'AuthPWReset',
      context: { email: email }
    });
    return res.status(400).json({ msg: 'Missing token, email, or new password' });
  }

  try {
    const user = await User.findOne({ 
      resetToken: token, 
      resetTokenExpiry: { $gt: new Date() },  // Not expired
      email 
    });

    if (!user) {
      logger.error('Invalid or expired token', {
        userId: userId,
        event: 'AuthPWReset',
        context: { email: email }  // Sanitize sensitive data!
      });
      return res.status(400).json({ msg: 'Invalid or expired token' });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear token
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    logger.info('Updating password and clearing token for user', {
      userId: userId,
      event: 'AuthPWReset',
      context: { email: email }
    });
    await user.save();

    // Generate new JWT token
    const payload = { id: user._id };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

    logger.info('Generated new token and sent to user', {
      userId: userId,
      event: 'AuthPWReset',
      context: { token: token }
    });
    res.json({ msg: 'Password reset successfully!', token });
  } catch (err) {
      logger.error('Server error', {
        userId: userId,
        event: 'AuthPWReset',
        context: { error: err }  // Sanitize sensitive data!
      });
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/auth/verify-token - Verify token and return user
router.post('/verify-token', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];  // Bearer token from header
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');  // Verify token
    const user = await User.findById(decoded.userId).select('-password');  // Fetch user without password
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    res.status(200).json({ user });  // Return user
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
  
});

// PATCH /api/auth/users/:userId - Update user fields (auth required)
router.patch('/users/:userId', authMiddleware, async (req, res) => {
  // logger.info('In PATCH /api/auth/users/:userId')
  try {
    const { userId } = req.params;
    const updates = req.body;  // e.g., { firstName: 'New Name', phoneNumber: '+1-555-new', notificationPreferences: { email: false } }
    const updaterId = req.user.userId;  // From JWT

    // logger.info(`Backend received /auth/users: id=${userId}`);
    // logger.info(`Backend received /auth/users: req.body=${updates}`);
    // logger.info(`Backend received /auth/users: req.user.userId=${updaterId}`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (updaterId !== user._id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update all allowed fields (partial merge)
    if (updates.firstName) user.firstName = updates.firstName;
    if (updates.lastName) user.lastName = updates.lastName;
    if (updates.email) user.email = updates.email;
    if (updates.phoneNumber) user.phoneNumber = updates.phoneNumber;
    if (updates.address) user.address = updates.address;
    if (updates.notificationPreferences) user.notificationPreferences = updates.notificationPreferences;

    await user.save();

    // Return updated user without password
    const { password: _, ...userWithoutPassword } = user.toObject();
    // logger.info(`User=${userWithoutPassword}`);
    res.status(200).json({ message: 'User updated', user: userWithoutPassword });
  } catch (error) {
    // logger.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout endpoint: POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  logger.info('At Logout', {
    userId: req.user.id,
    event: 'AuthLogout',
    context: {  }
  });
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (global.redisClient) {
      if (token) {
      // Optional: Blacklist token for 24h
        logger.info('Blacklisting token', {
        userId: req.user.id,
        event: 'AuthLogout',
        context: { Token: token }
        });
        await redisClient.set(token, 'blacklisted', { EX: 86400 });  // 24h expiration
      }
    }
    logger.info('User logged out', {
      userId: req.user.id,
      event: 'AuthLogout',
      context: { tokenLength: token ? token.length : 0 }
    });
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Server error', {
      userId: req.user ? req.user.id : 'anonymous',
      event: 'AuthLogout',
      context: { error: error.message }
    });
    res.status(500).json({ error: 'Logout error' });
  }
});

module.exports = router;