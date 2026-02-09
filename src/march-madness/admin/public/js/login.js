// Login functionality

// Check if already logged in
if (localStorage.getItem('admin_token')) {
  window.location.href = '/admin/dashboard.html';
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const password = document.getElementById('password').value;
  const errorMessage = document.getElementById('error-message');

  // Clear previous errors
  errorMessage.style.display = 'none';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Store token
      localStorage.setItem('admin_token', data.token);

      // Redirect to dashboard
      window.location.href = '/admin/dashboard.html';
    } else {
      // Show error
      errorMessage.textContent = data.error || 'Login failed';
      errorMessage.style.display = 'block';
    }
  } catch (error) {
    console.error('Login error:', error);
    errorMessage.textContent = 'Network error. Please try again.';
    errorMessage.style.display = 'block';
  }
});
