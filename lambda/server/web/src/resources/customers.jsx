import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  SelectInput,
  TextInput,
  TopToolbar,
  EditButton,
  CreateButton,
  ExportButton,
  FunctionField,
  required,
  email,
} from 'react-admin'
import { Chip } from '@mui/material'

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

function CustomerStatusChip({ status }) {
  const color =
    status === 'active' ? 'success' : status === 'inactive' ? 'warning' : 'default'
  return <Chip label={status || 'active'} color={color} size="small" />
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const customerFilters = [
  <TextInput key="q" label="Search name / email" source="q" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: 'active', name: 'Active' },
      { id: 'inactive', name: 'Inactive' },
    ]}
  />,
  <SelectInput
    key="industry"
    source="industry"
    choices={[
      { id: 'Technology', name: 'Technology' },
      { id: 'Healthcare', name: 'Healthcare' },
      { id: 'Finance', name: 'Finance' },
      { id: 'Manufacturing', name: 'Manufacturing' },
      { id: 'Retail', name: 'Retail' },
      { id: 'Education', name: 'Education' },
      { id: 'Government', name: 'Government' },
      { id: 'Other', name: 'Other' },
    ]}
  />,
]

// ---------------------------------------------------------------------------
// CustomerList
// ---------------------------------------------------------------------------

function CustomerListActions() {
  return (
    <TopToolbar>
      <CreateButton />
      <ExportButton />
    </TopToolbar>
  )
}

export function CustomerList() {
  return (
    <List
      filters={customerFilters}
      sort={{ field: 'created_at', order: 'DESC' }}
      actions={<CustomerListActions />}
      perPage={25}
    >
      <Datagrid rowClick="edit" bulkActionButtons={false}>
        <TextField source="name" label="Company Name" />
        <TextField source="contact_email" label="Contact Email" />
        <TextField source="sales_rep" label="Sales Rep" />
        <TextField source="industry" label="Industry" />
        <TextField source="company_size" label="Size" />
        <FunctionField
          label="Status"
          render={(record) => <CustomerStatusChip status={record.status} />}
        />
        <DateField source="created_at" label="Created" showTime={false} />
        <EditButton />
      </Datagrid>
    </List>
  )
}

// ---------------------------------------------------------------------------
// CustomerCreate
// ---------------------------------------------------------------------------

export function CustomerCreate() {
  return (
    <Create>
      <SimpleForm>
        <TextInput source="name" label="Company Name" validate={required()} fullWidth />
        <TextInput
          source="contact_email"
          label="Contact Email"
          validate={[required(), email()]}
          type="email"
          fullWidth
        />
        <TextInput source="sales_rep" label="Sales Rep" fullWidth />
        <SelectInput
          source="industry"
          choices={[
            { id: 'Technology', name: 'Technology' },
            { id: 'Healthcare', name: 'Healthcare' },
            { id: 'Finance', name: 'Finance' },
            { id: 'Manufacturing', name: 'Manufacturing' },
            { id: 'Retail', name: 'Retail' },
            { id: 'Education', name: 'Education' },
            { id: 'Government', name: 'Government' },
            { id: 'Other', name: 'Other' },
          ]}
          fullWidth
        />
        <SelectInput
          source="company_size"
          label="Company Size"
          choices={[
            { id: 'SMB', name: 'SMB (1–250 employees)' },
            { id: 'MidMarket', name: 'Mid-Market (251–2,500)' },
            { id: 'Enterprise', name: 'Enterprise (2,500+)' },
          ]}
          fullWidth
        />
        <TextInput source="website" label="Website" fullWidth />
        <SelectInput
          source="status"
          defaultValue="active"
          choices={[
            { id: 'active', name: 'Active' },
            { id: 'inactive', name: 'Inactive' },
          ]}
          fullWidth
        />
        <TextInput source="notes" label="Notes" multiline rows={3} fullWidth />
      </SimpleForm>
    </Create>
  )
}

// ---------------------------------------------------------------------------
// CustomerEdit
// ---------------------------------------------------------------------------

export function CustomerEdit() {
  return (
    <Edit>
      <SimpleForm>
        <TextInput source="name" label="Company Name" validate={required()} fullWidth />
        <TextInput
          source="contact_email"
          label="Contact Email"
          validate={[required(), email()]}
          type="email"
          fullWidth
        />
        <TextInput source="sales_rep" label="Sales Rep" fullWidth />
        <SelectInput
          source="industry"
          choices={[
            { id: 'Technology', name: 'Technology' },
            { id: 'Healthcare', name: 'Healthcare' },
            { id: 'Finance', name: 'Finance' },
            { id: 'Manufacturing', name: 'Manufacturing' },
            { id: 'Retail', name: 'Retail' },
            { id: 'Education', name: 'Education' },
            { id: 'Government', name: 'Government' },
            { id: 'Other', name: 'Other' },
          ]}
          fullWidth
        />
        <SelectInput
          source="company_size"
          label="Company Size"
          choices={[
            { id: 'SMB', name: 'SMB (1–250 employees)' },
            { id: 'MidMarket', name: 'Mid-Market (251–2,500)' },
            { id: 'Enterprise', name: 'Enterprise (2,500+)' },
          ]}
          fullWidth
        />
        <TextInput source="website" label="Website" fullWidth />
        <SelectInput
          source="status"
          choices={[
            { id: 'active', name: 'Active' },
            { id: 'inactive', name: 'Inactive' },
          ]}
          fullWidth
        />
        <TextInput source="notes" label="Notes" multiline rows={3} fullWidth />
      </SimpleForm>
    </Edit>
  )
}
