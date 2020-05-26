/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const extend = require('util')._extend;
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");
const {
    ObjectID
} = require('mongodb');

const Q = require('bluebird');

class KVStoreAPI extends AbstractAPI {
	constructor(){
		super();
	}

	configure(xtralifeapi, callback){
		this.xtralifeapi = xtralifeapi;
		this.kvColl = this.coll('kvstore');

		return this.kvColl.createIndex({domain:1, key: 1}, {unique: true}, callback);
	}

	onDeleteUser(userid, cb){
		return cb(null);
	}

	// in every KVStore API, the user_id is optional
	// so
	// - shuttle must enforce its presence and never allow passing null as a user_id
	// - but sandbox() can bypass the ACLs (batches know what they're doing) but they can rely on ACLs too
	// We check context.runsFromClient but this may not be enough (it should)

	// ATTN: create shouldn't be called from shuttle: only a batch can create a new key
	// It's a hard create, not an upsert. Handle error for duplicate key accordingly
	create(context, domain, user_id=null, key, value, acl){
		if (acl == null) { acl = {}; }
		acl = (user_id != null) ? this._defaults(acl, [user_id]) : this._defaults(acl);

		this.pre(check=> {
			return {
				"create cannot be run from client": !context.runsFromClient,
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id may be an ObjectID": (user_id === null) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key),
				"acl must be a valid ACL": this._validACL(acl)
			};
		});

		const cdate = Date.now();
		return this.kvColl.insertOne({domain, key, value, acl, cdate, udate: cdate})
		.get('result');
	}

	// change the ACL of a key (must have 'a' right to do so)
	changeACL(context, domain, user_id=null, key, acl){
		acl = (user_id != null) ? this._defaults(acl, [user_id]) : this._defaults(acl);

		this.pre(check=> {
			return {
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id must be an ObjectID": ((user_id === null) && !context.runsFromClient) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key),
				"acl must be a valid ACL": this._validACL(acl)
			};
		});

		const query = {domain, key};
		if (user_id != null) { query['$or']= [{'acl.a':'*'}, {'acl.a': user_id}]; }
		const udate = Date.now();
		return this.kvColl.updateOne(query, {$set: {acl, udate}})
		.get('result');
	}

	// set the value of a key (must have 'w' right to do so)
	// set 'udate' to perform optimistic locking (test and set)
	set(context, domain, user_id=null, key, value, udate=null){
		this.pre(check=> {
			return {
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id must be an ObjectID": ((user_id === null) && !context.runsFromClient) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key)
			};
		});

		const query = {domain, key};
		if (user_id != null) { query['$or']= [{'acl.w':'*'}, {'acl.w': user_id}]; }
		if (udate != null) { query.udate = udate; }

		return this.kvColl.updateOne(query, {$set: {value, udate: Date.now()}})
		.get('result');
	}

	// updateObject allows incremental changes to JS objects stored in value
	updateObject(context, domain, user_id=null, key, value, udate=null){
		this.pre(check=> {
			return {
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id must be an ObjectID": ((user_id === null) && !context.runsFromClient) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key),
				"value must be a JS object": check.object(value)
			};
		});

		const query = {domain, key};
		if (user_id != null) { query['$or']= [{'acl.w':'*'}, {'acl.w': user_id}]; }
		if (udate != null) { query.udate = udate; }

		const set = {udate: Date.now()};
		for (let k in value) { const v = value[k]; set[`value.${k}`] = v; }
		return this.kvColl.updateOne(query, {$set: set})
		.get('result');
	}


	// read a key (must have 'r' right to do so)
	get(context, domain, user_id=null, key){
		this.pre(check=> {
			return {
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id must be an ObjectID": ((user_id === null) && !context.runsFromClient) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key)
			};
		});

		const query = {domain, key};
		if (user_id != null) { query['$or']= [ {'acl.r':'*'}, {'acl.r': user_id} ]; }
		return this.kvColl.findOne(query);
	}

	// delete a key (must have 'a' right to do so)
	del(context, domain, user_id=null, key){
		this.pre(check=> {
			return {
				"context is not a valid context": check.object(context),
				"domain is not a valid domain": check.nonEmptyString(domain),
				"user_id must be an ObjectID": ((user_id === null) && !context.runsFromClient) || check.objectid(user_id),
				"key must be a string": check.nonEmptyString(key)
			};
		});

		const query = {domain, key};
		if (user_id != null) { query['$or']= [{'acl.a':'*'}, {'acl.a': user_id}]; }
		return this.kvColl.deleteOne({domain, key, $or: [{'acl.a':'*'}, {'acl.a': user_id}]})
		.get('result');
	}

	// used by BACKOFFICE only !
	list(context, domain, query, skip, limit){

		this.pre(check=> {
			return {
				"domain is not a valid domain": check.nonEmptyString(domain),
				"query must be an object": check.object(query)
			};
		});

		return this.kvColl.find( { "domain": domain , "acl.a" : query.user_id} , {
			skip,
			limit
		}
		).toArray();
	}

	// apply a default ACL if missing acl component
	_defaults(acl, defaultACL){
		if (defaultACL == null) { defaultACL = '*'; }
		return {r: acl.r || defaultACL, w: acl.w || defaultACL, d: acl.d || defaultACL, a: acl.a || defaultACL};
	}

	// returns false for non valid ACL, or true if OK
	_validACL(acl){
		const {r, w, d} = acl; // read, write, delete

		const _checkIDsOrStar = function(value){
			const _isArrayOfIDs = array => array.filter(each => each._bsontype !== 'ObjectID')
            .length === 0;

			return (value === '*') || (Array.isArray(value) && _isArrayOfIDs(value));
		};

		return _checkIDsOrStar(r) && _checkIDsOrStar(w) && _checkIDsOrStar(d);
	}

	sandbox(context){
		const _checkDomain = domain=> {
			if (!this.xtralifeapi.game.checkDomainSync(context.game.appid, domain)) {
				throw new errors.BadArgument("Your game doesn't have access to this domain");
			}
		};

		return {
			create: (domain, user_id, key, value, acl)=> {
				if (acl == null) { acl = {}; }
				_checkDomain(domain);
				return this.create(context, domain, user_id, key, value, acl);
			},

			changeACL: (domain, user_id, key, acl)=> {
				_checkDomain(domain);
				return this.changeACL(context, domain, user_id, key, acl);
			},

			set: (domain, user_id, key, value, udate=null)=> {
				_checkDomain(domain);
				return this.set(context, domain, user_id, key, value, udate);
			},

			updateObject: (domain, user_id, key, value, udate=null)=> {
				_checkDomain(domain);
				return this.updateObject(context, domain, user_id, key, value, udate);
			},

			get: (domain, user_id, key)=> {
				_checkDomain(domain);
				return this.get(context, domain, user_id, key);
			},

			del: (domain, user_id, key)=> {
				_checkDomain(domain);
				return this.del(context, domain, user_id, key);
			}
		};
	}
}



module.exports = new KVStoreAPI();
