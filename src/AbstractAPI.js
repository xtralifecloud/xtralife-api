//@ts-check
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const xtralife = require('./index.js');
const xtralifeerrors = require('./errors.js');

const checktypes = require('check-types');

// @ts-ignore
checktypes.objectid = id => (id != null ? id._bsontype : undefined) === 'ObjectID';

const shouldRunPreconditions = process.env.NODE_ENV !== "production";
const _ = require('underscore');

const Promise = require('bluebird');

const {
	ObjectId
} = require("mongodb");

/*
    AbstractAPI defines the contract followed by every business module of Xtralife
*/
class AbstractAPI {

	// No arg constructor
	constructor() { }

	// Called only once, at startup time
	// If this api is aggregagted in another api, the parent api is `parent`
	// cb (err)
	configure(parent, cb) {
		return cb();
	}
	configureGame(game, cb) {
		return cb();
	}
	// Called after every module has been initialized but before xtralife is fully ready
	// cb (err)
	afterConfigure(parent, cb) {
		return cb();
	}

	// Called when a user is deleted, to optionnally provide some cleanup
	// remove common data
	onDeleteUser(userid, cb) {
		return cb();
	}

	coll(name) {
		return xtralife.api.collections.coll(name);
	}

	pre(fn) {
		if (shouldRunPreconditions) {
			const errorsMessages = (() => {
				try {
					return (() => {
						const result = [];
						const object = fn(checktypes);
						for (let errorsMessage in object) {
							const passed = object[errorsMessage];
							if (!passed) {
								result.push(errorsMessage);
							}
						}
						return result;
					})();
				} catch (err) {
					return [`Exception when checking preconditions (${err.stack})`];
				}
			})();

			if (errorsMessages.length) { throw new xtralifeerrors.PreconditionError(errorsMessages); }
		}
	}

	handleHook(hookName, context, domain, params) {
		let durationms, err;
		this.pre(check => ({
			"hookName must be a string": check.nonEmptyString(hookName),
			"context must be an object": check.object(context),
			"domain must be a string": check.nonEmptyString(domain),
			"params must be an object": check.object(params)
		}));

		const isBatch = hookName.slice(0, 2) === '__';
		durationms = 0;

		if (context.recursion == null) { context.recursion = {}; }
		if (context.recursion[hookName] == null) { context.recursion[hookName] = 0; }
		context.recursion[hookName]++;

		if ((context.game != null ? context.game.appid : undefined) == null) { return Promise.reject(new Error("context for hooks must include context.game.appid")); }
		if (domain === 'private') { domain = xtralife.api.game.getPrivateDomain(context.game.appid); }

		const _findHook = function (name, domain) {
			const isCommon = name === "common";
			if ((xlenv.hooks.functions[domain] != null) && (xlenv.hooks.functions[domain][name] != null)) {
				return xlenv.hooks.functions[domain][name];
			} else { return null; }
		};

		let hook = null;
		try {
			hook = !context.skipHooks ? _findHook(hookName, domain) : null;
		} catch (error) {
			err = error;
			return Promise.reject(err);
		}

		const promise = (() => {
			if (hook != null) {
				if (context.recursion[hookName] <= (xlenv.hooks.recursionLimit || 10)) { // this hook can be run only x times in this context
					return Promise.try(() => {
						const commonHook = _findHook("common", domain);

						const mod = {
							'_': _,
							'Q': Promise,
							'ObjectID'(id) { return new ObjectId(id); },
							'ObjectIDs'(ids) {
								return _.map(ids, id => new ObjectId(id));
							},
							debug(log) {
								return xtralife.api.game.hookLog(context.game, domain, hookName, log);
							},
							isSafe: context.runsFromClient ? () => false : () => true
						};

						mod.common = (commonHook != null) ? commonHook.call(xtralife.api.sandbox(context), mod) : null;

						durationms = Date.now();
						if (process.send != null) {
							process.send({ proc: process.pid, cmd: 'batch', batch: `${domain}.${hookName}`, enter: true });
						}
						return hook.call(xtralife.api.sandbox(context), params, context.customData, mod);
					}).tap(function () {
						if (process.send != null) {
							return process.send({ proc: process.pid, cmd: 'batch', batch: `${domain}.${hookName}`, enter: false });
						}
					}).catch(function (err) {
						if (process.send != null) {
							process.send({ proc: process.pid, cmd: 'batch', batch: `${domain}.${hookName}`, enter: false });
						}

						throw new xtralifeerrors.HookError(err.message);
					}).tap(function (customData) {
						durationms = Date.now() - durationms;
						logger.debug(`Handling hook/batch ${domain}.${hookName} finished`, { batchTook: durationms });
						return context.customData = customData;
					});
				} else {
					logger.warn(`Hook recursion limit hit (${domain}) : ${context.recursion[hookName]}`, { hookName, domain });
					return Promise.reject(new xtralifeerrors.HookRecursionError(`Hook ${domain}/${hookName} exceeded recursion limit`));
				}
			} else {
				if (isBatch) {
					return Promise.reject(new xtralifeerrors.HookError(`Hook ${domain}/${hookName} does not exist`));
				} else {
					return Promise.resolve(null);
				}
			}
		})();

		return promise.tap(() => // TODO monitor hooks execution time + warn if above threshold ? if context.recursion[hookName] == 0
			context.recursion[hookName]--);
	}
}

// TODO catch err -> log for BO use -> throw err (ie tap err)

module.exports = AbstractAPI;