api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID
DTimer = require('dtimer').DTimer
os = require 'os'
check = require 'check-types'

Q = require 'bluebird'
async = require 'async'

_ = require 'underscore'


# How timers work
# Each user can have many timers, stored in a single document in the timers collection
# only the one about to expire is scheduled in rabbitmq
# so there's only one timeout message at a time in RabbitMQ's queues
# with new timers and retimes, it's possible to have many messages instead
# We just try to minimize their number and never waste them

getExpiryTime = (timer)->
	timer.baseTime + timer.expirySeconds * 1000

getTimerIds = (timers)->
	(timerName for timerName of timers when ['_id', 'domain', 'user_id'].indexOf(timerName) is -1)

# return null if no timers
# otherwise returns the id of the earliest timer (the one which should trigger first)
getEarliestTimerId = (timers)->
	timerIds = getTimerIds(timers)
	if timerIds.length is 0 then return null
	earliest = timerIds[0]

	for id in timerIds
		if getExpiryTime(timers[id]) < getExpiryTime(timers[earliest])
				earliest = id
	return earliest

# return null if no timers
# otherwise returns the earliest timer (the one which should trigger first)
getEarliestTimer = (timers)->
	id = getEarliestTimerId timers
	if id? then timers[id] else null

# add the expiresInMs field to timers, so the user knows in how many ms they'll trigger
addExpiryInMs = (timers)->
	for id in getTimerIds(timers)
		timers[id].expiresInMs = getExpiryTime(timers[id]) - Date.now()
	return timers


class TimerAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeapi, callback)->

		xlenv.inject ['redisClient', 'redisChannel'], (err, redis, pubsub)=>

			# replace ch1 with a unique id for this node (host ? process ?)
			@dtimer = new DTimer("#{os.hostname()}_#{process.pid}", redis, pubsub)

			@dtimer.on 'event', (ev)=>
				@_messageReceived ev.timer
				@dtimer.confirm ev.id, (err)=>
					# confirmed

			@dtimer.on 'error', (err)=>
				logger.error err

			@dtimer.join()
			.then ()=>
				@timersColl = @coll 'timers'
				@timersColl.createIndex {domain:1, user_id: 1}, {unique: true}
				.then ()=>
					callback null
			.catch callback


	# can return a null promise (no timers)
	# otherwise return all timers for this user
	get: (context, domain, user_id) ->
		@pre (check)->
			"context must be an object with .game": check.like context,
				game:
					apikey: 'cloudbuilder-key'
					apisecret: 'azerty'
					appid: 'com.clanofthecloud.cloudbuilder'
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		@timersColl.findOne {domain, user_id}
		.then addExpiryInMs

	add: (context, domain, user_id, timerObject, batchToRun) ->
		@pre (check)->
			"context must be an object with .game": check.like context,
				game:
					apikey: 'cloudbuilder-key'
					apisecret: 'azerty'
					appid: 'com.clanofthecloud.cloudbuilder'
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"timerObject must be an object": check.object(timerObject)
			"batchToRun must be a string": check.nonEmptyString(batchToRun)

		{expirySeconds, timerId, description, customData} = timerObject
		baseTime = Date.now()

		lightContext =
			game: context.game
			runsFromClient: context.runsFromClient
			recursion: {}
			customData: {}

		toSet = { "#{timerId}": {baseTime, expirySeconds, description, customData, batchToRun, context: lightContext, alreadyScheduled: false} }

		@timersColl.findOneAndUpdate {domain, user_id}, {'$set': toSet}, {returnOriginal: false, upsert: true}
		.get('value')
		.then (timers)=>
			# if the timer we're adding is the earliest, schedule one message delivery for it
			if getEarliestTimerId(timers) is timerId

				#console.log "scheduling #{timerId} with delay = #{expirySeconds*1000}"
				message = {domain, user_id, timerId, baseTime, expirySeconds, batchToRun, context: lightContext}
				@_publish message, expirySeconds*1000
				.then =>
					@_setAlreadyPublished domain, user_id, timerId, true
					.then ->
						return timers
			else
				return timers
		.then addExpiryInMs

	delete: (context, domain, user_id, timerId)->
		@pre (check)->
			"context must be an object with .game": check.like context,
				game:
					appid: 'com.clanofthecloud.cloudbuilder'
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"timerId must be a string": check.nonEmptyString(timerId)

		toUnset = { "#{timerId}": null }

		@timersColl.findOneAndUpdate {domain, user_id}, {'$unset': toUnset}, {returnOriginal: false}
		.get('value')
		.then addExpiryInMs

	# retiming doesn't change base time, only expirySeconds
	# so if at time t I set a timer to 2s, then retime it to 3s, it will trigger at t+3s
	#
	# retiming can also be relative and proportional
	# retime(-0.2) will speedup by 20% for the not yet elapsed time
	retime: (context, domain, user_id, timerId, expirySeconds)->
		@pre (check)->
			"context must be an object with .game": check.like context,
				game:
					appid: 'com.clanofthecloud.cloudbuilder'

			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"timerId must be a string": check.nonEmptyString(timerId)
			"expirySeconds must be a number" : check.number(expirySeconds)

		promise = if expirySeconds < 0 # relative retime, adjust expirySeconds
			retimeToPct = -expirySeconds
			@timersColl.findOne {domain, user_id}
			.then (timers)=>
				{baseTime, expirySeconds} = timers[timerId]
				alreadyElapsed = (Date.now() - baseTime)/1000
				remains = expirySeconds - alreadyElapsed

				retimeTo= remains*(1-retimeToPct)
				if retimeTo<0 then retimeTo=0
				return retimeTo
		else
			Q.resolve expirySeconds

		promise.then (expirySeconds)=>
			toSet = { "#{timerId}.expirySeconds": expirySeconds, "#{timerId}.alreadyScheduled": false }

			@timersColl.findOneAndUpdate {domain, user_id}, {'$set': toSet}, {returnOriginal: false, upsert: false}
			.get('value')
			.then (timers) =>
				if getEarliestTimerId(timers) is timerId
					timer = timers[timerId]
					newDelay = getExpiryTime(timer) - Date.now()
					newDelay = 0 if newDelay<0

					#console.log "scheduling #{timerId} with delay = #{newDelay}"

					return @_publish {domain, user_id, timerId, baseTime: timer.baseTime, expirySeconds, batchToRun: timer.batchToRun, context}, newDelay
					.then =>
						@_setAlreadyPublished domain, user_id, timerId, true
						timers
				else
					timers

			.then addExpiryInMs


	# returns a promise for timers
	# we must know if there's a message in a queue for each timer, so we store the info in mongodb
	_setAlreadyPublished: (domain, user_id, timerId, alreadyPublished)->
		toSet = { "#{timerId}.alreadyScheduled": alreadyPublished }
		@timersColl.updateOne {domain, user_id}, {'$set': toSet}, {returnOriginal: false, upsert: false}

	# publish the message with the specified timeout
	# will resolve to null, or reject if an error occurs
	_publish: (message, timeoutMs)->

		@dtimer.post {timer: message}, timeoutMs

	# called for each new message
	# it will check the message corresponds to the current state of timers
	# if it does, it will call the corresponding batch
	# and it will delete the corresponding timer
	# it will then schedule the next timer (if it wasn't scheduled before)
	_messageReceived: (message)=>
		_messageHasCorrectModel = ()=>
			check.like message,
				domain:"com.company.game.key"
				user_id:"55c885e75ecd563765faf612"
				timerId:"timerId"
				baseTime: 1439203492270
				expirySeconds: 1.0
				batchToRun: 'timerTrigger'
				context:
					game:
						appid: 'com.clanofthecloud.cloudbuilder'

		# returns a promise
		# with null if this message can't be processed (timer doesn't exist, or should not fire now)
		# with list of timers if message processed
		_processMessage = (message)=>
			unless _messageHasCorrectModel() then return Q.resolve null
			# get timers
			@get message.context, message.domain, new ObjectID(message.user_id)
			.then (timers)=>
				unless timers? then return null # should not happen

				timer = timers[message.timerId]
				unless timer? then return null

				# return if the earliest timer isn't this one
				unless getEarliestTimerId(timers) is message.timerId then return null
				# return if the message doesn't coincide exactly with timer
				unless message.baseTime is timer.baseTime and message.expirySeconds is timer.expirySeconds then return null

				# delete triggered timer then call batch (asynchronously)
				@delete message.context, message.domain, new ObjectID(message.user_id), message.timerId
				.then (timers)=>
					logger.debug "Calling batch from timer #{timer.batchToRun}", {message, timer}
					api.game.runBatch message.context, message.domain, '__'+timer.batchToRun, {domain: message.domain, user_id: new ObjectID(message.user_id), timerId: message.timerId, now: Date.now(), expiredAt: (timer.baseTime+timer.expirySeconds*1000), description: timer.description, customData: timer.customData}
					.then =>
						logger.debug "Batch returned from timer #{timer.batchToRun}", {message, timer}
					.catch (err)=>
						logger.debug "Error during timer batch #{message.domain}.__#{timer.batchToRun}"
						logger.debug err, {stack: err.stack}
					.done()
					return timers

		# resolves to null if no message needed scheduling
		_scheduleNextMessage = (timers)=>
			unless timers? then return null

			# we need to schedule a new message with the next earliest timer, if any
			# and if it's not scheduled already
			nextTimer = getEarliestTimer timers
			unless nextTimer? then return null
			if nextTimer.alreadyScheduled then return null
			nextTimerId = getEarliestTimerId timers

			newDelay = getExpiryTime(nextTimer) - Date.now()
			newDelay = 0 if newDelay<0
			#console.log "scheduling #{nextTimerId} with delay = #{newDelay}"

			message =
				domain: timers.domain
				user_id: timers.user_id
				timerId: nextTimerId
				baseTime: nextTimer.baseTime
				expirySeconds: nextTimer.expirySeconds
				batchToRun: nextTimer.batchToRun
				context: nextTimer.context
			@_publish message, newDelay
			.then =>
				@_setAlreadyPublished timers.domain, timers.user_id, nextTimerId, true



		_processMessage(message)
		.catch (error)=>
			logger.error 'Error in xtralife Timer _processMessage'
			logger.error error
			return null

		.then (timers)=>
			return timers or @get message.context, message.domain, new ObjectID(message.user_id)

		.then (timers)=>
			_scheduleNextMessage(timers)

		.catch (err)=>
			logger.error "Error in xtralife Timer _scheduleNextMessage or @get"
			logger.error err, {stack: err.stack}
			return null

	sandbox: (context)->
		@pre (check)->
			"context must be an object with .game": check.like context,
				game:
					appid: 'com.clanofthecloud.cloudbuilder'

		# timerObject = {expirySeconds, timerId, description, customData}
		add: (domain, user_id, timerObject, batchToRun)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@add context, domain, user_id, timerObject, batchToRun
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		get: (domain, user_id)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@get context, domain, user_id
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		delete: (domain, user_id, timerId)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@delete context, domain, user_id, timerId
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		retime: (domain, user_id, timerId, expirySeconds)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@retime context, domain, user_id, timerId, expirySeconds
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

module.exports = new TimerAPI()
