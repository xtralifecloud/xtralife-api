
should = require 'should'
crypto = require 'crypto'

global.xlenv = require "xtralife-env"

xlenv.override null, xlenv.Log
global.logger = xlenv.createLogger xlenv.logs

xlenv.override null, require './config.coffee'


xtralife = require '../src/index.coffee'

signPassword = (val, secret)->
	cipher = crypto.createCipher 'aes-256-cbc', secret
	coded = cipher.update val, 'utf8', 'base64'
	coded += cipher.final 'base64'
	coded

#console.log xtralife.routes

describe.skip "Xtralife Routes", ()->
	#Helps to test with .only
	before 'configure Xtralife', (done)->
		xtralife.configure (err)->
			should(err).not.be.ok
			done()

	describe "leaderbords", ()->
		it "rebuild lb test", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				return done(err) if err?			
				xtralife.api.leaderboard.rebuild game, "test", (err, out)->
					should(err).not.be.ok
					console.log out
					done err

	describe.skip "user routes", ()->
		it.skip 'register user should success', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				context=
					game: game
					options: 
						pseudo: 'roro3'
						password : signPassword('pass', game.apisecret)
						email : 'roro3@cotc.com'
						displayName : 'roro le super héros'
						lang : 'fr'
				xtralife.registerUser context, (err, data)->
					should(err).not.be.ok
					done()			
					#console.log "data = #{JSON.stringify(data)}"

		it 'register existing pseudo should fail', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				context=
					game: game
					options:
						pseudo: 'roro'
						password : signPassword('pass', game.apisecret)
						email : 'roro@cotc.com'
						displayName : 'roro le héros'
						lang : 'fr'
				xtralife.registerUser context, (err, data)->
					should(err).be.ok
					done()
					console.log "err = #{JSON.stringify(err)}"
					#console.log "data = #{JSON.stringify(data)}"

		it.skip 'profile should success', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				xtralife.api.user.existPseudo 'roro', (err, user)->
					should(err).not.be.ok
					should(user).be.ok
					context=
						route: 'profile'
						game: game
						user: user
						options: {}
					xtralife.loggedroute context, (err, data)->
						should(err).not.be.ok
						done()
						#console.log "data = #{JSON.stringify(data)}"

	describe.skip "login routes", ()->
		it 'login pseudo/pass should success', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				context=
					game: game
					options: 
						ident: 'roro'
						password : signPassword('pass', game.apisecret)
				xtralife.login "cotc", context, (err, logged, data)->
					should(err).not.be.ok
					done()	
					#console.log "err = #{JSON.stringify(err)}"
					#console.log "logged = #{logged}"
					#console.log "data = #{JSON.stringify(data)}"

		it 'login email/pass should success', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				context=
					game: game
					options: 
						ident: 'roro@cotc.com'
						password : signPassword('pass', game.apisecret)
				xtralife.login "cotc", context, (err, logged, data)->
					should(err).not.be.ok
					done()	
					#console.log "err = #{JSON.stringify(err)}"
					#console.log "logged = #{logged}"
					#console.log "data = #{JSON.stringify(data)}"

		it.skip 'login facebook should success', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				should(err).not.be.ok
				should(game).be.ok
				context=
					game: game
					options:
						facebookToken: 'xxxx'
				xtralife.login "facebook", context, (err, logged, data)->
					should(err).not.be.ok
					done()	
					#console.log "err = #{JSON.stringify(err)}"
					#console.log "logged = #{logged}"
					#console.log "data = #{JSON.stringify(data)}"


	describe.skip "transaction routes", ()->
		it 'should pass unit tests for balance manipulation', ->
			xtralife.api.transaction._insufficientBalances({},{}).length.should.eql(0)
			xtralife.api.transaction._insufficientBalances({},{test: 1}).length.should.eql(0)
			xtralife.api.transaction._insufficientBalances({},{test: -1}).should.eql(["test"])
			xtralife.api.transaction._insufficientBalances({test:1},{test: -2}).should.eql(["test"])
			xtralife.api.transaction._insufficientBalances({test:1},{test: -1}).length.should.eql(0)
			xtralife.api.transaction._insufficientBalances({test:0},{test: -1}).length.should.eql(1)
			xtralife.api.transaction._insufficientBalances({testa:0},{testb: -1}).length.should.eql(1)
			xtralife.api.transaction._insufficientBalances({testa:0, testb:0},{testb: -1}).length.should.eql(1)
			xtralife.api.transaction._insufficientBalances({testa:0, testb:1},{testb: -1}).length.should.eql(0)

			xtralife.api.transaction._adjustBalance({},{}).should.eql({})
			xtralife.api.transaction._adjustBalance({a:1},{}).should.eql({a:1})
			xtralife.api.transaction._adjustBalance({a:1},{a:1}).should.eql({a:2})
			xtralife.api.transaction._adjustBalance({a:1},{a:-1}).should.eql({a:0})
			xtralife.api.transaction._adjustBalance({a:1, b:0},{a:-1}).should.eql({a:0, b:0})

			xtralife.api.transaction._insufficientBalances({ "Gold" : 462, "fail" : 0 }, {"fail":-100}).length.should.eql(1)


		it 'transaction with amount>balance should fail', (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.exist '540036208f760125c721c529', (err, user)->
					xtralife.api.transaction.transaction "test", user._id, {"fail":-100}, "should fail", (err, balance)->
						err.error.should.eql(49)

						xtralife.api.transaction.transaction "test", user._id, {"Gold":-1000000}, "should fail", (err, balance)->
							err.error.should.eql(49)
							done()

	describe.skip "virtualfs", ->

		it "should support virtualfs", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				if err? then return done(err)
				xtralife.api.user.exist '540036208f760125c721c529', (err, user)->
					if err? then return done(err)
					xtralife.api.virtualfs.write "test", user._id, "/game/own/test", "OK", (err, update)->
						if err? then return done(err)
						xtralife.api.virtualfs.read "test", user._id, "/game/own/test", (err, fs)->
							if err? then return done(err)

							fs['/game/own/test'].should.eql("OK")
							xtralife.api.virtualfs.read "test", user._id, "/game/own/test", (err, res)->
								if err? then return done(err)
								res['/game/own/test'].should.eql("OK")

								xtralife.api.virtualfs.delete "test", user._id, "/game/own/test", (err, count)->
									if err? then return done(err)
									xtralife.api.virtualfs.read "test", user._id, "/game/own/test", (err, fs)->
										if err? then return done(err)
										done(err)

		it.skip 'should wait a while', (done)->
			setTimeout ->
				require("../src/counters.coffee").counters.close()
				done()
			, 20000

	describe.skip "friendship", ->

		it "should add friend", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.existPseudo 'roro', (err, user)->
					xtralife.api.user.existPseudo 'sdk', (err, friend)->
						xtralife.api.user.setFriendStatus game.appid, user._id, friend._id, "1", (err, status)->
							should(err).not.be.ok
							xtralife.api.user.getFriends game.appid, user._id, (err, friends)->
								should(err).not.be.ok
								friends.should.be.instanceof(Array)
								for each in friends
									return done() if each.pseudo=="sdk"
								(1).should.eql(0, 'sdk not found in friends')

		it "should forget friend", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.existPseudo 'roro', (err, user)->
					xtralife.api.user.existPseudo 'rolandvl', (err, friend)->
						xtralife.api.user.setFriendStatus game.appid, user._id, friend._id, "3", (err, status)->
							should(err).not.be.ok
							xtralife.api.user.getFriends game.appid, user._id, (err, friends)->
								should(err).not.be.ok
								friends.should.be.instanceof(Array)
								for each in friends
									return (1).should.eql(0, 'rolandvl still in friends') if each.pseudo=="rolandvl"
								xtralife.api.user.getBlacklistedUsers game.appid, user._id, (err, friends)->
									should(err).not.be.ok
									friends.should.be.instanceof(Array)
									for each in friends
										return (1).should.eql(0, 'rolandvl still in blacklist') if each.pseudo=="rolandvl"
									done()

		it "should add friend", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.existPseudo 'roro', (err, user)->
					xtralife.api.user.existPseudo 'rolandvl', (err, friend)->
						xtralife.api.user.setFriendStatus game.appid, user._id, friend._id, "1", (err, status)->
							should(err).not.be.ok
							xtralife.api.user.getFriends game.appid, user._id, (err, friends)->
								should(err).not.be.ok
								friends.should.be.instanceof(Array)
								for each in friends
									return done() if each.pseudo=="rolandvl"
								(1).should.eql(0, 'rolandvl not found in friends')

		it "should blacklist user", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.existPseudo 'roro', (err, user)->
					xtralife.api.user.existPseudo 'rolandvl', (err, friend)->
						xtralife.api.user.setFriendStatus game.appid, user._id, friend._id, "2", (err, status)->
							should(err).not.be.ok
							xtralife.api.user.getBlacklistedUsers game.appid, user._id, (err, friends)->
								should(err).not.be.ok
								#console.log friends
								friends.should.be.instanceof(Array)
								for each in friends
									return done() if each.pseudo=="rolandvl"
								(1).should.eql(0, 'rolandvl not found in blacklist')

		it "should forget blacklist", (done)->
			xtralife.api.game.existsKey 'cloudbuilder-key', (err, game)->
				xtralife.api.user.existPseudo 'roro', (err, user)->
					xtralife.api.user.existPseudo 'rolandvl', (err, friend)->
						xtralife.api.user.setFriendStatus game.appid, user._id, friend._id, "3", (err, status)->
							should(err).not.be.ok
							xtralife.api.user.getFriends game.appid, user._id, (err, friends)->
								should(err).not.be.ok
								friends.should.be.instanceof(Array)
								for each in friends
									return (1).should.eql(0, 'rolandvl still in friends') if each.pseudo=="rolandvl"
								xtralife.api.user.getBlacklistedUsers game.appid, user._id, (err, friends)->
									should(err).not.be.ok
									friends.should.be.instanceof(Array)
									for each in friends
										return (1).should.eql(0, 'rolandvl still in blacklist') if each.pseudo=="rolandvl"
									done()


