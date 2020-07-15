require('mocha');
const should = require('should');

global.xlenv = require("xtralife-env");

xlenv.override(null, xlenv.Log);

xlenv.override(null, require('./config.js'));
global.logger = xlenv.createLogger(xlenv.logs);

const xtralife = require('../src/index.js');

const domain = "com.clanofthecloud.cloudbuilder.azerty";

describe("Xtralife metrics", function () {
	let context = null;
	let metric = null;

	before('configure Xtralife', function (done) {
		this.timeout(5000);
		xtralife.configure(function (err) {
			const game = xtralife.api.game.dynGames['com.clanofthecloud.cloudbuilder'];
			context = { game };

			const Counter = xtralife.api.game.getMetrics().Counter;
			metric = new Counter({ name: "test_metric", help: "test metric", labelNames: ['game'] })

			return done(err);
		});
		return null;
	});

	it("should increase a counter", () =>
		metric.labels("test").inc()
	)

	it("should get metrics", () => {
		const metrics = xtralife.api.game.getMetrics().register.getMetricsAsJSON()
		metrics[metrics.length - 1].name.should.eql('test_metric')
		// @ts-ignore
		metrics[metrics.length - 1].values[0].value.should.eql(1)
		// @ts-ignore
		metrics[metrics.length - 1].values[0].labels['game'].should.eql('test')
	})
});
