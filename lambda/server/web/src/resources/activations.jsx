import {
  List,
  Datagrid,
  TextField,
  DateField,
  NumberField,
  TextInput,
  FunctionField,
  ExportButton,
  TopToolbar,
  useRedirect,
} from 'react-admin'
import { Chip, Button } from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

function LicenseStatusChip({ status }) {
  const color =
    status === 'active'
      ? 'success'
      : status === 'revoked'
      ? 'error'
      : status === 'expired'
      ? 'warning'
      : 'default'
  return <Chip label={status || '—'} color={color} size="small" />
}

const activationFilters = [
  <TextInput key="q" label="Search org ID / name" source="q" alwaysOn />,
]

function ActivationListActions() {
  return (
    <TopToolbar>
      <ExportButton />
    </TopToolbar>
  )
}

export function ActivationList() {
  const redirect = useRedirect()

  return (
    <List
      filters={activationFilters}
      sort={{ field: 'activated_at', order: 'DESC' }}
      actions={<ActivationListActions />}
      perPage={25}
    >
      <Datagrid bulkActionButtons={false} rowClick={false}>
        <TextField source="org_id" label="Org ID" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }} />
        <TextField source="org_name" label="Org Name" />
        <TextField source="customer_name" label="Customer" />
        <TextField
          source="license_key"
          label="License Key"
          sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
        />
        <FunctionField
          label="License Status"
          render={(record) => <LicenseStatusChip status={record.license_status} />}
        />
        <NumberField source="seats_used" label="Seats Used" />
        <DateField source="activated_at" label="Activated" showTime />
        <DateField source="last_phone_home" label="Last Seen" showTime />
        <FunctionField
          label="License"
          render={(record) =>
            record.license_id ? (
              <Button
                size="small"
                startIcon={<OpenInNewIcon fontSize="small" />}
                onClick={() => redirect('edit', 'licenses', record.license_id)}
              >
                View
              </Button>
            ) : null
          }
        />
      </Datagrid>
    </List>
  )
}
