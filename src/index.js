/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const errors = require("./errors.js");
const api = require("./api.js");
const {
    MultiplexedBroker
} = require("xtralife-msg");
const notify = require('./lib/network/notify.js');


class Xtralife {
	constructor() {
		this._initialised = false;
	}

	configure(cb){
		if (this._initialised) { return cb(null); }
		this._initialised = true;
		xlenv.inject(["=redisClient", "redisClient"], (err, rc, pubSub)=> {
			if (err != null) { console.error(err); }
			if (err != null) { return cb(err); }
			
			this.api.notify = notify;

			const timeoutHandler =
			xlenv.options.notifyUserOnBrokerTimeout ? (prefix, user, message)=> {

				logger.info(`User (${user}) message timeout for domain ${prefix}`);
				if (message.osn == null) { return; }

				return this.api.connect.devicesToNotify(prefix, user, (err, devs, lang)=> {
					let app;
					if (err != null) { return logger.error(err.message, {stack: err.stack}); }
					if (devs == null) { return logger.info(`no device to notify for ${user}`); }
					let msg = message.osn[lang];
					if (msg == null) { msg = message.osn["en"]; }
					if (msg == null) { return logger.info(`no lang(${lang}, en) found in the message!`); }

					const alert = {
						message : msg,
						user :  message.from,
						name :  message.name,
						data :  message.osn.data
					};

					return Array.from(devs).map((d) =>
						(app = this.api.game.getAppsWithDomain(prefix, function(err, app){
							if (err != null) { return logger.error(err.message, {stack: err.stack}); }
							return notify.send(app, prefix, d.os, d.token, alert, function(err, count){
								if (err != null) { return logger.error(err.message, {stack: err.stack}); }
						});
					})));
			});
			}

			:
				logger.info("OS notification disabled!");

			return xlenv.broker = new MultiplexedBroker(rc, pubSub, timeoutHandler, 5000,5000);
		});

		this.api = api;
		return this.api.configure(null, err=> {
			if (err != null) { return cb(err); }
			return this.api.afterConfigure(null, cb);
		});
	}
}

module.exports = new Xtralife();

module.exports.errors = errors;
