/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");
const {
	ObjectId
} = require('mongodb');
const {
	DTimer
} = require('./dtimer/dtimer');
const os = require('os');
const check = require('check-types');

const Promise = require('bluebird');
const async = require('async');

const _ = require('underscore');


// How timers work
// Each user can have many timers, stored in a single document in the timers collection
// only the one about to expire is scheduled in rabbitmq
// so there's only one timeout message at a time in RabbitMQ's queues
// with new timers and retimes, it's possible to have many messages instead
// We just try to minimize their number and never waste them

const getExpiryTime = timer => timer.baseTime + (timer.expirySeconds * 1000);

const getTimerIds = timers => (() => {
	const result = [];
	for (let timerName in timers) {
		if (['_id', 'domain', 'user_id'].indexOf(timerName) === -1) {
			result.push(timerName);
		}
	}
	return result;
})();

// return null if no timers
// otherwise returns the id of the earliest timer (the one which should trigger first)
const getEarliestTimerId = function (timers) {
	const timerIds = getTimerIds(timers);
	if (timerIds.length === 0) { return null; }
	let earliest = timerIds[0];

	for (let id of Array.from(timerIds)) {
		if (getExpiryTime(timers[id]) < getExpiryTime(timers[earliest])) {
			earliest = id;
		}
	}
	return earliest;
};

// return null if no timers
// otherwise returns the earliest timer (the one which should trigger first)
const getEarliestTimer = function (timers) {
	const id = getEarliestTimerId(timers);
	if (id != null) { return timers[id]; } else { return null; }
};

// add the expiresInMs field to timers, so the user knows in how many ms they'll trigger
const addExpiryInMs = function (timers) {
	for (let id of Array.from(getTimerIds(timers))) {
		timers[id].expiresInMs = getExpiryTime(timers[id]) - Date.now();
	}
	return timers;
};


class TimerAPI extends AbstractAPI {
	constructor() {
		super();
		this._messageReceived = this._messageReceived.bind(this);
	}

	configure(xtralifeapi, callback) {

		this.xtralifeapi = xtralifeapi;
		return xlenv.inject(['redisClient', 'redisChannel'], (err, pub, sub) => {
			// replace ch1 with a unique id for this node (host ? process ?)
			this.dtimer = new DTimer(`${os.hostname()}_${process.pid}`, pub, sub);

			this.dtimer.on('event', ev => {
				this._messageReceived(ev.timer);
				return this.dtimer.confirm(ev.id)
			});
			// confirmed

			this.dtimer.on('error', err => {
				return logger.error(err);
			});

			return this.dtimer.join()
				.then(() => {
					this.timersColl = this.coll('timers');
					return this.timersColl.createIndex({ domain: 1, user_id: 1 }, { unique: true })
						.then(() => {
							return callback(null);
						});
				}).catch(callback);
		});
	}


	// can return a null promise (no timers)
	// otherwise return all timers for this user
	get(context, domain, user_id) {
		this.pre(check => ({
			"context must be an object with .game": check.like(context, {
					game: {
						apikey: 'cloudbuilder-key',
						apisecret: 'azerty',
						appid: 'com.clanofthecloud.cloudbuilder'
					}
				}
			),

			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));

		return this.timersColl.findOne({ domain, user_id })
			.then(addExpiryInMs);
	}

	add(context, domain, user_id, timerObject, batchToRun) {
		this.pre(check => ({
			"context must be an object with .game": check.like(context, {
					game: {
						apikey: 'cloudbuilder-key',
						apisecret: 'azerty',
						appid: 'com.clanofthecloud.cloudbuilder'
					}
				}
			),

			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"timerObject must be an object": check.object(timerObject),
			"batchToRun must be a string": check.nonEmptyString(batchToRun)
		}));

		const { expirySeconds, timerId, description, customData } = timerObject;
		const baseTime = Date.now();

		const lightContext = {
			game: context.game,
			runsFromClient: context.runsFromClient,
			recursion: {},
			customData: {}
		};

		const toSet = { [timerId]: { baseTime, expirySeconds, description, customData, batchToRun, context: lightContext, alreadyScheduled: false } };

		return this.timersColl.findOneAndUpdate({ domain, user_id }, { '$set': toSet }, { upsert: true, returnDocument: "after" })
			.get('value')
			.then(timers => {
				// if the timer we're adding is the earliest, schedule one message delivery for it
				if (getEarliestTimerId(timers) === timerId) {
					//console.log "scheduling #{timerId} with delay = #{expirySeconds*1000}"
					const message = { domain, user_id, timerId, baseTime, expirySeconds, batchToRun, context: lightContext };
					return this._publish(message, expirySeconds * 1000)
						.then(() => {
							return this._setAlreadyPublished(domain, user_id, timerId, true)
								.then(() => this.timersColl.findOne({ domain, user_id })).then(updatedTimers => {
									return updatedTimers
								});
						});
				} else {
					return timers;
				}
			}).then(addExpiryInMs);
	}

	delete(context, domain, user_id, timerId) {
		this.pre(check => ({
			"context must be an object with .game": check.like(context, {
					game: {
						appid: 'com.clanofthecloud.cloudbuilder'
					}
				}
			),

			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"timerId must be a string": check.nonEmptyString(timerId)
		}));

		const toUnset = { [timerId]: null };

		return this.timersColl.findOneAndUpdate({ domain, user_id }, { '$unset': toUnset }, { returnDocument: "after" })
			.get('value')
			.then(addExpiryInMs);
	}

	// retiming doesn't change base time, only expirySeconds
	// so if at time t I set a timer to 2s, then retime it to 3s, it will trigger at t+3s
	//
	// retiming can also be relative and proportional
	// retime(-0.2) will speedup by 20% for the not yet elapsed time
	retime(context, domain, user_id, timerId, expirySeconds) {
		var timers, expirySeconds;
		this.pre(check => ({
			"context must be an object with .game": check.like(context, {
					game: {
						appid: 'com.clanofthecloud.cloudbuilder'
					}
				}
			),

			"domain is not a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"timerId must be a string": check.nonEmptyString(timerId),
			"expirySeconds must be a number": check.number(expirySeconds)
		}));

		const promise = (() => {
			if (expirySeconds < 0) { // relative retime, adjust expirySeconds
				const retimeToPct = -expirySeconds;
				return this.timersColl.findOne({ domain, user_id })
					.then(timers => {
						let baseTime;
						({ baseTime, expirySeconds } = timers[timerId]);
						const alreadyElapsed = (Date.now() - baseTime) / 1000;
						const remains = expirySeconds - alreadyElapsed;

						let retimeTo = remains * (1 - retimeToPct);
						if (retimeTo < 0) { retimeTo = 0; }
						return retimeTo;
					});
			} else {
				return Promise.resolve(expirySeconds);
			}
		})();

		return promise.then(expirySeconds => {
			const toSet = { [`${timerId}.expirySeconds`]: expirySeconds, [`${timerId}.alreadyScheduled`]: false };

			return this.timersColl.findOneAndUpdate({ domain, user_id }, { '$set': toSet }, { returnDocument: "after", upsert: false })
				.get('value')
				.then(timers => {
					if (getEarliestTimerId(timers) === timerId) {
						const timer = timers[timerId];
						let newDelay = getExpiryTime(timer) - Date.now();
						if (newDelay < 0) { newDelay = 0; }

						//console.log "scheduling #{timerId} with delay = #{newDelay}"

						return this._publish({ domain, user_id, timerId, baseTime: timer.baseTime, expirySeconds, batchToRun: timer.batchToRun, context }, newDelay)
							.then(() => {
								this._setAlreadyPublished(domain, user_id, timerId, true);
								return timers;
							});
					} else {
						return timers;
					}
				}).then(addExpiryInMs);
		});
	}


	// returns a promise for timers
	// we must know if there's a message in a queue for each timer, so we store the info in mongodb
	_setAlreadyPublished(domain, user_id, timerId, alreadyPublished) {
		const toSet = { [`${timerId}.alreadyScheduled`]: alreadyPublished };
		return this.timersColl.updateOne({ domain, user_id }, { '$set': toSet }, { returnDocument: "after", upsert: false });
	}

	// publish the message with the specified timeout
	// will resolve to null, or reject if an error occurs
	_publish(message, timeoutMs) {
		return this.dtimer.post({ timer: message }, timeoutMs);
	}

	// called for each new message
	// it will check the message corresponds to the current state of timers
	// if it does, it will call the corresponding batch
	// and it will delete the corresponding timer
	// it will then schedule the next timer (if it wasn't scheduled before)
	_messageReceived(message) {
		const _messageHasCorrectModel = () => {
			return check.like(message, {
					domain: "com.company.game.key",
					user_id: "55c885e75ecd563765faf612",
					timerId: "timerId",
					baseTime: 1439203492270,
					expirySeconds: 1.0,
					batchToRun: 'timerTrigger',
					context: {
						game: {
							appid: 'com.clanofthecloud.cloudbuilder'
						}
					}
				}
			);
		};

		// returns a promise
		// with null if this message can't be processed (timer doesn't exist, or should not fire now)
		// with list of timers if message processed
		const _processMessage = message => {
			if (!_messageHasCorrectModel()) { return Promise.resolve(null); }
			// get timers
			return this.get(message.context, message.domain, new ObjectId(message.user_id))
				.then(timers => {
					if (timers == null) { return null; } // should not happen

					const timer = timers[message.timerId];
					if (timer == null) { return null; }

					// return if the earliest timer isn't this one
					if (getEarliestTimerId(timers) !== message.timerId) { return null; }
					// return if the message doesn't coincide exactly with timer
					if ((message.baseTime !== timer.baseTime) || (message.expirySeconds !== timer.expirySeconds)) { return null; }

					// delete triggered timer then call batch (asynchronously)
					return this.delete(message.context, message.domain, new ObjectId(message.user_id), message.timerId)
						.then(timers => {
							// logger.debug(`Calling batch from timer ${timer.batchToRun}`, { message, timer });
							api.game.runBatch(message.context, message.domain, '__' + timer.batchToRun, { domain: message.domain, user_id: new ObjectId(message.user_id), timerId: message.timerId, now: Date.now(), expiredAt: (timer.baseTime + (timer.expirySeconds * 1000)), description: timer.description, customData: timer.customData })
								.then(() => {
									return
									return logger.debug(`Batch returned from timer ${timer.batchToRun}`, { message, timer });
								})
								.catch(err => {
									// logger.debug(`Error during timer batch ${message.domain}.__${timer.batchToRun}`);
									return logger.debug(err, { stack: err.stack });
								})
								.done();
							return timers;
						});
				});
		};

		// resolves to null if no message needed scheduling
		const _scheduleNextMessage = timers => {
			if (timers == null) { return null; }

			// we need to schedule a new message with the next earliest timer, if any
			// and if it's not scheduled already
			const nextTimer = getEarliestTimer(timers);
			if (nextTimer == null) { return null; }
			if (nextTimer.alreadyScheduled) { return null; }
			const nextTimerId = getEarliestTimerId(timers);

			let newDelay = getExpiryTime(nextTimer) - Date.now();
			if (newDelay < 0) { newDelay = 0; }
			//console.log "scheduling #{nextTimerId} with delay = #{newDelay}"

			message = {
				domain: timers.domain,
				user_id: timers.user_id,
				timerId: nextTimerId,
				baseTime: nextTimer.baseTime,
				expirySeconds: nextTimer.expirySeconds,
				batchToRun: nextTimer.batchToRun,
				context: nextTimer.context
			};

			return this._publish(message, newDelay)
				.then(() => {
					return this._setAlreadyPublished(timers.domain, timers.user_id, nextTimerId, true);
				});
		};



		return _processMessage(message)
			.catch(error => {
				logger.error('Error in xtralife Timer _processMessage');
				logger.error(error);
				return null;
			}).then(timers => {
				return timers || this.get(message.context, message.domain, new ObjectId(message.user_id));
			}).then(timers => {
				return _scheduleNextMessage(timers);
			}).catch(err => {
				logger.error("Error in xtralife Timer _scheduleNextMessage or @get");
				logger.error(err, { stack: err.stack });
				return null;
			});
	}

	sandbox(context) {
		this.pre(check => ({
			"context must be an object with .game": check.like(context, {
					game: {
						appid: 'com.clanofthecloud.cloudbuilder'
					}
				}
			)
		}));

		// timerObject = {expirySeconds, timerId, description, customData}
		return {
			add: (domain, user_id, timerObject, batchToRun) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.add(context, domain, user_id, timerObject, batchToRun);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			get: (domain, user_id) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.get(context, domain, user_id);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			delete: (domain, user_id, timerId) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.delete(context, domain, user_id, timerId);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			retime: (domain, user_id, timerId, expirySeconds) => {
				if (this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
					return this.retime(context, domain, user_id, timerId, expirySeconds);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}
}

module.exports = new TimerAPI();
