module.exports = {
	"com.clanofthecloud.cloudbuilder.azerty": {
		__testTimer: function (params, customData, mod) {
			return this.timer.add('com.clanofthecloud.cloudbuilder.azerty', params.user_id, {
				expirySeconds: 2,
				timerId: 'testTimerFromBatch',
				description: 'Test',
				customData: 'test'
			}, 'timerTrigger');
		},
		__timerTrigger: function (params, customData, mod) {
			console.log('timer ' + params.timerId + ' triggered batch (' + (Date.now() % 10000) + ')');
		},
		__testkvcreate: function (params, customData, mod) {
			return this.kv.create('com.clanofthecloud.cloudbuilder.azerty', params.user_id, 'fromBatch', 'works too', {});
		},
		__testkvget: function (params, customData, mod) {
			return this.kv.get('com.clanofthecloud.cloudbuilder.azerty', params.user_id, 'fromBatch');
		},
		__testkvset: function (params, customData, mod) {
			return this.kv.set('com.clanofthecloud.cloudbuilder.azerty', params.user_id, 'fromBatch', 'still works');
		},
		__testkvchangeACL: function (params, customData, mod) {
			return this.kv.changeACL('com.clanofthecloud.cloudbuilder.azerty', params.user_id, 'fromBatch', 'still works');
		},
		__testkvdel: function (params, customData, mod) {
			return this.kv.del('com.clanofthecloud.cloudbuilder.azerty', params.user_id, 'fromBatch');
		},
		__runWithLock: function (params, customData, mod) {
			console.log("Acquired lock " + params.counter);
			return new mod.Q(function (resolve, reject) {
				setTimeout(function () {
					console.log("Releasing lock " + params.counter);
					resolve();
				}, 100);
			});
		},
		__runWithLockCopy: function (params, customData, mod) {
			console.log("Acquired lock " + params.counter);
			return new mod.Q(function (resolve, reject) {
				setTimeout(function () {
					console.log("Releasing lock " + params.counter);
					resolve();
				}, 100);
			});
		},
		__runWithLockTooLong: function (params, customData, mod) {
			console.log("Acquired lock " + params.counter);
			return new mod.Q(function (resolve, reject) {
				setTimeout(function () {
					console.log("Exceeding 200ms runtime " + params.counter);
					resolve();
				}, 250);
			});
		},
		__testRecursiveTimer: function (params, customData, mod) {
			"use strict";

			var self = this;
			var {user_id} = params;

			console.log("Called !");

			var timerObject = {
				timerId: "timerId",
				expirySeconds: 2,
				description: "description",
				customData: {test: "hello"}
			};

			return self.timer.add(self.game.getPrivateDomain(), user_id, timerObject, "testRecursiveTimer")
				.then(result => {
					return mod.debug(result);
				})
				.catch(err => {
					return mod.debug(err);
				});
		},

		"__auth_customNetwork_comclanofthecloudcloudbuilder": function (params, customData, mod) {
			var {user_id, user_token} = params;
			return {verified : user_token == user_id};
		},

		"__auth_http_comclanofthecloudcloudbuilder": function (params, customData, mod) {
			var {user_id, user_token} = params;
			return this.game.http.get("http://localhost:4444/auth?id="+user_id+"&token="+user_token)
					.then((res)=> { 
						return {verified : res.body.valid==true}
					});
		},

	}
};
