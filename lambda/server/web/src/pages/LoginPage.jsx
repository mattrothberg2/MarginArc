import { useState } from 'react'
import { useLogin, useNotify } from 'react-admin'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [step, setStep] = useState('credentials') // 'credentials' | 'mfa'
  const [mfaToken, setMfaToken] = useState(null)
  const [loading, setLoading] = useState(false)

  const login = useLogin()
  const notify = useNotify()

  const handleCredentials = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login({ username, password })
      // If login() resolves without throwing, React Admin handles the redirect.
    } catch (err) {
      if (err && err.mfa_required) {
        // Backend requires a second factor — switch to the TOTP step
        setMfaToken(err.mfa_token)
        setStep('mfa')
      } else {
        notify(err?.message || 'Invalid credentials', { type: 'error' })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleMfa = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login({ totp_code: totpCode, mfa_token: mfaToken })
      // React Admin redirects to dashboard on success
    } catch (err) {
      notify(err?.message || 'Invalid TOTP code', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a1a2f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          padding: '2.5rem',
          width: '100%',
          maxWidth: '400px',
        }}
      >
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: '#0a1a2f',
              margin: 0,
              fontFamily: "'Inter var', 'Inter', sans-serif",
            }}
          >
            MarginArc
          </h1>
          <p
            style={{
              color: '#64748b',
              fontSize: '0.875rem',
              marginTop: '0.25rem',
              fontFamily: "'Inter var', 'Inter', sans-serif",
            }}
          >
            {step === 'credentials' ? 'Admin Portal' : 'Two-Factor Authentication'}
          </p>
        </div>

        {step === 'credentials' ? (
          <form onSubmit={handleCredentials}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                style={inputStyle}
                placeholder="admin"
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <button type="submit" disabled={loading} style={buttonStyle(loading)}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfa}>
            <p
              style={{
                color: '#475569',
                fontSize: '0.875rem',
                textAlign: 'center',
                marginBottom: '1.5rem',
                lineHeight: 1.5,
                fontFamily: "'Inter var', 'Inter', sans-serif",
              }}
            >
              Enter the 6-digit code from your authenticator app.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>TOTP Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                required
                style={{
                  ...inputStyle,
                  textAlign: 'center',
                  fontSize: '1.5rem',
                  letterSpacing: '0.4em',
                  fontWeight: 600,
                }}
                placeholder="000000"
              />
            </div>
            <button type="submit" disabled={loading} style={buttonStyle(loading)}>
              {loading ? 'Verifying…' : 'Verify Code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('credentials')
                setTotpCode('')
                setMfaToken(null)
              }}
              style={{
                marginTop: '0.75rem',
                width: '100%',
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '0.875rem',
                cursor: 'pointer',
                padding: '0.5rem',
                fontFamily: "'Inter var', 'Inter', sans-serif",
              }}
            >
              ← Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '0.375rem',
  fontFamily: "'Inter var', 'Inter', sans-serif",
}

const inputStyle = {
  display: 'block',
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: "'Inter var', 'Inter', sans-serif",
  transition: 'border-color 0.15s',
}

const buttonStyle = (disabled) => ({
  width: '100%',
  padding: '0.75rem',
  backgroundColor: disabled ? '#a7f3f5' : '#02b1b5',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: "'Inter var', 'Inter', sans-serif",
  transition: 'background-color 0.15s',
})
