api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID

Q = require 'bluebird'

class IndexAPI extends AbstractAPI
	constructor: ()->
		@elastic = null
		super()

	configure: (@parent, callback)->

		xlenv.inject ["=elastic"], (err, elastic)=>

			@elastic = elastic
			logger.info "ES Index initialized"

			callback err, {}

	index: (domain, indexName, objectId, properties, contents) ->

		document = properties

		document.payload = contents

		@elastic.index
			index: domain.toLowerCase()
			type: indexName
			id: objectId
			body: document
			refresh: true
			consistency: "one"

	get: (domain, indexName, objectId) ->

		@elastic.get
			index: domain.toLowerCase()
			type: indexName
			id: objectId

	# q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
	# sort: ['field1', 'field2']
	search: (domain, indexName, q, sort, from, max) ->
		@elastic.search
			index: domain.toLowerCase()
			type: indexName
			q: q
			defaultOperator: 'AND'
			sort: sort
			from: from
			size: max

	# query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
	query: (domain, indexName, query, from, max) ->
		@elastic.search
			index: domain.toLowerCase()
			type: indexName
			body: query
			from: from
			size: max


	delete: (domain, indexName, objectId)->
		@elastic.delete
			index: domain.toLowerCase()
			type: indexName
			id: objectId

	sandbox: (context)->
		index: (domain, indexName, objectId, properties, payload) =>
			if @parent.game.checkDomainSync context.game.appid, domain
				@index domain, indexName, objectId, properties, payload
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		# q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
		# sort: ['field1', 'field2']
		search: (domain, indexName, q, sort=[], from=0, max=10)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@search domain, indexName, q, sort, from, max
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		# query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
		query: (domain, indexName, query, from=0, max=10)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@query domain, indexName, query, from, max
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		delete: (domain, indexName, objectId)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@delete domain, indexName, objectId
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		getClient: ()=> # OpenSource version ONLY, not available in the hosted edition
			@elastic

module.exports = new IndexAPI()
