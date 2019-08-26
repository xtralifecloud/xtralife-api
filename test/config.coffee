os = require 'os'
global.xlenv = require "xtralife-env"

global.logger = require 'winston'

Q = require 'bluebird'
Q.promisifyAll(require('redis'))

xlenv.override null,
	nbworkers: 1
	privateKey: "CONFIGURE : This is a private key and you should customize it"

	logs:
		level: 'error'
		slack:
			enable: false

	redis:
		host: "localhost"
		port: 6378

	redisClient: (cb)->
		client = require('redis').createClient(xlenv.redis.port, xlenv.redis.host)
		client.info (err)->
			cb err, client

	redisChannel: (cb)->
		client = require('redis').createClient(xlenv.redis.port, xlenv.redis.host)
		client.info (err)->
			cb err, client

	mongodb:
		dbname: 'xtralife'

		url: "mongodb://localhost:27018"
		options: # see http://mongodb.github.io/node-mongodb-native/driver-articles/mongoclient.html
			db:
				w: 1
				readPreference: "primaryPreferred"

			server:
				auto_reconnect: true

			mongos: {}
			promiseLibrary: require 'bluebird'


	mongoCx: (cb)->
		require("mongodb").MongoClient.connect xlenv.mongodb.url, xlenv.mongodb.options, (err, mongodb)->
			return cb(err, mongodb)

	elastic: (cb)->
		elastic = require("elasticsearch")
		client = new elastic.Client()
		cb null, client

	options:

		useMongodbPushall: false

		notifyUserOnBrokerTimeout: true

		removeUser: true

		timers:
			enable: true
			listen: true

		hostnameBlacklist: [] # used to restrict this.game.http.* apis

		#profileFields: ['displayName'] # show nothing but displayName in profile

	mailer: null # CONFIGURE HERE


	xtralife:
		games:
			"com.clanofthecloud.testgame": 
				apikey:"testgame-key"
				apisecret:"testgame-secret"
				config:
					enable:true
					domains:[]
					eventedDomains:[]
					certs:
						android:
							enable: false
							senderID: ''
							apikey: ''
						ios:
							enable: false
							cert: ''
							key: ''
						macos:
							enable: false
							cert: ''
							key: ''
					socialSettings:
						facebookAppToken : ''
						gameCenterBundleIdRE: /^not.the.correct.bundleId$/


			"com.clanofthecloud.cloudbuilder": 
				apikey:"cloudbuilder-key"
				apisecret:"azerty"
				config:
					enable:true
					domains:["com.clanofthecloud.cloudbuilder.m3Nsd85GNQd3","com.clanofthecloud.cloudbuilder.test"]
					eventedDomains:[]
					certs:
						android:
							enable: false
							senderID: ''
							apikey: ''
						ios:
							enable: false
							cert: ''
							key: ''
						macos:
							enable: false
							cert: ''
							key: ''
					socialSettings:
						facebookAppToken : ''
						gameCenterBundleIdRE: /^cloud\.xtralife\..*$/


	AWS: null # this is not used for xtralife-api tests but may in the future

	hooks:
		functions: require './batches.js'
		definitions: {}
