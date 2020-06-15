/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// import service implementations
const { APNService, AndroidService } = require("./notifyServices.js");

// cache of appid->os->Sender
const _services = {};


// Creates a new Sender of the right kind, with the specified config
const _SenderFactory = function (os, config, appid) {
	switch (os) {
		case "macos": case "ios":
			try {
				return new APNService(config, appid);
			} catch (error) {
				logger.error(`Unable to init APNService(${JSON.stringify(config)})`);
				return null;
			}

		case "android":
			try {
				return new AndroidService(config, appid);
			} catch (error1) {
				logger.error(`Unable to init AndroidService(${JSON.stringify(config)})`);
				return null;
			}
		default:
			logger.error(`Unknown service OS (${os})`);
			return null;
	}
};

// Gets a sender for an appid/os combination
// Uses caching of Senders
// config is only used when not already in cache
var _getSender = function (appid, os, config) {
	if (_services[appid] != null) {
		if (_services[appid][os] != null) {
			return _services[appid][os];
		} else {
			return _services[appid][os] = _SenderFactory(os, config, appid);
		}
	} else {
		_services[appid] = {};
		return _getSender(appid, os, config);
	}
};

module.exports = {

	send(app, domain, os, tokens, alert, cb) {
		console.log(`notify ${domain} ${os} `);
		const sender = _getSender(app.appid, os, app.certs[os]);
		if (sender == null) { return cb(err); }
		return sender.send(domain, tokens, alert, cb);
	}
};
