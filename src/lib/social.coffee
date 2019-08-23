

async = require "async"
extend = require 'extend'
rs = require "randomstring"
moment = require 'moment'
_ = require "underscore"
Q = require 'bluebird'

ObjectID = require("mongodb").ObjectID

facebook = require "./network/facebook.coffee"
google = require "./network/google.coffee"
errors = require "./../errors.coffee"

AbstractAPI = require "../AbstractAPI.coffee"

class SocialAPI extends AbstractAPI
	constructor: ()->
		super()

	# helpers
	collusers: ->

	configure: (@xtralifeapi, callback)->
		@colldomains = @coll('domains')
		@collusers = @coll('users')
		
		@getFriendsAsync = Q.promisify this.getFriends

		if xlenv.options.removeUser
			return async.parallel [
				(cb)=>
					@colldomains.createIndex {"relations.friends":1}, cb
				(cb)=>
					@colldomains.createIndex {"relations.blacklist":1}, cb
				(cb)=>
					@colldomains.createIndex {godchildren:1}, cb
				(cb)=>
					@colldomains.createIndex {godfather:1}, cb
			], (err)->
				if err? then return callback(err)
				logger.info "Social initialized"
				callback null
		else
			logger.info "Social initialized"
			callback null

	configureGame: (appid, callback)->
		callback()

	# Called when a user is deleted, to optionally provide some cleanup
	# remove common data
	onDeleteUser: (userid, cb)->
		logger.debug "delete user #{userid} for social"
		# remove references to user ALL DOMAINS affected !
		@colldomains.updateMany {"relations.friends" : userid}, {$pull: {"relations.friends" : userid}}, (err)=>
			if err? then return cb err
			@colldomains.updateMany {"relations.blacklist" : userid}, {$pull: {"relations.blacklist" : userid}}, (err)=>
				if err? then return cb err
				@colldomains.updateMany {"relations.godchildren" : userid}, {$pull: {"relations.godchildren" : userid}}, (err)=>
					if err? then return cb err
					@colldomains.updateMany {"relations.godfather" : userid}, {$unset: {"relations.godfather" : null}}, (err)=>
						if err? then return cb err
						cb null

	addProfile : (context, domain, users, key)->
		ids = _.pluck users, key

		cursor = @collusers.find { _id : { $in : ids } }, {profile: 1}
		cursor.toArray().then (profiles)=>
			return users unless profiles?

			profiles = _.indexBy profiles, '_id'
			_.each users, (item, index)->
				p = profiles[item[key]]
				users[index].profile = p.profile if p?.profile?	
			users
		.then (profiledUsers)=>
			profids = _.pluck profiledUsers, key
			@handleHook "social-addprofile", context, domain,
				domain: domain
				users : profiledUsers
				userids: profids
			.then (afterData)->
				users

	describeUsersListBase: (ids)->
		cursor = @collusers.find { _id : { $in : ids } }, {profile: 1}

		cursor.toArray().then (users)=>
			return [] unless users?
			return ({gamer_id: user._id, profile: user.profile} for user in users when user?) # when user? is a sanity check

	describeUsersList : (context, domain, ids, cb)->
		users = _.map ids, (item)->
			{gamer_id : item}
		@addProfile context, domain, users, "gamer_id"
		.then (profiles)=>
			cb null, profiles
		.catch cb

	_indexOfId: (ids, id0) ->
		i = 0
		while i < ids.length
			return i if ids[i].equals(id0)
			i++
		-1

	getGodfather : (context, domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, user_id : user_id}, {projection:{"relations.godfather":1}},  (err, doc)=>
			return cb err if err?
			#return cb new errors.gamerDoesntHaveGodfather unless doc?.godfather?
			return cb null, null unless doc?.relations?.godfather?
			@describeUsersList context, domain, [doc.relations.godfather], (err, arr)=>
				cb err, arr[0]

	setGodfather : (context, domain, user_id, godfather, options, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, "relations.godfatherCode" : godfather} , (err, user)=>
			return cb err if err?
			return cb new errors.unknownGodfatherCode unless user?
			return cb new errors.cantBeSelfGodchild if user.user_id.toString() == user_id.toString()

			@collusers.findOne {_id : user_id}, {projection:{games : 1, profile: 1}} , (err, usergames)=>
				return cb err if err?

				@colldomains.findOne {domain: domain, user_id : user_id}, {projection:{"relations.godfather":1}},  (err, doc)=>
					return cb err if err?
					return cb new errors.alreadyGodchild if doc?.relations?.godfather?

					@handleHook "setGodfather-override-reward", context, domain,
						domain: domain
						godfather : user.user_id
						godchild : user_id
						reward : options.reward
					.then (afterData)=>
						logger.debug afterData
						if afterData?.accepted == false then return cb new errors.SponsorshipRefusedByHook
						# sponsoring is acceted or there is no hook !
						reward = afterData?.reward or options.reward
						logger.debug reward
						@colldomains.updateOne {domain: domain, user_id : user_id} , { $set : { "relations.godfather" : user.user_id}}, {upsert : true}, (err, result)=>
							return cb err if err?
							@colldomains.updateOne {domain: domain, user_id : user.user_id} , { $addToSet : { "relations.godchildren" : user_id}} , {upsert : true}, (err, result)=>
								return cb err if err?
								if reward? and reward.transaction?
									@xtralifeapi.transaction.transaction context, domain, user.user_id, reward.transaction, reward.description
									.spread (balance, achievements)=>
										if result.result.n == 1
											message = 
												type : "godchildren"
												event :
													godchildren : { gamer_id : user_id, profile : usergames.profile}
													reward : { balance: balance, achievements: achievements }
											message.osn = options.osn if options.osn?
											if @xtralifeapi.game.hasListener(domain) then xlenv.broker.send domain, user.user_id.toString(), message
										return 	cb null, result.result.n
									.catch cb
									.done()
								else
									cb err, result.result.n
									if result.result.n == 1
										message = 
											type : "godchildren"
											event :
												godchildren : { gamer_id : user_id, profile : usergames.profile}
										message.osn = options.osn if options.osn?
										if @xtralifeapi.game.hasListener(domain) then xlenv.broker.send domain, user.user_id.toString(), message
									return
					.catch cb

	godfatherCode : (domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, user_id : user_id}, {projection:{"relations.godfatherCode":1}},  (err, doc)=>
			return cb err if err?
			return cb null, doc.relations.godfatherCode if doc?.relations?.godfatherCode?

			code = rs.generate(8)
			@colldomains.updateOne {domain: domain, user_id : user_id} , {$set : { "relations.godfatherCode" : code}}, {upsert : true}, (err, result)=>
				#console.log err
				return cb err, code

	getGodchildren : (context, domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, user_id : user_id}, {projection:{"relations.godchildren":1}},  (err, doc)=>
			return cb err if err?
			return cb null, [] unless doc?.relations?.godchildren?
			@describeUsersList context, domain, doc.relations.godchildren, cb


	getFriends: (context, domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, user_id : user_id} , {projection:{ "relations.friends" : 1}},  (err, user)=>
			return cb err if err?
			return cb null, [] unless user?.relations?.friends?
			@describeUsersList context, domain, user.relations.friends, cb

	getBlacklistedUsers: (context, domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@colldomains.findOne {domain: domain, user_id : user_id} , {projection:{"relations.blacklist" : 1 }}, (err, user)=>
			return cb err if err?
			return cb null, [] unless user?.relations?.blacklist?
			@describeUsersList context, domain, user.relations.blacklist, cb

	_setStatus: (domain, user_id, friend_id, status, cb)->
		switch status
			when "add"
				@colldomains.findOne {domain: domain, user_id : user_id, "relations.blacklist" : friend_id }, {projection:{user_id : 1}}, (err, blacklisted)=>
					return cb err if err?
					if blacklisted? then return cb null, {done : 0} 
					@colldomains.updateOne {domain: domain, user_id : user_id} , {$addToSet : { "relations.friends" : friend_id} }, {upsert : true}, (err, result)=>
						return cb err, {done : result.result.n}

			when "forget"
				# TODO a single update can pull from both friends and blacklist at once
				# it will change the semantics of the return value...
				@colldomains.updateOne {domain: domain, user_id : user_id} , {$pull : { "relations.blacklist" : friend_id} }, {upsert : true}, (err, result)=>
					return cb err if err?
					@colldomains.updateOne {domain: domain, user_id : user_id} , {$pull : { "relations.friends" : friend_id} }, {upsert : true}, (err, other)=>
						return cb err, {done : result.result.n || other.result.n}
				
			when "blacklist"
				# TODO a single update can add/pull from both friends and blacklist at once
				# it will change the semantics of the return value...
				@colldomains.updateOne {domain: domain, user_id : user_id} , {$addToSet : { "relations.blacklist" : friend_id} }, {upsert : true}, (err, result)=>
					return cb err if err?
					@colldomains.updateOne {domain: domain, user_id : user_id} , {$pull : { "relations.friends" : friend_id} }, {upsert : true}, (err, other)=>
						return cb err, {done : result.result.n}

	setFriendStatus: (domain, user_id, friend_id, status, osn, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@_setStatus domain, user_id, friend_id, status, (err, res)=>
			return cb err if err?
			@_setStatus domain,friend_id, user_id, status, (err, res)=>
				return cb err if err?
				message = 
					type : "friend.#{status}"
					event :
						friend : user_id
				message.osn = osn if osn?
				if @xtralifeapi.game.hasListener(domain) then xlenv.broker.send domain, friend_id.toString(), message

				cb null, res

	getNetworkUsers: (game, domain, user_id, network, friends_initial, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		check = @identity
		options = {}
		if network=="facebook" 
			options = game.config.socialSettings
			check = facebook.validFriendsIDs
		check friends_initial, options, (err, friends)=>
			return cb err if err?
			query = {"network": network, "networkid" : {"$in" : Object.keys(friends)} }
			@collusers.find(query).toArray (err, doc)=>
				@colldomains.findOne {domain: domain, user_id : user_id} , {projection:{ relations : 1}},  (err, r)=>
					return cb err if err?
					for f in doc
						f.relation = "friend" if r?.relations?.friends? && @_indexOfId(r.relations.friends, f._id)!=-1 
						f.relation = "blacklisted" if r?.relations?.blacklisted? && @_indexOfId(r.relations.blacklisted, f._id)!=-1
						friends[f.networkid].clan = _.omit(f, ["networksecret", "devices"])
					friends = _.indexBy friends, "id" if network=="facebook"
					return cb null, friends

	identity: (friends, options, cb)->
		cb null, friends

	getNetworkUsersAndMatch: (game, domain, user_id, network, config, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"body should contains key 'friends'": check.object(config.friends)

		friends_initial = config.friends
		check = @identity
		options = {}
		if network=="facebook" 
			options = game.config.socialSettings
			check = facebook.validFriendsIDs
		check friends_initial, options, (err, friends)=>
			return cb err if err?
			#console.log "-------------- friends :"
			#console.log friends
			query1 = {"network": network, "networkid" : {"$in" : Object.keys(friends)} }
			query2 = {"links.#{network}" : {"$in" : Object.keys(friends)} }
			query = { "$or" : [query1, query2] } 
			@collusers.find(query).toArray (err, doc)=>
				return cb err if err?
				@colldomains.findOne {domain: domain, user_id : user_id} , {projection:{ relations : 1}},  (err, r)=>
					return cb err if err?
					#console.log "-------------- doc :"
					#console.log doc
					for f in doc
						f.relation = "friend" if r?.relations?.friends? && @_indexOfId(r.relations.friends, f._id)!=-1 
						f.relation = "blacklisted" if r?.relations?.blacklisted? && @_indexOfId(r.relations.blacklisted, f._id)!=-1
						if config.automatching == true and f.relation is undefined
							console.log "adding friend !"
							f.relation = "new friend"
							@setFriendStatus domain, user_id, f._id, "add", {}, (err)->
								logger.debug "automatching : #{user_id} became friend of #{f._id}."
						if friends[f.networkid]?
							friends[f.networkid].clan = _.omit(f, ["networksecret", "devices"])
						else if friends[f.links[network]]?
							friends[f.links[network]].clan = _.omit(f, ["networksecret", "devices"])
					friends = _.indexBy friends, "id" if network=="facebook"
					return cb null, friends


module.exports = new SocialAPI()
