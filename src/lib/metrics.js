const os = require('os')
const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
const prefix = 'xl_backend_';
collectDefaultMetrics({ prefix });

client.register.setDefaultLabels( { hostname: os.hostname() })

module.exports = client;