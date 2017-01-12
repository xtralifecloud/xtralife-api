should = require 'should'
crypto = require 'crypto'

global.xlenv = require "xtralife-env"

xlenv.override null, xlenv.Log

xlenv.override null, require './config.coffee'
global.logger = xlenv.createLogger xlenv.logs

xtralife = require '../src/index.coffee'
Q = require 'bluebird'
domain = "com.clanofthecloud.cloudbuilder.azerty"

game = null
user_id = null
token = null
context = null

describe "Xtralife external network", ()->

	before 'configure Xtralife', (done)->
		this.timeout 5000
		xtralife.configure (err)->
			should(err).not.be.ok
			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			context = {game}
			done()

	it 'should prevent registration', (done)->
		xtralife.api.connect.loginExternal game, "customNetwork","user", "user", {preventRegistration:true}, (err, user, created)=>
			#console.log err, user, created
			err.name.should.eql "PreventRegistration"
			done()

	it 'should not connect with a id!=token', (done)->
		xtralife.api.connect.loginExternal game, "customNetwork", "user", "pass", {preventRegistration:true}, (err, user, created)=>
			err.name.should.eql "BadUserCredentials"
			done()

	it 'should connect with a id==token', (done)->
		xtralife.api.connect.loginExternal game, "customNetwork", "good", "good", {}, (err, user, created)=>
			user.network.should.eql "customNetwork"
			user.networkid.should.eql "good"
			done()

	it 'should not connect with a bad network', (done)->
		xtralife.api.connect.loginExternal game, "Unknown", "good", "good", {}, (err, user, created)=>
			err.name.should.eql "HookError"
			done()

	it 'should not connect with a http custom network', (done)->
		xtralife.api.connect.loginExternal game, "http", "good", "good", {}, (err, user, created)=>
			console.log err
			user.network.should.eql "http"
			user.networkid.should.eql "good"
			done()
