/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const should = require('should');
const crypto = require('crypto');

global.xlenv = require("xtralife-env");

xlenv.override(null, xlenv.Log);

xlenv.override(null, require('./config.js'));
global.logger = xlenv.createLogger(xlenv.logs);

const xtralife = require('../src/index.js');
const Q = require('bluebird');
const domain = "com.clanofthecloud.cloudbuilder.azerty";

let game = null;
let user_id = null;

let context = null;
let token = null;

const jwt = require('jsonwebtoken');

const secret = "this is a game specific secret";


describe("Xtralife JWT token issuance", function(){

	before('configure Xtralife', function(done){
		this.timeout(5000);
		return xtralife.configure(function(err){
			should(err).not.be.ok;

			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = {game};
			return done();
		});
	});

	before('should create a new gamer', function(done){
		const profile = {
			displayName : "Test user 1",
			lang: "en"
		};
		return xtralife.api.connect.register(game, "anonymous", null, null, profile, function(err, user){
			user_id = user._id;
			return done();
		});
	});

	it('should issue a jwt token for a gamer', function(){

		// issue and remember token
		token = xtralife.api.user.sandbox(context).account.getJWToken(user_id, domain, secret, {hello: "world", isThePayload: true});

		const key = crypto.createHash('sha256').update(secret + domain).digest('hex');

		const decoded = jwt.verify(token, key);

		decoded.user_id.should.eql(user_id.toString());
		decoded.domain.should.eql(domain);
		decoded.payload.hello.should.eql("world");
		decoded.payload.isThePayload.should.eql(true);
		decoded.sub.should.eql("auth");
		return decoded.iss.should.eql("xtralife-api");
	});

	it('should fail with invalid secret', function(done){

		const key = crypto.createHash('sha256').update("WRONG SECRET" + domain).digest('hex');

		try {
			return jwt.verify(token, key);
		} catch (JsonWebTokenError) {
			return done();
		}
	});

	return it('should fail with invalid domain', function(done){

		const key = crypto.createHash('sha256').update(secret + "INVALID DOMAIN").digest('hex');

		try {
			return jwt.verify(token, key);
		} catch (JsonWebTokenError) {
			return done();
		}
	});
});
