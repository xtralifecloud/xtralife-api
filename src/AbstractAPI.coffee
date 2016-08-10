xtralife = require './index.coffee'
xtralifeerrors = require './errors.coffee'

checktypes = require 'check-types'

checktypes.objectid = (id)->
	id?._bsontype is 'ObjectID'

shouldRunPreconditions = process.env.NODE_ENV isnt "production"
_ = require 'underscore'

Q = require 'bluebird'

ObjectID = require("mongodb").ObjectID

###
    AbstractAPI defines the contract followed by every business module of Xtralife
###
class AbstractAPI

	# No arg constructor
	constructor: ->

	# Called only once, at startup time
	# If this api is aggregagted in another api, the parent api is `parent`
	# cb (err)
	configure: (parent, cb)->
		cb()

	# Called after every module has been initialized but before xtralife is fully ready
	# cb (err)
	afterConfigure: (parent, cb)->
		cb()

	# Called when a user is deleted, to optionnally provide some cleanup
	# remove common data
	onDeleteUser: (userid, cb)->
		cb()
	
	coll: (name)->
		xtralife.api.collections.coll(name)

	pre: (fn)->
		if shouldRunPreconditions
			try
				errorsMessages = (errorsMessage for errorsMessage, passed of fn(checktypes) when not passed)
				if errorsMessages.length then throw new xtralifeerrors.PreconditionError(errorsMessages)
			catch err
				console.error err
				logger.error 'Exception when checking preconditions', {stack: err.stack}
				throw new xtralifeerrors.PreconditionError(['Exception when checking preconditions'])

	handleHook: (hookName, context, domain, params)->
		@pre (check)->
			"hookName must be a string": check.nonEmptyString(hookName)
			"context must be an object": check.object(context)
			"domain must be a string": check.nonEmptyString(domain)
			"params must be an object": check.object(params)

		isBatch = hookName[0..1] is '__'
		durationms = 0

		unless context.recursion? then context.recursion = {}
		unless context.recursion[hookName]? then context.recursion[hookName] = 0
		context.recursion[hookName]++

		unless context.game?.appid? then return Q.reject new Error("context for hooks must include context.game.appid")
		if domain is 'private' then domain = xtralife.api.game.getPrivateDomain context.game.appid

		_findHook = (name, domain)->
			isCommon = name is "common"
			if xlenv.hooks.functions[domain]? and xlenv.hooks.functions[domain][name]?
				return xlenv.hooks.functions[domain][name]
			else null

		hook = null
		try
			hook = unless context.skipHooks then _findHook(hookName, domain) else null
		catch err
			return Q.reject err

		promise = if hook?
			if context.recursion[hookName] <= (xlenv.hooks.recursionLimit or 10) # this hook can be run only x times in this context
				Q.try =>
					commonHook = _findHook("common", domain)

					mod =
						'_': _
						'Q': Q
						'ObjectID' : (id)-> new ObjectID id
						'ObjectIDs' : (ids)->
							_.map ids, (id)->
								new ObjectID(id)
						debug: (log)->
							xtralife.api.game.hookLog(context.game, domain, hookName, log)
						isSafe: if context.runsFromClient then ()-> false else ()-> true

					mod.common= if commonHook? then commonHook.call(xtralife.api.sandbox(context), mod) else null

					durationms = Date.now()
					if process.send?
						process.send({proc: process.pid, cmd: 'batch', batch: "#{domain}.#{hookName}", enter: true})
					hook.call xtralife.api.sandbox(context), params, context.customData, mod
				.tap ()->
					if process.send?
						process.send({proc: process.pid, cmd: 'batch', batch: "#{domain}.#{hookName}", enter: false})
				.catch (err)->
					if process.send?
						process.send({proc: process.pid, cmd: 'batch', batch: "#{domain}.#{hookName}", enter: false})

					throw new xtralifeerrors.HookError(err.message)
				.tap (customData)->
					durationms = Date.now() - durationms
					logger.debug "Handling hook/batch #{domain}.#{hookName} finished", {batchTook: durationms}
					context.customData = customData
			else
				logger.warn "Hook recursion limit hit (#{domain}) : #{context.recursion[hookName]}", {hookName, domain}
				Q.reject new xtralifeerrors.HookRecursionError("Hook #{domain}/#{hookName} exceeded recursion limit")
		else
			if isBatch
				Q.reject new xtralifeerrors.HookError("Hook #{domain}/#{hookName} does not exist")
			else
				Q.resolve(null)

		promise.tap ->
			# TODO monitor hooks execution time + warn if above threshold ? if context.recursion[hookName] == 0
			context.recursion[hookName]--

			# TODO catch err -> log for BO use -> throw err (ie tap err)

module.exports = AbstractAPI