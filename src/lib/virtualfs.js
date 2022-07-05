//@ts-check
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
// @ts-ignore
const extend = require('util')._extend;
const {
	ObjectId
} = require('mongodb');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");

const crypto = require("crypto");

const generateHash = function (userid, key) {
	const sha = crypto.createHash('sha1');
	sha.update(`${userid}-${key}- secret to keep S3 private`); // TODOXTRA secret MUST be in xlenv
	return sha.digest('hex');
};

class VirtualfsAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(parent, callback) {

		this.parent = parent;
		this.domains = this.coll('domains');

		this.domains.createIndex({ domain: 1, user_id: 1 }, { unique: true }, function (err) {
			if (err != null) { return callback(err); }
			logger.info("Virtualfs initialized");

			return callback(err, {});
		});

		if (xlenv.AWS && xlenv.AWS.S3 && xlenv.AWS.S3.credentials && xlenv.AWS.S3.region) {
			this.s3bucket = new S3Client({region: xlenv.AWS.S3.region, credentials: xlenv.AWS.S3.credentials});
		}
	}
	//Promise.promisifyAll(this.s3bucket)

	onDeleteUser(user_id, cb) {
		logger.debug(`delete user ${user_id} for virtualfs`);
		if(this.s3bucket){
			return this.domains.find({ user_id, fs: { "$exists": true } }, { domain: 1, fs: 1 }).toArray((err, docs) => {
				if (docs == null) { return cb(err); }
				if (err != null) { return cb(err); }
				return async.forEach(docs, (item, localcb) => {
						let params = { Bucket: xlenv.AWS.S3.bucket, Prefix: `${item.domain}/${user_id}/`, Delete: undefined };
						const list = new ListObjectsV2Command(params);
						return this.s3bucket.send(list, (err, data) => {
							if (err != null) { logger.error(err); }
							if (err != null) { return localcb(null); }
							if(!data.Contents) { return localcb(null); }
							const keys = [];
							for (let each of Array.from(data.Contents)) { keys.push({ Key: each.Key }); }
							params = { Bucket: xlenv.AWS.S3.bucket, Delete: { Objects: keys }, Delimiter: undefined };
							const del = new DeleteObjectsCommand(params);
							return this.s3bucket.send(del, err => {
								logger.warn(`remove s3 objects ${keys} : ${err}`);
								return localcb(null);
							});
						});
					}
					, err => cb(null));
			});
		}else {
			return cb(null)
		}
	}

	read(context, domain, user_id, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"key may be an unempty string or array": check.maybe.nonEmptyString(key) || key instanceof Array
		}));

		return this.handleHook("before-gamervfs-read", context, domain, {
			user_id,
			key
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const field = {};
			if (key instanceof Array) {
				for (let each of Array.from(key)) { field[`fs.${each}`] = 1; }
			} else {
				field[(key == null) ? 'fs' : `fs.${key}`] = 1;
			}

			return this.domains.findOne(query, { projection: field })
				.then(value => {
					return this.handleHook("after-gamervfs-read", context, domain, {
						user_id,
						key,
						value
					}).then(function (afterData) {
						if ((value != null) && (value.fs != null)) { return value.fs; } else { return {}; }
					});
				});
		});
	}

	write(context, domain, user_id, key, value) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"key may be a unempty string": check.maybe.nonEmptyString(key) || check.object(key)
		}));

		return this.handleHook("before-gamervfs-write", context, domain, {
			user_id,
			key,
			value
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const set = {};
			if (key === null) {
				set['fs'] = value;
			} else if (typeof key === 'string') {
				set[`fs.${key}`] = value;
			} else {
				for (let k in key) { value = key[k]; set[`fs.${k}`] = value; }
			}

			return this.domains.updateOne(query, { $set: set }, { upsert: true });
		})

			.then(result => {
				return this.handleHook("after-gamervfs-write", context, domain, {
					user_id,
					key,
					value
				}).then(() => {
					return result.modifiedCount === 1 ? result.modifiedCount : result.upsertedCount
				})
			});
	}

	delete(context, domain, user_id, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id),
			"key may be a unempty string": check.maybe.nonEmptyString(key)
		}));

		return this.handleHook("before-gamervfs-delete", context, domain, {
			user_id,
			key
		}).then(beforeData => {

			const query = {
				domain,
				user_id
			};

			const unset = {};
			unset[(key == null) ? 'fs' : `fs.${key}`] = "";

			return this.domains.updateOne(query, { $unset: unset }, { upsert: true })
				.then(result => {
					return this.handleHook("after-gamervfs-delete", context, domain, {
						user_id,
						key
					}).then(() => {
						return result.modifiedCount
					});
				});
		});
	}

	readmulti(context, domain, userids, keys, included) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"userids must be an array": check.array(userids),
			"keys must be an array": check.array(keys),
			"included may be an array": check.maybe.array(included)
		}));

		const query = {
			domain,
			user_id: { $in: userids }
		};

		const fields =
			{ user_id: 1 };
		for (let key of Array.from(keys)) { fields[`fs.${key}`] = 1; }

		if (included != null) {
			for (let i of Array.from(included)) { fields[i] = 1; }
		}

		const cursor = this.domains.find(query, { projection: fields });
		return cursor.toArray().then(values => {
			for (let v of Array.from(values)) {
				v.gamer_id = v.user_id;
				delete v.user_id;
				delete v._id;
			}
			return values;
		});
	}

	_getDownloadUrl(domain, user_id, key, secret) {
		return `https://s3-${xlenv.AWS.S3.region}.amazonaws.com/${xlenv.AWS.S3.bucket}/${domain}/${user_id}/${key}-${secret}`;
	}

	createSignedURL(domain, user_id, key, contentType = null) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));


		// TODO refactor, used in gameFS
		// forbids checking type of user_id
		const secret = generateHash(user_id, key);
		const params = { Bucket: xlenv.AWS.S3.bucket, Key: `${domain}/${user_id}/${key}-${secret}` };
		if (contentType != null) {
			params.ContentType = contentType;
		}
		// @ts-ignore
		const put = new PutObjectCommand(params);
		return getSignedUrl(this.s3bucket, put)
			.then(url => {
				return [url, this._getDownloadUrl(domain, user_id, key, secret)];
			});
	}

	deleteURL(domain, user_id, key) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain)
		}));

		// TODO refactor, used in gameFS
		// forbids checking type of user_id
		const secret = generateHash(user_id, key);
		const params = { Bucket: xlenv.AWS.S3.bucket, Key: `${domain}/${user_id}/${key}-${secret}` };
		const del = new DeleteObjectCommand(params);
		return this.s3bucket.send(del).then(result => {
			return result;
		}).catch(err => {
			logger.error(`deleteURL ${domain} ${key}`, err);
			return err;
		});
	}

	sandbox(context) {
		return {
			AWS: {
				S3: options => {
					if (((options.accessKeyId == null)) || ((options.secretAccessKey == null))) {
						throw new Error("accessKeyID or secretAccessKey missing from options");
					}
					return new AWS.S3(options);
				}
			},

			read: (domain, user_id, key) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.read(context, domain, user_id, key);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			write: (domain, user_id, key, value) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.write(context, domain, user_id, key, value);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			delete: (domain, user_id, key) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.delete(context, domain, user_id, key);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			readmulti: (domain, userids, keys, included) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.readmulti(context, domain, userids, keys, included);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			createSignedURL: (domain, user_id, key, contentType = null) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.createSignedURL(domain, user_id.toString(), key, contentType)
						.then(([putURL, getURL]) => {
							return {putURL, getURL}
						});
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			deleteURL: (domain, user_id, key) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.deleteURL(domain, user_id.toString(), key);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			}
		};
	}
}

module.exports = new VirtualfsAPI();
