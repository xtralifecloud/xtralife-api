async = require "async"
extend = require('util')._extend
ObjectID = require('mongodb').ObjectID
_ = require "underscore"

AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"

Q = require "bluebird"

class LeaderboardAPI extends AbstractAPI
	constructor: ()->
		super()
		@rc = null

	configure: (@xtralifeapi, callback)->
		@domainDefinition = @coll 'domainDefinition'
		@colldomains = @coll('domains')
		@scoreAsync = Q.promisify this.score, context: this

		async.parallel [
			(cb)=>
				@domainDefinition.createIndex {domain:1}, {unique: true}, cb
			(cb)=>
				xlenv.inject ["=redisClient"], (err, @rc)=>
					return cb err if err?
					cb null

		], (err)->
			return callback err if err?
			logger.info "Leaderboard initialized"
			callback()

	afterConfigure: (_xtralifeapi, cb)->
		cb()

	configureGame: (appid, callback)->
		callback null

	onDeleteUser: (userid, cb)->
		logger.debug "delete user #{userid.toString()} for leaderboard"
		@colldomains.find({user_id : userid, lb: { "$exists" : true}}, {domain: 1, lb: 1}).toArray (err, docs)=>
			unless docs? then return cb err
			return cb err if err?
			async.forEach docs, (item, localcb) =>
				async.forEach Object.keys(item.lb), (board, innercb) =>
					key = "#{item.domain}:leaderboards:#{board}"
					@rc.zrem key, userid.toString(), (err, out)=>
						logger.warn "delete lb.#{board} for user #{userid.toString()} : #{out}, #{err} "
						innercb err
				, (err)->
					localcb err
			, (err)->
				cb err


	_describeScore: (context, domain, board, scores, rank, card, page, count, cb)->
		before = new Date()

		list = _.map scores, (item)->
			new ObjectID(item)

		query = 
			domain: domain
			user_id : { $in : list }
		query["lb.#{board}.score"] = {"$exists" : true }

		fields =
			user_id : 1
		fields["lb.#{board}"] = 1

		@colldomains.find( query , {projection:fields} ).toArray (err, userscores)=>
			return cb err if err?
			return cb null , [] unless userscores?

			@xtralifeapi.social.addProfile context, domain, userscores, "user_id"
			.then (scoreprofiles)->

				orderscores = []

				scoreprofiles = _.indexBy scoreprofiles, (item)->
					item.user_id

				_.each scores, (user)->
					item = scoreprofiles[user]
					if item? and item.lb? # sanity check
						gamer = 
							score : item.lb[board]
							gamer_id : item.user_id
							profile : item.profile
						orderscores.push gamer

				result = {}
				result[board] =
					maxpage : Math.ceil(card/count)
					page : page
					rankOfFirst : rank
					scores : orderscores


				cb null, result
			.catch cb


	_getRank : (key, score, order, cb)->
		rank = undefined
		if order == "hightolow"
			@rc.zrevrangebyscore [key, score, "-inf", "WITHSCORES", "LIMIT", 0, 1], (err, replies)=>
				return cb err if err?
				if replies.length==0
					@rc.zcard key, (err, rank)=>
						return cb err, ++rank
				else
					@rc.zrevrank key, replies[0], (err, rank)=>
						cb err, ++rank
		else
			@rc.zrangebyscore [key, "-inf", score, "WITHSCORES", "LIMIT", 0, 1], (err, replies)=>
				return cb err if err?
				if replies.length==0
					@rc.zcard key, (err, rank)=>
						return cb err, ++rank
				else
					@rc.zrank key, replies[0], (err, rank)=>
						cb err, ++rank

	score: (domain, user_id, board, order, score, info, force, cb)->
		order = order.toLowerCase()
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"board must be string" : check.string(board)
			"order must be string" : check.string(order) and (order is 'hightolow' or order is 'lowtohigh')
			"score must be number" : check.number(score)
			"info must be string or null" : check.maybe.string(info)
			"force must be boolean" : check.boolean(force)
			"callback must be a function": check.function(cb)

		set = {}
		set["leaderboards.#{board}"] = { order : order }

		# we should really cache this, to avoid writing each time... except if mongodb skips the write already
		# it does grow the oplog with no reason, make replication slower, cause SSD access, etc...
		@domainDefinition.updateOne {domain: domain}, {$set: set}, {upsert: true}, (err, result)=>
			return cb err if err?

			newscore = {}
			newscore["lb.#{board}"] =
				timestamp : new Date()
				score : score
				info : info
			
			query =
				domain: domain
				user_id : user_id

			field = {}
			field["lb.#{board}"] = 1

			#console.log "board=#{board}, order=#{order}, score=#{score}, info=#{info}"
			@colldomains.findOne query, {projection:field}, (err, doc)=>
				return cb err if err?
				if (not force) and (doc?.lb?[board]?.score? and ((order == "hightolow" && doc.lb[board].score >= score) or (order == "lowtohigh" && doc.lb[board].score <= score)))
					key = "#{domain}:leaderboards:#{board}"
					@_getRank key, score, order, (err, rank)=>
						return cb null, { done : 0, msg: "this is not the highest score", rank: rank} 
				else
					@colldomains.updateOne query, {$set: newscore}, { upsert : true }, (err, doc)=>
						return cb err if err?
						key = "#{domain}:leaderboards:#{board}"
						@rc.zadd key, score, user_id.toString(), (err, out)=>
							return cb err if err?
							if order == "hightolow"
								@rc.zrevrank key, user_id.toString(), (err, rank)=>
									rank++
									cb err, {done: 1, rank}
							else
								@rc.zrank key, user_id.toString(), (err, rank)=>
									rank++
									cb err, {done : 1, rank}

	getrank : (domain, board, score, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"board must be string" : check.string(board)
			"score must be number" : check.number(score)
			"callback must be a function": check.function(cb)

		@domainDefinition.findOne {domain: domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=>
			return cb err if err?

			return cb new errors.MissingScore unless _domainDefinition?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards[board]?

			order = _domainDefinition.leaderboards[board].order

			key = "#{domain}:leaderboards:#{board}"
			@_getRank key, score, order, cb


	deleteScore: (domain, user_id, board, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"board must be string" : check.string(board)
			"callback must be a function": check.function(cb)

		delscore = {}
		delscore["lb.#{board}"] = ""

		@colldomains.updateOne {domain: domain, user_id : user_id}, {$unset: delscore},{ upsert : true }, (err, doc)=>
			return cb err if err?
			key = "#{domain}:leaderboards:#{board}"
			@rc.zrem key, user_id.toString(), (err, out)=>
				cb err, {done : out==1}

	rebuild: (domain, board, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"board must be string" : check.string(board)
			"callback must be a function": check.function(cb)

		key = "#{domain}:leaderboards:#{board}"
		@rc.del key, (err, out)=>
			return cb err if err?
			field = {user_id: 1}
			field["lb.#{board}"] = 1
			query = {domain: domain}
			query["lb.#{board}"] = {"$exists":true}
			count=0;
			@colldomains.find(query, field).each (merr, user)=>
				if merr? then logger.error merr.message, {stack: merr.stack}
				return cb null, { "done" : count } unless user?
				count++
				@rc.zadd key, user.lb[board].score, user.user_id.toString(), (rerr, out)=>
					if rerr? then logger.error rerr.message, {stack: rerr.stack}

	deleteLeaderboard: (domain, board, cb)->
		# 1) Remove the key associated with the board from redis
		key = "#{domain}:leaderboards:#{board}"
		@rc.del key, (err, out)=>
			return cb err if err?

			# 2) Remove the board from the game
			deldomain = {}
			deldomain["leaderboards.#{board}"] = ""
			@domainDefinition.updateMany {domain: domain}, {$unset: deldomain}, (err, result)=>
				return cb err if err?

				# 3) Remove the board from all players
				delscore = {}
				delscore["lb.#{board}"] = ""
				@colldomains.updateOne {domain: domain}, {$unset: delscore}, (err, result)=>
					return cb err if err?
					cb null, {done : 1}

	_calcOffset: (key, user_id, order, page, count, cb)->
		if page == -1 #centeredscore
			#console.log "---- centered"
			if order == "hightolow"
				@rc.zrevrank key, user_id.toString(), (err, myrank)=>
					#console.log "rank = #{myrank}"
					return cb err if err?
					return cb new errors.MissingScore unless myrank?
					page = Math.floor(myrank/count)+1
					#console.log "page = #{page}"
					offset = (page-1)*count
					cb  null, offset, page
			else
				@rc.zrank key, user_id.toString(), (err, myrank)=>
					#console.log "rank = #{myrank}"
					return cb err if err?
					return cb new errors.MissingScore unless myrank?
					page = Math.floor(myrank/count)+1
					offset = (page-1)*count
					cb  null, offset, page
		else
			offset = (page-1)*count
			cb null, offset, page

	# TODO remove param
	gethighscore: (context, domain, user_id, board, page, count, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be null or an ObjectID": user_id is null or check.objectid(user_id)
			"board must be string" : check.string(board)
			"callback must be a function": check.function(cb)
			"page must be a postive or -1 number": check.positive(page) or page==-1
			"count must be a postive": check.positive(count)

		@domainDefinition.findOne {domain: domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=>
			return cb err if err?

			return cb new errors.MissingScore unless _domainDefinition?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards[board]?

			order = _domainDefinition.leaderboards[board].order

			before = new Date()

			#console.log "board=#{board}, order=#{order}, type=#{type}, page=#{page}, count=#{count}"
			key = "#{domain}:leaderboards:#{board}"

			#TODO: handle the Redis reset ?

			@_calcOffset key, user_id, order, page, count, (err, offset, curpage)=>
				return cb err if err?

				#console.log "--- offset = #{offset}, page = #{page}"
				if order == "hightolow"
					@rc.zrevrangebyscore key, "+inf", "-inf",'LIMIT', offset, count, (err, scores)=>
						return cb err if err?
						@rc.zrevrank key, scores[0], (err, rank)=>
							return cb err if err?
							@rc.zcard key, (err, card)=>
								return cb err if err?
								@_describeScore context, domain, board, scores, rank+1, card, curpage, count, cb
				else
					@rc.zrangebyscore key, "-inf", "+inf",'LIMIT', offset, count, (err, scores)=>
						return cb err if err?
						@rc.zrank key, scores[0], (err, rank)=>
							return cb err if err?
							@rc.zcard key, (err, card)=>
								return cb err if err?
								@_describeScore context, domain, board, scores, rank+1, card, curpage, count, cb

	getfriendscore: (context, domain, user_id, board, order, page, count, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"board must be string" : check.string(board)
			"order must be string" : check.string(order)
			"callback must be a function": check.function(cb)
			"page must be a postive or -1 number": check.positive(page) or page==-1
			"count must be a postive": check.positive(count)

		before = new Date()

		resp = {}
		resp[board] = []

		@domainDefinition.findOne {domain: domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=>
			return cb err if err?

			return cb new errors.MissingScore unless _domainDefinition?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards[board]?

			order = _domainDefinition.leaderboards[board].order

			field = {}
			field["lb.#{board}"] = 1
			field["user_id"] = 1
			query =
				domain: domain
			query["lb.#{board}.score"] = {"$exists" : true }
			query["$or"] = [{"relations.friends": user_id}, {user_id: user_id}]

			@colldomains.find( query, field ).toArray (err, userscores)=>
				return cb err if err?
				return cb null , resp unless userscores?

				key = "#{domain}:leaderboards:#{board}"
				if order == "hightolow" then cmd = "zrevrank" else cmd = "zrank"				
				list = []
				(list.push [cmd, key, each.user_id.toString()] ) for each in userscores
				@rc.multi(list).exec (err, replies)=>
					return cb err if err?
					return cb new errors.MissingScore unless replies?
					(each.rank = replies[i]+1) for each, i in userscores
					@xtralifeapi.social.addProfile context, domain, userscores, "user_id"
					.then (scoreprofiles)->
						#nicer response
						_.each scoreprofiles, (item, index)->
							item.score = item.lb[board]
							item.gamer_id = item.user_id
							delete item._id
							delete item.lb
							delete item.user_id

						resp[board] = _.sortBy scoreprofiles, (item)->
							item.rank

						cb null, resp
					.catch cb


	getusersscore: (domain, board, users, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"board must be string" : check.string(board)
			"callback must be a function": check.function(cb)
			"users must be an array": check.array(users)

		before = new Date()

		resp = {}
		resp[board] = []

		@domainDefinition.findOne {domain: domain}, {projection:{"leaderboards" : 1}}, (err, _domainDefinition)=>
			return cb err if err?

			return cb new errors.MissingScore unless _domainDefinition?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards?
			return cb new errors.MissingScore unless _domainDefinition.leaderboards[board]?

			order = _domainDefinition.leaderboards[board].order

			field = {}
			field["lb.#{board}"] = 1
			field["user_id"] = 1
			query =
				domain: domain
			query["lb.#{board}.score"] = {"$exists" : true }
			query["user_id"] = {"$in": users}

			@colldomains.find( query, field ).toArray (err, userscores)=>
				return cb err if err?
				return cb null , resp unless userscores?

				key = "#{domain}:leaderboards:#{board}"
				if order == "hightolow" then cmd = "zrevrank" else cmd = "zrank"				
				list = []
				(list.push [cmd, key, each.user_id.toString()] ) for each in userscores
				@rc.multi(list).exec (err, replies)=>
					return cb err if err?
					return cb new errors.MissingScore unless replies?

					_.each userscores, (item, index)->
						item.rank = replies[index]+1
						item.score = item.lb[board]
						item.gamer_id = item.user_id
						delete item._id
						delete item.lb
						delete item.user_id

					resp[board] = _.sortBy userscores, (item)->
						item.rank

					cb null, resp


	bestscores: (domain, user_id, cb) ->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		@colldomains.findOne {domain: domain, user_id : user_id}, {projection:{lb: 1}}, (err, doc)=>
			return cb err if err?
			return cb null, {} unless doc?.lb?

			@domainDefinition.findOne {domain: domain}, {projection:{"leaderboards" : 1}}, (err, gamelb)=>
				return cb err if err?
				async.forEach Object.keys(doc.lb)
					, (board, localcb) =>
						key = "#{domain}:leaderboards:#{board}"
						return localcb null unless gamelb?.leaderboards?[board]?
						if (gamelb.leaderboards[board].order == "hightolow")
							@rc.zrevrank key, user_id.toString(), (err, rankh)=>
								return localcb err if err?
								doc.lb[board].order = "hightolow"
								doc.lb[board].rank = rankh+1
								localcb null
						else
							@rc.zrank key, user_id.toString(), (err, rankl)=>
								return localcb err if err?
								doc.lb[board].order = "lowtohigh"
								doc.lb[board].rank = rankl+1
								localcb null
					, (err) ->
						cb err, doc.lb

	sandbox: (context)->
		score: (domain, user_id, board, order, value, info, force)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@scoreAsync domain, user_id, board, order, value, info, force
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		bestscores: (domain, user_id) =>
			bestscoresAsync = Q.promisify(@bestscores, context: @)
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				bestscoresAsync domain, user_id
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		usersscores: (domain, board, usersid) =>
			usersscoresAsync = Q.promisify(@getusersscore, context: @)
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				usersscoresAsync domain, board, usersid
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		highscore: (domain, user_id, board, count) =>
			highscoreAsync = Q.promisify(@gethighscore, context: @)
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				page = 1
				if user_id? then page = -1
				if count > 100 then count = 100
				highscoreAsync context, domain, user_id, board, page, count
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")


module.exports = new LeaderboardAPI()
