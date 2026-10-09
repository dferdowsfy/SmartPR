// Staging parameters. Fill in allowedIp and alertEmail before what-if/deploy.
// Get your public IP with: curl -s https://api.ipify.org
using './main.bicep'

param location = 'eastus2'
param allowedIp = '<YOUR-PUBLIC-IP>' // e.g. '203.0.113.42' — no /32 suffix
param alertEmail = '<YOUR-SMARTPR-EMAIL>'
param monthlyBudget = 200

// Optional: set after `az login` if you want Entra DB admin now.
// Find your object ID with: az ad signed-in-user show --query id -o tsv
param entraAdminObjectId = ''
param entraAdminUpn = ''
