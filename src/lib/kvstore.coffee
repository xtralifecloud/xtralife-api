extend = require('util')._extend
api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID

Q = require 'bluebird'

class KVStoreAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeapi, callback)->
		@kvColl = @coll 'kvstore'

		@kvColl.ensureIndex({domain:1, key: 1}, {unique: true}, callback)

	onDeleteUser: (userid, cb)->
		cb null

	# in every KVStore API, the user_id is optional
	# so
	# - shuttle must enforce its presence and never allow passing null as a user_id
	# - but sandbox() can bypass the ACLs (batches know what they're doing) but they can rely on ACLs too
	# We check context.runsFromClient but this may not be enough (it should)

	# ATTN: create shouldn't be called from shuttle: only a batch can create a new key
	# It's a hard create, not an upsert. Handle error for duplicate key accordingly
	create: (context, domain, user_id=null, key, value, acl={})->
		acl = if user_id? then @_defaults acl, [user_id] else @_defaults acl

		@pre (check)=>
			"create cannot be run from client": not context.runsFromClient
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id may be an ObjectID": user_id is null or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)
			"acl must be a valid ACL": @_validACL(acl)

		cdate = Date.now()
		@kvColl.insert {domain, key, value, acl, cdate, udate: cdate}
		.get 'result'

	# change the ACL of a key (must have 'a' right to do so)
	changeACL: (context, domain, user_id=null, key, acl)->
		acl = if user_id? then @_defaults acl, [user_id] else @_defaults acl

		@pre (check)=>
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": (user_id is null and not context.runsFromClient) or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)
			"acl must be a valid ACL": @_validACL(acl)

		query = {domain, key}
		if user_id? then query['$or']= [{'acl.a':'*'}, {'acl.a': user_id}]
		udate = Date.now()
		@kvColl.update query, {$set: {acl, udate}}
		.get 'result'

	# set the value of a key (must have 'w' right to do so)
	# set 'udate' to perform optimistic locking (test and set)
	set: (context, domain, user_id=null, key, value, udate=null)->
		@pre (check)=>
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": (user_id is null and not context.runsFromClient) or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)

		query = {domain, key}
		if user_id? then query['$or']= [{'acl.w':'*'}, {'acl.w': user_id}]
		if udate? then query.udate = udate

		@kvColl.update query, {$set: {value, udate: Date.now()}}
		.get 'result'

	# updateObject allows incremental changes to JS objects stored in value
	updateObject: (context, domain, user_id=null, key, value, udate=null)->
		@pre (check)=>
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": (user_id is null and not context.runsFromClient) or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)
			"value must be a JS object": check.object(value)

		query = {domain, key}
		if user_id? then query['$or']= [{'acl.w':'*'}, {'acl.w': user_id}]
		if udate? then query.udate = udate

		set = {udate: Date.now()}
		set["value.#{k}"] = v for k, v of value
		@kvColl.update query, {$set: set}
		.get 'result'


	# read a key (must have 'r' right to do so)
	get: (context, domain, user_id=null, key)->
		@pre (check)=>
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": (user_id is null and not context.runsFromClient) or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)

		query = {domain, key}
		if user_id? then query['$or']= [ {'acl.r':'*'}, {'acl.r': user_id} ]
		@kvColl.findOne query

	# delete a key (must have 'a' right to do so)
	del: (context, domain, user_id=null, key)->
		@pre (check)=>
			"context is not a valid context": check.object(context)
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": (user_id is null and not context.runsFromClient) or check.objectid(user_id)
			"key must be a string": check.nonEmptyString(key)

		query = {domain, key}
		if user_id? then query['$or']= [{'acl.a':'*'}, {'acl.a': user_id}]
		@kvColl.remove {domain, key, $or: [{'acl.a':'*'}, {'acl.a': user_id}]}
		.get 'result'

	# used by BACKOFFICE only !
	list: (context, domain, query, skip, limit)->

		@pre (check)=>
			"domain is not a valid domain": check.nonEmptyString(domain)
			"query must be an object": check.object(query)

		@kvColl.find( { "domain": domain , "acl.a" : query.user_id} ,
			skip : skip
			limit: limit
		).toArray()

	# apply a default ACL if missing acl component
	_defaults: (acl, defaultACL = '*')->
		{r: acl.r or defaultACL, w: acl.w or defaultACL, d: acl.d or defaultACL, a: acl.a or defaultACL}

	# returns false for non valid ACL, or true if OK
	_validACL: (acl)->
		{r, w, d} = acl # read, write, delete

		_checkIDsOrStar = (value)->
			_isArrayOfIDs = (array)->
				array.filter (each)-> each._bsontype isnt 'ObjectID'
				.length is 0

			value is '*' or (Array.isArray(value) and _isArrayOfIDs(value))

		_checkIDsOrStar(r) and _checkIDsOrStar(w) and _checkIDsOrStar(d)

	sandbox: (context)->
		_checkDomain = (domain)=>
			unless @xtralifeapi.game.checkDomainSync context.game.appid, domain
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		create: (domain, user_id, key, value, acl={})=>
			_checkDomain domain
			@create context, domain, user_id, key, value, acl

		changeACL: (domain, user_id, key, acl)=>
			_checkDomain domain
			@changeACL context, domain, user_id, key, acl

		set: (domain, user_id, key, value, udate=null)=>
			_checkDomain domain
			@set context, domain, user_id, key, value, udate

		updateObject: (domain, user_id, key, value, udate=null)=>
			_checkDomain domain
			@updateObject context, domain, user_id, key, value, udate

		get: (domain, user_id, key)=>
			_checkDomain domain
			@get context, domain, user_id, key

		del: (domain, user_id, key)=>
			_checkDomain domain
			@del context, domain, user_id, key



module.exports = new KVStoreAPI()
