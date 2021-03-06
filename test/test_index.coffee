should = require 'should'

global.xlenv = require "xtralife-env"

xlenv.override null, xlenv.Log

xlenv.override null, require './config.coffee'
global.logger = xlenv.createLogger xlenv.logs

xtralife = require '../src/index.coffee'

domain = "com.clanofthecloud.cloudbuilder.azerty"
indexName = "test"

context = null

describe "Xtralife Index module", ()->

	before 'configure Xtralife', (done)->
		this.timeout 5000
		xtralife.configure (err)->
			game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder']
			context = {game}

			done(err)
		return null

	it "should index a document", ->
		xtralife.api.index.index context, domain, indexName, "firstDocumentId", {a:1, b:2}, {string: "This is a string", int: 5}
		.then (result)->
			result.created.should.eql true

	it "should have stored the document", ->
		xtralife.api.index.search context, domain, indexName, "_id: firstDocumentId AND a:1 AND b:2", ["a"]
		.then (result)->
			result.hits.total.should.eql 1

	it "should delete the document", ->
		xtralife.api.index.delete context, domain, indexName, "firstDocumentId"
