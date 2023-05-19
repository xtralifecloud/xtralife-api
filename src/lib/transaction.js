/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
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

class TransactionAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(xtralifeapi, callback) {
		this.xtralifeapi = xtralifeapi;
		this.domainsColl = this.coll('domains');
		this.txColl = this.coll('transactions');

		return Promise.all([
			this.domainsColl.createIndex({ domain: 1, user_id: 1 }, { unique: true }),
			this.txColl.createIndex({ domain: 1, userid: 1, ts: -1 })
		])
			.then(() => {
				if (callback) callback(null);
			})
			.catch((err) => {
				if (callback) callback(err);
			});
	}

	// remove common data
	onDeleteUser(userid, cb) {
		return this.txColl.deleteMany({ userid })
			.then(result => {
				logger.warn(`removed transactions ${userid} : ${result.modifiedCount}`);
				return cb(null);
			})
			.catch(err => {
				return cb(err);
			});
	}

	// transaction [{unit: amount}]
	// callback(err, balance)
	transaction(context, domain, user_id, transaction, description, skipAchievementsCheck) {
		if (skipAchievementsCheck == null) { skipAchievementsCheck = false; }
		const _checkTransaction = function (tx) {
			const _checkValue = value => (value === "-auto") || ((typeof value === 'number') && !Number.isNaN(value));
			let valid = true;
			for (let _ in tx) { const value = tx[_]; valid = valid && _checkValue(value); }
			return valid;
		};

		this.pre(check => ({
			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"transaction must be a valid transaction": _checkTransaction(transaction),
			"description must be a string": check.maybe.string(description),
			"skipAchievementsCheck must be a boolean": check.boolean(skipAchievementsCheck)
		}));

		return Promise.try(() => { // Check transaction is a valid tx object
			if (!this._checkTransaction(transaction)) { throw new errors.PreconditionError(["transaction must be a valid transaction"]); }
			return this._getDomain(domain, user_id, { balance: 1, lastTx: 1, achievements: 1 });
		}).then(([balance, lastTx, user_achievements]) => {
			let value;
			for (let unit in transaction) { value = transaction[unit]; if (value === '-auto') { transaction[unit] = (-balance[unit] || 0); } }

			if ((this._insufficientBalances(balance, transaction)).length > 0) { // balance is not enough
				logger.debug('balance not high enough for transaction');
				return (() => { throw new errors.BalanceInsufficient(); })();
			}

			let adjustedBalance = this._adjustBalance(balance, transaction);
			return this.handleHook("before-transaction", context, domain, {
				domain,
				user_id,
				transaction,
				description,
				balanceBefore: balance,
				balanceAfter: adjustedBalance
			}).then(() => { // now insert Tx
				const insertedTx = { _id: new ObjectId(), domain, userid: user_id, ts: new Date(), tx: transaction, desc: description };
				return this.txColl.insertOne(insertedTx)
					.then(() => {
						// update the balance if the lastTx is the one read just before into balObj
						// upsert : insert new balance if not already present
						return this.domainsColl.findOneAndUpdate({ domain, user_id, lastTx }
							, { $set: { balance: adjustedBalance, lastTx: insertedTx._id } }
							, { upsert: true, returnDocument: "after" });
					})
					.then(status => {
						if (!status.ok) {
							logger.warn(err, 'error in transaction/balance.update, race condition (count=' + status.result.n + ')');
							throw new errors.ConcurrentModification;
						}

						const updatedDomain = status.value;

						if (skipAchievementsCheck) {
							return [adjustedBalance, []];
						} else { // Check for achievements if requested to do so
							return this.xtralifeapi.achievement.checkTriggeredAchievements(context, user_id, domain, updatedDomain, balance, adjustedBalance, user_achievements)
								.then((result) => {
									const [triggeredAchievements, updatedBalance] = result;
									if (updatedBalance != null) { adjustedBalance = updatedBalance; }
									return [adjustedBalance, triggeredAchievements];
								});
						}
					})
					.then((result) => {
						const [adjustedBalance, triggeredAchievements] = result;
						return this.handleHook("after-transaction", context, domain, {
							domain,
							user_id,
							transaction,
							description,
							adjustedBalance,
							triggeredAchievements
						}).return([adjustedBalance, triggeredAchievements]);
					});
			});
		});
	}

	// callback(err, balance)
	balance(context, domain, user_id) {
		this.pre(check => ({
			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));


		return this.handleHook("before-balance", context, domain, {
			domain,
			user_id
		}).then(() => {
			return this._getDomain(domain, user_id, { balance: 1 });
		}).then(([balance]) => {
			return this.handleHook("after-balance", context, domain, {
				domain,
				user_id
			}).return(balance);
		});
	}

	_checkTransaction(transaction) {
		try {
			const errs = Object.keys(transaction).filter(key => !((typeof transaction[key] === 'number') || (transaction[key] === '-auto')));
			return errs.length === 0;
		} catch (error) { return false; }
	}

	// use @_get(..).spread (balance, lastTx_id, achievements)=>
	_getDomain(domain, user_id, fields) {

		return this.domainsColl.findOne({ domain, user_id }, { projection: fields })
			.then(function (domain) {
				if ((domain != null) && (domain.balance != null)) {
					return [domain.balance, domain.lastTx, domain.achievements];
				} else {
					return [{}, null, null];
				}
			}); // empty balance
	}

	// callback(err, [tx])
	txHistory(domain, user_id, unit, skip, limit, callback) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"unit must be a string": check.maybe.string(unit),
			"skip must be an integer": check.maybe.integer(skip),
			"limit must be an integer": check.maybe.integer(limit)
		}));

		const before = new Date();

		const query = { domain, userid: user_id };
		if (unit != null) {
			query['tx.' + unit] = { $ne: null };
		}

		const cursor = this.txColl.find(query);
		cursor.sort({ ts: -1 });

		cursor.count().
			then((count) => {
				return cursor.skip(skip).limit(limit).toArray().then((transactions) => {
					for (let each of Array.from(transactions)) {
						(function (each) {
							delete each._id;
							return delete each.userid;
						})(each);
					}
					return callback(null, { transactions, count });
				});
			})
			.catch((err) => {
				logger.error(err, 'error in txHistory.find or txHistory.find.toArray');
				return callback(err);
			});
	}

	// returns the units in balance where balance is not high enough for transaction
	_insufficientBalances(bal, transaction) {
		let unit, amount;
		const balanceValue = function (unit) { if (bal[unit] != null) { return bal[unit]; } else { return 0; } };

		const excessiveTx = (unit, amount) => (amount < 0) && (balanceValue(unit) < -amount);
		const res = ((() => {
			const result = [];
			for (unit in transaction) {
				amount = transaction[unit];
				if (excessiveTx(unit, amount)) {
					result.push(unit);
				}
			}
			return result;
		})());
		return res;
	}

	// the balance must be sufficient for that transaction
	_adjustBalance(bal, transaction) {
		const balanceValue = function (unit) {

			if (bal[unit] != null) {
				if ((typeof bal[unit] === 'number') && !Number.isNaN(bal[unit])) {
					return bal[unit];
				}
			}
			return 0;
		};

		const result = extend({}, bal);
		for (let unit in transaction) { const amount = transaction[unit]; result[unit] = balanceValue(unit) + amount; }
		return result;
	}

	sandbox(context) {
		return {
			balance: (domain, user_id) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.balance(context, domain, user_id);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},
			transaction: (domain, user_id, transaction, description, skipAchievementsCheck) => {
				if (skipAchievementsCheck == null) { skipAchievementsCheck = false; }
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.transaction(context, domain, user_id, transaction, description, skipAchievementsCheck);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}

	search(domain, user_id, ts1, ts2, q, skip, limit, callback) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"timestamp1 must be an string": check.string(ts1),
			"timestamp2 must be an string": check.string(ts2),
			"q must be an string": check.string(q),
		}));

		const query = { domain, userid: user_id };

		if(ts1 !== "null" && ts2 !== "null") query["ts"]= {$gte: new Date(parseInt(ts1)), $lte: new Date(parseInt(ts2))}
		if(q !== "null") query["desc"]= {$regex: q}

		const cursor = this.txColl.find(query);
		cursor.sort({ ts: -1 });
		return cursor.count(function (err, count) {
			if (err != null) {
				logger.error(err, 'error in txHistory.find');
				return callback(err);
			}

			return cursor.skip(skip).limit(limit).toArray(function (err, transactions) {
				if (err != null) {
					logger.error(err, 'error in txHistory.find.toArray');
					return callback(err);
				}

				for (let each of Array.from(transactions)) {
					(function (each) {
						delete each._id;
						return delete each.userid;
					})(each);
				}

				return callback(null, { transactions, count });
			});
		});
	}
}

module.exports = new TransactionAPI();
