

async = require "async"
extend = require 'extend'
rs = require "randomstring"
flatten = require "flat"

ObjectID = require("mongodb").ObjectID

facebook = require "./network/facebook.coffee"
google = require "./network/google.coffee"
errors = require "./../errors.coffee"
_ = require "underscore"

AbstractAPI = require "../AbstractAPI.coffee"


class OutlineAPI extends AbstractAPI
	constructor: ()->
		super()

	# helpers
	collusers: ->
		@coll("users")

	colldomains: ->
		@coll("domains")
	
	configure: (@xtralifeapi, callback)->
		logger.info "Outline initialized"
		callback null

	onDeleteUser: (userid, cb)->
		logger.debug "delete user #{userid} for outline"
		cb null

	outline: (game, user_id, globaldomains, cb)->
		domains = _.union [], globaldomains 
		privdom = @xtralifeapi.game.getPrivateDomain(game.appid)
		domains.push privdom

		#TODO remove "gameRelated" section when new route available
		@collusers().findOne {_id : user_id} , (err, global)=>
			return cb err if err?
			delete global._id
			delete global.networksecret
			outline = global
			@colldomains().find({domain: {"$in" : domains}, user_id : user_id}).toArray (err, docs)=>
				return cb err if err?
				for doc in docs
					delete doc._id
					delete doc.user_id
					doc.domain = "private" if doc.domain == privdom 
					
					# TODO remove in next release !
					#if doc.domain == "private"
					#	outline.gameRelated = doc
					#	delete outline.gameRelated.domain

				outline.domains = docs
				cb err, outline

	get: (game, user_id, domains, cb)->
		if typeof domains == "function"
			cb = domains
			domains = [] 
		@outline game, user_id, domains, (err, outline)->
			return cb err if err?
			outline.servertime = new Date()
			cb err, outline

	getflat: (game, user_id, domains, cb)->
		if typeof domains == "function"
			cb = domains
			domains = [] 
		@outline game, user_id, domains, (err, outline)=>
			cb err, flatten(JSON.parse(JSON.stringify(outline)))

module.exports = new OutlineAPI()
