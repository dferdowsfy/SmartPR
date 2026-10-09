// SmartPR staging environment — subscription-level deployment.
// Creates rg-smartpr-staging and all staging resources inside it.
// Parameterised so the same template can later deploy into a customer's
// subscription (override resourceGroupName, location, tags as needed).
// Deploys NOTHING until you approve: run what-if first (see README.md).
targetScope = 'subscription'

@description('Azure region for all staging resources. eastus2 has the broadest Azure AI Foundry model availability.')
param location string = 'eastus2'

@description('Name of the staging resource group.')
param resourceGroupName string = 'rg-smartpr-staging'

@description('Environment tag value.')
param environment string = 'staging'

@description('Owner tag value.')
param owner string = 'smartpr'

@description('Your current public IPv4 address (without /32). Locks down Key Vault, Postgres firewall, and Storage.')
param allowedIp string

@description('Email address for budget alerts.')
param alertEmail string

@description('Monthly budget cap in USD.')
param monthlyBudget int = 200

@description('Postgres admin login name.')
param postgresAdminLogin string = 'smartpradmin'

@secure()
@description('Postgres admin password. Defaults to a generated value; it is stored in Key Vault and never printed.')
param postgresAdminPassword string = newGuid()

@description('Entra object ID for the Postgres Entra admin. Leave empty to skip Entra admin for now (password auth still works).')
param entraAdminObjectId string = ''

@description('Entra UPN (email) of the Postgres Entra admin.')
param entraAdminUpn string = ''

var tags = {
  env: environment
  owner: owner
}

// Globally-unique names (Key Vault and Storage must be unique across Azure).
var baseName = 'smartpr-${environment}'
var keyVaultName = take('kv-${baseName}-${uniqueString(subscription().id)}', 24)
var storageAccountName = take('st${replace(baseName, '-', '')}${uniqueString(subscription().id)}', 24)
var postgresServerName = 'pg-${baseName}'
var aiServicesName = 'ai-${baseName}'
var logAnalyticsName = 'log-${baseName}'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module logAnalytics 'modules/monitor.bicep' = {
  name: 'logAnalytics'
  scope: rg
  params: {
    name: logAnalyticsName
    location: location
    tags: tags
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  scope: rg
  params: {
    name: keyVaultName
    location: location
    tags: tags
    allowedIp: allowedIp
    postgresAdminPassword: postgresAdminPassword
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    name: postgresServerName
    location: location
    tags: tags
    adminLogin: postgresAdminLogin
    adminPassword: postgresAdminPassword
    allowedIp: allowedIp
    entraAdminObjectId: entraAdminObjectId
    entraAdminUpn: entraAdminUpn
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    name: storageAccountName
    location: location
    tags: tags
    allowedIp: allowedIp
  }
}

module aiServices 'modules/ai.bicep' = {
  name: 'aiServices'
  scope: rg
  params: {
    name: aiServicesName
    location: location
    tags: tags
  }
}

module diagnostics 'modules/diagnostics.bicep' = {
  name: 'diagnostics'
  scope: rg
  params: {
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    keyVaultName: keyVault.outputs.name
    postgresServerName: postgres.outputs.serverName
    storageAccountName: storage.outputs.accountName
    aiServicesName: aiServices.outputs.name
  }
}

// Monthly cost guardrail, scoped to the staging resource group only.
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-${baseName}'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '2026-10-01T00:00:00Z'
      endDate: '2027-10-01T00:00:00Z'
    }
    notifications: {
      Alert50: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
      }
      Alert90: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
      }
    }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [resourceGroupName]
      }
    }
  }
}

@description('Staging resource group name.')
output resourceGroupName string = rg.name

@description('Postgres server fully-qualified domain name.')
output postgresFqdn string = postgres.outputs.fqdn

@description('Key Vault URI (use this to reference secrets; the password itself is never output).')
output keyVaultUri string = keyVault.outputs.vaultUri

@description('Storage account name.')
output storageAccountName string = storage.outputs.accountName
