/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require('util')._extend;
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");
const {
	ObjectId
} = require('mongodb');

const Promise = require('bluebird');

class GameVFSAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(parent, callback) {

		this.parent = parent;
		this.domains = this.coll('gamevfs');
		this.readAsync = Promise.promisify(this.read, { context: this });
		this.writeAsync = Promise.promisify(this.write, { context: this });

		return this.domains.createIndex({ domain: 1 }, function (err) {
			if (err != null) { return callback(err); }
			logger.info("Gamevfs initialized");
			return callback(err, {});
		});
	}

	// remove common data
	onDeleteUser(user_id, cb) {
		logger.debug(`delete user ${user_id} for gamevfs`);
		return cb(null);
	}

	read(domain, key, callback) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"key may be an unempty string or array": check.maybe.nonEmptyString(key) || key instanceof Array
		}));

		const query =
			{ domain };

		const field = {};
		if (key instanceof Array) {
			for (let each of Array.from(key)) { field[`fs.${each}`] = 1; }
		} else {
			field[(key == null) ? 'fs' : `fs.${key}`] = 1;
		}

		return this.domains.findOne(query, { projection: field }, (err, value) => {
			if (err != null) { return callback(err); }
			return callback(null, ((value != null) && (value.fs != null) ? value.fs : {}));
		});
	}

	write(domain, key, value, callback) {
		if (callback == null) { callback = value; }
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		const query =
			{ domain };

		const set = {};
		if (key === null) {
			set['fs'] = value;
		} else if (typeof key === 'string') {
			set[`fs.${key}`] = value;
		} else {
			for (let k in key) { value = key[k]; set[`fs.${k}`] = value; }
		}

		return this.domains.updateOne(query, { $set: set }, { upsert: true }, (err, result) => {
			if (err != null) { return callback(err); }
			return callback(null, result.modifiedCount);
		});
	}

	delete(domain, key, callback) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		const query =
			{ domain };

		const unset = {};
		unset[(key == null) ? 'fs' : `fs.${key}`] = "";
		return this.domains.updateOne(query, { $unset: unset }, (err, result) => {
			if (err != null) { return callback(err); }

			return callback(null, result.modifiedCount);
		});
	}

	incr(context, domain, key, amount) {
		if (amount == null) { amount = 1; }
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"key must be a string": check.nonEmptyString(key)
		}));

		const query =
			{ domain };

		const field = { [`fs.${key}`]: 1 };
		const update = { "$inc": { [`fs.${key}`]: amount } };

		return this.domains.findOneAndUpdate(query, update, { projection: field, returnDocument: "after" })
			.then(results => {
				return results.value.fs;
			});
	}

	createSignedURL(domain, key, contentType = null, callback) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		if (callback == null) {
			callback = contentType;
			contentType = null;
		}

		return this.parent.virtualfs.createSignedURL(domain, "GAME", key, contentType)
			.then(([signedURL, getURL]) => callback(null, signedURL, getURL))
			.catch(callback)
	}

	deleteURL(domain, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));
		return this.parent.virtualfs.deleteURL(domain, "GAME", key)
			.then(result => result)
			.catch(err => {
				logger.error(`deleteURL ${domain} ${key}`, err);
				return err;
			});
	}

	sandbox(context) {
		return {
			incr: (domain, key, amount) => {
				if (amount == null) { amount = 1; }
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.incr(context, domain, key, amount);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			read: (domain, key) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.readAsync(domain, key);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			write: (domain, key, value) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.writeAsync(domain, key, value);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}
}

module.exports = new GameVFSAPI();
