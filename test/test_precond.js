/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const should = require('should');
const xtralife = require('../src/index.js');

describe("Xtralife preconditions", function(){

	before('configure Xtralife', done => xtralife.configure(function(err){
        should(err).not.be.ok;
        return done();
    }));

	return it('should throw PreconditionError', function(){

		const fun = () => xtralife.api.transaction.txHistory(null, null, null, null, null, err => fail());

		return fun.should.throw(/Incorrect parameters/);
	});
});