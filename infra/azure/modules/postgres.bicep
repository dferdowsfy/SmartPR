// Azure Database for PostgreSQL Flexible Server — staging database.
// PostgreSQL 16, Burstable B1ms (cheapest tier that still runs real
// workloads), 7-day backups, TLS enforced, firewall locked to your IP.
// Entra authentication is enabled; password auth stays on for break-glass
// (the password lives only in Key Vault). No customer data goes here.
param name string
param location string
param tags object
param adminLogin string

@secure()
param adminPassword string
param allowedIp string
param entraAdminObjectId string
param entraAdminUpn string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// TLS 1.2 minimum.
resource tlsMin 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: server
  name: 'tls_version'
  properties: {
    value: 'TLSv1.2'
    source: 'user-override'
  }
}

// Encrypted connections required.
resource requireSecureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'on'
    source: 'user-override'
  }
}

// Firewall: your IP only. No Azure-services bypass, no open ranges.
resource firewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: server
  name: 'allow-owner-ip'
  properties: {
    startIpAddress: allowedIp
    endIpAddress: allowedIp
  }
}

// Optional Entra admin (set entraAdminObjectId after `az login`).
resource entraAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2023-12-01-preview' = if (!empty(entraAdminObjectId)) {
  parent: server
  name: entraAdminObjectId
  properties: {
    principalName: entraAdminUpn
    principalType: 'User'
    tenantId: subscription().tenantId
  }
}

output serverName string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
