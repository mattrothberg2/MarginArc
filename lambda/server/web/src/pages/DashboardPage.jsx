import { useEffect, useState } from 'react'
import { Title, useRedirect } from 'react-admin'
import { Card, CardContent, Typography, Box, Divider, Chip } from '@mui/material'

function StatCard({ label, value, urgent }) {
  return (
    <Card
      elevation={0}
      sx={{
        border: urgent ? '1px solid #fb923c' : '1px solid #e2e8f0',
        borderRadius: 2,
        flex: '1 1 160px',
      }}
    >
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
            mt: 0.5,
            color: urgent ? '#ea580c' : '#0a1a2f',
          }}
        >
          {value ?? '—'}
        </Typography>
      </CardContent>
    </Card>
  )
}

function actionColor(action) {
  if (action.includes('login')) return 'primary'
  if (action.includes('create')) return 'success'
  if (action.includes('delete') || action.includes('revoke') || action.includes('deactivate'))
    return 'error'
  if (action.includes('update') || action.includes('renew')) return 'warning'
  return 'default'
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [expiring, setExpiring] = useState([])
  const [loadError, setLoadError] = useState(null)
  const redirect = useRedirect()

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    const headers = { Authorization: `Bearer ${token}` }

    Promise.all([
      fetch('/admin/api/dashboard/stats', { headers }).then((r) => r.json()),
      fetch('/admin/api/dashboard/activity', { headers }).then((r) => r.json()),
      fetch('/admin/api/dashboard/expiring', { headers }).then((r) => r.json()),
    ])
      .then(([s, a, e]) => {
        setStats(s)
        setActivity(Array.isArray(a) ? a : [])
        setExpiring(Array.isArray(e) ? e : [])
      })
      .catch((err) => setLoadError(err.message))
  }, [])

  const cards = stats
    ? [
        { label: 'Total Customers', value: stats.totalCustomers },
        { label: 'Active Customers', value: stats.activeCustomers },
        { label: 'Active Licenses', value: stats.activeLicenses },
        {
          label: 'Expiring in 30 Days',
          value: stats.expiringLicenses30d,
          urgent: stats.expiringLicenses30d > 0,
        },
        { label: 'Total Licensed Seats', value: stats.totalSeats },
      ]
    : []

  return (
    <Box sx={{ p: 3 }}>
      <Title title="Dashboard" />

      {loadError && (
        <Box
          sx={{
            p: 2,
            mb: 3,
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 2,
            color: '#b91c1c',
          }}
        >
          Failed to load dashboard data: {loadError}
        </Box>
      )}

      {/* Stats row */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        {stats === null && !loadError
          ? Array(5)
              .fill(null)
              .map((_, i) => <StatCard key={i} label="Loading…" value={null} />)
          : cards.map((c) => (
              <StatCard key={c.label} label={c.label} value={c.value} urgent={c.urgent} />
            ))}
      </Box>

      {/* Expiring licenses */}
      {expiring.length > 0 && (
        <Card elevation={0} sx={{ border: '1px solid #fed7aa', borderRadius: 2, mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#c2410c', mb: 1 }}>
              Licenses Expiring Within 30 Days
            </Typography>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <Box component="thead">
                <Box component="tr" sx={{ background: '#fff7ed' }}>
                  {['License Key', 'Customer', 'Seats', 'Expires'].map((h) => (
                    <Box
                      key={h}
                      component="th"
                      sx={{ textAlign: 'left', p: '8px 12px', color: '#92400e', fontWeight: 600 }}
                    >
                      {h}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {expiring.map((row) => (
                  <Box
                    key={row.id}
                    component="tr"
                    sx={{
                      borderTop: '1px solid #fed7aa',
                      cursor: 'pointer',
                      '&:hover': { background: '#fff7ed' },
                    }}
                    onClick={() => redirect('edit', 'licenses', row.id)}
                  >
                    <Box component="td" sx={{ p: '8px 12px', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                      {row.license_key}
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px' }}>
                      {row.customer_name}
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px' }}>
                      {row.seats_licensed}
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px', color: '#b91c1c', fontWeight: 500 }}>
                      {new Date(row.expiry_date).toLocaleDateString()}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#0a1a2f', mb: 1 }}>
            Recent Activity
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {activity.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No recent activity
            </Typography>
          ) : (
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <Box component="thead">
                <Box component="tr" sx={{ background: '#f8fafc' }}>
                  {['Action', 'Resource', 'Admin', 'Time'].map((h) => (
                    <Box
                      key={h}
                      component="th"
                      sx={{ textAlign: 'left', p: '8px 12px', color: '#64748b', fontWeight: 600, fontSize: '0.8125rem' }}
                    >
                      {h}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {activity.map((row) => (
                  <Box
                    key={row.id}
                    component="tr"
                    sx={{ borderTop: '1px solid #f1f5f9', '&:hover': { background: '#f8fafc' } }}
                  >
                    <Box component="td" sx={{ p: '8px 12px' }}>
                      <Chip
                        label={row.action}
                        size="small"
                        color={actionColor(row.action)}
                        variant="outlined"
                        sx={{ fontSize: '0.75rem', height: 22 }}
                      />
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px', color: '#475569' }}>
                      {row.resource_type}
                      {row.resource_id ? ` #${row.resource_id}` : ''}
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px', fontWeight: 500, color: '#334155' }}>
                      {row.admin_user}
                    </Box>
                    <Box component="td" sx={{ p: '8px 12px', color: '#94a3b8', fontSize: '0.8125rem' }}>
                      {new Date(row.created_at).toLocaleString()}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
