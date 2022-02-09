/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const xtralife = require('../src/index.js');

const valid_identity = {
	bundleId: "cloud.xtralife.gamecenterauth",
	playerId: "G:1965586982",
	publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer",
	salt: "NRRF0g==",
	signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g==",
	timestamp: 1565253768519
};

const invalid_signature = {
	bundleId: "cloud.xtralife.gamecenterauth",
	playerId: "G:1965586982 this is clearly altered",
	publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer",
	salt: "NRRF0g==",
	signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g==",
	timestamp: 1565253768519
};

const invalid_bundleId = {
	bundleId: "wrong bundleId, should not even attempt to check signature",
	playerId: "G:1965586982",
	publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer",
	salt: "NRRF0g==",
	signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g==",
	timestamp: 1565253768519
};

let game = null;
let othergame = null;
describe("Gamecenter login check", () => {

	before('should configure Xtralife', done => {
		xtralife.configure(function (err) {
			if (err) { return done(err); }
			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			othergame = xtralife.api.game.dynGames['com.clanofthecloud.testgame'];
			return done();
		});
		return null;
	});

	it.skip('should refuse the token if id isnt the right one', done => {
		xtralife.api.connect.logingc(game, "wrong ID", valid_identity, {}, (err, user, created) => {
			should.exist(err);
			return done();
		});
		return null;
	});

	it.skip('should refuse the token if signature is invalid', done => {
		xtralife.api.connect.logingc(game, "G:1965586982", invalid_signature, {}, (err, user, created) => {
			should.exist(err);
			return done();
		});
		return null;
	});

	it.skip('should refuse the token if signature is wrong bundleId', done => {
		xtralife.api.connect.logingc(othergame, "G:1965586982", valid_identity, {}, (err, user, created) => {
			should.exist(err);
			return done();
		});
		return null;
	});

	return it.skip('should accept a valid identity', done => {
		xtralife.api.connect.logingc(game, "G:1965586982", valid_identity, {}, (err, user, created) => {
			should.not.exist(err);
			should.exist(user);
			user.network.should.eql('gamecenter');
			user.networkid.should.eql('G:1965586982');
			return done();
		});
		return null;
	});
});
