/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */


const async = require("async");
const extend = require('extend');
const rs = require("randomstring");
const flatten = require("flat");

const {
    ObjectID
} = require("mongodb");

const facebook = require("./network/facebook.js");
const google = require("./network/google.js");
const errors = require("./../errors.js");
const _ = require("underscore");

const AbstractAPI = require("../AbstractAPI.js");


class OutlineAPI extends AbstractAPI {
	constructor(){
		super();
	}

	// helpers
	collusers() {
		return this.coll("users");
	}

	colldomains() {
		return this.coll("domains");
	}
	
	configure(xtralifeapi, callback){
		this.xtralifeapi = xtralifeapi;
		logger.info("Outline initialized");
		return callback(null);
	}

	onDeleteUser(userid, cb){
		logger.debug(`delete user ${userid} for outline`);
		return cb(null);
	}

	outline(game, user_id, globaldomains, cb){
		const domains = _.union([], globaldomains); 
		const privdom = this.xtralifeapi.game.getPrivateDomain(game.appid);
		domains.push(privdom);

		//TODO remove "gameRelated" section when new route available
		return this.collusers().findOne({_id : user_id} , (err, global)=> {
			if (err != null) { return cb(err); }
			delete global._id;
			delete global.networksecret;
			const outline = global;
			return this.colldomains().find({domain: {"$in" : domains}, user_id}).toArray((err, docs)=> {
				if (err != null) { return cb(err); }
				for (let doc of Array.from(docs)) {
					delete doc._id;
					delete doc.user_id;
					if (doc.domain === privdom) { doc.domain = "private"; }
				} 
					
					// TODO remove in next release !
					//if doc.domain == "private"
					//	outline.gameRelated = doc
					//	delete outline.gameRelated.domain

				outline.domains = docs;
				return cb(err, outline);
			});
		});
	}

	get(game, user_id, domains, cb){
		if (typeof domains === "function") {
			cb = domains;
			domains = []; 
		}
		return this.outline(game, user_id, domains, function(err, outline){
			if (err != null) { return cb(err); }
			outline.servertime = new Date();
			return cb(err, outline);
		});
	}

	getflat(game, user_id, domains, cb){
		if (typeof domains === "function") {
			cb = domains;
			domains = []; 
		}
		return this.outline(game, user_id, domains, (err, outline)=> {
			return cb(err, flatten(JSON.parse(JSON.stringify(outline))));
		});
	}
}

module.exports = new OutlineAPI();
