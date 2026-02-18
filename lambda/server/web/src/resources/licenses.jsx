import { useState } from 'react'
import {
  List,
  Datagrid,
  TextField,
  DateField,
  NumberField,
  FunctionField,
  Create,
  Edit,
  SimpleForm,
  ReferenceInput,
  AutocompleteInput,
  SelectInput,
  TextInput,
  NumberInput,
  DateInput,
  Show,
  SimpleShowLayout,
  TopToolbar,
  EditButton,
  ShowButton,
  CreateButton,
  ExportButton,
  SaveButton,
  Toolbar,
  useDataProvider,
  useNotify,
  useRefresh,
  useRecordContext,
  required,
  minValue,
} from 'react-admin'
import {
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField as MuiTextField,
} from '@mui/material'
import BlockIcon from '@mui/icons-material/Block'
import AutorenewIcon from '@mui/icons-material/Autorenew'

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_COLORS = {
  active: 'success',
  pending: 'warning',
  expired: 'error',
  revoked: 'default',
}

function StatusChip({ status }) {
  return (
    <Chip
      label={status || 'unknown'}
      color={STATUS_COLORS[status] || 'default'}
      size="small"
      variant={status === 'revoked' ? 'outlined' : 'filled'}
    />
  )
}

// ---------------------------------------------------------------------------
// Revoke button
// ---------------------------------------------------------------------------

function RevokeButton() {
  const record = useRecordContext()
  const dataProvider = useDataProvider()
  const notify = useNotify()
  const refresh = useRefresh()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  if (!record || record.status === 'revoked') return null

  const handleRevoke = async () => {
    setLoading(true)
    try {
      await dataProvider.revokeRecord('licenses', { id: record.id, data: { reason } })
      notify('License revoked', { type: 'success' })
      refresh()
      setOpen(false)
      setReason('')
    } catch (err) {
      notify(err.message || 'Revoke failed', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        size="small"
        color="error"
        startIcon={<BlockIcon />}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        Revoke
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Revoke License</DialogTitle>
        <DialogContent>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#475569' }}>
            Revoke <strong>{record.license_key}</strong>?
            <br />
            The license will be immediately deactivated.
          </p>
          <MuiTextField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRevoke}
            color="error"
            variant="contained"
            disabled={loading}
          >
            {loading ? 'Revoking…' : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Renew button
// ---------------------------------------------------------------------------

function RenewButton() {
  const record = useRecordContext()
  const dataProvider = useDataProvider()
  const notify = useNotify()
  const refresh = useRefresh()
  const [open, setOpen] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')
  const [loading, setLoading] = useState(false)

  if (!record || record.status === 'revoked') return null

  // Default new expiry to 1 year from now (or from current expiry if in the future)
  const openDialog = (e) => {
    e.stopPropagation()
    const base = record.expiry_date ? new Date(record.expiry_date) : new Date()
    if (base < new Date()) {
      base.setTime(new Date().getTime())
    }
    base.setFullYear(base.getFullYear() + 1)
    setExpiryDate(base.toISOString().split('T')[0])
    setOpen(true)
  }

  const handleRenew = async () => {
    if (!expiryDate) {
      notify('Please select an expiry date', { type: 'warning' })
      return
    }
    setLoading(true)
    try {
      await dataProvider.renewRecord('licenses', { id: record.id, data: { expiry_date: expiryDate } })
      notify('License renewed', { type: 'success' })
      refresh()
      setOpen(false)
    } catch (err) {
      notify(err.message || 'Renew failed', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        size="small"
        color="primary"
        startIcon={<AutorenewIcon />}
        onClick={openDialog}
      >
        Renew
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Renew License</DialogTitle>
        <DialogContent>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#475569' }}>
            Set new expiry date for <strong>{record.license_key}</strong>:
          </p>
          <MuiTextField
            label="New Expiry Date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRenew}
            color="primary"
            variant="contained"
            disabled={loading}
          >
            {loading ? 'Renewing…' : 'Renew'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// List filters
// ---------------------------------------------------------------------------

const licenseFilters = [
  <TextInput key="q" label="Search key / customer" source="q" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: 'active', name: 'Active' },
      { id: 'pending', name: 'Pending' },
      { id: 'expired', name: 'Expired' },
      { id: 'revoked', name: 'Revoked' },
    ]}
  />,
  <SelectInput
    key="license_type"
    label="Type"
    source="license_type"
    choices={[
      { id: 'standard', name: 'Standard' },
      { id: 'trial', name: 'Trial' },
      { id: 'enterprise', name: 'Enterprise' },
    ]}
  />,
]

// ---------------------------------------------------------------------------
// LicenseList
// ---------------------------------------------------------------------------

function LicenseListActions() {
  return (
    <TopToolbar>
      <CreateButton />
      <ExportButton />
    </TopToolbar>
  )
}

export function LicenseList() {
  return (
    <List
      filters={licenseFilters}
      sort={{ field: 'created_at', order: 'DESC' }}
      actions={<LicenseListActions />}
      perPage={25}
    >
      <Datagrid rowClick="edit" bulkActionButtons={false}>
        <TextField source="license_key" label="License Key" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }} />
        <TextField source="customer_name" label="Customer" />
        <NumberField source="seats_licensed" label="Seats" />
        <TextField source="license_type" label="Type" />
        <FunctionField
          label="Status"
          render={(record) => <StatusChip status={record.status} />}
        />
        <DateField source="expiry_date" label="Expires" />
        <DateField source="created_at" label="Created" showTime={false} />
        <RevokeButton />
        <RenewButton />
        <EditButton />
        <ShowButton />
      </Datagrid>
    </List>
  )
}

// ---------------------------------------------------------------------------
// LicenseCreate
// ---------------------------------------------------------------------------

export function LicenseCreate() {
  return (
    <Create>
      <SimpleForm>
        <ReferenceInput source="customer_id" reference="customers" label="Customer">
          <AutocompleteInput
            optionText="name"
            filterToQuery={(q) => ({ q })}
            validate={required()}
            fullWidth
          />
        </ReferenceInput>
        <NumberInput
          source="seats_licensed"
          label="Seats"
          validate={[required(), minValue(1)]}
          min={1}
          fullWidth
        />
        <DateInput
          source="expiry_date"
          label="Expiry Date"
          validate={required()}
          fullWidth
        />
        <SelectInput
          source="license_type"
          label="License Type"
          defaultValue="standard"
          choices={[
            { id: 'standard', name: 'Standard' },
            { id: 'trial', name: 'Trial' },
            { id: 'enterprise', name: 'Enterprise' },
          ]}
          fullWidth
        />
        <TextInput source="notes" label="Notes" multiline rows={3} fullWidth />
      </SimpleForm>
    </Create>
  )
}

// ---------------------------------------------------------------------------
// LicenseEdit
// ---------------------------------------------------------------------------

function LicenseEditToolbar() {
  return (
    <Toolbar>
      <SaveButton />
    </Toolbar>
  )
}

export function LicenseEdit() {
  return (
    <Edit>
      <SimpleForm toolbar={<LicenseEditToolbar />}>
        <TextInput source="license_key" label="License Key" disabled fullWidth />
        <TextInput source="customer_name" label="Customer" disabled fullWidth />
        <NumberInput
          source="seats_licensed"
          label="Seats"
          validate={[required(), minValue(1)]}
          min={1}
          fullWidth
        />
        <DateInput
          source="expiry_date"
          label="Expiry Date"
          validate={required()}
          fullWidth
        />
        <SelectInput
          source="status"
          choices={[
            { id: 'active', name: 'Active' },
            { id: 'pending', name: 'Pending' },
            { id: 'expired', name: 'Expired' },
            { id: 'revoked', name: 'Revoked' },
          ]}
          fullWidth
        />
        <SelectInput
          source="license_type"
          label="License Type"
          choices={[
            { id: 'standard', name: 'Standard' },
            { id: 'trial', name: 'Trial' },
            { id: 'enterprise', name: 'Enterprise' },
          ]}
          fullWidth
        />
        <TextInput source="notes" label="Notes" multiline rows={3} fullWidth />
      </SimpleForm>
    </Edit>
  )
}

// ---------------------------------------------------------------------------
// LicenseShow
// ---------------------------------------------------------------------------

export function LicenseShow() {
  return (
    <Show>
      <SimpleShowLayout>
        <TextField source="license_key" label="License Key" sx={{ fontFamily: 'monospace' }} />
        <TextField source="customer_name" label="Customer" />
        <NumberField source="seats_licensed" label="Seats" />
        <TextField source="license_type" label="Type" />
        <FunctionField label="Status" render={(r) => <StatusChip status={r.status} />} />
        <DateField source="expiry_date" label="Expiry Date" />
        <DateField source="created_at" label="Created" showTime />
        <TextField source="notes" label="Notes" />
      </SimpleShowLayout>
    </Show>
  )
}
