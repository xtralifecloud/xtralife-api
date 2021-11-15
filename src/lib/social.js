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
const extend = require('extend');
const rs = require("randomstring");
//const moment = require('moment');
const _ = require("underscore");
const Promise = require('bluebird');

const {
	ObjectId
} = require("mongodb");

const facebook = require("./network/facebook.js");
const google = require("./network/google.js");
const errors = require("../errors.js");

const AbstractAPI = require("../AbstractAPI.js");

class SocialAPI extends AbstractAPI {
	constructor() {
		super();
		this.findGodfatherFromCode = this.findGodfatherFromCode.bind(this);
	}

	// helpers
	collusers() { }

	configure(xtralifeapi, callback) {
		this.xtralifeapi = xtralifeapi;
		this.colldomains = this.coll('domains');
		this.collusers = this.coll('users');

		this.getFriendsAsync = Promise.promisify(this.getFriends);

		if (xlenv.options.removeUser) {
			return async.parallel([
				cb => {
					return this.colldomains.createIndex({ "relations.friends": 1 }, cb);
				},
				cb => {
					return this.colldomains.createIndex({ "relations.blacklist": 1 }, cb);
				},
				cb => {
					return this.colldomains.createIndex({ godchildren: 1 }, cb);
				},
				cb => {
					return this.colldomains.createIndex({ godfather: 1 }, cb);
				}
			], function (err) {
				if (err != null) { return callback(err); }
				logger.info("Social initialized");
				return callback(null);
			});
		} else {
			logger.info("Social initialized");
			return callback(null);
		}
	}

	configureGame(appid, callback) {
		return callback();
	}

	// Called when a user is deleted, to optionally provide some cleanup
	// remove common data
	onDeleteUser(userid, cb) {
		logger.debug(`delete user ${userid} for social`);
		// remove references to user ALL DOMAINS affected !
		return this.colldomains.updateMany({ "relations.friends": userid }, { $pull: { "relations.friends": userid } }, err => {
			if (err != null) { return cb(err); }
			return this.colldomains.updateMany({ "relations.blacklist": userid }, { $pull: { "relations.blacklist": userid } }, err => {
				if (err != null) { return cb(err); }
				return this.colldomains.updateMany({ "relations.godchildren": userid }, { $pull: { "relations.godchildren": userid } }, err => {
					if (err != null) { return cb(err); }
					return this.colldomains.updateMany({ "relations.godfather": userid }, { $unset: { "relations.godfather": null } }, err => {
						if (err != null) { return cb(err); }
						return cb(null);
					});
				});
			});
		});
	}

	addProfile(context, domain, users, key) {
		const ids = _.pluck(users, key);

		const cursor = this.collusers.find({ _id: { $in: ids } }, { profile: 1 });
		return cursor.toArray().then(profiles => {
			if (profiles == null) { return users; }

			profiles = _.indexBy(profiles, '_id');
			_.each(users, function (item, index) {
				const p = profiles[item[key]];
				if ((p != null ? p.profile : undefined) != null) { return users[index].profile = p.profile; }
			});
			return users;
		}).then(profiledUsers => {
			const profids = _.pluck(profiledUsers, key);
			return this.handleHook("social-addprofile", context, domain, {
				domain,
				users: profiledUsers,
				userids: profids
			}).then(afterData => users);
		});
	}

	describeUsersListBase(ids) {
		const cursor = this.collusers.find({ _id: { $in: ids } }, { profile: 1 })

		return cursor.toArray().then(users => {
			if (users == null) { return []; }
			return (() => {
				const result = [];
				for (let user of Array.from(users)) {
					if (user != null) {
						result.push({ gamer_id: user._id, profile: user.profile });
					}
				}
				return result;
			})();
		}); // when user? is a sanity check
	}

	describeUsersList(context, domain, ids, cb) {
		const users = _.map(ids, item => ({
			gamer_id: item
		}));
		return this.addProfile(context, domain, users, "gamer_id")
			.then(profiles => {
				return cb(null, profiles);
			}).catch(cb);
	}

	_indexOfId(ids, id0) {
		let i = 0;
		while (i < ids.length) {
			if (ids[i].equals(id0)) { return i; }
			i++;
		}
		return -1;
	}

	getGodfather(context, domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.godfather": 1 } }, (err, doc) => {
			if (err != null) { return cb(err); }
			//return cb new errors.gamerDoesntHaveGodfather unless doc?.godfather?
			if (__guard__(doc != null ? doc.relations : undefined, x => x.godfather) == null) { return cb(null, null); }
			return this.describeUsersList(context, domain, [doc.relations.godfather], (err, arr) => {
				return cb(err, arr[0]);
			});
		});
	}

	findGodfatherFromCode(context, domain, godfatherCode) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, "relations.godfatherCode": godfatherCode })
			.then(godfather => {
				return (godfather != null ? godfather.user_id : undefined);
			});
	}

	setGodfather(context, domain, user_id, godfather, options, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, "relations.godfatherCode": godfather }, (err, user) => {
			if (err != null) { return cb(err); }
			if (user == null) { return cb(new errors.unknownGodfatherCode); }
			if (user.user_id.toString() === user_id.toString()) { return cb(new errors.cantBeSelfGodchild); }

			return this.collusers.findOne({ _id: user_id }, { projection: { games: 1, profile: 1 } }, (err, usergames) => {
				if (err != null) { return cb(err); }

				return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.godfather": 1 } }, (err, doc) => {
					if (err != null) { return cb(err); }
					if (__guard__(doc != null ? doc.relations : undefined, x => x.godfather) != null) { return cb(new errors.alreadyGodchild); }

					return this.handleHook("setGodfather-override-reward", context, domain, {
						domain,
						godfather: user.user_id,
						godchild: user_id,
						reward: options.reward
					}).then(afterData => {
						logger.debug(afterData);
						if ((afterData != null ? afterData.accepted : undefined) === false) { return cb(new errors.SponsorshipRefusedByHook); }
						// sponsoring is acceted or there is no hook !
						const reward = (afterData != null ? afterData.reward : undefined) || options.reward;
						logger.debug(reward);
						return this.colldomains.updateOne({ domain, user_id }, { $set: { "relations.godfather": user.user_id } }, { upsert: true }, (err, result) => {
							if (err != null) { return cb(err); }
							return this.colldomains.updateOne({ domain, user_id: user.user_id }, { $addToSet: { "relations.godchildren": user_id } }, { upsert: true }, (err, result) => {
								if (err != null) { return cb(err); }
								if ((reward != null) && (reward.transaction != null)) {
									return this.xtralifeapi.transaction.transaction(context, domain, user.user_id, reward.transaction, reward.description)
										.spread((balance, achievements) => {
											if (result.modifiedCount === 1) {
												const message = {
													type: "godchildren",
													event: {
														godchildren: { gamer_id: user_id, profile: usergames.profile },
														reward: { balance, achievements }
													}
												};
												if (options.osn != null) { message.osn = options.osn; }
												if (this.xtralifeapi.game.hasListener(domain)) { xlenv.broker.send(domain, user.user_id.toString(), message); }
											}
											return cb(null, result.modifiedCount);
										}).catch(cb)
										.done();
								} else {
									cb(err, result.modifiedCount);
									if (result.modifiedCount === 1) {
										const message = {
											type: "godchildren",
											event: {
												godchildren: { gamer_id: user_id, profile: usergames.profile }
											}
										};
										if (options.osn != null) { message.osn = options.osn; }
										if (this.xtralifeapi.game.hasListener(domain)) { xlenv.broker.send(domain, user.user_id.toString(), message); }
									}
									return;
								}
							});
						});
					}).catch(cb);
				});
			});
		});
	}

	godfatherCode(domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.godfatherCode": 1 } }, (err, doc) => {
			if (err != null) { return cb(err); }
			if (__guard__(doc != null ? doc.relations : undefined, x => x.godfatherCode) != null) { return cb(null, doc.relations.godfatherCode); }

			const code = rs.generate(8);
			return this.colldomains.updateOne({ domain, user_id }, { $set: { "relations.godfatherCode": code } }, { upsert: true }, (err, result) => {
				//console.log err
				return cb(err, code);
			});
		});
	}

	getGodchildren(context, domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.godchildren": 1 } }, (err, doc) => {
			if (err != null) { return cb(err); }
			if (__guard__(doc != null ? doc.relations : undefined, x => x.godchildren) == null) { return cb(null, []); }
			return this.describeUsersList(context, domain, doc.relations.godchildren, cb);
		});
	}


	getFriends(context, domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.friends": 1 } }, (err, user) => {
			if (err != null) { return cb(err); }
			if (__guard__(user != null ? user.relations : undefined, x => x.friends) == null) { return cb(null, []); }
			return this.describeUsersList(context, domain, user.relations.friends, cb);
		});
	}

	getBlacklistedUsers(context, domain, user_id, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this.colldomains.findOne({ domain, user_id }, { projection: { "relations.blacklist": 1 } }, (err, user) => {
			if (err != null) { return cb(err); }
			if (__guard__(user != null ? user.relations : undefined, x => x.blacklist) == null) { return cb(null, []); }
			return this.describeUsersList(context, domain, user.relations.blacklist, cb);
		});
	}

	_setStatus(domain, user_id, friend_id, status, cb) {
		switch (status) {
			case "add":
				return this.colldomains.findOne({ domain, user_id, "relations.blacklist": friend_id }, { projection: { user_id: 1 } }, (err, blacklisted) => {
					if (err != null) { return cb(err); }
					if (blacklisted != null) { return cb(null, { done: 0 }); }
					return this.colldomains.updateOne({ domain, user_id }, { $addToSet: { "relations.friends": friend_id } }, { upsert: true }, (err, result) => {
						return cb(err, { done: result.upsertedCount });
					});
				});

			case "forget":
				// TODO a single update can pull from both friends and blacklist at once
				// it will change the semantics of the return value...
				return this.colldomains.updateOne({ domain, user_id }, { $pull: { "relations.blacklist": friend_id } }, { upsert: true }, (err, result) => {
					if (err != null) { return cb(err); }
					return this.colldomains.updateOne({ domain, user_id }, { $pull: { "relations.friends": friend_id } }, { upsert: true }, (err, other) => {
						return cb(err, { done: result.modifiedCount || other.result.n });
					});
				});

			case "blacklist":
				// TODO a single update can add/pull from both friends and blacklist at once
				// it will change the semantics of the return value...
				return this.colldomains.updateOne({ domain, user_id }, { $addToSet: { "relations.blacklist": friend_id } }, { upsert: true }, (err, result) => {
					if (err != null) { return cb(err); }
					return this.colldomains.updateOne({ domain, user_id }, { $pull: { "relations.friends": friend_id } }, { upsert: true }, (err, other) => {
						return cb(err, { done: result.modifiedCount });
					});
				});
		}
	}

	setFriendStatus(domain, user_id, friend_id, status, osn, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		return this._setStatus(domain, user_id, friend_id, status, (err, res) => {
			if (err != null) { return cb(err); }
			return this._setStatus(domain, friend_id, user_id, status, (err, res) => {
				if (err != null) { return cb(err); }
				const message = {
					type: `friend.${status}`,
					event: {
						friend: user_id
					}
				};
				if (osn != null) { message.osn = osn; }
				if (this.xtralifeapi.game.hasListener(domain)) { xlenv.broker.send(domain, friend_id.toString(), message); }

				return cb(null, res);
			});
		});
	}

	getNetworkUsers(game, domain, user_id, network, friends_initial, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		let check = this.identity;
		let options = {};
		if (network === "facebook") {
			options = game.config.socialSettings;
			check = facebook.validFriendsIDs;
		}
		return check(friends_initial, options, (err, friends) => {
			if (err != null) { return cb(err); }
			const query = { "network": network, "networkid": { "$in": Object.keys(friends) } };
			return this.collusers.find(query).toArray((err, doc) => {
				return this.colldomains.findOne({ domain, user_id }, { projection: { relations: 1 } }, (err, r) => {
					if (err != null) { return cb(err); }
					for (let f of Array.from(doc)) {
						if ((__guard__(r != null ? r.relations : undefined, x => x.friends) != null) && (this._indexOfId(r.relations.friends, f._id) !== -1)) { f.relation = "friend"; }
						if ((__guard__(r != null ? r.relations : undefined, x1 => x1.blacklisted) != null) && (this._indexOfId(r.relations.blacklisted, f._id) !== -1)) { f.relation = "blacklisted"; }
						friends[f.networkid].clan = _.omit(f, ["networksecret", "devices"]);
					}
					if (network === "facebook") { friends = _.indexBy(friends, "id"); }
					return cb(null, friends);
				});
			});
		});
	}

	identity(friends, options, cb) {
		return cb(null, friends);
	}

	getNetworkUsersAndMatch(game, domain, user_id, network, config, cb) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"body should contains key 'friends'": check.object(config.friends)
		}));

		const friends_initial = config.friends;
		let check = this.identity;
		let options = {};
		if (network === "facebook") {
			options = game.config.socialSettings;
			check = facebook.validFriendsIDs;
		}
		return check(friends_initial, options, (err, friends) => {
			if (err != null) { return cb(err); }
			//console.log "-------------- friends :"
			//console.log friends
			const query1 = { "network": network, "networkid": { "$in": Object.keys(friends) } };
			const query2 = { [`links.${network}`]: { "$in": Object.keys(friends) } };
			const query = { "$or": [query1, query2] };
			return this.collusers.find(query).toArray((err, doc) => {
				if (err != null) { return cb(err); }
				return this.colldomains.findOne({ domain, user_id }, { projection: { relations: 1 } }, (err, r) => {
					if (err != null) { return cb(err); }
					//console.log "-------------- doc :"
					//console.log doc
					for (var f of Array.from(doc)) {
						if ((__guard__(r != null ? r.relations : undefined, x => x.friends) != null) && (this._indexOfId(r.relations.friends, f._id) !== -1)) { f.relation = "friend"; }
						if ((__guard__(r != null ? r.relations : undefined, x1 => x1.blacklisted) != null) && (this._indexOfId(r.relations.blacklisted, f._id) !== -1)) { f.relation = "blacklisted"; }
						if ((config.automatching === true) && (f.relation === undefined)) {
							console.log("adding friend !");
							f.relation = "new friend";
							this.setFriendStatus(domain, user_id, f._id, "add", {}, err => logger.debug(`automatching : ${user_id} became friend of ${f._id}.`));
						}
						if (friends[f.networkid] != null) {
							friends[f.networkid].clan = _.omit(f, ["networksecret", "devices"]);
						} else if (friends[f.links[network]] != null) {
							friends[f.links[network]].clan = _.omit(f, ["networksecret", "devices"]);
						}
					}
					if (network === "facebook") { friends = _.indexBy(friends, "id"); }
					return cb(null, friends);
				});
			});
		});
	}
}


module.exports = new SocialAPI();

function __guard__(value, transform) {
	return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}