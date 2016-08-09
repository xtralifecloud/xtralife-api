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
		}
	}
};
