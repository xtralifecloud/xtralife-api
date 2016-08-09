async = require "async"
extend = require('util')._extend
api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"

Q = require 'bluebird'

class AchievementAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeApi, callback)->
		async.parallel [
			(cb)=>
				@coll('achievements').ensureIndex({domain:1}, {unique: true}, cb)
		], (err)->
			return callback err if err?
			logger.info "Achievements initialized"
			callback()

	# remove common data
	onDeleteUser: (userid, callback)->
		logger.debug "delete user #{userid} for Achievements"		
		callback null
		
	# Checks which achievements are triggered by a transaction. Returns a list of achievements.
	# .spread (triggeredAchievements, latestBalance)
	checkTriggeredAchievements: (context, user_id, domain, domainDocument, oldBalance, newBalance, user_achievements)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		# Needed prior to returning the achievements
		_postResults = (achievements, latestBalance = null)=>
			domainDocument.balance = latestBalance if latestBalance?
			@_enrichAchievements achievements, domainDocument, user_id
			return [achievements, latestBalance]

		@loadAchievementsDefinitions domain
		.then (achDefinitions)=>
			# Check what achievements were just triggered
			_canTrigger = (achName, achievementDefinition)->
				ach = user_achievements?[achName]
				# Already obtained?
				if ach?.status?.obtained
					# Else just check that the max count allows it
					maxCount = achievementDefinition.config.maxTriggerCount or 1
					# maxCount = -1 allows an infinite number of triggers
					return if maxCount == -1 then true else ach.status.count < maxCount
				else
					return true

			_triggered = (achievementDefinition)=>
				@_getProgress(achievementDefinition, oldBalance) < 1 and
				@_getProgress(achievementDefinition, newBalance) >= 1

			triggeredAchievements = {}
			triggeredAchievements[key] = each for key, each of achDefinitions when _canTrigger(key, each) and _triggered(each)

			if Object.keys(triggeredAchievements).length > 0
				# if they were triggered, we want to store it in domains
				setQuery = {}
				setQuery["achievements.#{name}.status.obtained"] = true for name, each of triggeredAchievements
				incQuery = {}
				incQuery["achievements.#{name}.status.count"] = 1 for name, each of triggeredAchievements
				@coll('domains').update {domain: domain, user_id: user_id}, {"$set": setQuery, "$inc": incQuery}, {upsert: true, multi: false}
				.then (result)=>
					# Run associated transactions if any
					transactions = (each.config.rewardTx for name, each of triggeredAchievements when each.config?.rewardTx?)
					@handleHook "after-achievement-triggered", context, domain,
						domain: domain
						user_id: user_id
						triggeredAchievements: triggeredAchievements
						runTransactions: transactions
					.then (beforeData)=>
						console.log "transactions"
						console.log transactions
						if transactions? and transactions.length > 0
							# we'll build a promise chain to run transactions in series to prevent race conditions
							promiseChain = Q.resolve(null)
							for tx in transactions
								do (tx)=>
									promiseChain = promiseChain.then ()=>
										@xtralifeApi.transaction.transaction context, domain, user_id, tx, 'Triggered by achievement', true

							promiseChain.spread (latestBalance)=>
								_postResults triggeredAchievements, latestBalance
						else
							_postResults triggeredAchievements
			else
				_postResults triggeredAchievements

	getUserAchievements: (user_id, domain)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		@loadAchievementsDefinitions domain
		.then (achievements)=>
			@coll('domains').findOne {domain: domain, user_id: user_id}, {achievements: 1, balance: 1}
			.then (domain)=>
				resultAchievements = {}
				resultAchievements[name] = @_enrichAchievementDefinitionForUser(name, ach, domain) for name, ach of achievements
				return resultAchievements

	# .then (achievements)
	# where achievements is {"name": {config}}
	loadAchievementsDefinitions: (domain)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@coll('achievements').findOne {domain: domain}
		.then (achievements)->
			return achievements?.definitions

	modifyUserAchievementData: (context, user_id, domain, achName, gamerData)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@loadAchievementsDefinitions domain
		.then (definitions)=>
			# Check that the achievement exists
			throw new errors.BadArgument if not definitions?[achName]?

			query = {}
			query["achievements.#{achName}.gamerData.#{key}"] = value for key, value of gamerData
			# Update the achievements field for the domain in DB
			@coll('domains').findAndModify {domain: domain, user_id: user_id},
				{},
				{"$set": query},
				{new: true, upsert: true}
			.then (result)=>
				@handleHook "after-achievement-userdata-modified", context, domain,
					domain: domain
					user_id: user_id
					achievement: achName
					gamerData: gamerData
				.then (afterHookData)=>
					return @_enrichAchievementDefinitionForUser(achName, definitions[achName], result.value)

	resetAchievementsForUser: (context, user_id, domain)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@coll('domains').update {domain: domain, user_id: user_id}, {"$unset": {"achievements": ""}}, {upsert: true}

	# Add or replace achievements for a domain
	saveAchievementsDefinitions: (domain, achievements)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		achColl = @coll('achievements')
		achColl.findOne {domain: domain}
		.then (foundAchievements)->
			unless foundAchievements? then foundAchievements={domain:domain}
			foundAchievements.definitions = achievements

			achColl.save foundAchievements
			.then (insertedAch)=>
				return foundAchievements

	# Takes an achievement definition as well as a domain and makes something returnable to the user when querying the status of achievements
	# Efficient method to be used whenever possible. A simpler _enrichAchievements exist though.
	_enrichAchievementDefinitionForUser: (achName, achDefinition, userDomain)->
		_notTriggeredBefore = (achName)->
			ach = userDomain?.achievements?[achName]
			return not ach?.status

		# Enrich achievement with the progress
		achDefinition.progress = if _notTriggeredBefore(achName) then @_getProgress(achDefinition, userDomain?.balance) else 1
		achDefinition.gamerData = userDomain?.achievements?[achName]?.gamerData
		achDefinition

	# Higher level version, which requires an access to the database.
	_enrichAchievements: (achievementDefinitions, domainDocument)->
		@_enrichAchievementDefinitionForUser(name, ach, domainDocument) for name, ach of achievementDefinitions
		return achievementDefinitions

	_getProgress: (definition, balance)->
		if definition.type is "limit"
			# Not been set once
			return 0 unless balance?
			max = definition.config.maxValue
			unit = definition.config.unit
			value = balance[unit]
			return if value? then Math.min (value / max), 1 else 0
		else
			throw new Error("Not implemented: unknown achievement type " + definition.type)

	sandbox: (context)->
		modifyUserAchievementData: (domain, user_id, achName, gamerData)=>
			if @xtralifeApi.game.checkDomainSync context.game.appid, domain
				@modifyUserAchievementData context, user_id, domain, achName, gamerData
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")
		getUserAchievements: (domain, user_id)=>
			if @xtralifeApi.game.checkDomainSync context.game.appid, domain
				@getUserAchievements user_id, domain
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

module.exports = new AchievementAPI()
