//@ts-check
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// @ts-ignore
const async = require("async");
// @ts-ignore
const extend = require('extend');
// @ts-ignore
const rs = require("randomstring");

// @ts-ignore
const {
	ObjectID
} = require("mongodb");

// @ts-ignore
const facebook = require("./network/facebook.js");
// @ts-ignore
const google = require("./network/google.js");
const errors = require("../errors.js");
// @ts-ignore
const _ = require("underscore");

const AbstractAPI = require("../AbstractAPI.js");

const Promise = require('bluebird');
const crypto = require('crypto');

const jwt = require('jsonwebtoken');

class UserAPI extends AbstractAPI {
	constructor() {
		super();
		this.nuke = this.nuke.bind(this);
	}

	// helpers
	collusers() {
		return this.coll("users");
	}

	colldomains() {
		return this.coll("domains");
	}

	configure(xtralifeapi, callback) {
		this.xtralifeapi = xtralifeapi;
		this.domains = this.coll('domains');

		logger.info("User initialized");
		return callback(null);
	}

	afterConfigure(_xtralifeapi, cb) {
		return cb();
	}

	onDeleteUser(userid, cb) {
		logger.debug(`delete user ${userid} for user`);
		return cb(null);
	}

	setProfile(user, values, cb) {
		const updated = {};
		let needUpdate = false;
		for (let key in values) {
			if (["email", "displayName", "lang", "firstName", "lastName", "addr1", "addr2", "addr3", "avatar"].indexOf(key) !== -1) {
				updated[`profile.${key}`] = values[key];
				user.profile[key] = values[key];
				needUpdate = true;
			}
		}

		if (needUpdate) {
			return this.collusers().updateOne({ _id: user._id }, { $set: updated }, (err, result) => {
				return cb(err, { done: result.result.n, profile: user.profile });
			});
		} else {
			return cb(null, { done: 0 });
		}
	}

	updateProfile(user_id, profile, cb) {
		return this.collusers().updateOne({ _id: user_id }, { $set: { profile } }, (err, result) => {
			return cb(err, { done: result.result.n, profile });
		});
	}

	getProfile(user, cb) {
		return cb(null, user.profile);
	}

	updateProfileAsync(user_id, profile) {
		const updated = {};
		for (let key in profile) {
			if (["email", "displayName", "lang", "firstName", "lastName", "addr1", "addr2", "addr3", "avatar"].indexOf(key) !== -1) {
				updated[`profile.${key}`] = profile[key];
			}
		}

		return this.collusers().updateOne({ _id: user_id }, { $set: updated })
			.then(res => {
				return res.result;
			});
	}

	_checktype(value) {
		switch (typeof value) {
			case "number": case "string": case "boolean":
				return null;
				// @ts-ignore
				break;
			case "object":
				if (!Array.isArray(value)) { return new errors.BadPropertyType('Bad type'); }
				for (let elem of Array.from(value)) {
					if (!["number", "string", "boolean"].includes(typeof (elem))) { return new errors.BadPropertyType('Bad type'); }
				}
				break;
		}
		return null;
	}

	read(context, domain, user_id, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));
		//"key may be a unempty string": check.maybe.nonEmptyString(key)

		return this.handleHook("before-properties-read", context, domain, {
			domain,
			user_id,
			key
			// @ts-ignore
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const field = {};
			field[(key == null) ? 'properties' : `properties.${key}`] = 1;

			return this.domains.findOne(query, { projection: field })
				.then(value => {
					return this.handleHook("after-properties-read", context, domain, {
						domain,
						user_id,
						key,
						value
						// @ts-ignore
					}).then(function (afterData) {
						if ((value != null) && (value.properties != null)) { return value.properties; } else { return {}; }
					});
				});
		});
	}

	write(context, domain, user_id, key, value) {
		let err;
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));
		//"key may be a unempty string": check.maybe.nonEmptyString(key)

		if (key != null) {
			if (value == null) { return (() => { throw (new errors.MissingPropertyValue("Missing value")); })(); }
			err = this._checktype(value);
			if (err != null) { return (() => { throw err; })(); }
		} else {
			for (let k in value) {
				const v = value[k];
				err = this._checktype(v);
				if (err != null) { return (() => { throw err; })(); }
			}
		}

		return this.handleHook("before-properties-write", context, domain, {
			domain,
			user_id,
			key,
			value
			// @ts-ignore
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const set = {};
			set[(key == null) ? 'properties' : `properties.${key}`] = value;

			return this.domains.updateOne(query, { $set: set }, { upsert: true });
		})

			.then(result => {
				return this.handleHook("after-properties-write", context, domain, {
					domain,
					user_id,
					key,
					value
					// @ts-ignore
				}).then(afterData => result.result.n);
			});
	}

	delete(context, domain, user_id, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"key may be a unempty string": check.maybe.nonEmptyString(key)
		}));

		return this.handleHook("before-properties-delete", context, domain, {
			domain,
			user_id,
			key
			// @ts-ignore
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const unset = {};
			unset[(key == null) ? 'properties' : `properties.${key}`] = "";

			return this.domains.updateOne(query, { $unset: unset }, { upsert: true })
				.then(result => {
					return this.handleHook("after-properties-delete", context, domain, {
						domain,
						user_id,
						key
						// @ts-ignore
					}).then(afterData => result.result.n);
				});
		});
	}

	nuke(context, gamer_id) {
		const {
			appid
		} = context.game;
		return this.collusers().findOne({ _id: gamer_id, "games.appid": appid })
			.then(player => {
				return new Promise((resolve, reject) => {
					if (player != null) {
						return this.xtralifeapi.onDeleteUser(player._id, err => {
							if (err != null) {
								return reject(err);
							} else { return resolve({ nuked: true, dead: 'probably' }); }
						}
							, appid);
					} else {
						return reject(new Error("Player not found"));
					}
				});
			});
	}

	// Deprecated since 2.11
	// use indexing API instead
	// @ts-ignore
	matchProperties(context, domain, user_id, query, cb) {
		throw new Error("Deprecated since 2.11");
	}

	sha_passwd(passwd) {
		if (xlenv.privateKey == null) { throw new Error("null privatekey"); }
		const sha = crypto.createHash('sha1');
		sha.update(xlenv.privateKey + passwd);
		return sha.digest('hex');
	}

	sandbox(context) {
		return {
			account: {
				existInNetwork: (network, id) => {
					const existAsync = Promise.promisify(this.xtralifeapi.connect.existInNetwork, { context: this.xtralifeapi.connect })

					// @ts-ignore
					return existAsync(network, id)
						.then(gamer => {
							//console.log(JSON.stringify(gamer))
							gamer.gamer_id = gamer._id
							delete gamer._id
							return gamer
						})
				},

				nuke: user_id => {
					return this.nuke(context, user_id);
				},

				// conversionOptions can contain updatedGamer to return the updated gamer instead of just one (in case of success).
				convert: (user_id, network, token, options, conversionOptions) => {
					const conversionPromise =
						(() => {
							switch (network.toLowerCase()) {
								case "facebook": return this.xtralifeapi.connect.convertAccountToFacebook(user_id, token);
								case "googleplus": return this.xtralifeapi.connect.convertAccountToGooglePlus(user_id, token);
								case "gamecenter": return this.xtralifeapi.connect.convertAccountToGameCenter(user_id, token, options);
								case "email": return this.xtralifeapi.connect.convertAccountToEmail(user_id, token, this.sha_passwd(options));
								default: throw new errors.BadArgument("Unknown network to convert to");
							}
						})();

					// Returns the updated gamer as well
					if (!(conversionOptions != null ? conversionOptions.updatedGamer : undefined)) {
						// Return an old style document with just one
						// @ts-ignore
						return conversionPromise.then(result => 1);
					} else {
						return conversionPromise;
					}
				},

				changeEmail: (user_id, email) => {
					const changeAsync = Promise.promisify(this.xtralifeapi.connect.changeEmail, { context: this.xtralifeapi.connect });
					// @ts-ignore
					return changeAsync(user_id, email);
				},

				getJWToken: (user_id, domain, secret, payload, expiresIn) => {
					if (expiresIn == null) { expiresIn = "2m"; }
					if (!this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}

					const key = crypto.createHash('sha256').update(secret + domain).digest('hex');

					return jwt.sign({ user_id: user_id.toString(), domain, payload }, key, { expiresIn, issuer: "xtralife-api", subject: "auth" });
				}
			},

			profile: {
				read: (user_id, included) => {
					const fields = {};
					if (included != null) {
						for (let i of Array.from(included)) { fields[i] = 1; }
					}
					return this.xtralifeapi.connect.readProfileAsync(user_id, fields);
				},

				write: (user_id, fields) => {
					return this.updateProfileAsync(user_id, fields);
				}
			},

			properties: {
				read: (domain, user_id, key) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						return this.read(context, domain, user_id, key);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				},

				write: (domain, user_id, key, value) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						return this.write(context, domain, user_id, key, value);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				},

				delete: (domain, user_id, key) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						return this.delete(context, domain, user_id, key);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				}
			},

			relations: {
				friends: (domain, user_id) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						return this.xtralifeapi.social.getFriendsAsync(context, domain, user_id);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				},

				blacklist: (domain, user_id) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						return this.xtralifeapi.social.getBlacklistedUsersAsync(context, domain, user_id);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				},

				setFriendStatus: (domain, user_id, friend_id, status, osn) => {
					if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
						const setFriendStatus = Promise.promisify(this.xtralifeapi.social.setFriendStatus, { context: this.xtralifeapi.social });
						// @ts-ignore
						return setFriendStatus(domain, user_id, friend_id, status, osn);
					} else {
						throw new errors.BadArgument("Your game doesn't have access to this domain");
					}
				},

				godfather: {
					set: (domain, user_id, godfather, options) => {
						if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
							const asyncFn = Promise.promisify(this.xtralifeapi.social.setGodfather, { context: this.xtralifeapi.social });
							// @ts-ignore
							return asyncFn(context, domain, user_id, godfather, options);

						} else {
							throw new errors.BadArgument("Your game doesn't have access to this domain");
						}
					},

					get: (domain, user_id) => {
						if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
							const asyncFn = Promise.promisify(this.xtralifeapi.social.getGodfather, { context: this.xtralifeapi.social });
							// @ts-ignore
							return asyncFn(context, domain, user_id);

						} else {
							throw new errors.BadArgument("Your game doesn't have access to this domain");
						}
					},

					getCode: (domain, user_id) => {
						if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
							const asyncFn = Promise.promisify(this.xtralifeapi.social.godfatherCode, { context: this.xtralifeapi.social });
							// @ts-ignore
							return asyncFn(domain, user_id);

						} else {
							throw new errors.BadArgument("Your game doesn't have access to this domain");
						}
					},

					getChildren: (domain, user_id) => {
						if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
							const asyncFn = Promise.promisify(this.xtralifeapi.social.getGodchildren, { context: this.xtralifeapi.social });
							// @ts-ignore
							return asyncFn(context, domain, user_id);

						} else {
							throw new errors.BadArgument("Your game doesn't have access to this domain");
						}
					},

					getGodfatherFromCode: (domain, godfatherCode) => {
						if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
							return this.xtralifeapi.social.findGodfatherFromCode(context, domain, godfatherCode);
						} else {
							throw new errors.BadArgument("Your game doesn't have access to this domain");
						}
					}
				}
			}
		};
	}

	// BACKOFFICE ###########################################################################

	list(options, cb) {
		const filter = {
			games: {
				"$elemMatch": {
					appid: options.game
				}
			}
		};
		if (options.id != null) { filter._id = options.id; }

		return this.collusers().count(filter, (err, count) => {
			if (err != null) { return cb(err); }
			return this.collusers().find(filter, {
				skip: options.skip,
				limit: options.limit,
				projection: {
					password: 0,
					networksecret: 0
				}
			}
			).toArray((err, docs) => cb(err, count, docs));
		});
	}

	search(appId, q, skip, limit, cb) {
		const query = { $or: [{ 'profile.displayName': { $regex: `${q}`, $options: 'i' } }, { 'profile.email': { $regex: `${q}`, $options: 'i' } }] };
		query.games = { $elemMatch: { appid: appId } };

		const cursor = this.collusers().find(query, {
			limit,
			skip,
			projection: {
				password: 0,
				networksecret: 0
			}
		}
		);
		// @ts-ignore
		return cursor.count((err, count) => cursor.toArray((err, docs) => cb(err, count, docs)));
	}
}

module.exports = new UserAPI();
