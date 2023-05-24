/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const xlenv = global.xlenv = require("xtralife-env");

global.logger = require('winston');
// const Promise = require('bluebird');
// Promise.promisifyAll(require('redis'));

const Redis = require('ioredis')

xlenv.override(null, {
	nbworkers: 1,
	privateKey: "CONFIGURE : This is a private key and you should customize it",

	logs: {
		level: 'error',
		slack: {
			enable: false
		}
	},

	redis: {
		config: { // refer to https://github.com/luin/ioredis/blob/v4/API.md#new-redisport-host-options
				port: 6378,
				host: "localhost"
		}
	},

	redisClient(cb){
		const redis = new Redis(xlenv.redis.config);
		redis.info((err) => {
			return cb(err, redis);
		})
	},

	redisChannel(cb){
		const redis = new Redis(xlenv.redis.config);
		redis.info((err) => {
			return cb(err, redis);
		})
	},

	mongodb: {
		dbname: 'xtralife',

		url: "mongodb://localhost:27018",
		options: { // see http://mongodb.github.io/node-mongodb-native/driver-articles/mongoclient.html
			
			w: 1,
			readPreference: "primaryPreferred",
			promiseLibrary: require("bluebird")
		}
	},


	mongoCx(cb) {
		return require("mongodb").MongoClient.connect(xlenv.mongodb.url, xlenv.mongodb.options, (err, mongodb) => cb(err, mongodb));
	},

	elastic: {
		driver: {
			version: "8.7.0",
		}
	},

	elasticClient(cb) {
		const { Client } = require('@elastic/elasticsearch');
		const client = new Client({
			node: 'http://localhost:9200'
		});
		return cb(null, client);
	},

	options: {

		useMongodbPushall: false,

		notifyUserOnBrokerTimeout: true,

		removeUser: true,

		timers: {
			enable: true,
			listen: true
		},

		hostnameBlacklist: []
	}, // used to restrict this.game.http.* apis

	//profileFields: ['displayName'] # show nothing but displayName in profile

	mailer: null, // CONFIGURE HERE


	xtralife: {
		games: {
			"com.clanofthecloud.testgame": {
				apikey: "testgame-key",
				apisecret: "testgame-secret",
				config: {
					enable: true,
					domains: [],
					eventedDomains: [],

					facebook: {
						useBusinessManager : false
					},

					google: { // see google cloud platform
						clientID: '', // login
						inApp: { // in-app purchase android
							packageID: '',
							serviceAccount: {
								private_key_id: '',
								client_email: '',
								client_id: '',
								type: 'service_account'
							}
						}
					},

					apple: { // see apple developer console
						bundleID: '', // for login & apn
						gameCenterBundleIdRE: null, // login
						inApp: { // In-app
						},
						apn: { //apple push notification
							token: { // apn auth key
								key: "",
								keyId: "",
								teamId: "",
							},
							production: false,
						}
					},

					firebase: { // login & push Android (firebaseAdmin sdk), see firebase console
						type: "",
						project_id: "",
						private_key_id: "",
						private_key: "",
						client_email: "",
						client_id: "",
						auth_uri: "",
						token_uri: "",
						auth_provider_x509_cert_url: "",
						client_x509_cert_url: ""
					},

					steam: { // login
						appId: null,
						webApiKey: ''
					},
				}
			},


			"com.clanofthecloud.cloudbuilder": {
				apikey: "cloudbuilder-key",
				apisecret: "azerty",
				config: {
					enable: true,
					domains: ["com.clanofthecloud.cloudbuilder.m3Nsd85GNQd3", "com.clanofthecloud.cloudbuilder.test"],
					eventedDomains: [],

					facebook: {
						useBusinessManager : false
					},

					google: { // see google cloud platform
						clientID: '', // login
						inApp: { // in-app purchase android
							packageID: '',
							serviceAccount: {
								private_key_id: '',
								client_email: '',
								client_id: '',
								type: 'service_account'
							}
						}
					},

					apple: { // see apple developer console
						bundleID: '', // for login & apn
						gameCenterBundleIdRE: null, // login
						inApp: { // In-app
						},
						apn: { //apple push notification
							token: { // apn auth key
								key: "",
								keyId: "",
								teamId: "",
							},
							production: false,
						}
					},

					firebase: { // login & push Android (firebaseAdmin sdk), see firebase console
						type: "",
						project_id: "",
						private_key_id: "",
						private_key: "",
						client_email: "",
						client_id: "",
						auth_uri: "",
						token_uri: "",
						auth_provider_x509_cert_url: "",
						client_x509_cert_url: ""
					},

					steam: { // login
						appId: null,
						webApiKey: ''
					},
				}
			}
		}
	},


	AWS: null, // this is not used for xtralife-api tests but may in the future

	hooks: {
		functions: require('./batches.js'),
	}
});
