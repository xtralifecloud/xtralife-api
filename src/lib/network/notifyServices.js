/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const apn = require("apn");
const _ = require("underscore");
const { getMessaging } = require("firebase-admin/messaging");

class APNService {
	constructor(config, appid) {
		if (!config.apn) { logger.error(`no apn config for ${appid}`); return null; }
		if (!config.apn.token) { logger.error(`no apn.token for ${appid}`); return null; }
		if (!config.apn.token.key) { logger.error(`no apn.token.key for ${appid}`); return null; }
		if (!config.apn.token.keyId) { logger.error(`no apn.token.keyId for ${appid}`); return null; }
		if (!config.apn.token.teamId) { logger.error(`no apn.token.teamId for ${appid}`); return null; }
		if (!config.bundleID) { logger.error(`no apple.bundleID for ${appid}`); return null; }

		this.topic = config.bundleID;

		this.service = new apn.Provider(config.apn);

		this.service.on('connected', () => logger.info(`Connected (${appid})`));

		this.service.on('transmitted', (notification, device) => logger.info(`Notification transmitted to: ${device.token.toString('hex')}`));

		this.service.on('transmissionError', (errCode, notification, device) => logger.warn(`Notification caused error: ${errCode} for device ${device} ${errCode === 8 ? "device token is invalid" : undefined}`));

		this.service.on('timeout', () => logger.info(`Connection Timeout for ${appid}`));

		this.service.on('disconnected', () => logger.info(`Disconnected from APNS for ${appid}`));

		this.service.on('socketError', err => logger.error(`APN socket error ${appid} : ${JSON.stringify(err)}`));

		this.service.on('error', err => logger.error(`APN error ${appid} : ${JSON.stringify(err)}`));
	}


	send(domain, tokens, alert, cb) {
		if (this.service == null) { return cb(null); }
		if (!_.isArray(tokens)) { tokens = [tokens]; }

		const note = new apn.Notification();

		note.badge = 1;
		note.sound = alert.sound ? alert.sound : "ping.aiff";
		note.alert = alert.message;

		note.payload = {
			user: alert.user,
			name: alert.name,
			data: alert.data
		};

		note.topic = alert.topic ? alert.topic : this.topic;

		this.service.send(note, tokens).then( (result) => {
			result.sent.forEach( sent => {
				logger.debug(`message sent to device: ${sent.device}`)
			});

			result.failed.forEach(fail => {
				if(fail.response) {
					logger.debug(`APS error ${domain} : ${JSON.stringify(fail.response)}`)
				}
			})
		}).catch((err) => {
			logger.error(`APS error ${domain} : ${JSON.stringify(err)}`);
			cb(err);
		});

		return process.nextTick(() => cb(null));
	}
}

class AndroidService {
	constructor(firebaseAdmin) {
		this.service = firebaseAdmin
	}

	send(domain, tokens, alert, cb) {
		if (this.service == null) { return cb(null); }
		if (!_.isArray(tokens)) { tokens = [tokens]; }

		const message = {}
		message.notification = alert.message;
		message.data = alert.data;
		message.tokens = tokens;

		getMessaging(this.service).sendMulticast(message)
			.then((result) => {
				if(result.successCount === tokens.length) {
					logger.debug(`message sent to ${tokens}`)
				} else {
					result.responses.forEach(response => {
						if(response.error) {
							logger.debug(`FCM error ${domain} : ${JSON.stringify(response.error)}`)
						}
					})
				}
			}).catch((err) => {
				logger.error(`FCM error ${domain} : ${JSON.stringify(err)}`);
				cb(err);
			});
	}
}

module.exports = { APNService, AndroidService };