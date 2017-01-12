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

context = null
token = null

jwt = require 'jsonwebtoken'

secret = "this is a game specific secret"


describe "Xtralife JWT token issuance", ()->

	before 'configure Xtralife', (done)->
		this.timeout 5000
		xtralife.configure (err)->
			should(err).not.be.ok

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			context = {game}
			done()

	before 'should create a new gamer', (done)->
		profile =
			displayName : "Test user 1"
			lang: "en"
		xtralife.api.connect.register game, "anonymous", null, null, profile, (err, user)->
			user_id = user._id
			done()

	it 'should issue a jwt token for a gamer', ()->

		# issue and remember token
		token = xtralife.api.user.sandbox(context).account.getJWToken user_id, domain, secret, {hello: "world", isThePayload: true}

		key = crypto.createHash('sha256').update(secret + domain).digest('hex')

		decoded = jwt.verify token, key

		decoded.user_id.should.eql(user_id.toString())
		decoded.domain.should.eql(domain)
		decoded.payload.hello.should.eql("world")
		decoded.payload.isThePayload.should.eql(true)
		decoded.sub.should.eql("auth")
		decoded.iss.should.eql("xtralife-api")

	it 'should fail with invalid secret', (done)->

		key = crypto.createHash('sha256').update("WRONG SECRET" + domain).digest('hex')

		try
			jwt.verify(token, key)
		catch JsonWebTokenError
			done()

	it 'should fail with invalid domain', (done)->

		key = crypto.createHash('sha256').update(secret + "INVALID DOMAIN").digest('hex')

		try
			jwt.verify(token, key)
		catch JsonWebTokenError
			done()
