const jwt = require('jsonwebtoken');
const config = require("../config/fabric-config");
const dotenv = require('dotenv');
dotenv.config();

const EMAIL_TO_ORG_MAPPING = {
  'corp.co.id': 'org1',
  'comp.co.id': 'org2',
};

function getOrgFromEmail(email) {
  if (!email) return null;

  const domain = email.split('@')[1];
  return EMAIL_TO_ORG_MAPPING[domain] || null;
}

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token tidak ditemukan. Gunakan header: Authorization: Bearer <token>'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = {
      userId: decoded.user_id,
      username: decoded.preferred_username,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role || 'user',
      organizations: []
    };

    const orgFromEmail = getOrgFromEmail(user.email);
    if (orgFromEmail) {
      user.organizations.push(orgFromEmail);
    }

    if (decoded.organizations && Array.isArray(decoded.organizations)) {
      user.organizations = [...new Set([...user.organizations, ...decoded.organizations])];
    }

    if (user.organizations.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'User tidak memiliki akses ke organization manapun',
        email: user.email,
        hint: 'Pastikan email domain terdaftar atau JWT memiliki field organizations'
      });
    }

    req.user = user;

    console.log(`JWT verified for user: ${user.username} (${user.email}) → orgs: ${user.organizations.join(', ')}`);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token sudah expired. Silakan login kembali.'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({
        success: false,
        error: 'Token tidak valid'
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Authentication failed',
      details: error.message
    });
  }
};

const validateOrgAccess = (req, res, next) => {
  const { orgName } = req.params;
  const user = req.user;

  if (!config.organizations[orgName]) {
    return res.status(400).json({
      success: false,
      error: `Organization ${orgName} not found`,
      availableOrgs: config.getAllOrgs(),
    });
  }

  if (!user.organizations.includes(orgName)) {
    console.warn(`Access denied: User ${user.username} (${user.email}) tried to access ${orgName}`);

    return res.status(403).json({
      success: false,
      error: `Access denied. User ${user.username} tidak memiliki akses ke ${orgName}`,
      userEmail: user.email,
      userAllowedOrgs: user.organizations,
      attemptedOrg: orgName,
      hint: `User dengan email @${user.email.split('@')[1]} hanya bisa akses: ${user.organizations.join(', ')}`
    });
  }

  req.walletUserId = user.username;

  console.log(`Access granted: ${user.username} (${user.email}) → ${orgName}`);
  next();
};

const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        error: 'Role tidak ditemukan dalam token'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Role '${req.user.role}' tidak diizinkan.`,
        requiredRoles: allowedRoles
      });
    }

    next();
  };
};

function getEmailOrgMapping() {
  return EMAIL_TO_ORG_MAPPING;
}

module.exports = {
  verifyToken,
  validateOrgAccess,
  checkRole,
  getOrgFromEmail,
  getEmailOrgMapping
};
