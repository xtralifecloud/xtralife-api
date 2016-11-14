should = require 'should'

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
Redlock = require 'redlock'

describe.skip "Xtralife batch with lock", ()->

	before 'configure Xtralife', (done)->
		this.timeout 5000
		xtralife.configure (err)->
			should(err).not.be.ok

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			context = {game}
			done()

	it 'should create a new gamer', (done)->
		profile =
			displayName : "Test user 1"
			lang: "en"
		xtralife.api.connect.register game, "anonymous", null, null, profile, (err, user)->
			user_id = user._id
			done()

	it 'should mutually exclude each other', (done)->
		counter = 0
		doneafter2 = ()->
			if ++counter is 2 then done()

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 1}
		.then (result)->
			doneafter2()
		.catch done

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 2}
		.then (result)->
			doneafter2()
		.catch done

		return null

	it 'should exclude each other if resource is the same', (done)->
		counter = 0
		doneafter2 = ()->
			if ++counter is 2 then done()

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 1}, "this is the same resource"
		.then (result)->
			doneafter2()
		.catch done

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 2}, "this is the same resource"
		.then (result)->
			doneafter2()
		.catch done

		return null

	it 'should exclude each other if resource is the same even if batch is different', (done)->
		counter = 0
		doneafter2 = ()->
			if ++counter is 2 then done()

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 1}, "this is the same resource"
		.then (result)->
			doneafter2()
		.catch done

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLockCopy', {counter: 2}, "this is the same resource"
		.then (result)->
			doneafter2()
		.catch done

		return null

	it 'should not exclude each other if resource is different', (done)->
		counter = 0
		doneafter2 = ()->
			if ++counter is 2 then done()

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 1}, "this is resource 1"
		.then (result)->
			doneafter2()
		.catch done

		xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 2}, "this is resource 2"
		.then (result)->
			doneafter2()
		.catch done

		return null

	it "should timeout after 200ms", (done)->
		xtralife.api.game.runBatchWithLock context, domain, '__runWithLockTooLong', {counter: 1}, "this is resource 1"
		.catch Q.TimeoutError, (err)->
			err.name.should.eql("TimeoutError")
			done()
		return null

	it "should fail to acquire lock after 3 attempts", (done)->
		xtralife.api.game.redlock.lock("#{domain}.shared resource", 1000).then (lock)->
			xtralife.api.game.runBatchWithLock context, domain, '__runWithLock', {counter: 1}, "shared resource"
			.then (result)->
				done(new Error "should not happen")
			.catch (err)->
				err.name.should.eql 'LockError'
				done()

			setTimeout ()->
				lock.unlock()
			, 700

		return null

