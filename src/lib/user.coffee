async = require "async"
extend = require 'extend'
rs = require "randomstring"

ObjectID = require("mongodb").ObjectID

facebook = require "./network/facebook.coffee"
google = require "./network/google.coffee"
errors = require "./../errors.coffee"
_ = require "underscore"

AbstractAPI = require "../AbstractAPI.coffee"

Q = require 'bluebird'
crypto = require 'crypto'

jwt = require 'jsonwebtoken'

class UserAPI extends AbstractAPI
	constructor: ()->
		super()

	# helpers
	collusers: ->
		@coll("users")
	
	colldomains: ->
		@coll("domains")

	configure: (@xtralifeapi, callback)->
		@domains = @coll('domains')

		logger.info "User initialized"
		callback null

	afterConfigure: (_xtralifeapi, cb)->
		cb()

	onDeleteUser: (userid, cb)->
		logger.debug "delete user #{userid} for user"
		cb null

	setProfile: (user, values, cb)->
		updated = {}
		needUpdate = false;
		for key of values
			if ["email", "displayName", "lang", "firstName", "lastName", "addr1", "addr2", "addr3", "avatar"].indexOf(key) != -1
				updated["profile.#{key}"] = values[key]
				user.profile[key] = values[key]
				needUpdate = true

		if needUpdate
			@collusers().update {_id : user._id} , {$set : updated}, (err, result)=>
				cb err, { done : result.result.n, profile : user.profile }
		else
			cb null, {done : 0}

	updateProfile: (user_id, profile, cb)->
		@collusers().update {_id : user_id} , {$set : {profile: profile}}, (err, result)=>
			cb err, { done : result.result.n, profile : profile }

	getProfile: (user, cb)->
		cb null, user.profile

	updateProfileAsync: (user_id, profile)->
		updated = {}
		for key of profile
			if ["email", "displayName", "lang", "firstName", "lastName", "addr1", "addr2", "addr3", "avatar"].indexOf(key) != -1
				updated["profile.#{key}"] = profile[key]

		@collusers().update {_id : user_id} , {$set : updated}
		.then (res)=>
			res.result

	_checktype: (value)->
		switch typeof value
			when "number", "string", "boolean"
				return null
			when "object"
				return new errors.BadPropertyType unless Array.isArray value
				for elem in value 
					return new errors.BadPropertyType if typeof(elem) not in ["number", "string", "boolean"]
		return null

	read: (context, domain, user_id, key)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			#"key may be a unempty string": check.maybe.nonEmptyString(key)

		@handleHook "before-properties-read", context, domain,
			domain: domain
			user_id: user_id
			key: key
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			field = {}
			field[unless key? then 'properties' else "properties.#{key}"] = 1

			@domains.findOne query, field
			.then (value)=>
				@handleHook "after-properties-read", context, domain,
					domain: domain
					user_id: user_id
					key: key
					value: value
				.then (afterData)->
					if value? and value.properties? then value.properties else {}

	write: (context, domain, user_id, key, value)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			#"key may be a unempty string": check.maybe.nonEmptyString(key)

		if key?
			return throw new errors.MissingPropertyValue unless value?
			err = @_checktype value
			return throw err if err?
		else
			for k, v of value
				err = @_checktype v
				return throw err if err?

		@handleHook "before-properties-write", context, domain,
			domain: domain
			user_id: user_id
			key: key
			value: value
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			set = {}
			set[unless key? then 'properties' else "properties.#{key}"] = value

			@domains.update query, {$set: set}, { upsert: true }

		.then (result)=>
			@handleHook "after-properties-write", context, domain,
				domain: domain
				user_id: user_id
				key: key
				value: value
			.then (afterData)->
				result.result.n

	delete: (context, domain, user_id, key)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"key may be a unempty string": check.maybe.nonEmptyString(key)

		@handleHook "before-properties-delete", context, domain,
			domain: domain
			user_id: user_id
			key: key
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			unset = {}
			unset[unless key? then 'properties' else "properties.#{key}"] = ""

			@domains.update query, {$unset: unset}, {upsert: true}
			.then (result)=>
				@handleHook "after-properties-delete", context, domain,
					domain: domain
					user_id: user_id
					key: key
				.then (afterData)->
					result.result.n

	nuke: (context, gamer_id)=>
		appid = context.game.appid
		@collusers().findOne({_id: gamer_id, "game.appid": appid})
		.then player =>
			new Q (resolve, reject)=>
				if player?
					@xtralifeapi.onDeleteUser player._id, (err)=>
						if err? then reject err
						else resolve {nuked: true, dead: 'probably'}
					, appid
				else
					reject new Error("Player not found")

	# Deprecated since 2.11
	# use indexing API instead
	matchProperties: (context, domain, user_id, query, cb)->
		throw new Error("Deprecated since 2.11")

	sha_passwd: (passwd)->
		unless xlenv.privateKey? then throw new Error("null privatekey")
		sha = crypto.createHash('sha1')
		sha.update(xlenv.privateKey + passwd)
		sha.digest('hex')

	sandbox: (context)->
		account:
			nuke: (user_id)=>
				@nuke context, user_id

			# conversionOptions can contain updatedGamer to return the updated gamer instead of just one (in case of success).
			convert: (user_id, network, token, options, conversionOptions)=>
				conversionPromise =
					switch network.toLowerCase()
						when "facebook" then @xtralifeapi.connect.convertAccountToFacebook user_id, token
						when "googleplus" then @xtralifeapi.connect.convertAccountToGooglePlus user_id, token
						when "gamecenter" then @xtralifeapi.connect.convertAccountToGameCenter user_id, token, options
						when "email" then @xtralifeapi.connect.convertAccountToEmail user_id, token, @sha_passwd(options)
						else throw new errors.BadArgument("Unknown network to convert to")

				# Returns the updated gamer as well
				if not conversionOptions?.updatedGamer
					# Return an old style document with just one
					conversionPromise.then (result)-> 1
				else
					conversionPromise

			changeEmail: (user_id, email)=>
				changeAsync = Q.promisify @xtralifeapi.connect.changeEmail, context: @xtralifeapi.connect
				changeAsync(user_id, email)

			getJWToken: (user_id, domain, secret, payload, expiresIn="2m" ) =>
				if not @xtralifeapi.game.checkDomainSync context.game.appid, domain
					throw new errors.BadArgument("Your game doesn't have access to this domain")

				key = crypto.createHash('sha256').update(secret + domain).digest('hex')

				return jwt.sign {user_id: user_id.toString(), domain: domain, payload: payload}, key, {expiresIn, issuer: "xtralife-api", subject: "auth"}

		profile:
			read:  (user_id, included)=>
				fields = {}
				if included?
					fields[i] = 1 for i in included
				@xtralifeapi.connect.readProfileAsync user_id, fields

			write: (user_id, fields)=>
				@updateProfileAsync user_id, fields

		properties:
			read: (domain, user_id, key)=>
				if @xtralifeapi.game.checkDomainSync context.game.appid, domain
					@read context, domain, user_id, key
				else
					throw new errors.BadArgument("Your game doesn't have access to this domain")

			write: (domain, user_id, key, value)=>
				if @xtralifeapi.game.checkDomainSync context.game.appid, domain
					@write context, domain, user_id, key, value
				else
					throw new errors.BadArgument("Your game doesn't have access to this domain")

			delete: (domain, user_id, key)=>
				if @xtralifeapi.game.checkDomainSync context.game.appid, domain
					@delete context, domain, user_id, key
				else
					throw new errors.BadArgument("Your game doesn't have access to this domain")

		relations:
			friends: (domain, user_id)=>
				if @xtralifeapi.game.checkDomainSync context.game.appid, domain
					@xtralifeapi.social.getFriendsAsync context, domain, user_id
				else
					throw new errors.BadArgument("Your game doesn't have access to this domain")


# BACKOFFICE ###########################################################################

	list: (options, cb)->
		filter =
			games:
				"$elemMatch" :
					appid : options.game
		if options.id? then filter._id = options.id

		@collusers().count filter , (err, count)=>
			return cb err if err?
			@collusers().find( filter,
				skip : options.skip
				limit: options.limit
				fields :
					password : 0
					networksecret : 0
			).toArray (err, docs)->
				cb err, count, docs

	search: (appId, q, skip, limit, cb)->
		query = {$or: [{'profile.displayName': {$regex: "#{q}", $options: 'i'}},{'profile.email': {$regex: "#{q}", $options: 'i'}}]}
		query.games = {$elemMatch: {appid: appId}}

		cursor = @collusers().find query,
			limit: limit
			skip: skip
			fields:
				password : 0
				networksecret : 0
		cursor.count (err, count)->
			cursor.toArray (err, docs)->
				cb err, count, docs

module.exports = new UserAPI()
