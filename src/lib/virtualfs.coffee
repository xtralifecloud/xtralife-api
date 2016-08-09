async = require "async"
extend = require('util')._extend
ObjectID = require('mongodb').ObjectID
AWS = require('aws-sdk')

AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"

crypto = require "crypto"

Q = require 'bluebird'

generateHash = (userid, key)->
	sha = crypto.createHash('sha1')
	sha.update("#{userid}-#{key}- secret to keep S3 private") # TODOXTRA secret MUST be in xlenv
	sha.digest('hex')

class VirtualfsAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@parent, callback)->

		@domains = @coll('domains')

		@domains.ensureIndex {domain:1, user_id: 1}, {unique: true}, (err)->
			if err? then return callback err
			logger.info "Virtualfs initialized"

			callback err, {}

		if xlenv.AWS?
			AWS.config.update xlenv.AWS.S3.credentials
			@s3bucket = new AWS.S3 {params: {Bucket: xlenv.AWS.S3.bucket}}
			Q.promisifyAll @s3bucket

	onDeleteUser: (user_id, cb)->
		logger.debug "delete user #{user_id} for virtualfs"
		@domains.find({user_id : user_id, fs: { "$exists" : true}}, {domain: 1, fs: 1}).toArray (err, docs)=>
			unless docs? then return cb err
			return cb err if err?
			async.forEach docs, (item, localcb) =>
				params = {Bucket: xlenv.AWS.S3.bucket, Delimiter :  "#{item.domain}/#{user_id}/"}
				@s3bucket.listObjects params, (err, data) =>
					logger.error err if err?
					return localcb null if err?
					keys = []
					keys.push(each.Key) for each in data.Contents
					params = {Bucket: xlenv.AWS.S3.bucket, Delete : { Objects : keys} }
					@s3bucket.deleteObjects params, (err) =>
						logger.warn "remove s3 objects #{keys} : #{err}"
						return localcb null
			, (err)->
				cb null

	read: (context, domain, user_id, key)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"key may be an unempty string or array": check.maybe.nonEmptyString(key) or key instanceof Array

		@handleHook "before-gamervfs-read", context, domain,
			user_id: user_id
			key: key
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			field = {}
			if key instanceof Array
				field["fs.#{each}"] = 1 for each in key
			else
				field[unless key? then 'fs' else "fs.#{key}"] = 1

			@domains.findOne query, field
			.then (value)=>
				@handleHook "after-gamervfs-read", context, domain,
					user_id: user_id
					key: key
					value: value
				.then (afterData)->
					if value? and value.fs? then value.fs else {}

	write: (context, domain, user_id, key, value)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"key may be a unempty string": check.maybe.nonEmptyString(key) or check.object(key)

		@handleHook "before-gamervfs-write", context, domain,
			user_id: user_id
			key: key
			value: value
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			set = {}
			if key is null
				set['fs'] = value
			else if typeof key is 'string'
				set["fs.#{key}"] = value
			else
				set["fs.#{k}"] = value for k, value of key

			@domains.update query, {$set: set}, { upsert: true }

		.then (result)=>
			@handleHook "after-gamervfs-write", context, domain,
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

		@handleHook "before-gamervfs-delete", context, domain,
			user_id: user_id
			key: key
		.then (beforeData)=>

			query =
				domain: domain
				user_id: user_id

			unset = {}
			unset[unless key? then 'fs' else "fs.#{key}"] = ""

			@domains.update query, {$unset: unset}, {upsert: true}
			.then (result)=>
				@handleHook "after-gamervfs-delete", context, domain,
					user_id: user_id
					key: key
				.then (afterData)->
					result.result.n

	readmulti: (context, domain, userids, keys, included)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"userids must be an array": check.array(userids)
			"keys must be an array": check.array(keys)
			"included may be an array": check.maybe.array(included)

		query =
			domain: domain
			user_id: { $in : userids }

		fields =
			user_id : 1
		fields["fs.#{key}"] = 1 for key in keys
		
		if included?
			fields[i] = 1 for i in included

		cursor = @domains.find query, fields
		cursor.toArray().then (values)=>
			for v in values
				v.gamer_id = v.user_id
				delete v.user_id
				delete v._id
			values

	_getDownloadUrl: (domain, user_id, key, secret)->
		"https://s3-#{xlenv.AWS.S3.credentials.region}.amazonaws.com/#{xlenv.AWS.S3.bucket}/#{domain}/#{user_id}/#{key}-#{secret}"

	createSignedURL: (domain, user_id, key)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)


		# TODO refactor, used in gameFS
		# forbids checking type of user_id
		secret = generateHash user_id, key
		params = {Bucket: xlenv.AWS.S3.bucket, Key: "#{domain}/#{user_id}/#{key}-#{secret}"}
		@s3bucket.getSignedUrlAsync 'putObject', params
		.then (url) =>
			[url, @_getDownloadUrl(domain, user_id, key, secret)]

	deleteURL: (domain, user_id, key)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)


		# TODO refactor, used in gameFS
		# forbids checking type of user_id
		secret = generateHash user_id, key
		keys3 = "#{domain}/#{user_id}/#{key}-#{secret}"
		params = {Bucket: xlenv.AWS.S3.bucket, Key: keys3 }
		@s3bucket.deleteObjectAsync params

	sandbox: (context)->
		read: (domain, user_id, key)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@read context, domain, user_id, key
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		write: (domain, user_id, key, value)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@write context, domain, user_id, key, value
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		delete: (domain, user_id, key)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@delete context, domain, user_id, key
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		readmulti: (domain, userids, keys, included)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@readmulti context, domain, userids, keys, included
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

module.exports = new VirtualfsAPI()
