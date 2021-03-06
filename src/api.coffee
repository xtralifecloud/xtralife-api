async = require "async"
extend = require "extend"
_ = require "underscore"
_errors = require './errors.coffee'
Q = require "bluebird"

class XtralifeAPI
	constructor: ->
		@apikeys = {}
		@errors = _errors

	configure: (_, cb)->
		before = Date.now()

		@mailer = xlenv.mailer

		# it takes 2+s to compile all this coffeescript code...
		@collections = require './lib/collections.coffee'
		@connect = require "./lib/connect.coffee"
		@user = require "./lib/user.coffee"
		@social = require "./lib/social.coffee"
		@outline = require "./lib/outline.coffee"
		@transaction = require "./lib/transaction.coffee"
		@virtualfs = require "./lib/virtualfs.coffee"
		@gamevfs = require "./lib/gamevfs.coffee"
		@leaderboard = require "./lib/leaderboard.coffee"
		@achievement = require './lib/achievement.coffee'
		@match = require './lib/match.coffee'
		@store = require './lib/store.coffee'
		@index = require './lib/index.coffee'
		@timer = require './lib/timer.coffee'
		@kv = require './lib/kvstore.coffee'
		@game = require "./lib/game.coffee"

		@modules = [@connect, @user, @social, @outline, @transaction, @virtualfs, @leaderboard, @gamevfs, @achievement, @match, @store, @index, @timer, @kv]

		if xlenv.options.disableIndexModule
			this.modules = this.modules.filter (m) => m != this.index


		# WARNING @collections must always be first
		@modules.unshift @collections

		# WARNING, surprisingly, games, should be the last to be initialized as it suscribe to a redisConfigurtion
		# and then the callback on dynamic config could be called before the initialiation of all modules!
		@modules.push @game

		async.mapSeries @modules, (each, localcb)=>
			each.configure this, (err)->
				localcb err
		, (err)=>
			if err?
				logger.error "can't configure Xtralife-API!"
				logger.error err.message, {stack: err.stack}
				return cb err
			else
				logger.info "Xtralife-API configured... in #{Date.now()-before} ms"

				cb()

	configureGame: (game, callback)->
		async.each @modules, (eachApi, cb)->
			eachApi.configureGame game, cb
		, callback

	afterConfigure: (xtralifeapi, cb)->
		async.mapSeries @modules, (each, localcb)=>
			each.afterConfigure this, localcb
		, (err)=>
			logger.info "All Xtralife-API modules post configured"
			cb err

	# remove common data
	onDeleteUser: (userid, cb, appid)->
		unless xlenv.options.removeUser then return cb null

		@game.handleHook "before-nuking-user", {game: {appid}}, 'private',
			userid: userid
			user_id: userid
		.then =>

			# Call onDeleteUser for each of the submodules
			tasks = []
			for module in @modules
				do (module)=>
					tasks.push (callback)=> module.onDeleteUser userid, callback

			tasks.reverse()

			new Q (resolve, reject) =>
				async.series tasks, (err)=> 
					if err? then reject err
					else resolve err
		.then =>
			@game.handleHook "after-nuking-user", {game: {appid}}, 'private',
			userid: userid
			user_id: userid
		.then cb
		.catch cb

	sandbox: (context)->
		context.runsFromClient = false

		virtualfs: @virtualfs.sandbox(context)
		tx: @transaction.sandbox(context)
		game: @game.sandbox(context)
		user: @user.sandbox(context)
		gamevfs: @gamevfs.sandbox(context)
		leaderboard: @leaderboard.sandbox(context)
		achievement: @achievement.sandbox(context)
		match: @match.sandbox(context)
		index: @index.sandbox(context)
		timer: @timer.sandbox(context)
		kv: @kv.sandbox(context)

module.exports = new XtralifeAPI()
