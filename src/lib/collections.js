/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const AbstractAPI = require('../AbstractAPI.js');

class CollectionsAPI extends AbstractAPI {
	constructor(){
		super();
		this.mongoCx = null;
		this.db = null;

		this._cache = {};
	}

	configure(_, callback){
		return xlenv.inject(["=mongoCx"], (err, mongoCx)=> {
			if (err != null) { return callback(err); }
			this.mongoCx = mongoCx;

			this.db = this.mongoCx.db(xlenv.mongodb.dbname);
			logger.info("Collections initialized");

			return callback();
		});
	}

	coll(name){
		if (this._cache[name] != null) {
			return this._cache[name];
		} else {
			const coll = this.db.collection(name);
			return this._cache[name] = coll;
		}
	}

	onDeleteUser(userid, cb){
		return this.coll("domains").deleteOne({user_id: userid}, (err, result)=> {
			logger.warn(`removed domains ${userid} : ${result.result.n} , ${err} `);
			return cb();
		});
	}
}

module.exports = new CollectionsAPI();