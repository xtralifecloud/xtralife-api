/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require('util')._extend;
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");

const Promise = require('bluebird');

class AchievementAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(xtralifeApi, callback) {
		this.xtralifeApi = xtralifeApi;
		return async.parallel([
			cb => {
				return this.coll('achievements').createIndex({ domain: 1 }, { unique: true }, cb);
			}
		], function (err) {
			if (err != null) { return callback(err); }
			logger.info("Achievements initialized");
			return callback();
		});
	}

	// remove common data
	onDeleteUser(userid, callback) {
		logger.debug(`delete user ${userid} for Achievements`);
		return callback(null);
	}

	// Checks which achievements are triggered by a transaction. Returns a list of achievements.
	// .spread (triggeredAchievements, latestBalance)
	checkTriggeredAchievements(context, user_id, domain, domainDocument, oldBalance, newBalance, user_achievements) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));

		// Needed prior to returning the achievements
		const _postResults = (achievements, latestBalance = null) => {
			if (latestBalance != null) { domainDocument.balance = latestBalance; }
			this._enrichAchievements(achievements, domainDocument, user_id);
			return [achievements, latestBalance];
		};

		return this.loadAchievementsDefinitions(domain)
			.then(achDefinitions => {
				// Check what achievements were just triggered
				let each;
				const _canTrigger = function (achName, achievementDefinition) {
					const ach = user_achievements != null ? user_achievements[achName] : undefined;
					// Already obtained?
					if (__guard__(ach != null ? ach.status : undefined, x => x.obtained)) {
						// Else just check that the max count allows it
						const maxCount = achievementDefinition.config.maxTriggerCount || 1;
						// maxCount = -1 allows an infinite number of triggers
						if (maxCount === -1) { return true; } else { return ach.status.count < maxCount; }
					} else {
						return true;
					}
				};

				const _triggered = achievementDefinition => {
					return (this._getProgress(achievementDefinition, oldBalance) < 1) &&
						(this._getProgress(achievementDefinition, newBalance) >= 1);
				};

				const triggeredAchievements = {};
				for (let key in achDefinitions) { each = achDefinitions[key]; if (_canTrigger(key, each) && _triggered(each)) { triggeredAchievements[key] = each; } }

				if (Object.keys(triggeredAchievements).length > 0) {
					// if they were triggered, we want to store it in domains
					let name;
					const setQuery = {};
					for (name in triggeredAchievements) { each = triggeredAchievements[name]; setQuery[`achievements.${name}.status.obtained`] = true; }
					const incQuery = {};
					for (name in triggeredAchievements) { each = triggeredAchievements[name]; incQuery[`achievements.${name}.status.count`] = 1; }
					return this.coll('domains').updateOne({ domain, user_id }, { "$set": setQuery, "$inc": incQuery }, { upsert: true, multi: false })
						.then(result => {
							// Run associated transactions if any
							const transactions = ((() => {
								const result1 = [];
								for (name in triggeredAchievements) {
									each = triggeredAchievements[name];
									if ((each.config != null ? each.config.rewardTx : undefined) != null) {
										result1.push(each.config.rewardTx);
									}
								}
								return result1;
							})());
							return this.handleHook("after-achievement-triggered", context, domain, {
								domain,
								user_id,
								triggeredAchievements,
								runTransactions: transactions
							}).then(beforeData => {
								if ((transactions != null) && (transactions.length > 0)) {
									// we'll build a promise chain to run transactions in series to prevent race conditions
									let promiseChain = Promise.resolve(null);
									for (let tx of Array.from(transactions)) {
										(tx => {
											return promiseChain = promiseChain.then(() => {
												return this.xtralifeApi.transaction.transaction(context, domain, user_id, tx, 'Triggered by achievement', true);
											});
										})(tx);
									}

									return promiseChain.spread(latestBalance => {
										return _postResults(triggeredAchievements, latestBalance);
									});
								} else {
									return _postResults(triggeredAchievements);
								}
							});
						});
				} else {
					return _postResults(triggeredAchievements);
				}
			});
	}

	getUserAchievements(user_id, domain) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));

		return this.loadAchievementsDefinitions(domain)
			.then(achievements => {
				return this.coll('domains').findOne({ domain, user_id }, { projection: { achievements: 1, balance: 1 } })
					.then(domain => {
						const resultAchievements = {};
						for (let name in achievements) { const ach = achievements[name]; resultAchievements[name] = this._enrichAchievementDefinitionForUser(name, ach, domain); }
						return resultAchievements;
					});
			});
	}

	// .then (achievements)
	// where achievements is {"name": {config}}
	loadAchievementsDefinitions(domain) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.coll('achievements').findOne({ domain })
			.then(achievements => achievements != null ? achievements.definitions : undefined);
	}

	modifyUserAchievementData(context, user_id, domain, achName, gamerData) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.loadAchievementsDefinitions(domain)
			.then(definitions => {
				// Check that the achievement exists
				let value;
				if (((definitions != null ? definitions[achName] : undefined) == null)) { throw new errors.BadArgument; }

				const query = {};
				for (let key in gamerData) { value = gamerData[key]; query[`achievements.${achName}.gamerData.${key}`] = value; }
				// Update the achievements field for the domain in DB
				return this.coll('domains').findOneAndUpdate({ domain, user_id },
					{ "$set": query },
					{ upsert: true, returnOriginal: false })
					.then(result => {
						return this.handleHook("after-achievement-userdata-modified", context, domain, {
							domain,
							user_id,
							achievement: achName,
							gamerData
						}).then(afterHookData => {
							return this._enrichAchievementDefinitionForUser(achName, definitions[achName], result.value);
						});
					});
			});
	}

	resetAchievementsForUser(context, user_id, domain) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.coll('domains').updateOne({ domain, user_id }, { "$unset": { "achievements": "" } }, { upsert: true });
	}

	// Add or replace achievements for a domain
	saveAchievementsDefinitions(domain, achievements) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		const achColl = this.coll('achievements');
		return achColl.findOneAndUpdate({ domain }, { $set: { definitions: achievements } }, { upsert: true, returnOriginal: false })
			.then(result => {
				return result.value;
			});
	}

	// Takes an achievement definition as well as a domain and makes something returnable to the user when querying the status of achievements
	// Efficient method to be used whenever possible. A simpler _enrichAchievements exist though.
	_enrichAchievementDefinitionForUser(achName, achDefinition, userDomain) {
		const _notTriggeredBefore = function (achName) {
			const ach = __guard__(userDomain != null ? userDomain.achievements : undefined, x => x[achName]);
			return !(ach != null ? ach.status : undefined);
		};

		// Enrich achievement with the progress
		achDefinition.progress = _notTriggeredBefore(achName) ? this._getProgress(achDefinition, userDomain != null ? userDomain.balance : undefined) : 1;
		achDefinition.gamerData = __guard__(__guard__(userDomain != null ? userDomain.achievements : undefined, x1 => x1[achName]), x => x.gamerData);
		return achDefinition;
	}

	// Higher level version, which requires an access to the database.
	_enrichAchievements(achievementDefinitions, domainDocument) {
		for (let name in achievementDefinitions) { const ach = achievementDefinitions[name]; this._enrichAchievementDefinitionForUser(name, ach, domainDocument); }
		return achievementDefinitions;
	}

	_getProgress(definition, balance) {
		if (definition.type === "limit") {
			// Not been set once
			if (balance == null) { return 0; }
			const max = definition.config.maxValue;
			const {
				unit
			} = definition.config;
			const value = balance[unit];
			if (value != null) { return Math.min((value / max), 1); } else { return 0; }
		} else {
			throw new Error("Not implemented: unknown achievement type " + definition.type);
		}
	}

	sandbox(context) {
		return {
			modifyUserAchievementData: (domain, user_id, achName, gamerData) => {
				if (this.xtralifeApi.game.checkDomainSync(context.game.appid, domain)) {
					return this.modifyUserAchievementData(context, user_id, domain, achName, gamerData);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},
			getUserAchievements: (domain, user_id) => {
				if (this.xtralifeApi.game.checkDomainSync(context.game.appid, domain)) {
					return this.getUserAchievements(user_id, domain);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}
}

module.exports = new AchievementAPI();

function __guard__(value, transform) {
	return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}