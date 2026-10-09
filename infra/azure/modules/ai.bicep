// Azure AI Services (AI Foundry) — placeholder for the future Azure-hosted
// model provider (audit PR #5). Created with NO model deployments, so it
// costs nothing while idle. Deployments get added later per-deployment.
param name string
param location string
param tags object

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

output name string = aiServices.name
output endpoint string = aiServices.properties.endpoint
