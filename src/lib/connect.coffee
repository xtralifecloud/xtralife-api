async = require "async"
extend = require 'extend'
rs = require "randomstring"
_ = require "underscore"

ObjectID = require("mongodb").ObjectID

facebook = require "./network/facebook.coffee"
google = require "./network/google.coffee"
gamecenter = require 'gamecenter-identity-verifier'
errors = require "./../errors.coffee"

AbstractAPI = require "../AbstractAPI.coffee"

Q = require 'bluebird'


class ConnectAPI extends AbstractAPI
	constructor: ()->
		super()

	# helpers
	collusers: ->
		@coll("users")
	
	configure: (@xtralifeapi, callback)->

		@facebookValidTokenAsync = Q.promisify facebook.validToken, {context: facebook}
		@googleValidTokenAsync = Q.promisify google.validToken, {context: google}

		xlenv.inject ["=redisClient"], (err, @rc)=>
			if err? then return callback err
			async.parallel [
					# data related to user
					(cb)=>
						@collusers().ensureIndex({network:1, networkid: 1}, { unique: true }, cb)
					(cb)=>
						@collusers().ensureIndex {'profile.displayName':1}, { unique: false }, cb
					(cb)=>
						@collusers().ensureIndex {'profile.email':1}, { unique: false }, cb
				], (err)=>
					logger.info "Connect initialized"
					callback err

	onDeleteUser: (userid, cb)->
		@collusers().remove {_id: userid}, (err, result)->
			logger.warn "removed #{userid} : #{result.result.n} , #{err} "
			cb err

	exist: (userid, cb)->
		try
			id = new ObjectID(userid)
		catch
			return cb new errors.BadGamerID

		@collusers().findOne {_id: id}
		.then (user)->
			cb null, user
		.catch (err)->
			cb err

	existAndLog: (userid, appid, cb)->
		try
			id = new ObjectID(userid)
		catch
			return cb new errors.BadGamerID

		logtime = new Date(Math.floor(Date.now() / 86400000) * 86400000)
		@collusers().findOne {_id: id}, (err, user)=>
			return cb err if err? or user==null

			authg = _.find user.games, (g)->
				g.appid == appid

			return cb err, user	 if authg?.lastlogin?.getTime()==logtime.getTime()
			@collusers().update {_id: id, "games.appid" : appid }, {'$set' : {"games.$.lastlogin" : logtime}}, (err, result)=>
				cb err, user


	existInNetwork: (network, id, cb)->
		@collusers().findOne {network:network, networkid:id}, (err, user)->
			return cb new errors.BadGamerID unless user?
			cb err, user


	createShortLoginCode: (domain, id, ttl, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		ttl = ttl || 3600*2; # valid for 2 hours
		token = rs.generate(8)
		key = "shortlogincode:#{token}"
		loginfo =
			user_id : id
			domain : domain
		@rc.set key, JSON.stringify(loginfo), (err, done)=>
			return cb err if err?
			@rc.expire key, ttl, (err, done)=>
				return cb err if err?
				cb null, token

	resolveShortLoginCode: (game, token, cb)->
		key = "shortlogincode:#{token}"

		@rc.get key , (err, loginfo)=>
			return cb err if err?
			try
				loginfo = JSON.parse loginfo
			catch
				return cb new errors.BadToken

			return cb new errors.BadToken unless loginfo?

			privatedomain = @xtralifeapi.game.getPrivateDomain(game.appid)
			@xtralifeapi.game.checkDomain game, loginfo.domain, (err, allowed)=>
				return cb err if err?
				if !allowed && loginfo.domain != privatedomain then return cb new errors.RestrictedDomain		
				@rc.del key , (err, done)=> # token must be used only once !
					cb null, loginfo.user_id

	sendPassword: (game, email, from, title, body, html, cb)->
		@existInNetwork 'email', email, (err, user)=>
			return cb err if err?
			privatedomain = @xtralifeapi.game.getPrivateDomain(game.appid)
			ttl = xlenv.options['sendPasswordTTL'] or (86400*2) # 2 days
			@createShortLoginCode privatedomain, user._id, ttl, (err, token)=>
				return cb err if err?
				
				mail = 
					from: from
					to: email
					subject: title
					text: body.replace /\[\[SHORTCODE\]\]/gi, token

				if html?
					mail.html =  html.replace /\[\[SHORTCODE\]\]/gi, token

				xlenv.mailer.sendMail mail, (err, info)=>
					return cb err if err?
					logger.debug info
					cb null, {done : 1}

	changePassword: (user_id, sha_pass, cb)->
		@collusers().update {_id : user_id}, { $set: { networksecret : sha_pass}}, (err, result)=>
			logger.debug "password changed for #{user_id}" unless err?
			cb err, result.result.n

	changeEmail: (user_id, email, cb)->
		@collusers().findOne {network:"email", networkid:email}, (err, user)=>
			return cb err if err?
			return cb new errors.ConnectError("UserExists", "#{email} already exists") if user?
			@collusers().update {_id : user_id}, { $set: { networkid : email}}, (err, result)=>
				logger.debug "email changed for #{user_id}" unless err?
				cb err, result.result.n

	register: (game, network, networkid, networksecret, profile, cb)->
		networkid = new ObjectID().toString() unless networkid?
		newuser = 
			network : network
			networkid : networkid
			networksecret : networksecret
			registerTime : new Date
			registerBy : game.appid
			games: [ {
				appid : game.appid
				ts : new Date
				lastlogin: new Date(Math.floor(Date.now() / 86400000) * 86400000)
			}]
			profile : profile
		@collusers().insert newuser, (err)=>
			if err?
				if err.code == 11000
					key = err.err.substring(err.err.indexOf('$')+1, err.err.indexOf('_1'))
					return cb new errors.ConnectError("UserExists", "#{key} already exists")
				else
					return cb err

			logger.debug "user #{newuser._id} registered!"

			cb null, newuser


	addGameToUser: (game, user, cb) ->
		for g in user.games
			if g.appid == game.appid then return cb null, 0
		newgame =
			appid : game.appid
			ts : new Date()
		@collusers().update {_id : user._id}, { $addToSet: { games : newgame}}, (err, result)=>
			logger.debug "#{game.appid} added to #{user.gamer_id}" unless err?

			cb err, result.result.n

	loginExternal: (game, external, id, token, options, cb)->
		return cb new errors.BadArgument unless id?
		return cb new errors.BadArgument unless token?
		return cb new errors.BadArgument unless external?

		_check_auth = (external,  id, token, cb)=>
			@handleHook "__auth_#{external}_#{game.appid.replace(/[^0-9a-z]/gi,'')}", {game}, "#{game.appid}.#{game.apisecret}",
				user_id: id
				user_token: token
			.then (status)=>
				cb null, status
			.catch (err)=>
				cb err

		@collusers().findOne {network:external, networkid:id}, (err, user)=>
			return cb err if err?
			_check_auth external, id, token, (err, status)=>
				console.log "status", status
				return cb err if err?
				return cb new errors.BadUserCredentials unless status?
				return cb new errors.BadUserCredentials unless status.verified == true
				return cb null, user, false if user?

				return cb new errors.PreventRegistration(id), null, false if options?.preventRegistration
				# create account
				@register game, external, id, token, {displayName:id, lang:"en"}, (err, user)->
					cb err, user, true


	login: (game, email, sha_pass, options, cb)->
		return cb new errors.BadArgument unless email?
		return cb new errors.BadArgument unless /^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test email

		@collusers().findOne {network:"email", networkid:email}, (err, user)=>
			return cb err if err?
			if user?
				if user.networksecret == sha_pass
					return cb null, user, false
				else
					return cb new errors.BadUserCredentials

			return cb new errors.PreventRegistration(email), null, false if options?.preventRegistration

			# create account
			@register game, "email", email, sha_pass, @_buildEmailProfile(email), (err, user)->
				cb err, user, true

	loginfb: (game, facebookToken, options, cb)->
		facebook.validToken facebookToken, (err, me)=>
			return cb err if err?
			@collusers().findOne {network: "facebook", networkid: me.id}, (err, user)=>
				return cb err if err?
				return cb null, user, false if user?

				return cb new errors.PreventRegistration(me), null, false if options?.preventRegistration

				@register game, "facebook", me.id, null, @_buildFacebookProfile(me), (err, user)->
					if me.noBusinessManager 
						#logger.warn "Business Manager for #{game.appid} doesn't exit! "
						user.noBusinessManager = me.noBusinessManager if user? and me.noBusinessManager
					cb err, user, true

	logingp: (game, googleToken, options, cb)->
		google.validToken googleToken, (err, me)=>
			return cb err if err?
			@collusers().findOne  {network: "googleplus", networkid: me.id}, (err, user)=>
				return cb err if err?
				return cb null, user, false if user?
				return cb new errors.PreventRegistration(me), null, false if options?.preventRegistration

				# create account
				@register game, "googleplus", me.id, null, @_buildGooglePlusProfile(me), (err, user)=>
					cb err, user, true

	logingc: (game, id, secret, options, cb)->
		if id isnt secret.playerId then return cb new Error("token is not for this player")
		unless game.config.socialSettings?.gameCenterBundleIdRE then return cb new Error("socialSettings.gameCenterBundleIdRE must be set for GameCenter login")
		unless secret.bundleId.match(game.config.socialSettings.gameCenterBundleIdRE) then return cb new Error("Invalid bundleId")
		
		gamecenter.verify secret, (err, token) => 
			return cb err if err?

			@collusers().findOne  {network: "gamecenter", networkid: id}, (err, user)=>
				return cb err if err?
				return cb null, user, false if user?
				return cb new errors.PreventRegistration(options?.gamecenter || {}), null, false if options?.preventRegistration

				# create account
				@register game, "gamecenter", id, null, @_buildGameCenterProfile(options), (err, user)=>
					cb err, user, true

	convertAccountToEmail: (user_id, email, sha_password)->
		return Q.reject new errors.BadArgument unless /^[^@ ]+@[^\.@ ]+\.[^@ ]+$/.test email
		@_checkAccountForConversion "email", user_id, email
		.then =>
			modification = $set:
				network: "email"
				networkid: email
				networksecret: sha_password
				profile: @_buildEmailProfile(email)
			@collusers().findAndModify {_id : user_id}, {}, modification, {new: true}
		.then (result)->
			logger.debug "converted to e-mail account for #{user_id}"
			return result?.value

	convertAccountToFacebook: (user_id, facebookToken)->
		@facebookValidTokenAsync facebookToken
		.then (me)=>
			@_checkAccountForConversion "facebook", user_id, me.id
			.then =>
				modification = $set:
					network: "facebook"
					networkid: me.id
					networksecret: null
					profile: @_buildFacebookProfile(me)
				@collusers().findAndModify {_id : user_id}, {}, modification, {new: true}
			.then (result)->
				logger.debug "converted to facebook account for #{me.id}" unless err?
				return result?.value

	convertAccountToGooglePlus: (user_id, googleToken)->
		@googleValidTokenAsync googleToken
		.then (me)=>
			@_checkAccountForConversion "googleplus", user_id, me.id
			.then =>
				modification = $set:
					network: "googleplus"
					networkid: me.id
					networksecret: null
					profile: @_buildGooglePlusProfile(me)
				@collusers().findAndModify {_id : user_id}, {}, modification, {new: true}
			.then (result)->
				logger.debug "converted to google+ account for #{me.id}" unless err?
				return result?.value

	convertAccountToGameCenter: (user_id, id, options)->
		@_checkAccountForConversion "gamecenter", user_id, id
		.then =>
			modification = $set:
				network: "gamecenter"
				networkid: id
				networksecret: null
				profile: @_buildGameCenterProfile(options)
			@collusers().findAndModify {_id : user_id}, {}, modification, {new: true}
		.then (result)->
			logger.debug "converted to game center account for #{user_id}" unless err?
			return result?.value

	linkAccountWithFacebook: (user, token, cb)->
		facebook.validToken token, (err, me)=>
			return cb err if err?
			@collusers().findOne {_id: user._id}, (err, user)=>
				return cb err if err?
				return cb new errors.ConnectError("Gamer not found!") unless user? 
				return cb new errors.ConnectError("Already linked to facebook") if user.links?.facebook?
				updated = {}
				updated["links.facebook"] = me.id
				updated["profile.email"] = me.email  unless user.profile.email?
				updated["profile.firstName"] = me.first_name  unless user.profile.firstName?
				updated["profile.lastName"] = me.last_name  unless user.profile.lastName?
				updated["profile.avatar"] = me.avatar  unless user.profile.avatar?
				updated["profile.displayName"] = me.name  unless user.profile.displayName?
				updated["profile.lang"] = me.locale.substr(0,2)  unless user.profile.lang?
				@collusers().update {_id: user._id}, {$set: updated}, (err, result)=>
					cb err, { done: result.result.n}

	linkAccountWithGoogle: (user, token, cb)->
		google.validToken token, (err, me)=>
			return cb err if err?
			@collusers().findOne {_id: user._id}, (err, user)=>
				return cb err if err?
				return cb new errors.ConnectError("Gamer not found!") unless user?
				return cb new errors.ConnectError("Already linked to googleplus") if user.links?.googleplus?
				updated = {}
				updated["links.googleplus"] = me.id
				updated["profile.displayName"] = me.displayName unless user.profile.displayName?
				updated["profile.lang"] = me.language unless user.profile.lang?
				updated["profile.avatar"] = me.image.url if me.image? and not user.profile.avatar?
				updated["profile.email"] = me.emails[0].value if me.emails?[0].value?  and not user.profile.email?
				updated["profile.firstName"] = me.name.givenName if me.name? and not user.profile.firstName?
				updated["profile.lastName"] = me.name.familyName if me.name? and not user.profile.lastName?

				@collusers().update {_id: user._id}, {$set: updated}, (err, result)=>
					cb err, { done: result.result.n}

	unlink: (user, network, cb)->
		return cb new errors.ConnectError("Not linked to #{network}") unless user.links?[network]?
		unset = {}
		unset["links.#{network}"] = ""
		@collusers().update {_id: user._id}, {$unset: unset}, (err, result)=>
			cb err, {done : result.result.n}

	trackDevice: (user_id, device)->
		return unless device?.id?

		@collusers().findOne {_id: user_id, "devices.id" : device.id}, {_id:1, devices:1}, (err, user)=>
			if err? then return logger.error err.message, {stack: err.stack}
			if user? && user.devices?
				deviceExists = each for each in user.devices when each.id is device.id

				if deviceExists?
					return if (deviceExists?.version or 0)>=device.version
				
					logger.debug "user #{user_id} update device #{JSON.stringify(device)}"
					@collusers().update {_id: user_id, "devices.id" : device.id } , { $set: { "devices.$" : device } }, (err, result)=>
						if err? then logger.error err.message, {stack: err.stack}
				else
					logger.debug "user #{user_id} adding device #{JSON.stringify(device)}"
					@collusers().update {_id: user_id} , { $push: { "devices" : device } }, (err, result)=>
						if err? then logger.error err.message, {stack: err.stack}
			else
				logger.debug "user #{user_id} owns #{JSON.stringify(device)}"
				@collusers().update {_id: user_id} , { $addToSet: { devices : device } }, (err, result)=>
					if err? then logger.error err.message, {stack: err.stack}

	registerToken: (user, os, token , domain, cb)->
		device =
			os : os
			token : token
		#TODO: remove previous version with no domain TO BE REMOVED LATER
		@collusers().update {_id : user._id}, { $pull: { tokens : device}}, (err, result)=>
			return cb err if err?
			device.domain = domain
			# add current version with domain
			@collusers().update {_id : user._id}, { $addToSet: { tokens : device}}, (err, result)=>
				return cb err if err?
				#logger.info "user: #{user._id}, token: #{token}, count : #{count}"
				cb null, result.result.n

	unregisterToken: (user, os, token , domain, cb)->
		device =
			os : os
			token : token
		#TODO: remove previous version with no domain TO BE REMOVED LATER
		@collusers().update {_id : user._id}, { $pull: { tokens : device}}, (err, result)=>
			return cb err if err?
			device.domain = domain
			# remove current version with domain
			@collusers().update {_id : user._id}, { $pull: { tokens : device}}, (err, result)=>
				return cb err if err?
				cb null, result.result.n

	devicesToNotify: (domain, user_id, cb)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)

		@collusers().findOne {_id : new ObjectID(user_id)}, { "profile.lang": 1, tokens : 1}, (err, user)=>
			return cb err if err?
			return cb null, null unless user?.tokens?
			 
			tokens = _.filter user.tokens, (t)->
				t.domain is domain

			cb null, tokens, user.profile.lang?.substring(0,2)

	readProfileAsync: (user_id, fields)->
			query =
				_id: user_id

			@collusers().findOne query, fields
			.then (value)=>
				if value?
					delete value._id
					delete value.networksecret
					value
				else
					{}

	_buildEmailProfile: (email)->
		profile =
			email: email
			displayName : email.slice 0, email.indexOf("@")
			lang : "en"
		return profile

	_buildFacebookProfile: (me)->
		profile =
			email: me.email
			firstName : me.first_name
			lastName : me.last_name
			avatar: me.avatar
			displayName : me.name
			lang : me.locale.substr(0,2) if me.locale?
		return profile

	_buildGameCenterProfile: (options)->
		profile =
			displayName: options?.gamecenter?.gcdisplayname || ""
			firstName: options?.gamecenter?.gcalias || ""
			lang: "en"
		return profile

	_buildGooglePlusProfile: (me)->
		profile =
			displayName : me.displayName
			lang : me.language
		profile.avatar = me.image.url if me.image?
		profile.email = me.emails[0].value if me.emails?[0].value?
		profile.firstName = me.name.givenName if me.name?
		profile.lastName = me.name.familyName if me.name?
		return profile

	_checkAccountForConversion: (network, user_id, networkid)->
		@collusers().findOne {_id: user_id}
		.then (user)=>
			throw new errors.ConnectError("Gamer not found!") unless user?
			# not only anonymous account can be converted....
			#return @rejected new errors.ConnectError("Anonymous account required") unless user.network is "anonymous"

			@collusers().findOne {network: network, networkid: networkid}
			.then (user)=>
				throw new errors.ConnectError("UserExists", "#{network}/#{networkid} already exists") if user?
				return

module.exports = new ConnectAPI()
