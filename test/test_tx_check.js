/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const should = require('should');

const tx = require('../src/lib/transaction.js');

describe('Tx check', function () {

	this.timeout(2000);
	const fn = tx._checkTransaction;

	it('should catch foolish tx', function (done) {
		tx._checkTransaction({ Gold: 'a' }).should.eql(false);
		tx._checkTransaction({ Gold: {} }).should.eql(false);
		tx._checkTransaction({ Gold: null }).should.eql(false);

		return done();
	});

	return it('should catch mixed string tx', function (done) {
		tx._checkTransaction({ Gold: '1' }).should.eql(false);
		tx._checkTransaction({ Gold: '-auto' }).should.eql(true);
		tx._checkTransaction({ Gold: '-1' }).should.eql(false);
		tx._checkTransaction({ Gold: '' }).should.eql(false);

		return done();
	});
});



