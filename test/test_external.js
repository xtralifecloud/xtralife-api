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
const user_id = null;
const token = null;
let context = null;

describe("Xtralife external network", function(){

	before('configure Xtralife', function(done){
		this.timeout(5000);
		return xtralife.configure(function(err){
			should(err).not.be.ok;
			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = {game};
			return done();
		});
	});

	it('should prevent registration', done => xtralife.api.connect.loginExternal(game, "customNetwork","user", "user", {preventRegistration:true}, (err, user, created)=> {
        //console.log err, user, created
        err.name.should.eql("PreventRegistration");
        return done();
    }));

	it('should not connect with a id!=token', done => xtralife.api.connect.loginExternal(game, "customNetwork", "user", "pass", {preventRegistration:true}, (err, user, created)=> {
        err.name.should.eql("BadUserCredentials");
        return done();
    }));

	it('should connect with a id==token', done => xtralife.api.connect.loginExternal(game, "customNetwork", "good", "good", {}, (err, user, created)=> {
        user.network.should.eql("customNetwork");
        user.networkid.should.eql("good");
        return done();
    }));

	it('should not connect with a bad network', done => xtralife.api.connect.loginExternal(game, "Unknown", "good", "good", {}, (err, user, created)=> {
        err.name.should.eql("HookError");
        return done();
    }));

	it('should not connect with a http custom network', done => xtralife.api.connect.loginExternal(game, "http", "good", "good", {}, (err, user, created)=> {
        console.log(err);
        user.network.should.eql("http");
        user.networkid.should.eql("good");
        return done();
    }));

	it('should also work from a batch', () => xtralife.api.game.runBatch(context, domain, 'testLoginExternal', { id: "good", secret: "good" }));
});
