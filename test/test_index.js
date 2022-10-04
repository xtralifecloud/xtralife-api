/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

global.xlenv = require("xtralife-env");

xlenv.override(null, xlenv.Log);

xlenv.override(null, require('./config.js'));
global.logger = xlenv.createLogger(xlenv.logs);

const xtralife = require('../src/index.js');

const domain = "com.clanofthecloud.cloudbuilder.azerty";
const indexName = "test";

let context = null;

describe("Xtralife Index module", function () {

	before('configure Xtralife', function (done) {
		this.timeout(5000);
		xtralife.configure(function (err) {
			const game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = { game };

			return done(err);
		});
		return null;
	});

	it("should index a document", () => xtralife.api.index.index(context, domain, indexName, "firstDocumentId", { a: 1, b: 2 }, { string: "This is a string", int: 5 })
		.then(result => {
			result._shards.successful.should.eql(1)
		}));

	it("should retrieve a document with get", () => xtralife.api.index.get(context, domain, indexName, "firstDocumentId")
		.then(result => {
			result._index.should.eql("com.clanofthecloud.cloudbuilder.azerty.test");
			result._id.should.eql("firstDocumentId");
		}));

	it("should retrieve a document with search", () => xtralife.api.index.search(context, domain, indexName, "_id: firstDocumentId AND a:1 AND b:2", ["a"])
		.then(result => {
			result.hits.total.value.should.eql(1)
		}));

	it("should perform a query", () => xtralife.api.index.query(context, domain, indexName, {match: { _id: "firstDocumentId" }}, 0, 10)
		.then(result => {
			result.hits.total.value.should.eql(1)
		}));


	return it("should delete the document", () => xtralife.api.index.delete(context, domain, indexName, "firstDocumentId"));
});