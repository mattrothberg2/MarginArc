const API_BASE = '/admin/api'

const authProvider = {
  /**
   * Login handles two steps:
   * Step 1 — username + password: may return mfa_required signal
   * Step 2 — mfa_token + totp_code: completes MFA authentication
   */
  async login({ username, password, totp_code, mfa_token }) {
    // Step 2: TOTP code submission
    if (totp_code && mfa_token) {
      const response = await fetch(`${API_BASE}/auth/mfa/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token, totp_code }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || 'Invalid TOTP code')
      }
      const data = await response.json()
      localStorage.setItem('admin_token', data.token)
      localStorage.setItem('admin_user', JSON.stringify(data.user))
      return
    }

    // Step 1: username + password
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.message || 'Invalid credentials')
    }
    const data = await response.json()

    if (data.mfa_required) {
      // Signal LoginPage to show the TOTP step. We throw so React Admin
      // does NOT redirect to the dashboard yet.
      // eslint-disable-next-line no-throw-literal
      throw { mfa_required: true, mfa_token: data.mfa_token, user: data.user }
    }

    localStorage.setItem('admin_token', data.token)
    localStorage.setItem('admin_user', JSON.stringify(data.user))
  },

  async logout() {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
  },

  async checkAuth() {
    const token = localStorage.getItem('admin_token')
    if (!token) throw new Error('Not authenticated')

    // Verify token is still valid server-side
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      throw new Error('Session expired')
    }
    // Refresh stored user info from server
    const user = await response.json()
    localStorage.setItem('admin_user', JSON.stringify(user))
  },

  async checkError({ status }) {
    if (status === 401 || status === 403) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      throw new Error('Session expired')
    }
  },

  async getIdentity() {
    const user = JSON.parse(localStorage.getItem('admin_user') || '{}')
    return {
      id: user.id || 0,
      fullName: user.fullName || user.username || 'Admin',
      avatar: null,
    }
  },

  async getPermissions() {
    const user = JSON.parse(localStorage.getItem('admin_user') || '{}')
    return user.role || 'viewer'
  },
}

export default authProvider
