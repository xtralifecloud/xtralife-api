AbstractAPI = require '../AbstractAPI.coffee'

class CollectionsAPI extends AbstractAPI
	constructor: ()->
		super()
		@mongoCx = null
		@db = null

		@_cache = {}

	configure: (_, callback)->
		xlenv.inject ["=mongoCx"], (err, mongoCx)=>
			return callback err if err?
			@mongoCx = mongoCx

			@db = @mongoCx.db(xlenv.mongodb.dbname)
			logger.info "Collections initialized"

			callback()

	coll: (name)->
		if @_cache[name]?
			@_cache[name]
		else
			coll = @db.collection(name)
			@_cache[name] = coll

	onDeleteUser: (userid, cb)->
		@coll("domains").deleteOne {user_id: userid}, (err, result)=>
			logger.warn "removed domains #{userid} : #{result.result.n} , #{err} "
			cb()

module.exports = new CollectionsAPI()