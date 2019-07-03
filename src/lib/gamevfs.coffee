async = require "async"
extend = require('util')._extend
api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID

Q = require 'bluebird'

class GameVFSAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@parent, callback)->

		@domains = @coll 'gamevfs'
		@readAsync = Q.promisify this.read, context: this
		@writeAsync = Q.promisify this.write, context: this

		@domains.ensureIndex {domain:1}, (err)->
			if err? then return callback err
			logger.info "Gamevfs initialized"
			callback err, {}

	# remove common data
	onDeleteUser: (user_id, cb)->
		logger.debug "delete user #{user_id} for gamevfs"
		cb null

	read: (domain, key, callback)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"key may be an unempty string or array": check.maybe.nonEmptyString(key) or key instanceof Array

		query =
			domain: domain

		field = {}
		if key instanceof Array
			field["fs.#{each}"] = 1 for each in key
		else
			field[unless key? then 'fs' else "fs.#{key}"] = 1

		@domains.findOne query, field , (err, value)=>
			return callback err if err?
			callback null, (if value? and value.fs? then value.fs else {})

	write: (domain, key, value, callback)->
		unless callback? then callback = value
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		query =
			domain: domain

		set = {}
		if key == null
			set['fs'] = value
		else if typeof key is 'string'
			set["fs.#{key}"] = value
		else
			set["fs.#{k}"] = value for k, value of key

		@domains.update query, {$set: set}, { upsert: true }, (err, result)=>
			return callback err if err?
			callback null, result.result.n

	delete: (domain, key, callback)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		query =
			domain: domain

		unset = {}
		unset[unless key? then 'fs' else "fs.#{key}"] = ""
		@domains.update query, {$unset: unset}, (err, result)=>
			return callback err if err?

			callback null, result.result.n

	incr: (context, domain, key, amount=1)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"key must be a string": check.nonEmptyString(key)

		query =
			domain: domain

		field = {"fs.#{key}" : 1}
		update = {"$inc" : {"fs.#{key}": amount} }

		@domains.findOneAndUpdate query, update, {returnOriginal: false, projection: field}
		.then (results)=>
			results.value.fs

	createSignedURL: (domain, key, contentType=null, callback)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		unless callback?
			callback = contentType
			contentType = null

		@parent.virtualfs.createSignedURL domain, "GAME", key, contentType
		.spread (signedURL, getURL)-> callback null, signedURL, getURL
		.catch callback
		.done()

	deleteURL: (domain, key, callback)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@parent.virtualfs.deleteURL domain, "GAME", key
		.then (result)-> callback null, result
		.catch callback
		.done()

	sandbox: (context)->
		incr: (domain, key, amount=1)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@incr context, domain, key, amount
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		read: (domain, key)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@readAsync domain, key
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		write: (domain, key, value)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@writeAsync domain, key, value
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

module.exports = new GameVFSAPI()
