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
const firebase = require("./network/firebase.js");
const steam = require("./network/steam.js");
const epic = require("./network/epic.js");
const apple = require("./network/apple.js");
const gamecenter = require('./network/gamecenter.js');
const errors = require("./../errors.js");
const firebaseAdmin = require("firebase-admin");
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
		this.firebaseValidTokenAsync = Promise.promisify(firebase.validToken, { context: firebase });
		this.steamValidTokenAsync = Promise.promisify(steam.validToken, { context: steam });
		this.epicValidTokenAsync = Promise.promisify(epic.validToken, { context: epic });
		this.appleValidTokenAsync = Promise.promisify(apple.validToken, { context: apple });
		this.gameCenterValidTokenAsync = Promise.promisify(gamecenter.verify, { context: gamecenter });

		this.firebaseApps = {};
		const games = xlenv.xtralife.games

		for (const gameId in games){
			const game = games[gameId]
			const firebaseConfig = game.config.firebase
			if(firebaseConfig && firebaseConfig.type){
				try {
					this.firebaseApps[gameId] = firebaseAdmin.initializeApp({credential: firebaseAdmin.credential.cert(firebaseConfig)}, gameId);
				} catch (err) {
					logger.error(`firebase config error for ${gameId}`);
					return callback(err);
				}
			}else{
				this.firebaseApps[gameId] = null
			}
		};

		return xlenv.inject(["=redisClient"], (err, rc) => {
			this.rc = rc;
			if (err != null) { return callback(err); }
			const iter = (xlenv.mongodb.aws_documentdb == true) ? Promise.mapSeries : Promise.all;
			return iter([
				this.collusers().createIndex({ network: 1, networkid: 1 }, { unique: true }),
				this.collusers().createIndex({ 'profile.displayName': 1 }, { unique: false }),
				this.collusers().createIndex({ 'profile.email': 1 }, { unique: false })
			])
				.then(() => {
					logger.info("Connect initialized");
					return callback();
				})
				.catch(err => {
					return callback(err);
				});

		});
	}

	onDeleteUser(userid, cb) {
		return this.collusers().deleteOne({ _id: userid })
			.then(result => {
				logger.warn(`removed ${userid} : ${result.modifiedCount}`);
				return cb();
			})
			.catch(err => {
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

		return this.collusers().findOne({ _id: id })
			.then((user) => {
				if (user === null) {
					return cb(err);
				}

				const authg = _.find(user.games, g => g.appid === appid);

				if (__guard__(authg != null ? authg.lastlogin : undefined, x => x.getTime()) === logtime.getTime()) {
					return user;
				}

				return this.collusers().updateOne({ _id: id, "games.appid": appid }, { '$set': { "games.$.lastlogin": logtime } })
					.then(() => {
						return user;
					});
			})
			.then((user) => {
				return cb(null, user);
			})
			.catch((err) => {
				return cb(err);
			});

	}


	existInNetwork(network, id, cb) {
		return this.collusers().findOne({ network, networkid: id })
			.then(user => {
				if (user == null) {
					return cb(new errors.BadGamerID);
				}
				return cb(null, user);
			})
			.catch(err => {
				return cb(err);
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
		return this.collusers().updateOne({ _id: user_id }, { $set: { networksecret: sha_pass } })
			.then(result => {
				logger.debug(`password changed for ${user_id}`);
				return cb(null, result.modifiedCount);
			})
			.catch(err => {
				return cb(err);
			});
	}

	changeEmail(user_id, email, cb) {
		return this.collusers().findOne({ network: "email", networkid: email })
			.then(user => {
				if (user != null) { return cb(new errors.ConnectError("UserExists", `${email} already exists`)); }
				return this.collusers().updateOne({ _id: user_id }, { $set: { networkid: email } })
			})
			.then((result) => {
				logger.debug(`email changed for ${user_id}`);
				return cb(null, result.modifiedCount);
			})
			.catch(err => {
				return cb(err);
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

		return this.collusers().insertOne(newuser)
			.then(() => {
				logger.debug(`user ${newuser._id} registered!`);
				return cb(null, newuser);
			})
			.catch(err => {
				if (err.code === 11000) {
					const key = err.keyValue[''];
					return cb(new errors.ConnectError(`UserAlreadyExists: duplicate key '${key}'`));
				} else {
					return cb(err);
				}
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

		return this.collusers().updateOne({ _id: user._id }, { $addToSet: { games: newgame } })
			.then(result => {
				logger.debug(`${game.appid} added to ${user.gamer_id}`);
				return cb(null, result.modifiedCount)
			})
			.catch(err => {
				return cb(err);
			});
	}

	loginExternal(game, external, credentials, options, cb) {
		if (!external) { return cb(new errors.BadArgument); }
		if (!credentials) { return cb(new errors.BadArgument); }

		const _check_auth = (external, credentials, cb) => {
			return this.handleHook(`__auth_${external}_${game.appid.replace(/[^0-9a-z]/gi, '')}`, { game }, `${game.appid}.${game.apisecret}`, credentials).then(status => {
				return cb(null, status);
			}).catch(err => {
				return cb(err);
			});
		};

		return _check_auth(external, credentials, (err, status) => {
			if (err != null) { return cb(err); }
			if (!status) { return cb(new errors.BadUserCredentials); }
			if (status.verified !== true) { return cb(new errors.BadUserCredentials); }
			if (!status.id) { return cb(new errors.BadUserCredentials); }

			return this.collusers().findOne({ network: external, networkid: status.id })
				.then(user => {
					if (user != null) {
						return cb(null, user, false);
					}

					if (options != null ? options.preventRegistration : undefined) {
						return cb(new errors.PreventRegistration(status.id), null, false);
					}

					// create account
					return this.register(game, external, status.id, null, { displayName: status.id, lang: "en" },
							(err, user) => { return cb(err, user, true); })
				})
				.catch(err => {
					return cb(err);
				});
		});
	}

	login(game, email, sha_pass, options, cb) {
		if (email == null) { return cb(new errors.BadArgument); }
		if (!/^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test(email)) { return cb(new errors.BadArgument); }


		return this.collusers().findOne({ network: "email", networkid: email })
			.then(user => {
				if (user != null) {
					if (user.networksecret === sha_pass) {
						return cb(null, user, false);
					} else {
						return cb(new errors.BadUserCredentials);
					}
				}

				if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(email), null, false); }

				// create account
				return this.register(game, "email", email, sha_pass, this._buildEmailProfile(email),
						(err, user) => { return cb(err, user, true); })
			})
			.catch(err => {
				return cb(err);
			});
	}

	loginFacebook(game, facebookToken, options, cb) {
		return facebook.validToken(
			facebookToken,
			game.config.facebook != null ? game.config.facebook.useBusinessManager: null, 
			(err, me) => {
				if (err != null) { return cb(err); }


				return this.collusers().findOne({ network: "facebook", networkid: me.id })
					.then(() => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration(me), null, false); }
						return this.register(game, "facebook", me.id, null, this._buildFacebookProfile(me),
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => {
						return cb(err);
					});
			});
	}

	loginGoogle(game, googleToken, options, cb) {
		let clientID = null;
		if(game.config.google && game.config.google.clientID) clientID = game.config.google.clientID
		if(clientID === null) return cb(new errors.MissingGoogleClientID("Missing google client ID in config file"))

		return google.validToken(
			googleToken,
			clientID,
			(err, me) => {
				if (err != null) { return cb(err); }

				return this.collusers().findOne({ network: "google", networkid: me.sub })
					.then(user => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) {
							return cb(new errors.PreventRegistration(me), null, false);
						}

						return this.register(game, "google", me.sub, null, this._buildGoogleProfile(me),
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => cb(err));
			});
	}

	loginFirebase(game, firebaseToken, options, cb) {
		if(this.firebaseApps[game.appid] == null) return cb(new errors.MissingFirebaseCredentials("Missing firebase credentials in config file"))

		return firebase.validToken(
			firebaseToken,
			this.firebaseApps[game.appid],
			(err, me) => {
				if (err != null) { return cb(err); }

				return this.collusers().findOne({ network: "firebase", networkid: me.uid })
					.then(user => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) {
							return cb(new errors.PreventRegistration(me), null, false);
						}

						return this.register(game, "firebase", me.uid, null, this._buildFirebaseProfile(me),
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => cb(err));
			});
	}

	loginApple(game, appleToken, options, cb) {
		let bundleID = null;
		if(game.config.apple && game.config.apple.bundleID) bundleID = game.config.apple.bundleID
		if(!bundleID) return cb(new errors.MissingAppleClientID("Missing apple client ID in config file"))

		return apple.validToken(
			appleToken,
			bundleID,
			(err, me) => {
				if (err != null) { return cb(err); }

				return this.collusers().findOne({ network: "apple", networkid: me.sub })
					.then(user => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) {
							return cb(new errors.PreventRegistration(me), null, false);
						}

						return this.register(game, "apple", me.sub, null, this._buildAppleProfile(me),
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => cb(err));
			});
	}

	loginSteam(game, steamToken, options, cb) {
		let webApiKey, appId = null;

		if(game.config.steam && game.config.steam.webApiKey) webApiKey = game.config.steam.webApiKey
		if(game.config.steam && game.config.steam.appId) appId = game.config.steam.appId
		if(!webApiKey || !appId) return cb(new errors.MissingSteamCredentials("Missing steam credentials in config file"))
	
		return steam.validToken(
			steamToken,
			webApiKey,
			appId,
			(err, me) => {
				if (err != null) { return cb(err); }

				return this.collusers().findOne({ network: "steam", networkid: me.steamid })
					.then(user => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) {
							return cb(new errors.PreventRegistration(me), null, false);
						}

						return this.register(game, "steam", me.steamid, null, { lang: "en" },
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => cb(err));
			});
	}

	loginEpic(game, epicToken, options, cb) {

		return epic.validToken(
			epicToken,
			(err, me) => {
				if (err != null) { return cb(err); }

				return this.collusers().findOne({ network: "epic", networkid: me.account_id })
					.then(user => {
						if (user != null) { return cb(null, user, false); }
						if (options != null ? options.preventRegistration : undefined) {
							return cb(new errors.PreventRegistration(me), null, false);
						}

						return this.register(game, "epic", me.account_id, null, { lang: "en" },
								(err, user) => { return cb(err, user, true); })
					})
					.catch(err => cb(err));
			});
	}

	loginGameCenter(game, credentials, options, cb) {

		if (!game.config.apple || !game.config.apple.gameCenterBundleIdRE) { return cb(new errors.GameCenterError("apple.gameCenterBundleIdRE must be set for GameCenter login")); }
		if (!credentials.bundleId.match(game.config.apple.gameCenterBundleIdRE)) { return cb(new errors.GameCenterError("Invalid bundleId")); }
		if ((xlenv.options.gameCenterTokenMaxAge) && ((Date.now() - credentials.timestamp) > (1000 * xlenv.options.gameCenterTokenMaxAge))) {
			return cb(new errors.GameCenterError('Expired gamecenter token'));
		}

		return gamecenter.verify(credentials, (err, me) => {
			if (err != null) { return cb(new errors.GameCenterError(err.message)); }

			return this.collusers().findOne({ network: "gamecenter", networkid: me.id })
				.then(user => {
					if (user != null) { return cb(null, user, false); }
					if (options != null ? options.preventRegistration : undefined) { return cb(new errors.PreventRegistration((options != null ? options.gamecenter : undefined) || {}), null, false); }

					return this.register(game, "gamecenter", me.id, null, { lang: "en" },
							(err, user) => { return cb(err, user, true); })
				})
				.catch(err => cb(err));
		});
	}

	convertAccountToEmail(user_id, email, sha_password, options) {
		if (!/^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test(email)) { return Promise.reject(new errors.BadArgument); }
		return this._checkAccountForConversion("email", user_id, email)
			.then(() => {
				const modification = {
					$set: {
						network: "email",
						networkid: email,
						networksecret: sha_password,
					}
				};

				options && options.updateProfile === false ? null : modification.$set.profile = this._buildEmailProfile(email)
				return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
			})
			.then(function (result) {
				logger.debug(`converted to e-mail account for ${user_id}`);
				return (result != null ? result.value : undefined);
			});
	}

	convertAccountToFacebook(game, user_id, facebookToken, options) {
		return this.facebookValidTokenAsync(
			facebookToken,
			game.config.facebook != null ? game.config.facebook.useBusinessManager: null)
			.then(me => {
				return this._checkAccountForConversion("facebook", user_id, me.id)
					.then(() => {
						const modification = {
							$set: {
								network: "facebook",
								networkid: me.id,
								networksecret: null,
							}
						};
						
						options && options.updateProfile === false ? null : modification.$set.profile = this._buildFacebookProfile(me)
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to facebook account for ${me.id}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToGoogle(game, user_id, googleToken, options) {
		let clientID = null;
		if(game.config.google && game.config.google.clientID) clientID = game.config.google.clientID
		if(clientID === null) throw new errors.MissingGoogleClientID("Missing google client ID in config file")

		return this.googleValidTokenAsync(googleToken, clientID)
			.then(me => {
				return this._checkAccountForConversion("google", user_id, me.sub)
					.then(() => {
						const modification = {
							$set: {
								network: "google",
								networkid: me.sub,
								networksecret: null,
							}
						};

						options && options.updateProfile === false ? null : modification.$set.profile = this._buildGoogleProfile(me)
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to google account for ${me.sub}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToFirebase(game, user_id, firebaseToken, options) {
		if(this.firebaseApps[game.appid] == null) throw new errors.MissingFirebaseCredentials("Missing firebase credentials in config file")

		return this.firebaseValidTokenAsync(firebaseToken, this.firebaseApps[game.appid])
			.then(me => {
				return this._checkAccountForConversion("firebase", user_id, me.uid)
					.then(() => {
						const modification = {
							$set: {
								network: "firebase",
								networkid: me.uid,
								networksecret: null,
							}
						};

						options && options.updateProfile === false ? null : modification.$set.profile = this._buildFirebaseProfile(me)
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to firebase account for ${me.uid}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToSteam(game, user_id, SteamToken) {
		let webApiKey, appId = null;

		if(game.config.steam && game.config.steam.webApiKey) webApiKey = game.config.steam.webApiKey
		if(game.config.steam && game.config.steam.appId) appId = game.config.steam.appId
		if(!webApiKey || !appId) throw new errors.MissingSteamCredentials("Missing steam credentials in config file")

		return this.steamValidTokenAsync(SteamToken, webApiKey, appId)
			.then(me => {
				return this._checkAccountForConversion("steam", user_id, me.steamid)
					.then(() => {
						const modification = {
							$set: {
								network: "steam",
								networkid: me.steamid,
								networksecret: null,
							}
						};
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to steam account for ${me.steamid}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToEpic(game, user_id, EpicToken) {

		return this.epicValidTokenAsync(EpicToken)
			.then(me => {
				return this._checkAccountForConversion("epic", user_id, me.account_id)
					.then(() => {
						const modification = {
							$set: {
								network: "epic",
								networkid: me.account_id,
								networksecret: null,
							}
						};
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to epic account for ${me.account_id}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}

	convertAccountToApple(game, user_id, appleToken, options) {
		let bundleID = null;
		if(game.config.apple && game.config.apple.bundleID) bundleID = game.config.apple.bundleID
		if(!bundleID) throw new errors.MissingAppleClientID("Missing apple client ID in config file")

		return this.appleValidTokenAsync(appleToken, bundleID)
			.then(me => {
				return this._checkAccountForConversion("apple", user_id, me.sub)
					.then(() => {
						const modification = {
							$set: {
								network: "apple",
								networkid: me.sub,
								networksecret: null,
							}
						};
						options && options.updateProfile === false? null : (modification.$set.profile = this._buildAppleProfile(me));
						return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
					})
					.then(function (result) {
						if (typeof err === 'undefined' || err === null) { logger.debug(`converted to apple account for ${me.sub}`); }
						return (result != null ? result.value : undefined);
					});
			});
	}
	
	convertAccountToGameCenter(game, user_id, credentials) {

		if (!game.config.apple || !game.config.apple.gameCenterBundleIdRE) { throw new errors.GameCenterError("apple.gameCenterBundleIdRE must be set for GameCenter login"); }
		if (!credentials.bundleId.match(game.config.apple.gameCenterBundleIdRE)) { throw new errors.GameCenterError("Invalid bundleId"); }
		if ((xlenv.options.gameCenterTokenMaxAge) && ((Date.now() - credentials.timestamp) > (1000 * xlenv.options.gameCenterTokenMaxAge))) {
			throw new errors.GameCenterError('Expired gamecenter token');
		}

		return this.gameCenterValidTokenAsync(credentials)
		.then(me => {
			return this._checkAccountForConversion("gamecenter", user_id, me.id)
			.then(() => {
				const modification = {
					$set: {
						network: "gamecenter",
						networkid: me.id,
						networksecret: null,
					}
				};
				return this.collusers().findOneAndUpdate({ _id: user_id }, modification, { returnDocument: "after" });
			})
			.then(function (result) {
				if (typeof err === 'undefined' || err === null) { logger.debug(`converted to game center account for ${user_id}`); }
				return (result != null ? result.value : undefined);
			});
		});
	} 

	linkAccountWithFacebook(user, token, cb) {
		return facebook.validToken(token, (err, me) => {
			if (err != null) { return cb(err); }

			return this.collusers().findOne({ _id: user._id })
				.then(user => {
					if (user == null) {
						return cb(new errors.ConnectError("Gamer not found!"));
					}
					if ((user.links != null ? user.links.facebook : undefined) != null) {
						return cb(new errors.ConnectError("Already linked to facebook"));
					}
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

					return this.collusers().updateOne({ _id: user._id }, { $set: updated })
						.then(result => {
							return cb(null, { done: result.modifiedCount });
						});
				})
				.catch(err => {
					return cb(err);
				});
		});
	}

	linkAccountWithGoogle(user, token, cb) {
		return google.validToken(token, (err, me) => {
			if (err != null) { return cb(err); }
			return this.collusers().findOne({ _id: user._id })
				.then(user => {
					if (user == null) {
						return cb(new errors.ConnectError("Gamer not found!"));
					}
					if ((user.links != null ? user.links.googleplus : undefined) != null) {
						return cb(new errors.ConnectError("Already linked to googleplus"));
					}

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

					return this.collusers().updateOne({ _id: user._id }, { $set: updated })
						.then(result => {
							return cb(null, { done: result.modifiedCount });
						});
				})
				.catch(err => {
					return cb(err);
				});
		});
	}

	unlink(user, network, cb) {
		if ((user.links != null ? user.links[network] : undefined) == null) { return cb(new errors.ConnectError(`Not linked to ${network}`)); }
		const unset = {};
		unset[`links.${network}`] = "";
		return this.collusers().updateOne({ _id: user._id }, { $unset: unset })
			.then(result => {
				return cb(null, { done: result.modifiedCount });
			})
			.catch(err => {
				return cb(err);
			});
	}

	trackDevice(user_id, device) {
		if ((device != null ? device.id : undefined) == null) { return; }

		return this.collusers().findOne({ _id: user_id, "devices.id": device.id }, { projection: { _id: 1, devices: 1 } })
			.then((user) => {
				if ((user != null) && (user.devices != null)) {
					let deviceExists;
					for (let each of Array.from(user.devices)) { if (each.id === device.id) { deviceExists = each; } }

					if (deviceExists != null) {
						if (((deviceExists != null ? deviceExists.version : undefined) || 0) >= device.version) { return; }

						logger.debug(`user ${user_id} update device ${JSON.stringify(device)}`);
						return this.collusers().updateOne({ _id: user_id, "devices.id": device.id }, { $set: { "devices.$": device } });
					} else {
						logger.debug(`user ${user_id} adding device ${JSON.stringify(device)}`);
						return this.collusers().updateOne({ _id: user_id }, { $push: { "devices": device } });
					}
				} else {
					logger.debug(`user ${user_id} owns ${JSON.stringify(device)}`);
					return this.collusers().updateOne({ _id: user_id }, { $addToSet: { devices: device } });
				}
			})
			.catch((err) => {
				logger.error(err.message, { stack: err.stack });
			});


	}

	registerToken(user, os, token, domain, cb) {
		const device = {
			os,
			token,
			domain,
			creationTime: new Date(),
		};
		return this.collusers().findOne({ _id: user._id })
			.then(user => {
				if (user.tokens?.some(e => e.token === token)) {
					return cb(null, 0);
				}
				return this.collusers().updateOne({ _id: user._id }, { $addToSet: { tokens: device } })
					.then(result => {
						//logger.info "user: #{user._id}, token: #{token}, count : #{count}"
						return cb(null, result.modifiedCount);
					})
					.catch(err => {
						return cb(err);
					});
			})
			.catch(err => {
				return cb(err);
			});
	}

	unregisterToken(user, os, token, domain, cb) {
		const device = {
			os,
			token,
			domain,
		};
		return this.collusers().updateOne({ _id: user._id }, { $pull: { tokens: device } })
			.then(result => {
				return cb(null, result.modifiedCount);
			})
			.catch(err => cb(err));
	}

	devicesToNotify(domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.collusers().findOne({ _id: new ObjectId(user_id) }, { projection: { "profile.lang": 1, tokens: 1 } })
			.then(user => {
				if ((user != null ? user.tokens : undefined) == null) { return cb(null, null); }
				const tokens = _.filter(user.tokens, t => t.domain === domain);
				return cb(null, tokens, user.profile.lang != null ? user.profile.lang.substring(0, 2) : undefined);
			})
			.catch(err => cb(err));
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
			lang: "en"
		};
		if(me.name) profile.email = me.email;
		if(me.first_name) profile.firstName = me.first_name;
		if(me.last_name) profile.lastName = me.last_name;
		if(me.avatar) profile.avatar = me.avatar;
		if(me.locale) profile.lang = me.locale.substring(0, 2);
		if(me.name) profile.displayName = me.name;
		else if(me.first_name) profile.displayName = me.first_name;
		
		if (xlenv.options.profileFields) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_buildAppleProfile(me) {
		let profile = {
			lang : "en"
		}
		if(me.email) profile.email = me.email
		return profile
	}

	_buildGoogleProfile(me) {
		let profile = {
			lang: "en"
		};
		if(me.name) profile.displayName = me.name;
		if(me.locale) profile.lang = me.locale; 
		if (me.picture) { profile.avatar = me.picture; }
		if (me.email) { profile.email = me.email; }
		if (me.given_name) { profile.firstName = me.given_name; }
		if (me.family_name) { profile.lastName = me.family_name; }
		if (xlenv.options.profileFields) {
			profile = _.pick(profile, xlenv.options.profileFields);
		}
		return profile;
	}

	_buildFirebaseProfile(me) {
		let profile = {
			lang: "en"
		};

		if(me.name != null) { profile.displayName = me.name; }
		if (me.picture != null) { profile.avatar = me.picture; }
		if (me.email != null) { profile.email = me.email; }

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