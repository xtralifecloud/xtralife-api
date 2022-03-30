//@ts-check
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require("extend");
const _ = require("underscore");
const _errors = require('./errors.js');
const Q = require("bluebird");

class XtralifeAPI {
	constructor() {
		this.apikeys = {};
		this.errors = _errors;
	}

	configure(_, cb) {
		const before = Date.now();

		this.mailer = xlenv.mailer;

		// it takes 2+s to compile all this coffeescript code...
		this.collections = require('./lib/collections.js');
		this.connect = require("./lib/connect.js");
		this.user = require("./lib/user.js");
		this.social = require("./lib/social.js");
		this.outline = require("./lib/outline.js");
		this.transaction = require("./lib/transaction.js");
		this.virtualfs = require("./lib/virtualfs.js");
		this.gamevfs = require("./lib/gamevfs.js");
		this.leaderboard = require("./lib/leaderboard.js");
		this.achievement = require('./lib/achievement.js');
		this.match = require('./lib/match.js');
		this.store = require('./lib/store.js');
		this.index = require('./lib/index.js');
		this.timer = require('./lib/timer.js');
		this.kv = require('./lib/kvstore.js');
		this.game = require("./lib/game.js");

		this.modules = [this.connect, this.user, this.social, this.outline, this.transaction, this.virtualfs, this.leaderboard, this.gamevfs, this.achievement, this.match, this.store, this.index, this.timer, this.kv];

		if (xlenv.options.disableIndexModule) {
			this.modules = this.modules.filter( each => each !== this.index )
		}
		  
		// WARNING @collections must always be first
		// @ts-ignore
		this.modules.unshift(this.collections);

		// WARNING, surprisingly, games, should be the last to be initialized as it suscribe to a redisConfigurtion
		// and then the callback on dynamic config could be called before the initialiation of all modules!
		// @ts-ignore
		this.modules.push(this.game);

		return async.mapSeries(this.modules, (each, localcb) => {
			return each.configure(this, err => localcb(err));
		}
			, err => {
				if (err != null) {
					logger.error("can't configure Xtralife-API!");
					logger.error(err.message, { stack: err.stack });
					return cb(err);
				} else {
					logger.info(`Xtralife-API configured... in ${Date.now() - before} ms`);

					return cb();
				}
			});
	}

	configureGame(game, callback) {
		return async.each(this.modules, (eachApi, cb) => eachApi.configureGame(game, cb)
			, callback);
	}

	afterConfigure(xtralifeapi, cb) {
		return async.mapSeries(this.modules, (each, localcb) => {
			return each.afterConfigure(this, localcb);
		}
			, err => {
				// @ts-ignore
				const { version } = require("../package.json");
				logger.info(`All Xtralife-API modules post configured (${version})`);
				return cb(err);
			});
	}

	// remove common data
	onDeleteUser(userid, cb, appid) {
		if (!xlenv.options.removeUser) { return cb(null); }

		return this.game.handleHook("before-nuking-user", { game: { appid } }, 'private', {
			userid,
			user_id: userid
		}).then(() => {

			// Call onDeleteUser for each of the submodules
			const tasks = [];
			for (let module of Array.from(this.modules)) {
				(module => {
					return tasks.push(callback => module.onDeleteUser(userid, callback));
				})(module);
			}

			tasks.reverse();

			return new Q((resolve, reject) => {
				return async.series(tasks, err => {
					if (err != null) {
						return reject(err);
					} else { return resolve(err); }
				});
			});
		}).then(() => {
			return this.game.handleHook("after-nuking-user", { game: { appid } }, 'private', {
				userid,
				user_id: userid
			}
			);
		}).then(cb)
			.catch(cb);
	}

	sandbox(context) {
		context.runsFromClient = false;

		return {
			virtualfs: this.virtualfs.sandbox(context),
			tx: this.transaction.sandbox(context),
			game: this.game.sandbox(context),
			user: this.user.sandbox(context),
			gamevfs: this.gamevfs.sandbox(context),
			leaderboard: this.leaderboard.sandbox(context),
			achievement: this.achievement.sandbox(context),
			match: this.match.sandbox(context),
			index: this.index.sandbox(context),
			timer: this.timer.sandbox(context),
			kv: this.kv.sandbox(context)
		};
	}
}

module.exports = new XtralifeAPI();
