/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require('extend');
const rs = require("randomstring");
const _ = require("underscore");

const {
	ObjectId
} = require("mongodb");

const facebook = require("./network/facebook.js");
const google = require("./network/google.js");
const gamecenter = require('gamecenter-identity-verifier');
const errors = require("./../errors.js");

const AbstractAPI = require("../AbstractAPI.js");

const Promise = require('bluebird');

class ConnectAPI extends AbstractAPI {
	constructor() {
		super();
	}

	// helpers
	collusers() {
		return this.coll("users");
	}

	configure(xtralifeapi, callback) {

		this.xtralifeapi = xtralifeapi;
		this.facebookValidTokenAsync = Promise.promisify(facebook.validToken, { context: facebook });
		this.googleValidTokenAsync = Promise.promisify(google.validToken, { context: google });

		return xlenv.inject(["=redisClient"], (err, rc) => {
			this.rc = rc;
			if (err != null) { return callback(err); }
			return async.parallel([
				// data related to user
				cb => {
					return this.collusers().createIndex({ network: 1, networkid: 1 }, { unique: true }, cb);
				},
				cb => {
					return this.collusers().createIndex({ 'profile.displayName': 1 }, { unique: false }, cb);
				},
				cb => {
					return this.collusers().createIndex({ 'profile.email': 1 }, { unique: false }, cb);
				}
			], err => {
				logger.info("Connect initialized");
				return callback(err);
			});
		});
	}

	onDeleteUser(userid, cb) {
		return this.collusers().deleteOne({ _id: userid }, function (err, result) {
			logger.warn(`removed ${userid} : ${result.modifiedCount} , ${err} `);
			return cb(err);
		});
	}

	exist(userid, cb) {
		let id;
		try {
			id = new ObjectId(userid);
		} catch (error) {
			return cb(new errors.BadGamerID);
		}

		return this.collusers().findOne({ _id: id })
			.then(user => cb(null, user)).catch(err => cb(err));
	}

	existAndLog(userid, appid, cb) {
		let id;
		try {
			id = new ObjectId(userid);
		} catch (error) {
			return cb(new errors.BadGamerID);
		}

		const logtime = new Date(Math.floor(Date.now() / 86400000) * 86400000);
		return this.collusers().findOne({ _id: id }, (err, user) => {
			if ((err != null) || (user === null)) { return cb(err); }

			const authg = _.find(user.games, g => g.appid === appid);

			if (__guard__(authg != null ? authg.lastlogin : undefined, x => x.getTime()) === logtime.getTime()) { return cb(err, user); }
			return this.collusers().updateOne({ _id: id, "games.appid": appid }, { '$set': { "games.$.lastlogin": logtime } }, (err, result) => {
				return cb(err, user);
			});
		});
	}


	existInNetwork(network, id, cb) {
		return this.collusers().findOne({ network, networkid: id }, function (err, user) {
			if (user == null) { return cb(new errors.BadGamerID); }
			return cb(err, user);
		});
	}


	createShortLoginCode(domain, id, ttl, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		ttl = ttl || (3600 * 2); // valid for 2 hours
		const token = rs.generate(8);
		const key = `shortlogincode:${token}`;
		const loginfo = {
			user_id: id,
			domain
		};
		return this.rc.set(key, JSON.stringify(loginfo), (err, done) => {
			if (err != null) { return cb(err); }
			return this.rc.expire(key, ttl, (err, done) => {
				if (err != null) { return cb(err); }
				return cb(null, token);
			});
		});
	}

	resolveShortLoginCode(game, token, cb) {
		const key = `shortlogincode:${token}`;

		return this.rc.get(key, (err, loginfo) => {
			if (err != null) { return cb(err); }
			try {
				loginfo = JSON.parse(loginfo);
			} catch (error) {
				return cb(new errors.BadToken);
			}

			if (loginfo == null) { return cb(new errors.BadToken); }

			const privatedomain = this.xtralifeapi.game.getPrivateDomain(game.appid);
			return this.xtralifeapi.game.checkDomain(game, loginfo.domain, (err, allowed) => {
				if (err != null) { return cb(err); }
				if (!allowed && (loginfo.domain !== privatedomain)) { return cb(new errors.RestrictedDomain); }
				return this.rc.del(key, (err, done) => { // token must be used only once !
					return cb(null, loginfo.user_id);
				});
			});
		});
	}

	sendPassword(game, email, from, title, body, html, cb) {
		return this.existInNetwork('email', email, (err, user) => {
			if (err != null) { return cb(err); }
			const privatedomain = this.xtralifeapi.game.getPrivateDomain(game.appid);
			const ttl = xlenv.options['sendPasswordTTL'] || (86400 * 2); // 2 days
			return this.createShortLoginCode(privatedomain, user._id, ttl, (err, token) => {
				if (err != null) { return cb(err); }

				const mail = {
					from,
					to: email,
					subject: title,
					text: body.replace(/\[\[SHORTCODE\]\]/gi, token)
				};

				if (html != null) {
					mail.html = html.replace(/\[\[SHORTCODE\]\]/gi, token);
				}

				return xlenv.mailer.sendMail(mail, (err, info) => {
					if (err != null) { return cb(err); }
					logger.debug(info);
					return cb(null, { done: 1 });
				});
			});
		});
	}

	changePassword(user_id, sha_pass, cb) {
		return this.collusers().updateOne({ _id: user_id }, { $set: { networksecret: sha_pass } }, (err, result) => {
			if (err == null) { logger.debug(`password changed for ${user_id}`); }
			return cb(err, result.modifiedCount);
		});
	}

	changeEmail(user_id, email, cb) {
		return this.collusers().findOne({ network: "email", networkid: email }, (err, user) => {
			if (err != null) { return cb(err); }
			if (user != null) { return cb(new errors.ConnectError("UserExists", `${email} already exists`)); }
			return this.collusers().updateOne({ _id: user_id }, { $set: { networkid: email } }, (err, result) => {
				if (err == null) { logger.debug(`email changed for ${user_id}`); }
				return cb(err, result.modifiedCount);
			});
		});
	}

	register(game, network, networkid, networksecret, profile, cb) {
		if (networkid == null) { networkid = new ObjectId().toString(); }
		const newuser = {
			network,
			networkid,
			networksecret,
			registerTime: new Date,
			registerBy: game.appid,
			games: [{
				appid: game.appid,
				ts: new Date,
				lastlogin: new Date(Math.floor(Date.now() / 86400000) * 86400000)
			}],
			profile
		};
		return this.collusers().insertOne(newuser, err => {
			if (err != null) {
				if (err.code === 11000) {
					const key = err.err.substring(err.err.indexOf('$') + 1, err.err.indexOf('_1'));
					return cb(new errors.ConnectError("UserExists", `${key} already exists`));
				} else {
					return cb(err);
				}
			}

			logger.debug(`user ${newuser._id} registered!`);

			return cb(null, newuser);
		});
	}


	addGameToUser(game, user, cb) {
		for (let g of Array.from(user.games)) {
			if (g.appid === game.appid) { return cb(null, 0); }
		}
		const newgame = {
			appid: game.appid,
			ts: new Date()
		};
		return this.collusers().updateOne({ _id: user._id }, { $addToSet: { games: newgame } }, (err, result) => {
			if (err == null) { logger.debug(`${game.appid} added to ${user.gamer_id}`); }

			return cb(err, result.modifiedCount);
		});
	}

	loginExternal(game, external, id, token, options, cb) {
		if (id == null) { return cb(new errors.BadArgument); }
		if (token == null) { return cb(new errors.BadArgument); }
		if (external == null) { return cb(new errors.BadArgument); }

		const _check_auth = (external, id, token, cb) => {
			return this.handleHook(`__auth_${external}_${game.appid.replace(/[^0-9a-z]/gi, '')}`, { game }, `${game.appid}.${game.apisecret}`, {
				user_id: id,
				user_token: token
			}).then(status => {
				return cb(null, status);
			}).catch(err => {
				return cb(err);
			});
		};

		return this.collusers().findOne({ network: external, networkid: id }, (err, user) => {
			if (err != null) { return cb(err); }
			return _check_auth(external, id, token, (err, status) => {
				console.log("status", status);
				if (err != null) { return cb(err); }
				if (status == null) { return cb(new errors.BadUserCredentials); }
				if (status.verified !== true) { return cb(new errors.BadUserCredentials); }
				if (user != null) { return cb(null, user, false); }

				if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(id), null, false); }
				// create account
				return this.register(game, external, id, token, { displayName: id, lang: "en" }, (err, user) => cb(err, user, true));
			});
		});
	}


	login(game, email, sha_pass, options, cb) {
		if (email == null) { return cb(new errors.BadArgument); }
		if (!/^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test(email)) { return cb(new errors.BadArgument); }

		return this.collusers().findOne({ network: "email", networkid: email }, (err, user) => {
			if (err != null) { return cb(err); }
			if (user != null) {
				if (user.networksecret === sha_pass) {
					return cb(null, user, false);
				} else {
					return cb(new errors.BadUserCredentials);
				}
			}

			if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(email), null, false); }

			// create account
			return this.register(game, "email", email, sha_pass, this._buildEmailProfile(email), (err, user) => cb(err, user, true));
		});
	}

	loginfb(game, facebookToken, options, cb) {
		return facebook.validToken(facebookToken, (err, me) => {
			if (err != null) { return cb(err); }
			return this.collusers().findOne({ network: "facebook", networkid: me.id }, (err, user) => {
				if (err != null) { return cb(err); }
				if (user != null) { return cb(null, user, false); }

				if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(me), null, false); }

				return this.register(game, "facebook", me.id, null, this._buildFacebookProfile(me), function (err, user) {
					if (me.noBusinessManager) {
						//logger.warn "Business Manager for #{game.appid} doesn't exit! "
						if ((user != null) && me.noBusinessManager) { user.noBusinessManager = me.noBusinessManager; }
					}
					return cb(err, user, true);
				});
			});
		});
	}

	logingp(game, googleToken, options, cb) {
		return google.validToken(googleToken, (err, me) => {
			if (err != null) { return cb(err); }
			return this.collusers().findOne({ network: "googleplus", networkid: me.id }, (err, user) => {
				if (err != null) { return cb(err); }
				if (user != null) { return cb(null, user, false); }
				if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(me), null, false); }

				// create account
				return this.register(game, "googleplus", me.id, null, this._buildGooglePlusProfile(me), (err, user) => {
					return cb(err, user, true);
				});
			});
		});
	}

	logingc(game, id, secret, options, cb) {
		// TODO replace new Error with proper Nasa Errors
		if (id !== secret.playerId) { return cb(new errors.GameCenterError("token is not for this player")); }
		if (!(game.config.socialSettings != null ? game.config.socialSettings.gameCenterBundleIdRE : undefined)) { return cb(new errors.GameCenterError("socialSettings.gameCenterBundleIdRE must be set for GameCenter login")); }
		if (!secret.bundleId.match(game.config.socialSettings.gameCenterBundleIdRE)) { return cb(new errors.GameCenterError("Invalid bundleId")); }
		// TODO check secret expiry against optional options.expireGCtoken seconds
		if ((xlenv.options.GameCenterTokenMaxage != null) && ((Date.now() - secret.timestamp) > (1000 * xlenv.options.GameCenterTokenMaxage))) {
			return cb(new errors.GameCenterError('Expired gamecenter token'));
		}

		return gamecenter.verify(secret, (err, token) => {
			if (err != null) { return cb(new errors.GameCenterError(err.message)); }

			return this.collusers().findOne({ network: "gamecenter", networkid: id }, (err, user) => {
				if (err != null) { return cb(err); }
				if (user != null) { return cb(null, user, false); }
				if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration((options != null ? options.gamecenter : undefined) || {}), null, false); }

				// create account
				return this.register(game, "gamecenter", id, null, this._buildGameCenterProfile(options), (err, user) => {
					return cb(err, user, true);
				});
			});
		});
	}

	convertAccountToEmail(user_id, email, sha_password) {
		if (!/^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test(email)) { return Promise.reject(new errors.BadArgument); }
		return this._checkAccountForConversion("email", user_id, email)
			.then(() => {
				const modification = {
					$set: {
						network: "email",
						networkid: email,
						networksecret: sha_password,
						profile: this._buildEmailProfile(email)
					}
				};
				return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
			})
			.then(function (result) {
				logger.debug(`converted to e-mail account for ${user_id}`);
				return (result != null ? result.value : undefined);
			});
	}

	convertAccountToFacebook(user_id, facebookToken) {
		return this.facebookValidTokenAsync(facebookToken)
			.then(me => {
				return this._checkAccountForConversion("facebook", user_id, me.id)
					.then(() => {
						const modification = {
							$set: {
								network: "facebook",
								networkid: me.id,
								networksecret: null,
								profile: this._buildFacebookProfile(me)
							}
						};
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to facebook account for ${me.id}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToGooglePlus(user_id, googleToken) {
		return this.googleValidTokenAsync(googleToken)
			.then(me => {
				return this._checkAccountForConversion("googleplus", user_id, me.id)
					.then(() => {
						const modification = {
							$set: {
								network: "googleplus",
								networkid: me.id,
								networksecret: null,
								profile: this._buildGooglePlusProfile(me)
							}
						};
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to google+ account for ${me.id}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToGameCenter(user_id, id, options) {
		return this._checkAccountForConversion("gamecenter", user_id, id)
			.then(() => {
				const modification = {
					$set: {
						network: "gamecenter",
						networkid: id,
						networksecret: null,
						profile: this._buildGameCenterProfile(options)
					}
				};
				return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
			})
			.then(function (result) {
				if (typeof err === 'undefined' || err === null) { logger.debug(`converted to game center account for ${user_id}`); }
				return (result != null ? result.value : undefined);
			});
	}

	linkAccountWithFacebook(user, token, cb) {
		return facebook.validToken(token, (err, me) => {
			if (err != null) { return cb(err); }
			return this.collusers().findOne({ _id: user._id }, (err, user) => {
				if (err != null) { return cb(err); }
				if (user == null) { return cb(new errors.ConnectError("Gamer not found!")); }
				if ((user.links != null ? user.links.facebook : undefined) != null) { return cb(new errors.ConnectError("Already linked to facebook")); }
				const updated = {};
				updated["links.facebook"] = me.id;
				if (user.profile.displayName == null) { updated["profile.displayName"] = me.name; }
				if ((xlenv.options.profileFields == null)) {
					if (user.profile.email == null) { updated["profile.email"] = me.email; }
					if (user.profile.firstName == null) { updated["profile.firstName"] = me.first_name; }
					if (user.profile.lastName == null) { updated["profile.lastName"] = me.last_name; }
					if (user.profile.avatar == null) { updated["profile.avatar"] = me.avatar; }
					if (user.profile.lang == null) { updated["profile.lang"] = me.locale.substr(0, 2); }
				}

				return this.collusers().updateOne({ _id: user._id }, { $set: updated }, (err, result) => {
					return cb(err, { done: result.modifiedCount });
				});
			});
		});
	}

	linkAccountWithGoogle(user, token, cb) {
		return google.validToken(token, (err, me) => {
			if (err != null) { return cb(err); }
			return this.collusers().findOne({ _id: user._id }, (err, user) => {
				if (err != null) { return cb(err); }
				if (user == null) { return cb(new errors.ConnectError("Gamer not found!")); }
				if ((user.links != null ? user.links.googleplus : undefined) != null) { return cb(new errors.ConnectError("Already linked to googleplus")); }
				const updated = {};
				updated["links.googleplus"] = me.id;
				if (user.profile.displayName == null) { updated["profile.displayName"] = me.displayName; }
				if ((xlenv.options.profileFields == null)) {
					if (user.profile.lang == null) { updated["profile.lang"] = me.language; }
					if ((me.image != null) && (user.profile.avatar == null)) { updated["profile.avatar"] = me.image.url; }
					if (((me.emails != null ? me.emails[0].value : undefined) != null) && (user.profile.email == null)) { updated["profile.email"] = me.emails[0].value; }
					if ((me.name != null) && (user.profile.firstName == null)) { updated["profile.firstName"] = me.name.givenName; }
					if ((me.name != null) && (user.profile.lastName == null)) { updated["profile.lastName"] = me.name.familyName; }
				}

				return this.collusers().updateOne({ _id: user._id }, { $set: updated }, (err, result) => {
					return cb(err, { done: result.modifiedCount });
				});
			});
		});
	}

	unlink(user, network, cb) {
		if ((user.links != null ? user.links[network] : undefined) == null) { return cb(new errors.ConnectError(`Not linked to ${network}`)); }
		const unset = {};
		unset[`links.${network}`] = "";
		return this.collusers().updateOne({ _id: user._id }, { $unset: unset }, (err, result) => {
			return cb(err, { done: result.modifiedCount });
		});
	}

	trackDevice(user_id, device) {
		if ((device != null ? device.id : undefined) == null) { return; }

		return this.collusers().findOne({ _id: user_id, "devices.id": device.id }, { projection: { _id: 1, devices: 1 } }, (err, user) => {
			if (err != null) { return logger.error(err.message, { stack: err.stack }); }
			if ((user != null) && (user.devices != null)) {
				let deviceExists;
				for (let each of Array.from(user.devices)) { if (each.id === device.id) { deviceExists = each; } }

				if (deviceExists != null) {
					if (((deviceExists != null ? deviceExists.version : undefined) || 0) >= device.version) { return; }

					logger.debug(`user ${user_id} update device ${JSON.stringify(device)}`);
					return this.collusers().updateOne({ _id: user_id, "devices.id": device.id }, { $set: { "devices.$": device } }, (err, result) => {
						if (err != null) { return logger.error(err.message, { stack: err.stack }); }
					});
				} else {
					logger.debug(`user ${user_id} adding device ${JSON.stringify(device)}`);
					return this.collusers().updateOne({ _id: user_id }, { $push: { "devices": device } }, (err, result) => {
						if (err != null) { return logger.error(err.message, { stack: err.stack }); }
					});
				}
			} else {
				logger.debug(`user ${user_id} owns ${JSON.stringify(device)}`);
				return this.collusers().updateOne({ _id: user_id }, { $addToSet: { devices: device } }, (err, result) => {
					if (err != null) { return logger.error(err.message, { stack: err.stack }); }
				});
			}
		});
	}

	registerToken(user, os, token, domain, cb) {
		const device = {
			os,
			token
		};
		//TODO: remove previous version with no domain TO BE REMOVED LATER
		return this.collusers().updateOne({ _id: user._id }, { $pull: { tokens: device } }, (err, result) => {
			if (err != null) { return cb(err); }
			device.domain = domain;
			// add current version with domain
			return this.collusers().updateOne({ _id: user._id }, { $addToSet: { tokens: device } }, (err, result) => {
				if (err != null) { return cb(err); }
				//logger.info "user: #{user._id}, token: #{token}, count : #{count}"
				return cb(null, result.modifiedCount);
			});
		});
	}

	unregisterToken(user, os, token, domain, cb) {
		const device = {
			os,
			token
		};
		//TODO: remove previous version with no domain TO BE REMOVED LATER
		return this.collusers().updateOne({ _id: user._id }, { $pull: { tokens: device } }, (err, result) => {
			if (err != null) { return cb(err); }
			device.domain = domain;
			// remove current version with domain
			return this.collusers().updateOne({ _id: user._id }, { $pull: { tokens: device } }, (err, result) => {
				if (err != null) { return cb(err); }
				return cb(null, result.modifiedCount);
			});
		});
	}

	devicesToNotify(domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.collusers().findOne({ _id: new ObjectId(user_id) }, { projection: { "profile.lang": 1, tokens: 1 } }, (err, user) => {
			if (err != null) { return cb(err); }
			if ((user != null ? user.tokens : undefined) == null) { return cb(null, null); }

			const tokens = _.filter(user.tokens, t => t.domain === domain);

			return cb(null, tokens, user.profile.lang != null ? user.profile.lang.substring(0, 2) : undefined);
		});
	}

	readProfileAsync(user_id, fields) {
		const query =
			{ _id: user_id };

		return this.collusers().findOne(query, { projection: fields })
			.then(value => {
				if (value != null) {
					delete value._id;
					delete value.networksecret;
					return value;
				} else {
					return {};
				}
			});
	}

	_buildEmailProfile(email) {
		let profile = {
			email,
			displayName: email.slice(0, email.indexOf("@")),
			lang: "en"
		};
		if (xlenv.options.profileFields != null) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_buildFacebookProfile(me) {
		let profile = {
			email: me.email,
			firstName: me.first_name,
			lastName: me.last_name,
			avatar: me.avatar,
			displayName: me.name,
			lang: ((me.locale != null) ? me.locale.substr(0, 2) : undefined)
		};
		if (xlenv.options.profileFields != null) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_buildGameCenterProfile(options) {
		let profile = {
			displayName: __guard__(options != null ? options.gamecenter : undefined, x => x.gcdisplayname) || "",
			firstName: __guard__(options != null ? options.gamecenter : undefined, x1 => x1.gcalias) || "",
			lang: "en"
		};
		if (xlenv.options.profileFields != null) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_buildGooglePlusProfile(me) {
		let profile = {
			displayName: me.displayName,
			lang: me.language
		};
		if (me.image != null) { profile.avatar = me.image.url; }
		if ((me.emails != null ? me.emails[0].value : undefined) != null) { profile.email = me.emails[0].value; }
		if (me.name != null) { profile.firstName = me.name.givenName; }
		if (me.name != null) { profile.lastName = me.name.familyName; }
		if (xlenv.options.profileFields != null) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_checkAccountForConversion(network, user_id, networkid) {
		return this.collusers().findOne({ _id: user_id })
			.then(user => {
				if (user == null) { throw new errors.ConnectError("Gamer not found!"); }
				// not only anonymous account can be converted....
				//return @rejected new errors.ConnectError("Anonymous account required") unless user.network is "anonymous"

				return this.collusers().findOne({ network, networkid })
					.then(user => {
						if (user != null) { throw new errors.ConnectError("UserExists", `${network}/${networkid} already exists`); }
					});
			});
	}
}

module.exports = new ConnectAPI();

function __guard__(value, transform) {
	return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}