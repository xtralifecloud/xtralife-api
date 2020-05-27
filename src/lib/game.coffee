AbstractAPI = require '../AbstractAPI.coffee'
async = require 'async'
ObjectID = require('mongodb').ObjectID
moment = require "moment"
_ = require 'underscore-contrib'
Q = require 'bluebird'
errors = require '../errors.coffee'
util = require 'util'

Redlock = require 'redlock'

superagent = require 'superagent'
jwt = require 'jsonwebtoken'

url = require 'url'
nodemailer = require 'nodemailer'

class GameAPI extends AbstractAPI

	constructor: ->
		super()
		@dynGames = {}
		@appsForDomain = {}
		@eventedDomains = {}

	# helpers
	collgame: ()->
		@coll("games")

	configure: (@xtralifeapi, cb)->
		@collDomainDefinition = @coll("domainDefinition")

		@gamesByApiKey = {}

		# start with the contents of xlenv.hooks.definitions
		@hooks = _.clone xlenv.hooks.definitions

		xlenv.inject ["xtralife.games"], (err, xtralifeGames)=>
			cb err if err?

			@collgame().createIndex {appid: 1}, { unique: true }, (err)=>
				return cb err if err?


				@dynGames[appid] = game for appid, game of xtralifeGames
				@appsForDomain = {}

				@eventedDomains = {}

				Q.promisifyAll @coll('hookLog')

				xlenv.inject ['redisClient'], (err, client)=>
					@redlock = new Redlock [client], {driftFactor: 0.01, retryCount:  3, retryDelay:  200}

				async.eachSeries (each for each of xtralifeGames), (game, localcb)=>
					@configureGame game, (err)=>
						localcb(err)
					, true # silent
				, (err)->
					cb err

	configureGame: (appid, cb, silent=false)->
		game = @dynGames[appid]
		game.appid = appid
		@gamesByApiKey[game.apikey] = game
		unless silent then logger.info "added #{appid}"

		# needed to initiate the llop on timed out event !
		xlenv.broker.start "#{appid}.#{game.apisecret}"
		@eventedDomains[@getPrivateDomain(appid)] = true
		if game.config.eventedDomains? then for domain in game.config.eventedDomains
			@eventedDomains[domain] = true 
			xlenv.broker.start domain

		@coll('games').updateOne {appid}, {"$set": {appid, config: game.config}}, {upsert: true}
		.then (query)=>
			if query.result.upserted?
				query.result.upserted[0]._id
			else
				@coll('games').findOne {appid : appid}
				.then (agame)->
					agame._id
		.then (_id)->
			game._id = _id
			cb null
		.catch cb

	onDeleteUser: (userid, cb)->
		logger.debug "delete user #{userid} for game"
		cb(null)

	existsKey: (apikey, cb)->
		cb null, @gamesByApiKey[apikey]

	getPrivateDomain: (appid)->
		game = @dynGames[appid]
		"#{appid}.#{game.apisecret}"

	checkAppCredentials: (apikey, apisecret, cb)->
		game = @gamesByApiKey[apikey]
		unless game? then return cb new Error 'Invalid ApiKey'
		if game.apisecret is apisecret and game.config.enable
			cb null, game
		else
			cb new Error("Invalid App Credentials"), null

	checkDomain: (game, domain, cb)->
		cb null,  game.config.domains && game.config.domains.indexOf(domain)!=-1

	checkDomainSync: (appid, domain)->
		game = @dynGames[appid]
		(@getPrivateDomain(appid) is domain) or game.config.domains and game.config.domains.indexOf(domain) isnt -1

	getGame: (appid, domain, cb)->
		#keep ascending compatibility
		unless cb?
			cb = domain
			domain = @getPrivateDomain(appid)

		@collgame().findOne {appid : appid}, (err, game)=>
			if err? then return cb err

			@collDomainDefinition.findOne {domain: domain}, {projection:{leaderboards: 1}}, (err, domainDefinition)->
				if err? then return cb err
				game.leaderboards = domainDefinition?.leaderboards || {}
				cb null, game

	getCerts: (appid, cb)->
		empty =
			android:
				enable: false
				senderID: ''
				apikey: ''
			ios:
				enable: false
				cert: ''
				key: ''
			macos:
				enable: false
				cert: ''
				key: ''
		game = @dynGames[appid]
		cb(null, game.config.certs or empty)


	hasListener: (domain)->
		@eventedDomains[domain] is true

	getAppsWithDomain: (domain, cb)->

		if @appsForDomain[domain]?
			return cb null, @appsForDomain[domain]
		
		appid = undefined
		for key of @gamesByApiKey
			if domain == "#{@gamesByApiKey[key].appid}.#{@gamesByApiKey[key].apisecret}"
				appid = @gamesByApiKey[key].appid
		
		return cb null, null unless appid?

		game = @dynGames[appid]
		@appsForDomain[domain] = {appid, certs : game.config.certs}
		cb null, @appsForDomain[domain]


	runBatch: (context, domain, hookName, params)->
		unless hookName[0..1] is '__' then hookName = '__'+hookName

		@handleHook(hookName, context, domain, params)

	runBatchWithLock: (context, domain, hookName, params, resource=null)->
		unless hookName[0..1] is '__' then hookName = '__'+hookName

		unless resource? then resource = hookName
		lockName = "#{domain}.#{resource}"

		@redlock.lock(lockName, 200).then (lock)=>
			@handleHook(hookName, context, domain, params)
			.timeout(200)
			.tap (result)=>
				lock.unlock()
			.catch (err)=>
				lock.unlock()
				throw err

	sendEvent: (context, domain, user_id, message)->
		unless @hasListener(domain)
			throw new errors.NoListenerOnDomain(domain)

		if util.isArray user_id
			if user_id.length > (xlenv.options.maxReceptientsForEvent)
				return Q.reject new Error("Can't send a message to more than #{xlenv.options.maxUsersForEvent} users")

			Q.all (xlenv.broker.send(domain, eachUser.toString(), message) for eachUser in user_id)
		else
			xlenv.broker.send domain, user_id.toString(), message

	sendVolatileEvent: (context, domain, user_id, message)->
		if util.isArray user_id
			if user_id.length > (xlenv.options.maxReceptientsForEvent)
				return Q.reject new Error("Can't send a message to more than #{xlenv.options.maxUsersForEvent} users")

			Q.all (xlenv.broker.sendVolatile(domain, eachUser.toString(), message) for eachUser in user_id)
		else
			xlenv.broker.sendVolatile domain, user_id.toString(), message

	getHooks: (game, domain)->
		return Q.reject new errors.RestrictedDomain("Invalid domain access") unless @checkDomainSync(game.appid, domain)

		Q.resolve (
			unless @hooks[domain]? then null
			else @hooks[domain]
		)

	hookLog: (game, domain, hookName, log)->
		return unless xlenv.options.hookLog?.enable
		throw new errors.RestrictedDomain("Invalid domain access") unless @checkDomainSync(game.appid, domain)
		logger.debug "hookLog: #{domain}.#{hookName} - #{log}", {appid: game.appid}

	sandbox: (context)=>
		_checkUrl = (_url)->
			hostname = url.parse(_url).hostname
			unless xlenv.options.hostnameBlacklist?
				logger.warn 'xlenv.options.hostnameBlacklist should be defined, disabling http requests'
				throw new Error("HTTP requests have been disabled, please contact support")

			if hostname in xlenv.options.hostnameBlacklist
				throw new Error("This hostname is blacklisted for access through this.game.http.*")

		loginExternal: (external, id, token, options)=>
			loginAsync = Q.promisify @xtralifeapi.connect.loginExternal, context: @xtralifeapi.connect
			addGameAsync = Q.promisify @xtralifeapi.connect.addGameToUser, context: @xtralifeapi.connect

			loginAsync(context.game, external, id, token, options)
			.then (gamer, created) =>
				addGameAsync(context.game, gamer).then (count) =>
					result = gamer

					result.gamer_id = gamer._id
					result.gamer_secret = @xtralifeapi.user.sha_passwd(gamer._id)
					result.servertime = new Date()
					delete result._id
					delete result.networksecret
					return result
		
		runBatch: (domain, hookName, params)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@runBatch context, domain, hookName, params
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		runBatchWithLock: (domain, hookName, params, resource=null)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@runBatchWithLock context, domain, hookName, params, resource
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		getPrivateDomain: =>
			@getPrivateDomain(context.game.appid)

		sendEvent: (domain, user_id, message)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@sendEvent context, domain, user_id, message
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		sendVolatileEvent: (domain, user_id, message)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@sendVolatileEvent context, domain, user_id, message
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		jwt: jwt

		http:
			get: (_url)->
				_checkUrl _url
				superagent.get(_url)

			post: (_url)->
				_checkUrl _url
				superagent.post(_url)

			put: (_url)->
				_checkUrl _url
				superagent.put(_url)
		
			del: (_url)=>
				_checkUrl _url
				superagent.del(_url)

		nodemailer: nodemailer

		redlock: ()=> @redlock

module.exports = new GameAPI()
