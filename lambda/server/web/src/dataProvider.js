import simpleRestProvider from 'ra-data-simple-rest'
import { fetchUtils } from 'react-admin'

const API_BASE = '/admin/api'

/**
 * Inject the Authorization header into every request.
 */
const httpClient = (url, options = {}) => {
  const token = localStorage.getItem('admin_token')
  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetchUtils.fetchJson(url, { ...options, headers })
}

const baseDataProvider = simpleRestProvider(API_BASE, httpClient)

/**
 * Helper: call a custom action endpoint (not covered by CRUD).
 */
async function customPost(path, body = {}) {
  const token = localStorage.getItem('admin_token')
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || `Request to ${path} failed`)
  }
  return { data: await response.json() }
}

const dataProvider = {
  ...baseDataProvider,

  /**
   * POST /licenses/:id/revoke
   * Revoke a license with an optional reason.
   */
  revokeRecord(resource, { id, data }) {
    return customPost(`/${resource}/${id}/revoke`, data || {})
  },

  /**
   * POST /licenses/:id/renew
   * Renew a license with a new expiry_date.
   */
  renewRecord(resource, { id, data }) {
    return customPost(`/${resource}/${id}/renew`, data || {})
  },
}

export default dataProvider
