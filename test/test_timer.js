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

const domain = "com.clanofthecloud.cloudbuilder.azerty";
const indexName = "test";
const Promise = require('bluebird')

let game = null;
let user_id = null;

let context = null;

describe("Xtralife timer module", function () {

	before('configure Xtralife', function (done) {
		this.timeout(5000);
		return xtralife.configure(function (err) {
			should(err).not.be.ok;

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = { game };
			return done();
		});
	});

	before('should create a new gamer', function (done) {
		const profile = {
			displayName: "Test user",
			lang: "en"
		};
		return xtralife.api.connect.register(game, "anonymous", null, null, profile, function (err, user) {
			user_id = user._id;
			return done();
		});
	});


	// first messages are added in order, only one message in the queue at any time
	// tests scheduling of next message

	let upserted = null;

	it("Test 1: should add a first timer", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .1, timerId: 'testTimer1', description: 'first timer test', customData: { q: 1 } }, "timerTrigger")
		.then(function (timers) {
			upserted = timers;
			return timers.should.have.property('testTimer1');
		}));

	it("should add a second timer", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .2, timerId: 'testTimer2', description: 'second timer test', customData: { q: 2 } }, "timerTrigger")
		.then(function (timers) {
			timers._id.should.eql(upserted._id); // check there's only one list of timers

			timers.should.have.property('testTimer1');
			return timers.should.have.property("testTimer2");
		}));


	it("should get all timers and check expiresInMs", () => xtralife.api.timer.get(context, domain, user_id)
		.then(function (timers) {
			timers.should.have.property("testTimer1");
			timers.should.have.property("testTimer2");
			timers.testTimer1.should.have.property("expiresInMs");
			timers.testTimer2.should.have.property("expiresInMs");

			should((90 < timers.testTimer1.expiresInMs && timers.testTimer1.expiresInMs < 100));
			return should((190 < timers.testTimer2.expiresInMs && timers.testTimer2.expiresInMs < 200));
		}));


	it("should wait until messages are received (1 then 2)", done => setTimeout(done, 250));

	// Now messages are added in reverse order, so we'll have 2 timer messages in the queue
	// tests avoiding to requeue a message if it's already in the queue

	it("Test 2: should add a first timer", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .2, timerId: 'testTimer1', description: 'first timer test', customData: { q: 1 } }, "timerTrigger")
		.then(timers => timers.should.have.property('testTimer1')));

	it("should add a second timer before the first one", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .1, timerId: 'testTimer2', description: 'second timer test', customData: { q: 2 } }, "timerTrigger")
		.then(function (timers) {
			timers.should.have.property('testTimer1');
			return timers.should.have.property("testTimer2");
		}));

	it("should wait until messages are received (2 then 1)", function (done) {
		this.timeout(500);
		return setTimeout(done, 250);
	});

	// tests retiming of already scheduled timer in a further future

	it("Test 3: should add a first timer at 1s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .1, timerId: 'testTimer1', description: 'first timer test', customData: { q: 1 } }, "timerTrigger")
		.then(timers => timers.should.have.property('testTimer1')));


	it("should add a second timer at 1s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .1, timerId: 'testTimer2', description: 'second timer test', customData: { q: 2 } }, "timerTrigger")
		.then(function (timers) {
			timers.should.have.property('testTimer1');
			return timers.should.have.property("testTimer2");
		}));

	it("should change second timer to 2s", done => setTimeout(() => xtralife.api.timer.retime(context, domain, user_id, 'testTimer2', .2)
		.then(timers => done()).catch(done)
		, 50)); // there's a race condition here...

	it("should wait until messages are received (1 then 2)", done => setTimeout(done, 250));

	// tests retiming of already scheduled timer in a closer future

	it("Test 4: should add a first timer at 2s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .2, timerId: 'testTimer1', description: 'first timer test', customData: { q: 1 } }, "timerTrigger")
		.then(timers => timers.should.have.property('testTimer1')));


	it("should add a second timer at 3s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: .3, timerId: 'testTimer2', description: 'second timer test', customData: { q: 2 } }, "timerTrigger")
		.then(function (timers) {
			timers.should.have.property('testTimer1');
			return timers.should.have.property("testTimer2");
		}));


	it("should change second timer to 1s", done => setTimeout(() => xtralife.api.timer.retime(context, domain, user_id, 'testTimer2', .1)
		.then(timers => done()).catch(done)
		, 50)); // there's a race condition here...

	it("should wait until messages are received (2 then 1)", done => setTimeout(done, 250));

	// tests relative proportional retiming of already scheduled timer in a closer future

	it("Test 5: should add a first timer at 2s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: 2, timerId: 'testTimer1', description: 'first timer test', customData: { q: 1 } }, "timerTrigger")
		.then(timers => timers.should.have.property('testTimer1')));

	it("should add a second timer at 3s", () => xtralife.api.timer.add(context, domain, user_id, { expirySeconds: 3, timerId: 'testTimer2', description: 'second timer test', customData: { q: 2 } }, "timerTrigger")
		.then(function (timers) {
			timers.should.have.property('testTimer1');
			return timers.should.have.property("testTimer2");
		}));

	it("should change second timer to 1s", done => setTimeout(() => xtralife.api.timer.retime(context, domain, user_id, 'testTimer2', -0.333333333)
		.then(timers => done()).catch(done)
		, 50)); // there's a race condition here...

	it("should wait until messages are received (2 then 1)", function (done) {
		this.timeout(5000);
		return setTimeout(done, 2500);
	});

	it("should add timer from batch", function (done) {
		this.timeout(5000);
		xtralife.api.game.runBatch(context, domain, 'testTimer', { user_id });
		return setTimeout(done, 2500);
	});

	it("should run recursive timers", function (done) {
		this.timeout(5000);
		xtralife.api.game.runBatch(context, domain, 'testRecursiveTimer', { user_id });
		return setTimeout(done, 4500);
	});

	return after("should remove the recursive timer", () => xtralife.api.timer.delete(context, domain, user_id, 'timerId'));
}); // timerId is the timer name

describe.skip("test then catch then", function () {

	const Q = require('bluebird');

	return it("shoud let me catch and continue", () => Promise.resolve(null).then(function () {
		throw new Error("thrown");
	}).catch(function (err) {
		err.message.should.eql('thrown');
		return 'continues';
	}).then(function (result) {
		result.should.eql('continues');
		throw new Error("thrown2");
	}).catch(function (err) {
		err.message.should.eql('thrown2');
		return 'continues2';
	}).then(result => result.should.eql('continues2')));
});
