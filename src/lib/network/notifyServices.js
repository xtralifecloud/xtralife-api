/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const apn = require("apn");
const _ = require("underscore");
const firebaseAdmin = require("firebase-admin");
const { getMessaging } = require("firebase-admin/messaging");

class APNService {
	constructor(config, appid) {
		if ((config.cert == null) || (config.cert === "")) { logger.error(`no cert for ${appid}`); return null; }
		if ((config.key == null) || (config.key === "")) { logger.error(`no keyfor ${appid}`); return null; }

		this.service = new apn.Connection(config);

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

		const note = new apn.Notification;

		note.badge = 1;
		note.sound = alert.sound ? alert.sound : "ping.aiff";
		note.alert = alert.message;

		note.payload = {
			user: alert.user,
			name: alert.name,
			data: alert.data
		};

		const err = this.service.pushNotification(note, tokens);

		if (err != null) { logger.error(`APN error ${domain} : ${JSON.stringify(err)}`); }
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

		const message = alert.message
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