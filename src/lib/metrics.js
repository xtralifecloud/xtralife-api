const os = require('os')
const client = require('prom-client');

client.register.setDefaultLabels( { hostname: os.hostname() })

module.exports = client;