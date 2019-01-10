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

	index: (context, domain, indexName, objectId, properties, contents) ->

		document = properties

		document.payload = contents

		@handleHook "before-index", context, domain,
			domain: domain
			user_id: context.gamer_id
			gamer_id: context.gamer_id
			indexName: indexName
			objectId: objectId
			properties: properties
			contents: contents
		.then =>
			@elastic.index
				index: domain.toLowerCase()
				type: indexName
				id: objectId
				body: document
				refresh: true
				consistency: "one"

	get: (context, domain, indexName, objectId) ->

		@handleHook "before-index-get", context, domain,
			domain: domain
			user_id: context.gamer_id
			gamer_id: context.gamer_id
			indexName: indexName
			objectId: objectId
		.then =>
			@elastic.get
				index: domain.toLowerCase()
				type: indexName
				id: objectId

	# q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
	# sort: ['field1', 'field2']
	search: (context, domain, indexName, q, sort, from, max, search_type='query_then_fetch') ->
		@handleHook "before-index-search", context, domain,
			domain: domain
			user_id: context.gamer_id
			gamer_id: context.gamer_id
			indexName: indexName
			q: q
			sort: sort
			from: from
			max: max
		.then =>
			@elastic.search
				index: domain.toLowerCase()
				type: indexName
				q: q
				defaultOperator: 'AND'
				sort: sort
				from: from
				size: max
				search_type: search_type

	# query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
	query: (context, domain, indexName, query, from, max, search_type='query_then_fetch') ->
		@handleHook "before-index-query", context, domain,
			domain: domain
			user_id: context.gamer_id
			gamer_id: context.gamer_id
			indexName: indexName
			query: query
			from: from
			max: max
		.then =>
			@elastic.search
				index: domain.toLowerCase()
				type: indexName
				body: query
				from: from
				size: max
				search_type: search_type

	delete: (context, domain, indexName, objectId)->
		@handleHook "before-index-delete", context, domain,
			domain: domain
			user_id: context.gamer_id
			gamer_id: context.gamer_id
			indexName: indexName
			objectId: objectId
		.then =>
			@elastic.delete
				index: domain.toLowerCase()
				type: indexName
				id: objectId

	sandbox: (context)->
		index: (domain, indexName, objectId, properties, payload) =>
			if @parent.game.checkDomainSync context.game.appid, domain
				@index context, domain, indexName, objectId, properties, payload
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		# q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
		# sort: ['field1', 'field2']
		search: (domain, indexName, q, sort=[], from=0, max=10)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@search context, domain, indexName, q, sort, from, max, search_type
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		# query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
		query: (domain, indexName, query, from=0, max=10)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@query context, domain, indexName, query, from, max, search_type
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		delete: (domain, indexName, objectId)=>
			if @parent.game.checkDomainSync context.game.appid, domain
				@delete context, domain, indexName, objectId
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		getClient: ()=> # OpenSource version ONLY, not available in the hosted edition
			@elastic

module.exports = new IndexAPI()
