async = require "async"
extend = require('util')._extend
api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID

Q = require 'bluebird'

class TransactionAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeapi, callback)->
		@domainsColl = @coll 'domains'
		@txColl = @coll 'transactions'

		async.parallel [
			(cb)=>
				@domainsColl.ensureIndex({domain:1, user_id: 1}, {unique: true}, cb)
			(cb)=>
				@txColl.ensureIndex({domain:1, userid: 1, ts: -1}, cb)

		], callback

	# remove common data
	onDeleteUser: (userid, cb)->
		@txColl.remove {userid: userid}, (err, result)=>
			logger.warn "removed transactions #{userid} : #{result.result.n} , #{err} "
			cb null

	# transaction [{unit: amount}]
	# callback(err, balance)
	transaction: (context, domain, user_id, transaction, description, skipAchievementsCheck=false) ->
		_checkTransaction = (tx)->
			_checkValue = (value)-> value is "-auto" or (typeof value is 'number' and not Number.isNaN(value))
			valid = true
			(valid = valid and _checkValue(value)) for _, value of tx
			valid

		@pre (check)->
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"transaction must be a valid transaction": _checkTransaction(transaction)
			"description must be a string": check.maybe.string(description)
			"skipAchievementsCheck must be a boolean": check.boolean(skipAchievementsCheck)

		Q.try => # Check transaction is a valid tx object
			unless @_checkTransaction(transaction) then throw new errors.BadArgument
			@_getDomain(domain, user_id, {balance:1, lastTx:1, achievements: 1})
		.spread (balance, lastTx, user_achievements)=>
			(transaction[unit] = (-balance[unit] or 0)) for unit, value of transaction when value is '-auto'

			if (@_insufficientBalances(balance, transaction)).length>0 # balance is not enough
				logger.debug('balance not high enough for transaction')
				return throw new errors.BalanceInsufficient()

			adjustedBalance = @_adjustBalance(balance, transaction)

			@handleHook "before-transaction", context, domain,
				domain: domain
				user_id: user_id
				transaction: transaction
				description: description
				balanceBefore: balance
				balanceAfter: balance
			.then => # now insert Tx
				insertedTx = {_id: new ObjectID(), domain: domain, userid: user_id, ts: new Date(), tx: transaction, desc: description}
				@txColl.insert insertedTx
				.then =>

					# update the balance if the lastTx is the one read just before into balObj
					# upsert : insert new balance if not already present
					@domainsColl.findAndModify { domain: domain, user_id: user_id, lastTx: lastTx }
						, {}
						, { $set: {balance: adjustedBalance, lastTx: insertedTx._id }}
						, { multi: false, safe: true, upsert: true, new: true}
				.then (status)=>
					if status.lastErrorObject.n != 1 # count = 0 and err == null means race condition
						logger.warn(err, 'error in transaction/balance.update, race condition (count=' + status.result.n + ')')
						throw new errors.ConcurrentModification

					updatedDomain = status.value

					if skipAchievementsCheck
						return [adjustedBalance, []]
					else # Check for achievements if requested to do so
						@xtralifeapi.achievement.checkTriggeredAchievements context, user_id, domain, updatedDomain, balance, adjustedBalance, user_achievements
						.spread (triggeredAchievements, updatedBalance)=>
							adjustedBalance = updatedBalance if updatedBalance?
							return [adjustedBalance, triggeredAchievements]

				.spread (adjustedBalance, triggeredAchievements)=>
					@handleHook "after-transaction", context, domain,
						domain: domain
						user_id: user_id
						transaction: transaction
						description: description
						adjustedBalance: adjustedBalance
						triggeredAchievements: triggeredAchievements
					.return [adjustedBalance, triggeredAchievements]

	# callback(err, balance)
	balance: (context, domain, user_id)->
		@pre (check)->
			"domain is not a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)


		@handleHook "before-balance", context, domain,
			domain: domain
			user_id: user_id
		.then =>
			@_getDomain domain, user_id, {balance:1}
		.spread (balance)=>
			@handleHook "after-balance", context, domain,
				domain: domain
				user_id: user_id
			.return balance

	_checkTransaction: (transaction)->
		try
			errs = Object.keys(transaction).filter (key)->
				not ((typeof transaction[key] is 'number') or transaction[key] is '-auto')
			errs.length is 0
		catch then false

	# use @_get(..).spread (balance, lastTx_id, achievements)=>
	_getDomain: (domain, user_id, fields) ->

		@domainsColl.findOne {domain: domain, user_id: user_id}, fields
		.then (domain)->
			if domain? and domain.balance?
				[domain.balance, domain.lastTx, domain.achievements]
			else
				[{}, null, null] # empty balance

	# callback(err, [tx])
	txHistory: (domain, user_id, unit, skip, limit, callback)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)
			"unit must be a string": check.maybe.string(unit)
			"skip must be an integer": check.maybe.integer(skip)
			"limit must be an integer": check.maybe.integer(limit)

		before = new Date()

		query = {domain: domain, userid: user_id}
		if (unit?)
			query['tx.' + unit] = {$ne: null}

		cursor = @txColl.find query
		cursor.sort {ts: -1}
		cursor.count (err, count)->
			if err?
				logger.error(err, 'error in txHistory.find')
				return callback(err)

			cursor.skip(skip).limit(limit).toArray (err, transactions)->
				if err?
					logger.error(err, 'error in txHistory.find.toArray')
					return callback(err)

				for each in transactions
					do (each)->
						delete each._id
						delete each.userid

				callback null, {transactions, count}

	# returns the units in balance where balance is not high enough for transaction
	_insufficientBalances: (bal, transaction)->
		balanceValue = (unit)-> if bal[unit]? then bal[unit] else 0

		excessiveTx = (unit, amount)-> amount<0 and balanceValue(unit) < -amount
		res = (unit for unit, amount of transaction when excessiveTx(unit, amount))
		res

	# the balance must be sufficient for that transaction
	_adjustBalance: (bal, transaction)->
		balanceValue = (unit)->

			if bal[unit]?
				if typeof bal[unit] is 'number' and not Number.isNaN(bal[unit])
					return bal[unit]
			return 0

		result = extend({}, bal)
		(result[unit] = balanceValue(unit) + amount for unit, amount of transaction)
		result

	sandbox: (context)->
		balance: (domain, user_id)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@balance context, domain, user_id
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")
		transaction: (domain, user_id, transaction, description, skipAchievementsCheck=false)=>
			if @xtralifeapi.game.checkDomainSync context.game.appid, domain
				@transaction context, domain, user_id, transaction, description, skipAchievementsCheck
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

module.exports = new TransactionAPI()
