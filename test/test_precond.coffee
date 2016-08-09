should = require 'should'
xtralife = require '../src/index.coffee'

describe "Xtralife preconditions", ()->

	before 'configure Xtralife', (done)->
		xtralife.configure (err)->
			should(err).not.be.ok
			done()

	it 'should throw PreconditionError', ()->

		fun = ->
			xtralife.api.transaction.txHistory null, null, null, null, null, (err)->
				fail()

		fun.should.throw /Incorrect parameters/