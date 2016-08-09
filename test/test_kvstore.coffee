should = require 'should'

global.xlenv = require "xtralife-env"

xlenv.override null, xlenv.Log

xlenv.override null, require './config.coffee'
global.logger = xlenv.createLogger xlenv.logs

xtralife = require '../src/index.coffee'

domain = "com.clanofthecloud.cloudbuilder.azerty"
indexName = "test"

game = null
user_id = null
user_id2 = null

context = null
domain = 'com.clanofthecloud.cloudbuilder.azerty'

describe "Xtralife KV store module", ()->

	before 'configure Xtralife', (done)->
		this.timeout 5000
		xtralife.configure (err)->
			should(err).not.be.ok

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			context = {game}
			done()

	it 'should create 2 new gamers', (done)->
		profile =
			displayName : "Test user 1"
			lang: "en"
		xtralife.api.connect.register game, "anonymous", null, null, profile, (err, user)->
			user_id = user._id

			profile =
				displayName : "Test user 2"
				lang: "en"
			xtralife.api.connect.register game, "anonymous", null, null, profile, (err, user)->
				user_id2 = user._id
				done()

	it 'should create a new key', ->
		xtralife.api.kv.create context, domain, user_id, 'hello', 'world', {}
		.then (result)->
			result.ok.should.eql 1

	it 'should send a duplicate key error if attempting to re-create the key', (done)->
		xtralife.api.kv.create context, domain, user_id, 'hello', 'world', {}
		.catch (err)->
			err.code.should.eql 11000
			done()
		return null

	it 'should read the key', ->
		xtralife.api.kv.get context, domain, user_id, 'hello'
		.then (value)->
			value.value.should.eql 'world'

	it 'should not read key with user_id2', ->
		xtralife.api.kv.get context, domain, user_id2, 'hello'
		.then (value)->
			should(value).eql null

	it 'should set the key', ->
		xtralife.api.kv.set context, domain, user_id, 'hello', {itis: "an object"}
		.then ->
			xtralife.api.kv.get context, domain, user_id, 'hello'
		.then (value)->
			value.value.should.eql {itis: "an object"}


	it 'should update the key', ->
		xtralife.api.kv.updateObject context, domain, user_id, 'hello', {itis: "another object", "with.subobject": "like this"}
		.then ->
			xtralife.api.kv.get context, domain, user_id, 'hello'
		.then (value)->
			value.value.should.eql {itis: "another object", with: {subobject: "like this"}}

	it 'should reset the key', ->
		xtralife.api.kv.set context, domain, user_id, 'hello', "world"

	it 'should change ACL then read/write key with user_id2', ->
		xtralife.api.kv.changeACL context, domain, user_id, 'hello', {r: '*', w: [user_id, user_id2]}
		.then ->
			xtralife.api.kv.get context, domain, user_id2, 'hello'
		.then (value)->
			value.value.should.eql 'world'
		.then ->
			xtralife.api.kv.set context, domain, user_id2, 'hello', 'WORLD'
		.then ->
			xtralife.api.kv.get context, domain, user_id, 'hello'
		.then (value)->
			value.value.should.eql 'WORLD'

	it 'should also work from a batch', ->
		xtralife.api.game.runBatch context, domain, 'testkvcreate', {user_id}
		.then (result)->
			xtralife.api.game.runBatch context, domain, 'testkvget', {user_id}
		.then (result)->
			result.value.should.eql 'works too'
			xtralife.api.game.runBatch context, domain, 'testkvset', {user_id}
		.then (result)->
			xtralife.api.game.runBatch context, domain, 'testkvget', {user_id}
		.then (result)->
			result.value.should.eql 'still works'
			xtralife.api.game.runBatch context, domain, 'testkvdel', {user_id}

	after 'should delete the key', ->
		xtralife.api.kv.del context, domain, user_id, 'hello'
		.then (result)->
			result.ok.should.eql 1
			result.n.should.eql 1

