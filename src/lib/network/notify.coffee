# import service implementations
{APNService, AndroidService} = require "./notifyServices.coffee"

# cache of appid->os->Sender
_services = {}


# Creates a new Sender of the right kind, with the specified config
_SenderFactory = (os, config, appid)->
	switch os
		when "macos","ios"
			try
				return new APNService(config, appid)
			catch
				logger.error "Unable to init APNService(#{JSON.stringify(config)})"
				return null

		when "android"
			try
				return new AndroidService(config, appid)
			catch
				logger.error "Unable to init AndroidService(#{JSON.stringify(config)})"
				return null
		else
			logger.error "Unknown service OS (#{os})"
			return null

# Gets a sender for an appid/os combination
# Uses caching of Senders
# config is only used when not already in cache
_getSender = (appid, os, config)->
	if _services[appid]?
		if _services[appid][os]?
			_services[appid][os]
		else
			_services[appid][os] = _SenderFactory(os, config, appid)
	else
		_services[appid]={}
		_getSender(appid, os, config)

module.exports =

	send: (app, domain, os, tokens, alert, cb)->
		console.log "notify #{domain} #{os} "
		sender = _getSender app.appid, os, app.certs[os]
		return cb err unless sender?
		sender.send(domain, tokens, alert, cb) 
