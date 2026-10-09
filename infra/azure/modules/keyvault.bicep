// Key Vault — holds the generated Postgres admin password and any future
// staging secrets. RBAC authorization, soft-delete + purge protection, and
// network locked to your IP only.
param name string
param location string
param tags object
param allowedIp string

@secure()
param postgresAdminPassword string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      ipRules: [
        {
          value: allowedIp
        }
      ]
    }
  }
}

// The generated Postgres admin password, stored at deploy time. Never printed.
resource pgAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}

output name string = vault.name
output vaultUri string = vault.properties.vaultUri
