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
const domain = "com.clanofthecloud.cloudbuilder.azerty";

let game = null;
const user_id = null;
const token = null;
let context = null;

describe("Xtralife external network", function () {

    before('configure Xtralife', function (done) {
        this.timeout(5000);
        return xtralife.configure(function (err) {
            should(err).not.be.ok;
            game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
            context = { game };
            return done();
        });
    });

    it('should prevent registration',  () => xtralife.api.connect.loginExternal(game, "customNetwork", {id: "user", secret: "user"}, { preventRegistration: true }, (err, user, created) => {
        return err.name.should.eql("PreventRegistration");
    }));

    it('should not connect with a id!=token', () => xtralife.api.connect.loginExternal(game, "customNetwork", {id: "user", secret: "pass"}, { preventRegistration: true }, (err, user, created) => {
        return err.name.should.eql("BadUserCredentials");
    }));

    it('should connect with a id==token', () => xtralife.api.connect.loginExternal(game, "customNetwork", {id: "good", secret: "good"}, {}, (err, user, created) => {
        user.network.should.eql("customNetwork");
        return user.networkid.should.eql("good");
    }));

    it('should not connect with a bad network', () => xtralife.api.connect.loginExternal(game, "Unknown", {id: "good", secret: "good"}, {}, (err, user, created) => {
        return err.name.should.eql("HookError");
    }));

    it.skip('should not connect with a http custom network', () => xtralife.api.connect.loginExternal(game, "http", {id: "good", secret: "good"}, {}, (err, user, created) => {
        console.log(err);
        user.network.should.eql("http");
        return user.networkid.should.eql("good");
    }));

    it('should also work from a batch', () => xtralife.api.game.runBatch(context, domain, 'testLoginExternal', { id: "good", secret: "good" }));
});
