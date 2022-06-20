/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const AbstractAPI = require('../AbstractAPI.js');
const async = require('async');
const {
	ObjectId
} = require('mongodb');
//const moment = require("moment");
const _ = require('underscore-contrib');
const Promise = require('bluebird');
const errors = require('../errors.js');
const util = require('util');

const Redlock = require('redlock');

const superagent = require('superagent');
const jwt = require('jsonwebtoken');

const url = require('url');
const nodemailer = require('nodemailer');

const metrics = require('./metrics.js');

class GameAPI extends AbstractAPI {

	constructor() {
		super();
		this.sandbox = this.sandbox.bind(this);
		this.dynGames = {};
		this.appsForDomain = {};
		this.eventedDomains = {};
	}

	// helpers
	collgame() {
		return this.coll("games");
	}

	configure(xtralifeapi, cb) {
		this.xtralifeapi = xtralifeapi;
		this.collDomainDefinition = this.coll("domainDefinition");

		this.gamesByApiKey = {};

		// start with the contents of xlenv.hooks.definitions
		this.hooks = _.clone(xlenv.hooks.definitions);

		return xlenv.inject(["xtralife.games"], (err, xtralifeGames) => {
			if (err != null) { cb(err); }

			return this.collgame().createIndex({ appid: 1 }, { unique: true }, err => {
				if (err != null) { return cb(err); }


				for (let appid in xtralifeGames) { const game = xtralifeGames[appid]; this.dynGames[appid] = game; }
				this.appsForDomain = {};

				this.eventedDomains = {};

				Promise.promisifyAll(this.coll('hookLog'));

				xlenv.inject(['redisClient'], (err, client) => {
					return this.redlock = new Redlock([client], { driftFactor: 0.01, retryCount: 3, retryDelay: 200 });
				});

				return async.eachSeries(((() => {
					const result = [];
					for (let each in xtralifeGames) {
						result.push(each);
					}
					return result;
				})()), (game, localcb) => {
					return this.configureGame(game, err => {
						return localcb(err);
					}
						, true);
				} // silent
					, err => cb(err));
			});
		});
	}

	configureGame(appid, cb, silent) {
		if (silent == null) { silent = false; }
		const game = this.dynGames[appid];
		game.appid = appid;
		this.gamesByApiKey[game.apikey] = game;
		if (!silent) { logger.info(`added ${appid}`); }

		// needed to initiate the llop on timed out event !
		xlenv.broker.start(`${appid}.${game.apisecret}`);
		this.eventedDomains[this.getPrivateDomain(appid)] = true;
		if (game.config.eventedDomains != null) {
			for (let domain of Array.from(game.config.eventedDomains)) {
				this.eventedDomains[domain] = true;
				xlenv.broker.start(domain);
			}
		}

		// if there's an init hook on the private domain of the game, call it
		const privateDomain = this.getPrivateDomain(appid)
		if (xlenv.hooks.functions && xlenv.hooks.functions[privateDomain] && xlenv.hooks.functions[privateDomain]['init']) {
			// we've found an init hook, call it
			xlenv.hooks.functions[privateDomain].init()
		}

		return this.coll('games').updateOne({ appid }, { "$set": { appid, config: game.config } }, { upsert: true })
			.then(query => {
				if (query.upsertedCount != 0) {
					return query.upsertedId;
				} else {
					return this.coll('games').findOne({ appid })
						.then(agame => agame._id);
				}
			}).then(function (_id) {
				game._id = _id;
				return cb(null);
			}).catch(cb);
	}

	onDeleteUser(userid, cb) {
		logger.debug(`delete user ${userid} for game`);
		return cb(null);
	}

	existsKey(apikey, cb) {
		return cb(null, this.gamesByApiKey[apikey]);
	}

	getPrivateDomain(appid) {
		const game = this.dynGames[appid];
		return `${appid}.${game.apisecret}`;
	}

	checkAppCredentials(apikey, apisecret, cb) {
		const game = this.gamesByApiKey[apikey];
		if (game == null) { return cb(new Error('Invalid ApiKey')); }
		if ((game.apisecret === apisecret) && game.config.enable) {
			return cb(null, game);
		} else {
			return cb(new Error("Invalid App Credentials"), null);
		}
	}

	checkDomain(game, domain, cb) {
		return cb(null, game.config.domains && (game.config.domains.indexOf(domain) !== -1));
	}

	checkDomainSync(appid, domain) {
		const game = this.dynGames[appid];
		return (this.getPrivateDomain(appid) === domain) || (game.config.domains && (game.config.domains.indexOf(domain) !== -1));
	}

	getGame(appid, domain, cb) {
		//keep ascending compatibility
		if (cb == null) {
			cb = domain;
			domain = this.getPrivateDomain(appid);
		}

		return this.collgame().findOne({ appid }, (err, game) => {
			if (err != null) { return cb(err); }

			return this.collDomainDefinition.findOne({ domain }, { projection: { leaderboards: 1 } }, function (err, domainDefinition) {
				if (err != null) { return cb(err); }
				game.leaderboards = (domainDefinition != null ? domainDefinition.leaderboards : undefined) || {};
				return cb(null, game);
			});
		});
	}

	// getCerts(appid, cb) {
	// 	const empty = {
	// 		android: {
	// 			enable: false,
	// 			senderID: '',
	// 			apikey: ''
	// 		},
	// 		ios: {
	// 			enable: false,
	// 			cert: '',
	// 			key: ''
	// 		},
	// 		macos: {
	// 			enable: false,
	// 			cert: '',
	// 			key: ''
	// 		}
	// 	};
	// 	const game = this.dynGames[appid];
	// 	return cb(null, game.config.certs || empty);
	// }

	getGoogleCerts(appId, cb) {
		const empty = {
			packageID: '',
			serviceAccount: {
				private_key_id: '',
				client_email: '',
				client_id: '',
				type: 'service_account',
			},
		};
		const game = this.dynGames[appId];
		return cb(null, game.config.google.inApp || empty);
	}

	hasListener(domain) {
		return this.eventedDomains[domain] === true;
	}

	getAppsWithDomain(domain, cb) {

		if (this.appsForDomain[domain] != null) {
			return cb(null, this.appsForDomain[domain]);
		}

		let appid = undefined;
		for (let key in this.gamesByApiKey) {
			if (domain === `${this.gamesByApiKey[key].appid}.${this.gamesByApiKey[key].apisecret}`) {
				({
					appid
				} = this.gamesByApiKey[key]);
			}
		}

		if (appid == null) { return cb(null, null); }

		const game = this.dynGames[appid];
		this.appsForDomain[domain] = { appid, config: game.config };
		return cb(null, this.appsForDomain[domain]);
	}

	runBatch(context, domain, hookName, params) {
		if (hookName.slice(0, 2) !== '__') { hookName = '__' + hookName; }

		return this.handleHook(hookName, context, domain, params);
	}

	runBatchWithLock(context, domain, hookName, params, resource = null) {
		let timeout = 200;
		if(xlenv.options.redlock != null) {
			if(xlenv.options.redlock.timeout) timeout = xlenv.options.redlock.timeout;
			if(xlenv.options.redlock.overrideTimeoutViaParams && params.timeout) timeout = params.timeout;
		}

		if (hookName.slice(0, 2) !== '__') { hookName = '__' + hookName; }
		if (resource == null) { resource = hookName; }
		const lockName = `${domain}.${resource}`;

		return this.redlock.lock(lockName, timeout).then(lock => {
			return this.handleHook(hookName, context, domain, params)
				.timeout(timeout)
				.tap(result => {
					return lock.unlock();
				}).catch(err => {
					lock.unlock();
					throw err;
				});
		});
	}

	sendEvent(context, domain, user_id, message) {
		if (!this.hasListener(domain)) {
			throw new errors.NoListenerOnDomain(domain);
		}

		if (util.isArray(user_id)) {
			if (user_id.length > (xlenv.options.maxReceptientsForEvent)) {
				return Promise.reject(new Error(`Can't send a message to more than ${xlenv.options.maxUsersForEvent} users`));
			}

			return Promise.all((Array.from(user_id).map((eachUser) => xlenv.broker.send(domain, eachUser.toString(), message))));
		} else {
			return xlenv.broker.send(domain, user_id.toString(), message);
		}
	}

	sendVolatileEvent(context, domain, user_id, message) {
		if (util.isArray(user_id)) {
			if (user_id.length > (xlenv.options.maxReceptientsForEvent)) {
				return Promise.reject(new Error(`Can't send a message to more than ${xlenv.options.maxUsersForEvent} users`));
			}

			return Promise.all((Array.from(user_id).map((eachUser) => xlenv.broker.sendVolatile(domain, eachUser.toString(), message))));
		} else {
			return xlenv.broker.sendVolatile(domain, user_id.toString(), message);
		}
	}

	getHooks(game, domain) {
		if (!this.checkDomainSync(game.appid, domain)) { return Promise.reject(new errors.RestrictedDomain("Invalid domain access")); }

		return Promise.resolve((
			(this.hooks[domain] == null) ? null
				: this.hooks[domain]
		)
		);
	}

	hookLog(game, domain, hookName, log) {
		if (!(xlenv.options.hookLog != null ? xlenv.options.hookLog.enable : undefined)) { return; }
		if (!this.checkDomainSync(game.appid, domain)) { throw new errors.RestrictedDomain("Invalid domain access"); }
		return logger.debug(`hookLog: ${domain}.${hookName} - ${log}`, { appid: game.appid });
	}

	getMetrics() {
		return metrics;
	}

	sandbox(context) {
		const _checkUrl = function (_url) {
			const {
				hostname
			} = url.parse(_url);
			if (xlenv.options.hostnameBlacklist == null) {
				logger.warn('xlenv.options.hostnameBlacklist should be defined, disabling http requests');
				throw new Error("HTTP requests have been disabled, please contact support");
			}

			if (Array.from(xlenv.options.hostnameBlacklist).includes(hostname)) {
				throw new Error("This hostname is blacklisted for access through this.game.http.*");
			}
		};

		return {
			loginExternal: (external, credentials, options) => {
				const loginAsync = Promise.promisify(this.xtralifeapi.connect.loginExternal, { context: this.xtralifeapi.connect });
				const addGameAsync = Promise.promisify(this.xtralifeapi.connect.addGameToUser, { context: this.xtralifeapi.connect });

				return loginAsync(context.game, external, credentials, options)
					.then((gamer, created) => {
						return addGameAsync(context.game, gamer).then(count => {
							const result = gamer;

							result.gamer_id = gamer._id;
							result.gamer_secret = this.xtralifeapi.user.sha_passwd(gamer._id);
							result.servertime = new Date();
							delete result._id;
							delete result.networksecret;
							return result;
						});
					});
			},

			runBatch: (domain, hookName, params) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.runBatch(context, domain, hookName, params);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			runBatchWithLock: (domain, hookName, params, resource = null) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.runBatchWithLock(context, domain, hookName, params, resource);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			getPrivateDomain: () => {
				return this.getPrivateDomain(context.game.appid);
			},

			sendEvent: (domain, user_id, message) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.sendEvent(context, domain, user_id, message);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			sendVolatileEvent: (domain, user_id, message) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.sendVolatileEvent(context, domain, user_id, message);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			jwt,

			http: {
				get(_url) {
					_checkUrl(_url);
					return superagent.get(_url);
				},

				post(_url) {
					_checkUrl(_url);
					return superagent.post(_url);
				},

				put(_url) {
					_checkUrl(_url);
					return superagent.put(_url);
				},

				del: _url => {
					_checkUrl(_url);
					return superagent.del(_url);
				}
			},

			nodemailer,

			redlock: () => this.redlock,

			metrics: () => this.getMetrics()
		};
	}
}

module.exports = new GameAPI();
