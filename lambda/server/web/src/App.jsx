import { Admin, Resource } from 'react-admin'
import authProvider from './authProvider'
import dataProvider from './dataProvider'
import marginArcTheme from './theme'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import { LicenseList, LicenseCreate, LicenseEdit, LicenseShow } from './resources/licenses'
import { CustomerList, CustomerCreate, CustomerEdit } from './resources/customers'
import { AuditLogList } from './resources/auditLogs'
import { ActivationList } from './resources/activations'

export default function App() {
  return (
    <Admin
      authProvider={authProvider}
      dataProvider={dataProvider}
      theme={marginArcTheme}
      loginPage={LoginPage}
      dashboard={DashboardPage}
      title="MarginArc Admin"
      basename="/admin"
    >
      <Resource
        name="licenses"
        list={LicenseList}
        create={LicenseCreate}
        edit={LicenseEdit}
        show={LicenseShow}
        options={{ label: 'Licenses' }}
      />
      <Resource
        name="customers"
        list={CustomerList}
        create={CustomerCreate}
        edit={CustomerEdit}
        options={{ label: 'Customers' }}
      />
      <Resource
        name="activations"
        list={ActivationList}
        options={{ label: 'Activations' }}
      />
      <Resource
        name="audit-logs"
        list={AuditLogList}
        options={{ label: 'Audit Log' }}
      />
    </Admin>
  )
}
