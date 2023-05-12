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

let domain = "com.clanofthecloud.cloudbuilder.azerty";
const indexName = "test";

let game = null;
let user_id = null;
let user_id2 = null;

let context = null;
domain = 'com.clanofthecloud.cloudbuilder.azerty';

describe("Xtralife KV store module", function () {

	before('configure Xtralife', function (done) {
		this.timeout(5000);
		return xtralife.configure(function (err) {
			should(err).not.be.ok;

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = { game };
			return done();
		});
	});

	it('should create 2 new gamers', function () {
		let profile = {
			displayName: "Test user 1",
			lang: "en"
		};
		return xtralife.api.connect.register(game, "anonymous", null, null, profile, function (err, user) {
			user_id = user._id;
			profile = {
				displayName: "Test user 2",
				lang: "en"
			};
			return xtralife.api.connect.register(game, "anonymous", null, null, profile, function (err, user) {
				user_id2 = user._id;
			});
		});
	});

	it('should create a new key', () => xtralife.api.kv.create(context, domain, user_id, 'hello', 'world', {})
		.then(result => result.ok.should.eql(1)));

		it('should send a duplicate key error if attempting to re-create the key', function () {
			return xtralife.api.kv.create(context, domain, user_id, 'hello', 'world', {})
				.catch(function (err) {
					err.code.should.eql(11000);
				});
		});

	it('should read the key', () => xtralife.api.kv.get(context, domain, user_id, 'hello')
		.then(value => value.value.should.eql('world')));

	it('should not read key with user_id2', () => xtralife.api.kv.get(context, domain, user_id2, 'hello')
		.then(value => should(value).eql(null)));

	it('should set the key', () => xtralife.api.kv.set(context, domain, user_id, 'hello', { itis: "an object" })
		.then(() => xtralife.api.kv.get(context, domain, user_id, 'hello')).then(value => value.value.should.eql({ itis: "an object" })));


	it('should update the key', () => xtralife.api.kv.updateObject(context, domain, user_id, 'hello', { itis: "another object", "with.subobject": "like this" })
		.then(() => xtralife.api.kv.get(context, domain, user_id, 'hello')).then(value => value.value.should.eql({ itis: "another object", with: { subobject: "like this" } })));

	it('should reset the key', () => xtralife.api.kv.set(context, domain, user_id, 'hello', "world"));

	it('should change ACL then read/write key with user_id2', () => xtralife.api.kv.changeACL(context, domain, user_id, 'hello', { r: '*', w: [user_id, user_id2] })
		.then(() => xtralife.api.kv.get(context, domain, user_id2, 'hello')).then(value => value.value.should.eql('world')).then(() => xtralife.api.kv.set(context, domain, user_id2, 'hello', 'WORLD')).then(() => xtralife.api.kv.get(context, domain, user_id, 'hello')).then(value => value.value.should.eql('WORLD')));

	it('should also work from a batch', () => xtralife.api.game.runBatch(context, domain, 'testkvcreate', { user_id })
		.then(result => xtralife.api.game.runBatch(context, domain, 'testkvget', { user_id }))
		.then(function (result) {
			result.value.should.eql('works too');
			return xtralife.api.game.runBatch(context, domain, 'testkvset', { user_id });
		})
		.then(result => xtralife.api.game.runBatch(context, domain, 'testkvget', { user_id }))
		.then(function (result) {
			result.value.should.eql('still works');
			return xtralife.api.game.runBatch(context, domain, 'testkvdel', { user_id });
		}));

	return after('should delete the key', () => xtralife.api.kv.del(context, domain, user_id, 'hello')
		.then(function (result) {
			result.ok.should.eql(1);
			return result.n.should.eql(1);
		}));
});

