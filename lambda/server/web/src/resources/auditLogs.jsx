import {
  List,
  Datagrid,
  TextField,
  DateField,
  TextInput,
  SelectInput,
  FunctionField,
  ExportButton,
  TopToolbar,
} from 'react-admin'
import { Chip } from '@mui/material'

function ActionChip({ action }) {
  let color = 'default'
  if (action?.includes('login')) color = 'primary'
  else if (action?.includes('create')) color = 'success'
  else if (
    action?.includes('delete') ||
    action?.includes('revoke') ||
    action?.includes('deactivate') ||
    action?.includes('failed')
  )
    color = 'error'
  else if (action?.includes('update') || action?.includes('renew') || action?.includes('promote'))
    color = 'warning'
  else if (action?.includes('setup') || action?.includes('enabled')) color = 'info'

  return <Chip label={action || '—'} color={color} size="small" variant="outlined" />
}

const auditFilters = [
  <SelectInput
    key="action"
    source="action"
    choices={[
      { id: 'login', name: 'login' },
      { id: 'login_mfa_pending', name: 'login_mfa_pending' },
      { id: 'mfa_failed', name: 'mfa_failed' },
      { id: 'create', name: 'create' },
      { id: 'update', name: 'update' },
      { id: 'delete', name: 'delete' },
      { id: 'revoke', name: 'revoke' },
      { id: 'renew', name: 'renew' },
      { id: 'rotate_api_key', name: 'rotate_api_key' },
      { id: 'promote_api_key', name: 'promote_api_key' },
      { id: 'set_phase', name: 'set_phase' },
    ]}
  />,
  <SelectInput
    key="resource_type"
    label="Resource"
    source="resource_type"
    choices={[
      { id: 'admin_users', name: 'Admin Users' },
      { id: 'customers', name: 'Customers' },
      { id: 'licenses', name: 'Licenses' },
      { id: 'doc_users', name: 'Doc Users' },
      { id: 'settings', name: 'Settings' },
      { id: 'api_key', name: 'API Key' },
    ]}
  />,
  <TextInput key="admin_user" label="Admin" source="admin_user" />,
]

function AuditLogListActions() {
  return (
    <TopToolbar>
      <ExportButton />
    </TopToolbar>
  )
}

export function AuditLogList() {
  return (
    <List
      filters={auditFilters}
      sort={{ field: 'created_at', order: 'DESC' }}
      actions={<AuditLogListActions />}
      perPage={25}
    >
      <Datagrid bulkActionButtons={false} rowClick={false}>
        <FunctionField
          label="Action"
          render={(record) => <ActionChip action={record.action} />}
        />
        <TextField source="resource_type" label="Resource" />
        <TextField source="resource_id" label="ID" />
        <TextField source="admin_user" label="Admin" />
        <TextField source="ip_address" label="IP" />
        <DateField source="created_at" label="Time" showTime />
      </Datagrid>
    </List>
  )
}
