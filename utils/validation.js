const db = require('../db');

// Email regex pattern
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Phone regex pattern: allows optional +, optional country code, 10-15 digits with spaces/hyphens
const PHONE_REGEX = /^(?:\+?\d{1,3}[- ]?)?\(?\d{3,5}\)?[- ]?\d{3,5}[- ]?\d{0,4}$/;

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const digitsOnly = phone.replace(/\D/g, '');
  // Must have between 10 and 15 digits
  return digitsOnly.length >= 10 && digitsOnly.length <= 15 && PHONE_REGEX.test(phone.trim());
}

function validatePasswordPolicy(password) {
  const errors = [];
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one numeric digit (0-9).');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (e.g. !@#$%^&*).');
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}

function getTodayISODate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateCustomerPayload(data, excludeId = null) {
  const errors = [];

  // Required CustomerName
  if (!data.CustomerName || !data.CustomerName.trim()) {
    errors.push('Customer Name is required.');
  } else if (data.CustomerName.trim().length > 100) {
    errors.push('Customer Name cannot exceed 100 characters.');
  }

  // Email format & required
  if (!data.Email || !data.Email.trim()) {
    errors.push('Email is required.');
  } else if (!isValidEmail(data.Email)) {
    errors.push('Enter a valid email address.');
  } else {
    // Uniqueness check
    let query = 'SELECT CustomerId FROM Customers WHERE Email = ? COLLATE NOCASE';
    let params = [data.Email.trim()];
    if (excludeId) {
      query += ' AND CustomerId != ?';
      params.push(excludeId);
    }
    const existing = db.prepare(query).get(...params);
    if (existing) {
      errors.push('A customer with this email address already exists.');
    }
  }

  // Phone format & required
  if (!data.Phone || !data.Phone.trim()) {
    errors.push('Phone is required.');
  } else if (!isValidPhone(data.Phone)) {
    errors.push('Enter a valid phone number (minimum 10 digits).');
  } else {
    // Uniqueness check
    const cleanPhone = data.Phone.trim();
    let query = 'SELECT CustomerId FROM Customers WHERE Phone = ?';
    let params = [cleanPhone];
    if (excludeId) {
      query += ' AND CustomerId != ?';
      params.push(excludeId);
    }
    const existingPhone = db.prepare(query).get(...params);
    if (existingPhone) {
      errors.push('A customer with this phone number already exists.');
    }
  }

  return errors;
}

function validateLeadPayload(data, excludeId = null) {
  const errors = [];

  // Required LeadName
  if (!data.LeadName || !data.LeadName.trim()) {
    errors.push('Lead Name is mandatory.');
  } else if (data.LeadName.trim().length > 100) {
    errors.push('Lead Name cannot exceed 100 characters.');
  }

  // Email
  if (!data.Email || !data.Email.trim()) {
    errors.push('Lead Email is required.');
  } else if (!isValidEmail(data.Email)) {
    errors.push('Enter a valid lead email address.');
  }

  // Phone
  if (!data.Phone || !data.Phone.trim()) {
    errors.push('Lead Phone is required.');
  } else if (!isValidPhone(data.Phone)) {
    errors.push('Enter a valid lead phone number.');
  }

  // Status
  const validStatuses = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];
  if (!data.Status || !validStatuses.includes(data.Status)) {
    errors.push(`Lead Status must be one of: ${validStatuses.join(', ')}.`);
  }

  // Expected Value
  const expVal = parseFloat(data.ExpectedValue);
  if (isNaN(expVal) || expVal < 0) {
    errors.push('Expected value must be a valid non-negative number.');
  }

  return errors;
}

function validateOpportunityPayload(data) {
  const errors = [];

  if (!data.OpportunityName || !data.OpportunityName.trim()) {
    errors.push('Opportunity Name is required.');
  }

  if (!data.CustomerId) {
    errors.push('Associated Customer is required.');
  }

  const amount = parseFloat(data.Amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push('Opportunity Amount must be greater than 0.');
  }

  const prob = parseFloat(data.Probability);
  if (isNaN(prob) || prob < 0 || prob > 100) {
    errors.push('Probability must be between 0 and 100.');
  }

  const validStages = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  if (!data.Stage || !validStages.includes(data.Stage)) {
    errors.push(`Stage must be one of: ${validStages.join(', ')}.`);
  }

  if (!data.ExpectedCloseDate) {
    errors.push('Expected Close Date is required.');
  } else {
    const today = getTodayISODate();
    const isClosed = data.Stage === 'Won' || data.Stage === 'Lost';
    if (!isClosed && data.ExpectedCloseDate < today) {
      errors.push('Expected Close Date cannot be in the past.');
    }
  }

  return errors;
}

function validateFollowUpPayload(data) {
  const errors = [];

  if (!data.Subject || !data.Subject.trim()) {
    errors.push('Follow-Up Subject is required.');
  }

  if (!data.CustomerId && !data.LeadId && !data.OpportunityId) {
    errors.push('Follow-Up must be linked to at least one Customer, Lead, or Opportunity.');
  }

  if (!data.FollowUpDate) {
    errors.push('Follow-Up Date is required.');
  } else {
    const today = getTodayISODate();
    const isNewOrPlanned = !data.Status || data.Status === 'Planned';
    if (isNewOrPlanned && data.FollowUpDate < today) {
      errors.push('Follow-up date cannot be earlier than today.');
    }
  }

  const validTypes = ['Call', 'Meeting', 'Email', 'Task'];
  if (data.FollowUpType && !validTypes.includes(data.FollowUpType)) {
    errors.push(`Follow-up type must be one of: ${validTypes.join(', ')}.`);
  }

  return errors;
}

module.exports = {
  isValidEmail,
  isValidPhone,
  validatePasswordPolicy,
  getTodayISODate,
  validateCustomerPayload,
  validateLeadPayload,
  validateOpportunityPayload,
  validateFollowUpPayload
};
