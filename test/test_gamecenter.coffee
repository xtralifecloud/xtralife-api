xtralife = require '../src/index.coffee'

valid_identity = {
    bundleId: "cloud.xtralife.gamecenterauth"
    playerId: "G:1965586982"
    publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer"
    salt: "NRRF0g=="
    signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g=="
    timestamp: 1565253768519
}

invalid_signature = {
    bundleId: "cloud.xtralife.gamecenterauth"
    playerId: "G:1965586982 this is clearly altered"
    publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer"
    salt: "NRRF0g=="
    signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g=="
    timestamp: 1565253768519
}

invalid_bundleId = {
    bundleId: "wrong bundleId, should not even attempt to check signature"
    playerId: "G:1965586982"
    publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-4.cer"
    salt: "NRRF0g=="
    signature: "cf6d+TOnCFABj1+CT5dS4H7zU+xgCgos9gI3TsqcHyl7Q73UZHkdeAEM+Lq4zXtMOz14ieK5AhxorjkrxCnotH7JLMQhdGwyM11PIsA4Yugu+Vm9RqvY6HuAsNKpdIn1XvyIKwff7vXpCWwfbk6r8Idy8kHnAAOgCUxwE9vLXYGVov6KTDjrjM1LggvYjCY7cvPB8AjhPsA28GkIMZD04JSZEpZAAwTJCiDCwPoyZxBUciIe5NUOSboWZP8CjmNUB5WFl4Fwean4Vi0a8+tr1/UZdfUsB4eTqXoQOv6zgmvFjIU+XQ7gGGEUDbtJrc+LInXouN4nLNAY0cD4ItgA3g=="
    timestamp: 1565253768519
}

game = null
othergame = null
describe "Gamecenter login check", ()=>

	before 'should configure Xtralife', (done)=>
		xtralife.configure (err)->
			if err then return done(err)
			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			othergame = xtralife.api.game.dynGames['com.clanofthecloud.testgame']
			done()
		null

	it 'should refuse the token if id isnt the right one', (done)=>
		xtralife.api.connect.logingc game, "wrong ID", valid_identity, {}, (err, user, created) =>
			should.exist(err)
			done()
		null

	it 'should refuse the token if signature is invalid', (done)=>
		xtralife.api.connect.logingc game, "G:1965586982", invalid_signature, {}, (err, user, created) =>
			should.exist(err)
			done()
		null

	it 'should refuse the token if signature is wrong bundleId', (done)=>
		xtralife.api.connect.logingc othergame, "G:1965586982", valid_identity, {}, (err, user, created) =>
			should.exist(err)
			done()
		null

	it 'should accept a valid identity', (done)=>
		xtralife.api.connect.logingc game, "G:1965586982", valid_identity, {}, (err, user, created) =>
			should.not.exist(err)
			should.exist(user)
			user.network.should.eql('gamecenter')
			user.networkid.should.eql('G:1965586982')
			done()
		null
