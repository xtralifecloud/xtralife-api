errors = require "./errors.coffee"
api = require "./api.coffee"
MultiplexedBroker = require("xtralife-msg").MultiplexedBroker
notify = require './lib/network/notify.coffee'


class Xtralife
	constructor: ->
		@_initialised = false

	configure: (cb)->
		return cb(null) if @_initialised
		@_initialised = true
		xlenv.inject ["=redisClient", "redisClient"], (err, rc, pubSub)=>
			if err? then console.error err
			return cb err if err?
			
			@api.notify = notify

			timeoutHandler =
			if xlenv.options.notifyUserOnBrokerTimeout then (prefix, user, message)=>

				logger.info "User (#{user}) message timeout for domain #{prefix}"
				return unless message.osn?

				@api.connect.devicesToNotify prefix, user, (err, devs, lang)=>
					if err? then return logger.error err.message, {stack: err.stack}
					return logger.info "no device to notify for #{user}" unless devs?
					msg = message.osn[lang]
					msg = message.osn["en"] unless msg?
					return logger.info "no lang(#{lang}, en) found in the message!" unless msg?

					alert =
						message : msg
						user :  message.from
						name :  message.name
						data :  message.osn.data

					for d in devs
						app = @api.game.getAppsWithDomain prefix, (err, app)->
							if err? then return logger.error err.message, {stack: err.stack}
							notify.send app, prefix, d.os, d.token, alert, (err, count)->
								if err? then logger.error err.message, {stack: err.stack}

			else
				logger.info "OS notification disabled!"

			xlenv.broker = new MultiplexedBroker(rc, pubSub, timeoutHandler, 5000,5000)

		@api = api
		@api.configure null, (err)=>
			if err? then return cb err
			@api.afterConfigure null, cb

module.exports = new Xtralife()

module.exports.errors = errors
