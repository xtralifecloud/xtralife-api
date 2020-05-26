/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require('util')._extend;
const {
    ObjectID
} = require('mongodb');
const _ = require("underscore");

const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");

const Q = require("bluebird");

class LeaderboardAPI extends AbstractAPI {
	constructor(){
		super();
		this.rc = null;
	}

	configure(xtralifeapi, callback){
		this.xtralifeapi = xtralifeapi;
		this.domainDefinition = this.coll('domainDefinition');
		this.colldomains = this.coll('domains');
		this.scoreAsync = Q.promisify(this.score, {context: this});

		return async.parallel([
			cb=> {
				return this.domainDefinition.createIndex({domain:1}, {unique: true}, cb);
			},
			cb=> {
				return xlenv.inject(["=redisClient"], (err, rc)=> {
					this.rc = rc;
					if (err != null) { return cb(err); }
					return cb(null);
				});
			}

		], function(err){
			if (err != null) { return callback(err); }
			logger.info("Leaderboard initialized");
			return callback();
		});
	}

	afterConfigure(_xtralifeapi, cb){
		return cb();
	}

	configureGame(appid, callback){
		return callback(null);
	}

	onDeleteUser(userid, cb){
		logger.debug(`delete user ${userid.toString()} for leaderboard`);
		return this.colldomains.find({user_id : userid, lb: { "$exists" : true}}, {domain: 1, lb: 1}).toArray((err, docs)=> {
			if (docs == null) { return cb(err); }
			if (err != null) { return cb(err); }
			return async.forEach(docs, (item, localcb) => {
				return async.forEach(Object.keys(item.lb), (board, innercb) => {
					const key = `${item.domain}:leaderboards:${board}`;
					return this.rc.zrem(key, userid.toString(), (err, out)=> {
						logger.warn(`delete lb.${board} for user ${userid.toString()} : ${out}, ${err} `);
						return innercb(err);
					});
				}
				, err => localcb(err));
			}
			, err => cb(err));
		});
	}


	_describeScore(context, domain, board, scores, rank, card, page, count, cb){
		const before = new Date();

		const list = _.map(scores, item => new ObjectID(item));

		const query = { 
			domain,
			user_id : { $in : list }
		};
		query[`lb.${board}.score`] = {"$exists" : true };

		const fields =
			{user_id : 1};
		fields[`lb.${board}`] = 1;

		return this.colldomains.find( query , {projection:fields} ).toArray((err, userscores)=> {
			if (err != null) { return cb(err); }
			if (userscores == null) { return cb(null , []); }

			return this.xtralifeapi.social.addProfile(context, domain, userscores, "user_id")
			.then(function(scoreprofiles){

				const orderscores = [];

				scoreprofiles = _.indexBy(scoreprofiles, item => item.user_id);

				_.each(scores, function(user){
					const item = scoreprofiles[user];
					if ((item != null) && (item.lb != null)) { // sanity check
						const gamer = { 
							score : item.lb[board],
							gamer_id : item.user_id,
							profile : item.profile
						};
						return orderscores.push(gamer);
					}
				});

				const result = {};
				result[board] = {
					maxpage : Math.ceil(card/count),
					page,
					rankOfFirst : rank,
					scores : orderscores
				};


				return cb(null, result);}).catch(cb);
		});
	}


	_getRank(key, score, order, cb){
		const rank = undefined;
		if (order === "hightolow") {
			return this.rc.zrevrangebyscore([key, score, "-inf", "WITHSCORES", "LIMIT", 0, 1], (err, replies)=> {
				if (err != null) { return cb(err); }
				if (replies.length===0) {
					return this.rc.zcard(key, (err, rank)=> {
						return cb(err, ++rank);
					});
				} else {
					return this.rc.zrevrank(key, replies[0], (err, rank)=> {
						return cb(err, ++rank);
					});
				}
			});
		} else {
			return this.rc.zrangebyscore([key, "-inf", score, "WITHSCORES", "LIMIT", 0, 1], (err, replies)=> {
				if (err != null) { return cb(err); }
				if (replies.length===0) {
					return this.rc.zcard(key, (err, rank)=> {
						return cb(err, ++rank);
					});
				} else {
					return this.rc.zrank(key, replies[0], (err, rank)=> {
						return cb(err, ++rank);
					});
				}
			});
		}
	}

	score(domain, user_id, board, order, score, info, force, cb){
		order = order.toLowerCase();
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "user_id must be an ObjectID": check.objectid(user_id),
            "board must be string" : check.string(board),
            "order must be string" : check.string(order) && ((order === 'hightolow') || (order === 'lowtohigh')),
            "score must be number" : check.number(score),
            "info must be string or null" : check.maybe.string(info),
            "force must be boolean" : check.boolean(force),
            "callback must be a function": check.function(cb)
        }));

		const set = {};
		set[`leaderboards.${board}`] = { order };

		// we should really cache this, to avoid writing each time... except if mongodb skips the write already
		// it does grow the oplog with no reason, make replication slower, cause SSD access, etc...
		return this.domainDefinition.updateOne({domain}, {$set: set}, {upsert: true}, (err, result)=> {
			if (err != null) { return cb(err); }

			const newscore = {};
			newscore[`lb.${board}`] = {
				timestamp : new Date(),
				score,
				info
			};
			
			const query = {
				domain,
				user_id
			};

			const field = {};
			field[`lb.${board}`] = 1;

			//console.log "board=#{board}, order=#{order}, score=#{score}, info=#{info}"
			return this.colldomains.findOne(query, {projection:field}, (err, doc)=> {
				let key;
				if (err != null) { return cb(err); }
				if ((!force) && ((__guard__(__guard__(doc != null ? doc.lb : undefined, x1 => x1[board]), x => x.score) != null) && (((order === "hightolow") && (doc.lb[board].score >= score)) || ((order === "lowtohigh") && (doc.lb[board].score <= score))))) {
					key = `${domain}:leaderboards:${board}`;
					return this._getRank(key, score, order, (err, rank)=> {
						return cb(null, { done : 0, msg: "this is not the highest score", rank});
				}); 
				} else {
					return this.colldomains.updateOne(query, {$set: newscore}, { upsert : true }, (err, doc)=> {
						if (err != null) { return cb(err); }
						key = `${domain}:leaderboards:${board}`;
						return this.rc.zadd(key, score, user_id.toString(), (err, out)=> {
							if (err != null) { return cb(err); }
							if (order === "hightolow") {
								return this.rc.zrevrank(key, user_id.toString(), (err, rank)=> {
									rank++;
									return cb(err, {done: 1, rank});
							});
							} else {
								return this.rc.zrank(key, user_id.toString(), (err, rank)=> {
									rank++;
									return cb(err, {done : 1, rank});
							});
							}
					});
				});
				}
		});
	});
	}

	getrank(domain, board, score, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "board must be string" : check.string(board),
            "score must be number" : check.number(score),
            "callback must be a function": check.function(cb)
        }));

		return this.domainDefinition.findOne({domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=> {
			if (err != null) { return cb(err); }

			if (_domainDefinition == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards[board] == null) { return cb(new errors.MissingScore); }

			const {
                order
            } = _domainDefinition.leaderboards[board];

			const key = `${domain}:leaderboards:${board}`;
			return this._getRank(key, score, order, cb);
		});
	}


	deleteScore(domain, user_id, board, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "user_id must be an ObjectID": check.objectid(user_id),
            "board must be string" : check.string(board),
            "callback must be a function": check.function(cb)
        }));

		const delscore = {};
		delscore[`lb.${board}`] = "";

		return this.colldomains.updateOne({domain, user_id}, {$unset: delscore},{ upsert : true }, (err, doc)=> {
			if (err != null) { return cb(err); }
			const key = `${domain}:leaderboards:${board}`;
			return this.rc.zrem(key, user_id.toString(), (err, out)=> {
				return cb(err, {done : out===1});
		});
	});
	}

	rebuild(domain, board, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "board must be string" : check.string(board),
            "callback must be a function": check.function(cb)
        }));

		const key = `${domain}:leaderboards:${board}`;
		return this.rc.del(key, (err, out)=> {
			if (err != null) { return cb(err); }
			const field = {user_id: 1};
			field[`lb.${board}`] = 1;
			const query = {domain};
			query[`lb.${board}`] = {"$exists":true};
			let count=0;
			return this.colldomains.find(query, field).each((merr, user)=> {
				if (merr != null) { logger.error(merr.message, {stack: merr.stack}); }
				if (user == null) { return cb(null, { "done" : count }); }
				count++;
				return this.rc.zadd(key, user.lb[board].score, user.user_id.toString(), (rerr, out)=> {
					if (rerr != null) { return logger.error(rerr.message, {stack: rerr.stack}); }
			});
		});
	});
	}

	deleteLeaderboard(domain, board, cb){
		// 1) Remove the key associated with the board from redis
		const key = `${domain}:leaderboards:${board}`;
		return this.rc.del(key, (err, out)=> {
			if (err != null) { return cb(err); }

			// 2) Remove the board from the game
			const deldomain = {};
			deldomain[`leaderboards.${board}`] = "";
			return this.domainDefinition.updateMany({domain}, {$unset: deldomain}, (err, result)=> {
				if (err != null) { return cb(err); }

				// 3) Remove the board from all players
				const delscore = {};
				delscore[`lb.${board}`] = "";
				return this.colldomains.updateOne({domain}, {$unset: delscore}, (err, result)=> {
					if (err != null) { return cb(err); }
					return cb(null, {done : 1});
			});
		});
	});
	}

	_calcOffset(key, user_id, order, page, count, cb){
		if (page === -1) { //centeredscore
			//console.log "---- centered"
			if (order === "hightolow") {
				return this.rc.zrevrank(key, user_id.toString(), (err, myrank)=> {
					//console.log "rank = #{myrank}"
					if (err != null) { return cb(err); }
					if (myrank == null) { return cb(new errors.MissingScore); }
					page = Math.floor(myrank/count)+1;
					//console.log "page = #{page}"
					const offset = (page-1)*count;
					return cb(null, offset, page);
				});
			} else {
				return this.rc.zrank(key, user_id.toString(), (err, myrank)=> {
					//console.log "rank = #{myrank}"
					if (err != null) { return cb(err); }
					if (myrank == null) { return cb(new errors.MissingScore); }
					page = Math.floor(myrank/count)+1;
					const offset = (page-1)*count;
					return cb(null, offset, page);
				});
			}
		} else {
			const offset = (page-1)*count;
			return cb(null, offset, page);
		}
	}

	// TODO remove param
	gethighscore(context, domain, user_id, board, page, count, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "user_id must be null or an ObjectID": (user_id === null) || check.objectid(user_id),
            "board must be string" : check.string(board),
            "callback must be a function": check.function(cb),
            "page must be a postive or -1 number": check.positive(page) || (page===-1),
            "count must be a postive": check.positive(count)
        }));

		return this.domainDefinition.findOne({domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=> {
			if (err != null) { return cb(err); }

			if (_domainDefinition == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards[board] == null) { return cb(new errors.MissingScore); }

			const {
                order
            } = _domainDefinition.leaderboards[board];

			const before = new Date();

			//console.log "board=#{board}, order=#{order}, type=#{type}, page=#{page}, count=#{count}"
			const key = `${domain}:leaderboards:${board}`;

			//TODO: handle the Redis reset ?

			return this._calcOffset(key, user_id, order, page, count, (err, offset, curpage)=> {
				if (err != null) { return cb(err); }

				//console.log "--- offset = #{offset}, page = #{page}"
				if (order === "hightolow") {
					return this.rc.zrevrangebyscore(key, "+inf", "-inf",'LIMIT', offset, count, (err, scores)=> {
						if (err != null) { return cb(err); }
						return this.rc.zrevrank(key, scores[0], (err, rank)=> {
							if (err != null) { return cb(err); }
							return this.rc.zcard(key, (err, card)=> {
								if (err != null) { return cb(err); }
								return this._describeScore(context, domain, board, scores, rank+1, card, curpage, count, cb);
							});
						});
					});
				} else {
					return this.rc.zrangebyscore(key, "-inf", "+inf",'LIMIT', offset, count, (err, scores)=> {
						if (err != null) { return cb(err); }
						return this.rc.zrank(key, scores[0], (err, rank)=> {
							if (err != null) { return cb(err); }
							return this.rc.zcard(key, (err, card)=> {
								if (err != null) { return cb(err); }
								return this._describeScore(context, domain, board, scores, rank+1, card, curpage, count, cb);
							});
						});
					});
				}
			});
		});
	}

	getfriendscore(context, domain, user_id, board, order, page, count, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "user_id must be an ObjectID": check.objectid(user_id),
            "board must be string" : check.string(board),
            "order must be string" : check.string(order),
            "callback must be a function": check.function(cb),
            "page must be a postive or -1 number": check.positive(page) || (page===-1),
            "count must be a postive": check.positive(count)
        }));

		const before = new Date();

		const resp = {};
		resp[board] = [];

		return this.domainDefinition.findOne({domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=> {
			if (err != null) { return cb(err); }

			if (_domainDefinition == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards[board] == null) { return cb(new errors.MissingScore); }

			({
                order
            } = _domainDefinition.leaderboards[board]);

			const field = {};
			field[`lb.${board}`] = 1;
			field["user_id"] = 1;
			const query =
				{domain};
			query[`lb.${board}.score`] = {"$exists" : true };
			query["$or"] = [{"relations.friends": user_id}, {user_id}];

			return this.colldomains.find( query, field ).toArray((err, userscores)=> {
				let cmd, each;
				if (err != null) { return cb(err); }
				if (userscores == null) { return cb(null , resp); }

				const key = `${domain}:leaderboards:${board}`;
				if (order === "hightolow") { cmd = "zrevrank"; } else { cmd = "zrank"; }				
				const list = [];
				for (each of Array.from(userscores)) { list.push([cmd, key, each.user_id.toString()]) ; }
				return this.rc.multi(list).exec((err, replies)=> {
					if (err != null) { return cb(err); }
					if (replies == null) { return cb(new errors.MissingScore); }
					for (let i = 0; i < userscores.length; i++) { each = userscores[i]; each.rank = replies[i]+1; }
					return this.xtralifeapi.social.addProfile(context, domain, userscores, "user_id")
					.then(function(scoreprofiles){
						//nicer response
						_.each(scoreprofiles, function(item, index){
							item.score = item.lb[board];
							item.gamer_id = item.user_id;
							delete item._id;
							delete item.lb;
							return delete item.user_id;
						});

						resp[board] = _.sortBy(scoreprofiles, item => item.rank);

						return cb(null, resp);}).catch(cb);
				});
			});
		});
	}


	getusersscore(domain, board, users, cb){
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "board must be string" : check.string(board),
            "callback must be a function": check.function(cb),
            "users must be an array": check.array(users)
        }));

		const before = new Date();

		const resp = {};
		resp[board] = [];

		return this.domainDefinition.findOne({domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=> {
			if (err != null) { return cb(err); }

			if (_domainDefinition == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards == null) { return cb(new errors.MissingScore); }
			if (_domainDefinition.leaderboards[board] == null) { return cb(new errors.MissingScore); }

			const {
                order
            } = _domainDefinition.leaderboards[board];

			const field = {};
			field[`lb.${board}`] = 1;
			field["user_id"] = 1;
			const query =
				{domain};
			query[`lb.${board}.score`] = {"$exists" : true };
			query["user_id"] = {"$in": users};

			return this.colldomains.find( query, field ).toArray((err, userscores)=> {
				let cmd, each;
				if (err != null) { return cb(err); }
				if (userscores == null) { return cb(null , resp); }

				const key = `${domain}:leaderboards:${board}`;
				if (order === "hightolow") { cmd = "zrevrank"; } else { cmd = "zrank"; }				
				const list = [];
				for (each of Array.from(userscores)) { list.push([cmd, key, each.user_id.toString()]) ; }
				return this.rc.multi(list).exec((err, replies)=> {
					if (err != null) { return cb(err); }
					if (replies == null) { return cb(new errors.MissingScore); }

					_.each(userscores, function(item, index){
						item.rank = replies[index]+1;
						item.score = item.lb[board];
						item.gamer_id = item.user_id;
						delete item._id;
						delete item.lb;
						return delete item.user_id;
					});

					resp[board] = _.sortBy(userscores, item => item.rank);

					return cb(null, resp);
				});
			});
		});
	}


	bestscores(domain, user_id, cb) {
		this.pre(check => ({
            "domain must be a valid domain": check.nonEmptyString(domain),
            "user_id must be an ObjectID": check.objectid(user_id)
        }));

		return this.colldomains.findOne({domain, user_id}, {projection:{lb: 1}}, (err, doc)=> {
			if (err != null) { return cb(err); }
			if ((doc != null ? doc.lb : undefined) == null) { return cb(null, {}); }

			return this.domainDefinition.findOne({domain}, {projection:{"leaderboards" : 1}}, (err, gamelb)=> {
				if (err != null) { return cb(err); }
				return async.forEach(Object.keys(doc.lb)
					, (board, localcb) => {
						const key = `${domain}:leaderboards:${board}`;
						if (__guard__(gamelb != null ? gamelb.leaderboards : undefined, x => x[board]) == null) { return localcb(null); }
						if (gamelb.leaderboards[board].order === "hightolow") {
							return this.rc.zrevrank(key, user_id.toString(), (err, rankh)=> {
								if (err != null) { return localcb(err); }
								doc.lb[board].order = "hightolow";
								doc.lb[board].rank = rankh+1;
								return localcb(null);
							});
						} else {
							return this.rc.zrank(key, user_id.toString(), (err, rankl)=> {
								if (err != null) { return localcb(err); }
								doc.lb[board].order = "lowtohigh";
								doc.lb[board].rank = rankl+1;
								return localcb(null);
							});
						}
					}
					, err => cb(err, doc.lb));
			});
		});
	}

	sandbox(context){
		return {
			score: (domain, user_id, board, order, value, info, force)=> {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.scoreAsync(domain, user_id, board, order, value, info, force);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			bestscores: (domain, user_id) => {
				const bestscoresAsync = Q.promisify(this.bestscores, {context: this});
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return bestscoresAsync(domain, user_id);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			usersscores: (domain, board, usersid) => {
				const usersscoresAsync = Q.promisify(this.getusersscore, {context: this});
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return usersscoresAsync(domain, board, usersid);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			highscore: (domain, user_id, board, count) => {
				const highscoreAsync = Q.promisify(this.gethighscore, {context: this});
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					let page = 1;
					if (user_id != null) { page = -1; }
					if (count > 100) { count = 100; }
					return highscoreAsync(context, domain, user_id, board, page, count);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			getrank : (domain, board, score) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					const getrankAsync = Q.promisify(this.getrank, {context: this});
					return getrankAsync(domain, board, score);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			deleteScore: (domain, user_id, board) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					const deleteScoreAsync = Q.promisify(this.deleteScore, {context: this});
					return deleteScoreAsync(domain, user_id, board);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			deleteLeaderboard: (domain, board) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					const deleteLeaderboardAsync = Q.promisify(this.deleteLeaderboard, {context: this});
					return deleteLeaderboardAsync(domain, board);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}
}

module.exports = new LeaderboardAPI();

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}