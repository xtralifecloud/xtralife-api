/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

const api = require("../../api.js");
// import service implementations
const { APNService, AndroidService } = require("./notifyServices.js");

// cache of appid->os->Sender
const _services = {};


// Creates a new Sender of the right kind, with the specified config
const _SenderFactory = function (os, configApple, appid) {
	switch (os) {
		case "macos": case "ios":
			try {
				return new APNService(configApple, appid);
			} catch (error) {
				logger.error("error", error);
				logger.error(`Unable to init APNService(${JSON.stringify(configApple)})`);
				return null;
			}

		case "android":
			if(api.connect.firebaseApps[appid]) {
				return new AndroidService(api.connect.firebaseApps[appid])
			}else{
				logger.error(`Missing firebase credentials for appid ${appid}`);
				return null
			}
		default:
			logger.error(`Unknown service OS (${os})`);
			return null;
	}
};

// Gets a sender for an appid/os combination
// Uses caching of Senders
// config is only used when not already in cache
const _getSender = function (appid, os, config) {
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
		const sender = _getSender(app.appid, os, app.config.apple);
		if (sender == null) { return cb("err"); }
		return sender.send(domain, tokens, alert, cb);
	}
};
