/*
 * This file is named "test_zafter" just to be the last one to be executed after all other tests,
 * because its purpose is to disconnect the Redis instance(s) used by the other tests
 */
global.xlenv = require("xtralife-env");

describe('After tests disposal', function () {
	return it('should close all running instances', function () {
		xlenv.inject(['=redisClient', '=redisChannel', '=mongoCx'], function (err, rcl, rch, mongoCx) {
			xlenv.broker.stop(); // TimeoutBroker must be stopped (to stop checking for timeouts)
			// Redis connections must be stopped in order to prevent from the test to keep stuck
			rcl.disconnect();
			rch.disconnect();
			mongoCx.close();
		});

		if (!(xlenv.options.disableIndexModule === true))
			xlenv.inject(['=elastic'], function (err, elastic) {
				elastic.close();
			});
	});
});
