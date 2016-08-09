apn = require "apn"
gcm = require "node-gcm"
_ = require "underscore"

class APNService
	constructor: (config, appid)->
		console.log config
		unless config.cert? and config.cert!="" then  logger.error "no cert for #{appid}"; return null
		unless config.key? and config.key!="" then  logger.error "no keyfor #{appid}"; return null
		
		@service = new apn.Connection config

		@service.on 'connected', ()->
			logger.info "Connected (#{appid})"

		@service.on 'transmitted', (notification, device)->
			logger.info "Notification transmitted to: #{device.token.toString('hex')}"

		@service.on 'transmissionError', (errCode, notification, device)->
			logger.warn "Notification caused error: #{errCode} for device #{device} #{if errCode==8 then "device token is invalid"}"

		@service.on 'timeout', ()->
			logger.info "Connection Timeout for #{appid}"

		@service.on 'disconnected', ()->
			logger.info "Disconnected from APNS for #{appid}"

		@service.on 'socketError', (err)->
			logger.error "APN socket error #{appid} : #{JSON.stringify(err)}"

		@service.on 'error', (err)->
			logger.error "APN error #{appid} : #{JSON.stringify(err)}"


	send: (domain, tokens, alert, cb)->
		return cb null unless @service?

		note = new apn.Notification

		note.badge = 1
		note.sound = if alert.sound then alert.sound else "ping.aiff"
		note.alert = alert.message;

		note.payload =
			user: alert.user
			name: alert.name
			data: alert.data

		err = @service.pushNotification note, tokens

		logger.error "APN error #{domain} : #{JSON.stringify(err)}" if err?
		process.nextTick -> cb null

class AndroidService
	constructor: (config)->
		@service = new gcm.Sender config.apikey

	send: (domain, tokens, alert, cb)->
		return cb null unless @service?

		unless _.isArray tokens then tokens = [tokens]

		message = new gcm.Message

		message.addData 'message', alert.message
		message.collapseKey = domain;
		message.delayWhileIdle = false;

		@service.send message, tokens, 4, (err, result)->
			logger.error "GCM error #{domain} : #{JSON.stringify(err)}" if err?
			logger.debug "message sent to #{tokens}" unless err?
			cb err

module.exports = {APNService, AndroidService}