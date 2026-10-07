// AcxiomCRM Global Application Script

let currentUser = null;
let csrfToken = '';

// Initialize CSRF and User Session
async function initApp() {
  try {
    // 1. Fetch CSRF token
    const csrfRes = await fetch('/api/csrf-token');
    const csrfData = await csrfRes.json();
    csrfToken = csrfData.csrfToken;

    // 2. Fetch current user
    const userRes = await fetch('/auth/me');
    if (!userRes.ok) {
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
      return;
    }
    const userData = await userRes.json();
    currentUser = userData.user;

    // Render user profile and role-specific navigation
    renderUserNavigation();
  } catch (err) {
    console.error('App init error:', err);
  }
}

// Render dynamic user info and role permissions in layout
function renderUserNavigation() {
  if (!currentUser) return;

  // Set user names and badges
  const userNameElements = document.querySelectorAll('.current-user-name');
  userNameElements.forEach(el => el.textContent = currentUser.Name);

  const userEmailElements = document.querySelectorAll('.current-user-email');
  userEmailElements.forEach(el => el.textContent = currentUser.Email);

  const userRoleElements = document.querySelectorAll('.current-user-role');
  userRoleElements.forEach(el => {
    el.textContent = currentUser.Role;
    el.className = 'badge current-user-role badge-role-' + (
      currentUser.Role === 'Admin' ? 'admin' : (currentUser.Role === 'Manager' ? 'manager' : 'sales')
    );
  });

  const avatarInitials = document.querySelectorAll('.user-avatar');
  avatarInitials.forEach(el => {
    const initials = currentUser.Name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    el.textContent = initials;
  });

  // Highlight active role in demo switcher
  document.querySelectorAll('.demo-role-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === currentUser.Role);
  });

  // Enforce role-based menu hiding
  if (currentUser.Role !== 'Admin') {
    document.querySelectorAll('.admin-only-nav').forEach(el => el.style.display = 'none');
  }

  if (currentUser.Role === 'SalesExecutive') {
    document.querySelectorAll('.manager-admin-nav').forEach(el => el.style.display = 'none');
  }
}

// Helper to make authenticated & CSRF-protected requests
async function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  options.headers = headers;
  options.credentials = 'same-origin';

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
  }
  return data;
}

// Quick Demo Role Switcher
async function switchDemoRole(role) {
  try {
    showToast(`Switching role to ${role}...`, 'info');
    const res = await fetch('/auth/demo-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ role })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Switched to ${role}`, 'success');
      setTimeout(() => {
        window.location.reload();
      }, 300);
    } else {
      showToast(data.error || 'Failed to switch role', 'danger');
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Toast Notification System
function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
  }

  const toastEl = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-success' : (type === 'danger' ? 'bg-danger' : (type === 'warning' ? 'bg-warning text-dark' : 'bg-primary'));
  toastEl.className = `toast align-items-center text-white ${bgClass} border-0 show shadow-lg mb-2`;
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  toastEl.setAttribute('aria-atomic', 'true');

  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body fw-medium">
        ${message}
      </div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;

  container.appendChild(toastEl);
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.remove(), 300);
  }, 4000);
}

// Client-Side Validation Engine
function validateForm(form) {
  let isValid = true;
  const today = new Date().toISOString().split('T')[0];

  // Clear previous errors
  form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  form.querySelectorAll('.validation-error-feedback').forEach(el => el.remove());

  function addError(input, msg) {
    isValid = false;
    input.classList.add('is-invalid');
    const err = document.createElement('div');
    err.className = 'validation-error-feedback text-danger small mt-1';
    err.textContent = msg;
    input.parentNode.appendChild(err);
  }

  const inputs = form.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    const name = input.name || input.id;
    const val = input.value ? input.value.trim() : '';

    // Required check
    if (input.hasAttribute('required') && !val) {
      addError(input, `${input.dataset.label || name} is required.`);
      return;
    }

    if (val) {
      // Email format
      if (input.type === 'email' || name.toLowerCase().includes('email')) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          addError(input, 'Enter a valid email address.');
        }
      }

      // Phone format
      if (input.type === 'tel' || name.toLowerCase().includes('phone')) {
        const digits = val.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) {
          addError(input, 'Enter a valid phone number (minimum 10 digits).');
        }
      }

      // Opportunity Amount > 0
      if (name === 'Amount' || name === 'opportunityAmount') {
        const num = parseFloat(val);
        if (isNaN(num) || num <= 0) {
          addError(input, 'Opportunity Amount must be greater than 0.');
        }
      }

      // Probability 0 - 100
      if (name === 'Probability') {
        const prob = parseFloat(val);
        if (isNaN(prob) || prob < 0 || prob > 100) {
          addError(input, 'Probability must be between 0 and 100.');
        }
      }

      // Expected Close Date cannot be in the past for active opportunities
      if (name === 'ExpectedCloseDate' || name === 'expectedCloseDate') {
        const stage = form.querySelector('[name="Stage"]')?.value;
        if (stage !== 'Won' && stage !== 'Lost' && val < today) {
          addError(input, 'Expected Close Date cannot be in the past.');
        }
      }

      // Follow-Up Date cannot be in the past for new/planned follow-up
      if (name === 'FollowUpDate' || name === 'followUpDate') {
        const status = form.querySelector('[name="Status"]')?.value || 'Planned';
        if (status === 'Planned' && val < today) {
          addError(input, 'Follow-up date cannot be earlier than today.');
        }
      }

      // Max Length
      const maxLen = input.getAttribute('maxlength');
      if (maxLen && val.length > parseInt(maxLen, 10)) {
        addError(input, `Maximum character length is ${maxLen}.`);
      }
    }
  });

  return isValid;
}

// Logout handler
async function handleLogout() {
  try {
    await fetch('/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    window.location.href = '/login';
  } catch (err) {
    window.location.href = '/login';
  }
}

document.addEventListener('DOMContentLoaded', initApp);
