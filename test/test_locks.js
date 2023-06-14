/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const should = require('should');

global.xlenv = require("xtralife-env");

xlenv.override(null, xlenv.Log);

xlenv.override(null, require('./config.js'));
global.logger = xlenv.createLogger(xlenv.logs);

const xtralife = require('../src/index.js');
const Promise = require('bluebird');
const domain = "com.clanofthecloud.cloudbuilder.azerty";

let game = null;
let user_id = null;

let context = null;
const Redlock = require('redlock');

describe("Xtralife batch with lock", function () {

	before('configure Xtralife', function (done) {
		this.timeout(5000);
		return xtralife.configure(function (err) {
			should(err).not.be.ok;

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = { game };
			return done();
		});
	});

	it('should create a new gamer', function () {
		const profile = {
			displayName: "Test user 1",
			lang: "en"
		};
		return xtralife.api.connect.register(game, "anonymous", null, null, profile, function (err, user) {
			user_id = user._id;
		});
	});

	it('should mutually exclude each other', function (done) {
		let counter = 0;
		const doneafter2 = function () {
			if (++counter === 2) { return done(); }
		};

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 1 })
			.then(result => doneafter2()).catch(done);

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 2 })
			.then(result => doneafter2()).catch(done);

		return null;
	});

	it('should exclude each other if resource is the same', function (done) {
		let counter = 0;
		const doneafter2 = function () {
			if (++counter === 2) { return done(); }
		};

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 1 }, "this is the same resource")
			.then(result => doneafter2()).catch(done);

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 2 }, "this is the same resource")
			.then(result => doneafter2()).catch(done);

		return null;
	});

	it('should exclude each other if resource is the same even if batch is different', function (done) {
		let counter = 0;
		const doneafter2 = function () {
			if (++counter === 2) { return done(); }
		};

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 1 }, "this is the same resource")
			.then(result => doneafter2()).catch(done);

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLockCopy', { counter: 2 }, "this is the same resource")
			.then(result => doneafter2()).catch(done);

		return null;
	});

	it('should not exclude each other if resource is different', function (done) {
		let counter = 0;
		const doneafter2 = function () {
			if (++counter === 2) { return done(); }
		};

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 1 }, "this is resource 1")
			.then(result => doneafter2()).catch(done);

		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 2 }, "this is resource 2")
			.then(result => doneafter2()).catch(done);

		return null;
	});

	it("should timeout after 200ms", function (done) {
		xtralife.api.game.runBatchWithLock(context, domain, '__runWithLockTooLong', { counter: 1 }, "this is resource 1")
			.catch(function (err) {
				err.name.should.eql("TimeoutError");
				return done();
			});
		return null;
	});

	return it("should fail to acquire lock after 3 attempts", function (done) {
		xtralife.api.game.redlock.acquire(`${domain}.shared resource`, 1000).then(function (lock) {
			xtralife.api.game.runBatchWithLock(context, domain, '__runWithLock', { counter: 1 }, "shared resource")
				.then(result => done(new Error("should not happen"))).catch(function (err) {
					err.name.should.eql('ExecutionError');
					return done();
				});

			return setTimeout(() => lock.release()
				, 800);
		});

		return null;
	});
});

