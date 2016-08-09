should = require 'should'

tx = require '../src/lib/transaction.coffee'

describe 'Tx check', ->

	this.timeout 2000
	fn = tx._checkTransaction

	it 'should catch foolish tx', (done)->
		tx._checkTransaction({Gold: 'a'}).should.eql false
		tx._checkTransaction({Gold: {}}).should.eql false
		tx._checkTransaction({Gold: null}).should.eql false

		done()

	it 'should catch mixed string tx', (done)->
		tx._checkTransaction({Gold: '1'}).should.eql false
		tx._checkTransaction({Gold: '-auto'}).should.eql true
		tx._checkTransaction({Gold: '-1'}).should.eql false
		tx._checkTransaction({Gold: ''}).should.eql false

		done()



